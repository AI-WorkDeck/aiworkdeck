// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.contractreview;

import com.checkba.model.entity.ContractReviewRun;
import com.checkba.model.entity.ContractReviewStandard;
import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ContractReviewRunRepository;
import com.checkba.repository.ContractReviewStandardRepository;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.repository.ProjectRepository;
import com.checkba.service.DocumentTextService;
import com.checkba.service.LangText;
import com.checkba.service.account.AccountException;
import com.checkba.service.platform.GatewayException;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.ProjectFileAccessService;
import com.checkba.service.ai.AuxModelResolver;
import com.checkba.service.ai.ChatModelFactory;
import com.checkba.service.ai.PlatformAiUserScope;
import com.checkba.service.ai.TokenUsageService;
import com.checkba.service.contractreview.ContractReviewViews.*;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.langchain4j.data.message.AiMessage;
import dev.langchain4j.data.message.UserMessage;
import dev.langchain4j.model.output.Response;
import dev.langchain4j.model.output.FinishReason;
import jakarta.annotation.PreDestroy;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.*;

@Service
@RequiredArgsConstructor
public class ContractReviewService {
    static final int MAX_CHARS = 60_000;
    private final ContractReviewStandardRepository standards;
    private final ContractReviewRunRepository runs;
    private final ProjectFileRepository files;
    private final ProjectRepository projects;
    private final ProjectMemberService members;
    private final ProjectFileAccessService fileAccess;
    private final DocumentTextService texts;
    private final ChatModelFactory models;
    private final AuxModelResolver aux;
    private final TokenUsageService usage;
    private final ObjectMapper mapper;
    private final TransactionTemplate transactions;
    private final Set<String> inFlight = ConcurrentHashMap.newKeySet();
    // No queue: bounded memory and a deadline that includes provider setup and billing checks.
    private final ExecutorService executor = new ThreadPoolExecutor(0, 2, 30, TimeUnit.SECONDS,
            new SynchronousQueue<>(), r -> { Thread t = new Thread(r, "contract-review"); t.setDaemon(true); return t; });

    @PreDestroy public void close() { executor.shutdownNow(); }

    public List<StandardView> list(Long userId, Long projectId) {
        access(userId, projectId, false);
        return standards.findByProjectIdOrderByUpdatedAtDesc(projectId).stream().map(this::view).toList();
    }

    public StandardView save(Long userId, Long projectId, SaveStandard body) {
        access(userId, projectId, true);
        if (body == null || body.rules() == null || body.rules().isEmpty() || body.rules().size() > 20)
            throw new IllegalArgumentException(LangText.of("请填写 1 至 20 条审查规则", "Enter between 1 and 20 review rules"));
        String name = field(body.name(), 120, true);
        String position = field(body.position(), 300, true);
        String jurisdiction = field(body.jurisdiction(), 300, true);
        Set<String> ids = new HashSet<>();
        List<Rule> rules = new ArrayList<>();
        for (Rule rule : body.rules()) {
            if (rule == null) throw new IllegalArgumentException(LangText.of("审查规则不能为空", "Review rules cannot be empty"));
            String id = rule.id() == null || rule.id().isBlank() ? UUID.randomUUID().toString() : rule.id();
            if (!id.matches("[A-Za-z0-9_-]{1,64}") || !ids.add(id)) throw new IllegalArgumentException(LangText.of("规则编号无效或重复", "Rule IDs must be valid and unique"));
            rules.add(new Rule(id, field(rule.title(), 120, true), field(rule.instruction(), 2000, true)));
        }
        return transactions.execute(tx -> {
            lockProject(userId, projectId);
            ContractReviewStandard row = body.id() == null ? new ContractReviewStandard() : locked(body.id(), projectId);
            if (body.id() != null) {
                if (!Objects.equals(body.expectedVersion(), row.getVersion()))
                    throw new IllegalArgumentException(LangText.of("审查标准已更新，请刷新后再保存", "The standard has changed. Refresh before saving."));
                row.setVersion(row.getVersion() + 1);
            }
            row.setProjectId(projectId); row.setName(name); row.setPosition(position); row.setJurisdiction(jurisdiction);
            row.setRulesJson(json(rules)); row.setConfirmedVersion(null); row.setConfirmedAt(null);
            row.setUpdatedAt(LocalDateTime.now());
            return view(standards.saveAndFlush(row));
        });
    }

    public StandardView confirm(Long userId, Long projectId, Long id, long version) {
        access(userId, projectId, true);
        return transactions.execute(tx -> {
            lockProject(userId, projectId);
            ContractReviewStandard row = locked(id, projectId);
            if (row.getVersion() != version) throw new IllegalArgumentException(LangText.of("审查标准已更新，请确认最新版本", "The standard has changed. Confirm the latest version."));
            row.setConfirmedVersion(version); row.setConfirmedAt(LocalDateTime.now());
            return view(standards.saveAndFlush(row));
        });
    }

    public RunView run(Long userId, Long projectId, StartRun body) {
        access(userId, projectId, true);
        if (body == null) throw new IllegalArgumentException(LangText.of("请指定文档和审查标准", "Select a document and a review standard"));
        ProjectFile file = document(userId, projectId, body.docFileId());
        String key = projectId + ":" + file.getId();
        if (!inFlight.add(key)) throw new IllegalArgumentException(LangText.of("这份文档正在审查，请稍候", "This document is being reviewed. Please wait."));
        try {
            StandardView standard = transactions.execute(tx -> {
                ContractReviewStandard row = locked(body.standardId(), projectId);
                if (row.getVersion() != body.version() || !Objects.equals(row.getConfirmedVersion(), body.version()))
                    throw new IllegalArgumentException(LangText.of("请先确认当前版本的审查标准", "Confirm the current version of the standard first"));
                return view(row);
            });
            String text = read(file);
            ContractReviewRun row = new ContractReviewRun();
            row.setProjectId(projectId); row.setDocFileId(file.getId()); row.setStandardJson(json(standard));
            row.setDocumentHash(hash(text)); row.setStartedAt(LocalDateTime.now());
            List<Result> results;
            RuntimeException actionable = null;
            Future<Response<AiMessage>> future = null;
            try {
                String prompt = ContractReviewOutput.prompt(standard, text, mapper);
                future = executor.submit(() -> PlatformAiUserScope.call(userId, () -> {
                    models.ensurePaidAccess(userId);
                    Response<AiMessage> response = models.getAuxChatModel(Duration.ofSeconds(85))
                            .generate(List.of(UserMessage.from(prompt)));
                    if (response != null && response.tokenUsage() != null)
                        usage.recordUsage(projectId, userId, aux.auxModelId(), response.tokenUsage(), null);
                    return response;
                }));
                Response<AiMessage> response = future.get(90, TimeUnit.SECONDS);
                String raw = response == null || response.content() == null || response.finishReason() == FinishReason.LENGTH
                        ? null : response.content().text();
                ContractReviewOutput.Parsed parsed = ContractReviewOutput.parse(raw, standard, text, mapper);
                results = parsed.results();
                row.setStatus(parsed.partial() ? "PARTIAL" : "DONE");
            } catch (Exception e) {
                if (future != null) future.cancel(true);
                Throwable cause = e instanceof ExecutionException && e.getCause() != null ? e.getCause() : e;
                if (cause instanceof AccountException || cause instanceof GatewayException)
                    actionable = (RuntimeException) cause;
                if (e instanceof InterruptedException) Thread.currentThread().interrupt();
                row.setStatus("FAILED");
                row.setError(e instanceof TimeoutException ? LangText.of("审查超时，本次未完成，请稍后重试。", "The review timed out and is incomplete. Please try again.")
                        : e instanceof RejectedExecutionException ? LangText.of("当前审查任务较多，请稍后重试。", "Review capacity is busy. Please try again later.")
                        : LangText.of("AI 审查未完成，请检查账户连接、额度或网络后重试。", "AI review is incomplete. Check your account, credits or connection before retrying."));
                results = ContractReviewOutput.unreviewed(standard, row.getError());
            }
            row.setResultsJson(json(results)); row.setFinishedAt(LocalDateTime.now());
            transactions.executeWithoutResult(tx -> {
                lockProject(userId, projectId);
                document(userId, projectId, body.docFileId());
                runs.saveAndFlush(row);
            });
            if (actionable != null) throw actionable;
            return runView(row, isStale(row, file));
        } finally { inFlight.remove(key); }
    }

    public RunView latest(Long userId, Long projectId, Long docFileId) {
        access(userId, projectId, false);
        ProjectFile file = document(userId, projectId, docFileId);
        return runs.findFirstByProjectIdAndDocFileIdOrderByIdDesc(projectId, docFileId)
                .map(row -> runView(row, isStale(row, file))).orElse(null);
    }

    private boolean isStale(ContractReviewRun row, ProjectFile file) {
        try { return !row.getDocumentHash().equals(hash(read(file))); }
        catch (RuntimeException ignored) { return true; }
    }

    private String read(ProjectFile file) {
        try {
            String text = texts.extractText(file);
            if (text == null || text.isBlank()) throw new IllegalArgumentException(LangText.of("文档没有可读取的正文，请先保存文档", "No readable document text. Save the document first."));
            if (text.length() > MAX_CHARS) throw new IllegalArgumentException(LangText.of("文档超过 60000 字符，请拆分后审查；本次未发送 AI", "The document exceeds 60,000 characters. Split it before review; nothing was sent to AI."));
            return text;
        } catch (IllegalArgumentException e) { throw e; }
        catch (Exception e) { throw new IllegalArgumentException(LangText.of("无法完整读取文档，请保存后重试", "The document could not be read in full. Save it and retry.")); }
    }

    private void access(Long userId, Long projectId, boolean write) {
        if (userId == null || projectId == null || fileAccess.isClient(projectId, userId)
                || !(write ? members.hasWritePermission(projectId, userId) : members.hasReadPermission(projectId, userId)))
            throw new IllegalArgumentException(LangText.of("无权限访问或修改该项目的审查资料", "No permission to access or change this project’s review materials"));
    }

    private ProjectFile document(Long userId, Long projectId, Long id) {
        if (id == null) throw new IllegalArgumentException(LangText.of("请指定文档", "Select a document"));
        ProjectFile file = files.findById(id).orElseThrow(() -> new IllegalArgumentException(LangText.of("文件不存在", "File not found")));
        if (!Objects.equals(projectId, file.getProjectId()) || Boolean.TRUE.equals(file.getIsDeleted()))
            throw new IllegalArgumentException(LangText.of("文件不存在", "File not found"));
        fileAccess.requireRead(file, userId);
        if (Boolean.TRUE.equals(file.getIsFolder()) || !("docx".equalsIgnoreCase(file.getFileType())
                || (file.getName() != null && file.getName().toLowerCase(Locale.ROOT).endsWith(".docx"))))
            throw new IllegalArgumentException(LangText.of("请使用已保存的 DOCX 文档进行合同审查", "Use a saved DOCX document for contract review"));
        return file;
    }

    private void lockProject(Long userId, Long projectId) {
        projects.lockForImWrite(projectId).orElseThrow(() -> new IllegalArgumentException(LangText.of("项目不存在", "Project not found")));
        access(userId, projectId, true);
    }

    private ContractReviewStandard locked(Long id, Long projectId) {
        if (id == null) throw new IllegalArgumentException(LangText.of("请指定审查标准", "Select a review standard"));
        return standards.lockInProject(id, projectId).orElseThrow(() -> new IllegalArgumentException(LangText.of("审查标准不存在", "Review standard not found")));
    }

    private StandardView view(ContractReviewStandard row) {
        return new StandardView(row.getId(), row.getName(), row.getPosition(), row.getJurisdiction(),
                fromJson(row.getRulesJson(), new TypeReference<List<Rule>>() {}), row.getVersion(), row.getConfirmedVersion(),
                row.getConfirmedAt(), row.getUpdatedAt());
    }

    private RunView runView(ContractReviewRun row, boolean stale) {
        return new RunView(row.getId(), row.getDocFileId(), fromJson(row.getStandardJson(), new TypeReference<StandardView>() {}),
                row.getStatus(), fromJson(row.getResultsJson(), new TypeReference<List<Result>>() {}), row.getDocumentHash(),
                stale, row.getStartedAt(), row.getFinishedAt(), row.getError());
    }
    private String json(Object value) {
        try { return mapper.writeValueAsString(value); }
        catch (Exception e) { throw new IllegalStateException(LangText.of("无法保存审查资料", "Could not save review materials"), e); }
    }
    private <T> T fromJson(String value, TypeReference<T> type) {
        try { return mapper.readValue(value, type); }
        catch (Exception e) { throw new IllegalStateException(LangText.of("无法读取审查资料", "Could not read review materials"), e); }
    }
    private static String field(String value, int limit, boolean required) {
        String text = value == null ? "" : value.trim();
        if ((required && text.isEmpty()) || text.length() > limit) throw new IllegalArgumentException(LangText.of("审查标准字段为空或超过长度限制", "A required standard field is empty or exceeds its length limit"));
        return text;
    }
    private static String hash(String text) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
}
