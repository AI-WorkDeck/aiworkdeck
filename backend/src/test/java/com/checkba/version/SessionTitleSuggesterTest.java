// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.version;

import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.repository.ProjectRepository;
import com.checkba.repository.UserRepository;
import com.checkba.service.ai.AuxModelResolver;
import com.checkba.service.ai.ChatModelFactory;
import com.checkba.service.ai.TokenUsageService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.checkba.storage.StorageProperties;
import dev.langchain4j.data.message.AiMessage;
import dev.langchain4j.data.message.ChatMessage;
import dev.langchain4j.model.chat.ChatLanguageModel;
import dev.langchain4j.model.output.Response;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/** 提交弹窗「AI 写说明」：摘要必须覆盖这次提交的全部改动（含已自动存档的），且只带改动的段落。 */
class SessionTitleSuggesterTest {

    private Path root;
    private ProjectRepoService repoSvc;
    private WorkSessionService svc;
    private Map<Long, WorkSession> sessions;
    private long nextSessionId;
    private Map<Long, ProjectFile> db;
    private long nextFileId;
    private ProjectTreeManifestService manifestSvc;
    private WorkSessionRepository sessionRepo;
    private ThreadPoolTaskScheduler scheduler;
    private ProjectFileRepository fileRepo;
    private final List<List<ChatMessage>> prompts = new ArrayList<>();
    private String modelReply = "「补充付款条款」。";
    private SessionTitleSuggester suggester;

    @BeforeEach
    void setUp(@TempDir Path tmp) throws Exception {
        root = tmp;
        Files.createDirectories(root.resolve("projects/7"));
        Files.writeString(root.resolve("projects/7/合同.txt"), "初稿");

        StorageProperties props = new StorageProperties();
        props.getLocal().setRootPath(root.toAbsolutePath().toString());
        repoSvc = new ProjectRepoService(new com.checkba.storage.ProjectStorageResolver(props, null));
        repoSvc.init(7L, "韩泽伟", "hzw@example.com");

        db = new HashMap<>();
        nextFileId = 100L;
        fileRepo = mock(ProjectFileRepository.class);
        when(fileRepo.findByProjectId(any())).thenAnswer(i -> {
            Long pid = i.getArgument(0);
            List<ProjectFile> out = new ArrayList<>();
            for (ProjectFile f : db.values()) if (f.getProjectId().equals(pid)) out.add(f);
            return out;
        });
        when(fileRepo.save(any(ProjectFile.class))).thenAnswer(i -> {
            ProjectFile p = i.getArgument(0);
            if (p.getId() == null) p.setId(nextFileId++);
            db.put(p.getId(), p);
            return p;
        });
        manifestSvc = new ProjectTreeManifestService(fileRepo, repoSvc, new ObjectMapper(),
                mock(UserRepository.class), mock(ProjectRepository.class));

        sessions = new HashMap<>();
        nextSessionId = 1L;
        sessionRepo = mock(WorkSessionRepository.class);
        when(sessionRepo.save(any(WorkSession.class))).thenAnswer(i -> {
            WorkSession s = i.getArgument(0);
            if (s.getId() == null) s.setId(nextSessionId++);
            sessions.put(s.getId(), s);
            return s;
        });
        when(sessionRepo.findFirstByProjectIdAndStatusAndSessionType(any(), any(), any())).thenAnswer(i ->
                sessions.values().stream()
                        .filter(s -> s.getProjectId().equals(i.getArgument(0))
                                && s.getStatus() == i.getArgument(1)
                                && s.getSessionType() == i.getArgument(2))
                        .findFirst());
        when(sessionRepo.findByProjectIdAndStatusAndSessionTypeOrderByStartedAtDesc(any(), any(), any()))
                .thenAnswer(i -> sessions.values().stream()
                        .filter(s -> s.getProjectId().equals(i.getArgument(0))
                                && s.getStatus() == i.getArgument(1)
                                && s.getSessionType() == i.getArgument(2))
                        .sorted(Comparator.comparing(WorkSession::getStartedAt).reversed())
                        .toList());
        when(sessionRepo.findById(any())).thenAnswer(i -> Optional.ofNullable(sessions.get(i.getArgument(0))));

        scheduler = new ThreadPoolTaskScheduler();
        scheduler.initialize();

        svc = new WorkSessionService(repoSvc, manifestSvc, sessionRepo, scheduler, fileRepo, event -> {});
        svc.setDebounceMillis(60_000); // 测试里不让防抖自己触发，全部手动 commitNow
    }

    private SessionTitleSuggester suggester() {
        ChatLanguageModel model = mock(ChatLanguageModel.class);
        when(model.generate(anyList())).thenAnswer(i -> {
            prompts.add(i.getArgument(0));
            return Response.from(AiMessage.from(modelReply));
        });
        ChatModelFactory factory = mock(ChatModelFactory.class);
        when(factory.getAuxChatModel(any())).thenReturn(model);
        return new SessionTitleSuggester(svc, repoSvc, factory, mock(AuxModelResolver.class), mock(TokenUsageService.class));
    }

    private Path project(long id) { return root.resolve("projects/" + id); }

    @Test
    void digestCoversAutosavedAndUnsavedChangesButOnlyChangedParagraphs() throws Exception {
        long pid = 30L;
        Files.createDirectories(project(pid));
        Files.writeString(project(pid).resolve("合同.txt"), "第一条 定义\n第二条 付款期限三十日\n第三条 争议解决");
        Files.writeString(project(pid).resolve("备忘.txt"), "不变");
        svc.enableVersionRecording(pid, "韩泽伟", "hzw@example.com");

        svc.onChangeSignal(pid, 1L, "韩泽伟");
        Files.writeString(project(pid).resolve("合同.txt"), "第一条 定义\n第二条 付款期限六十日\n第三条 争议解决");
        svc.commitNow(pid, 1L, "韩泽伟", null); // 已自动存档进工作段：HEAD 里有，工作区相对 HEAD 已干净
        Files.writeString(project(pid).resolve("附件.txt"), "新增的授权委托书"); // 还没存档

        String digest = suggester().digest(pid);
        assertTrue(digest.contains("MODIFIED: 合同.txt"), digest);
        assertTrue(digest.contains("- 第二条 付款期限三十日") && digest.contains("+ 第二条 付款期限六十日"), digest);
        assertFalse(digest.contains("第一条") || digest.contains("第三条"), "unchanged paragraphs stay out: " + digest);
        assertTrue(digest.contains("ADDED: 附件.txt") && digest.contains("+ 新增的授权委托书"), digest);
        assertFalse(digest.contains("备忘"), digest);
    }

    @Test
    void suggestCleansTheModelReplyAndRefusesWhenNothingChanged() throws Exception {
        long pid = 31L;
        Files.createDirectories(project(pid));
        Files.writeString(project(pid).resolve("合同.txt"), "初稿");
        svc.enableVersionRecording(pid, "韩泽伟", "hzw@example.com");
        SessionTitleSuggester s = suggester();

        VersionException none = assertThrows(VersionException.class, () -> s.suggest(pid, 1L));
        assertTrue(none.isUserFacing());
        assertTrue(prompts.isEmpty(), "no model call without changes");

        Files.writeString(project(pid).resolve("合同.txt"), "初稿\n第四条 付款");
        assertEquals("补充付款条款", s.suggest(pid, 1L));
        assertTrue(prompts.get(0).get(1).toString().contains("+ 第四条 付款"));

        modelReply = "  \n";
        assertTrue(assertThrows(VersionException.class, () -> s.suggest(pid, 1L)).isUserFacing());
    }

    /** 真实 Word 文件：正文经 Tika 抽取，只送改动的条款，跨 run 拆开的数字也要还原成整句。 */
    @Test
    void digestOfAWordContractShowsOnlyTheEditedClauses() throws Exception {
        long pid = 32L;
        Files.createDirectories(project(pid));
        Path original = Path.of("../fixtures/evidence-demo-1076/01-购销合同.docx");
        Files.copy(original, project(pid).resolve("合同.docx"));
        svc.enableVersionRecording(pid, "韩泽伟", "hzw@example.com");

        Files.write(project(pid).resolve("合同.docx"), editDocx(Files.readAllBytes(original)));
        String digest = suggester().digest(pid);
        assertTrue(digest.startsWith("MODIFIED: 合同.docx"), digest);
        assertTrue(digest.contains("- 5.1 甲方应于验收合格后 15 日内一次性支付合同总价。"), digest);
        assertTrue(digest.contains("+ 5.1 甲方应于验收合格后 30 日内一次性支付合同总价。"), digest);
        assertTrue(digest.contains("+ 8.1 甲方逾期付款的，每逾期一日按未付金额的万分之五支付违约金。"), digest);
        assertFalse(digest.contains("第一条") || digest.contains("第九条"), "unchanged clauses stay out: " + digest);
    }

    /** 与编辑器保存同形：只改 document.xml 里的两处文字，其余部件原样。 */
    private static byte[] editDocx(byte[] docx) throws Exception {
        var out = new java.io.ByteArrayOutputStream();
        try (var in = new java.util.zip.ZipInputStream(new java.io.ByteArrayInputStream(docx));
             var zip = new java.util.zip.ZipOutputStream(out)) {
            for (var e = in.getNextEntry(); e != null; e = in.getNextEntry()) {
                byte[] bytes = in.readAllBytes();
                if (e.getName().equals("word/document.xml")) {
                    String xml = new String(bytes, java.nio.charset.StandardCharsets.UTF_8)
                            .replace("验收合格后</w:t></w:r><w:r><w:t xml:space=\"preserve\"> 15 </w:t>",
                                    "验收合格后</w:t></w:r><w:r><w:t xml:space=\"preserve\"> 30 </w:t>")
                            .replace("万分之三", "万分之五");
                    bytes = xml.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                }
                zip.putNextEntry(new java.util.zip.ZipEntry(e.getName()));
                zip.write(bytes);
                zip.closeEntry();
            }
        }
        return out.toByteArray();
    }

    @Test
    void cleanTitleStripsLabelsQuotesAndTrailingPunctuation() {
        assertEquals("Add payment terms", SessionTitleSuggester.cleanTitle("Title: \"Add payment terms.\"\nExplanation"));
        assertEquals("下调违约金比例", SessionTitleSuggester.cleanTitle("标题：「下调违约金比例」。"));
        assertEquals("修改《股权转让协议》", SessionTitleSuggester.cleanTitle("修改《股权转让协议》。"));
        assertEquals("调整付款期限", SessionTitleSuggester.cleanTitle("<think>\n先看改动……\n</think>\n\n调整付款期限"));
        assertEquals("调整付款期限", SessionTitleSuggester.cleanTitle("<final>调整付款期限</final>"));
        assertEquals(SessionTitleSuggester.MAX_TITLE_CHARS, SessionTitleSuggester.cleanTitle("长".repeat(200)).length());
    }
}
