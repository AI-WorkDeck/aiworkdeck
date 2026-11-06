// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.version;

import com.checkba.service.LangText;
import com.checkba.service.ai.AuxModelResolver;
import com.checkba.service.ai.ChatModelFactory;
import com.checkba.service.ai.PlatformAiUserScope;
import com.checkba.service.ai.TokenUsageService;
import dev.langchain4j.data.message.AiMessage;
import dev.langchain4j.data.message.SystemMessage;
import dev.langchain4j.data.message.UserMessage;
import dev.langchain4j.model.output.Response;
import lombok.extern.slf4j.Slf4j;
import org.apache.tika.Tika;
import org.springframework.stereotype.Service;

import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Arrays;
import java.util.List;

/**
 * 「提交本次改动」弹窗里的 AI 按钮：把这次要提交的改动压成一份小摘要，交给辅助模型（便宜档）
 * 写一句标题。律师可以改，也可以不用；不调用就和以前一样留空走默认标题。
 */
@Slf4j
@Service
public class SessionTitleSuggester {

    static final int FILE_CHARS = 1500;
    static final int TOTAL_CHARS = 6000;
    static final int MAX_TITLE_CHARS = 60;
    private static final long MAX_EXTRACT_BYTES = 20L * 1024 * 1024;

    private final WorkSessionService sessionService;
    private final ProjectRepoService repoService;
    private final ChatModelFactory chatModelFactory;
    private final AuxModelResolver auxModelResolver;
    private final TokenUsageService tokenUsageService;

    public SessionTitleSuggester(WorkSessionService sessionService, ProjectRepoService repoService,
                                 ChatModelFactory chatModelFactory, AuxModelResolver auxModelResolver,
                                 TokenUsageService tokenUsageService) {
        this.sessionService = sessionService;
        this.repoService = repoService;
        this.chatModelFactory = chatModelFactory;
        this.auxModelResolver = auxModelResolver;
        this.tokenUsageService = tokenUsageService;
    }

    public String suggest(long projectId, Long userId) {
        String digest = digest(projectId);
        if (digest.isEmpty()) {
            throw VersionException.userFacing(LangText.of("这次没有可总结的改动", "There are no changes to summarize"));
        }
        String system = LangText.of(
                "你在为律师的文档版本写提交说明。根据下面的改动，写一句不超过 20 个字的标题，说明这次改了什么，"
                        + "例如「补充付款条款」「下调违约金比例」。只输出标题本身，不加引号、句号或解释。",
                "You write commit titles for a lawyer's document versions. From the changes below, write one title of at most "
                        + "10 words saying what changed, e.g. \"Add payment terms\". Write it in the language of locale "
                        + LangText.localeCode() + ". Output only the title: no quotes, period or explanation.");
        try {
            Response<AiMessage> r = PlatformAiUserScope.call(userId, () -> chatModelFactory
                    .getAuxChatModel(Duration.ofSeconds(30))
                    .generate(List.of(SystemMessage.from(system), UserMessage.from(digest))));
            recordUsage(projectId, userId, r);
            String title = cleanTitle(r.content() == null ? null : r.content().text());
            if (!title.isEmpty()) return title;
        } catch (RuntimeException e) {
            log.warn("提交说明生成失败: project={}", projectId, e);
        }
        throw VersionException.userFacing(LangText.of("暂时没能生成说明，请手动填写", "Couldn't draft a title right now; please type one"));
    }

    /** Model input: one block per changed file, its removed/added paragraphs trimmed to a budget. */
    String digest(long projectId) {
        WorkSessionService.CommitPreview preview = sessionService.commitPreview(projectId);
        StringBuilder out = new StringBuilder();
        for (FileChange change : preview.changes()) {
            String before = textAt(projectId, preview.base(), change.path());
            String after = textInWorkTree(projectId, change.path());
            if (before == null && after == null) continue; // 本次新建又删掉，净改动为零
            String head = (before == null ? "ADDED: " : after == null ? "DELETED: " : "MODIFIED: ") + change.path();
            if (out.length() + head.length() > TOTAL_CHARS) break;
            out.append(head).append('\n');
            if (after == null) continue;
            String delta = before == null ? prefixed("+ ", paragraphs(after)) : lineDelta(before, after);
            int room = Math.min(FILE_CHARS, TOTAL_CHARS - out.length());
            if (room <= 0) continue;
            out.append(delta.length() > room ? delta.substring(0, room) + "…\n" : delta);
        }
        return out.toString().trim();
    }

    /** Common leading/trailing paragraphs dropped; what is left in the middle is what changed. */
    static String lineDelta(String before, String after) {
        String[] a = paragraphs(before);
        String[] b = paragraphs(after);
        int start = 0;
        while (start < a.length && start < b.length && a[start].equals(b[start])) start++;
        int endA = a.length;
        int endB = b.length;
        while (endA > start && endB > start && a[endA - 1].equals(b[endB - 1])) { endA--; endB--; }
        return prefixed("- ", Arrays.copyOfRange(a, start, endA)) + prefixed("+ ", Arrays.copyOfRange(b, start, endB));
    }

    static String cleanTitle(String raw) {
        if (raw == null) return "";
        String line = raw.strip().lines().filter(l -> !l.isBlank()).findFirst().orElse("").strip();
        line = line.replaceAll("^(标题|Title)\\s*[:：]\\s*", "");
        // 《》 不剥：标题常以书名号结尾（「修改《股权转让协议》」）
        line = line.replaceAll("^[\"'“”‘’「」『』*`\\s]+|[\"'“”‘’「」『』*`。．.！!\\s]+$", "");
        return line.length() > MAX_TITLE_CHARS ? line.substring(0, MAX_TITLE_CHARS) : line;
    }

    private static String[] paragraphs(String text) {
        return text.lines().map(String::strip).filter(l -> !l.isEmpty()).toArray(String[]::new);
    }

    private static String prefixed(String mark, String[] lines) {
        StringBuilder sb = new StringBuilder();
        for (String l : lines) sb.append(mark).append(l).append('\n');
        return sb.toString();
    }

    private String textAt(long projectId, String ref, String path) {
        try {
            byte[] bytes = repoService.readBlobAtCommit(projectId, ref, path);
            return bytes == null ? null : extract(bytes);
        } catch (RuntimeException e) {
            return ""; // 超大文件等读不出正文：仍按「修改」列出文件名
        }
    }

    private String textInWorkTree(long projectId, String path) {
        Path root = repoService.workTree(projectId).toAbsolutePath().normalize();
        Path file = root.resolve(path).normalize();
        if (!file.startsWith(root) || !Files.isRegularFile(file)) return null;
        try {
            if (Files.size(file) > MAX_EXTRACT_BYTES) return "";
            return extract(Files.readAllBytes(file));
        } catch (Exception e) {
            return "";
        }
    }

    private static String extract(byte[] bytes) {
        try (var in = new ByteArrayInputStream(bytes)) {
            String text = new Tika().parseToString(in);
            return text == null ? "" : text;
        } catch (Exception e) {
            return "";
        }
    }

    private void recordUsage(long projectId, Long userId, Response<AiMessage> r) {
        try {
            if (r.tokenUsage() != null) {
                tokenUsageService.recordUsage(projectId, userId, auxModelResolver.auxModelId(), r.tokenUsage(), null);
            }
        } catch (Exception e) {
            log.warn("提交说明 token 记账失败: {}", e.getMessage());
        }
    }
}
