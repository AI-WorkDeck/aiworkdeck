// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.dd;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.service.*;
import com.checkba.service.evidence.EvidenceTextExtractor;
import com.checkba.storage.StorageServiceFactory;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.annotation.PreDestroy;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.event.*;
import java.io.*;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

/** Persistent queue: no fabricated progress, no replay of an uncertain paid request after restart. */
@Service @RequiredArgsConstructor
public class DdAiService {
    private final DdAiJobRepository jobs;
    private final DdSubmissionRepository submissions;
    private final DdItemRepository items;
    private final DdRequestRepository requests;
    private final ProjectFileRepository files;
    private final ProjectRepository projects;
    private final ProjectFileService projectFiles;
    private final ProjectMemberService members;
    private final DdService dd;
    private final EvidenceTextExtractor extractor;
    private final DdAiGateway ai;
    private final ObjectMapper json;
    private final StorageServiceFactory storage;
    private final TransactionTemplate transactions;
    private final org.springframework.beans.factory.ObjectProvider<DdMaterialService> materials;
    private final ExecutorService workers = Executors.newFixedThreadPool(2, r -> {
        Thread thread = new Thread(r, "dd-workflow"); thread.setDaemon(true); return thread;
    });
    private final AtomicInteger running = new AtomicInteger();

    public synchronized DdAiJob enqueue(Long projectId, Long userId, String kind, Long itemId, Long submissionId, Map<String, ?> input) {
        return enqueue(projectId, userId, kind, itemId, submissionId, input, null);
    }

    public synchronized DdAiJob enqueue(Long projectId, Long userId, String kind, Long itemId, Long submissionId, Map<String, ?> input, String key) {
        String serialized, hash;
        try {
            serialized = json.writeValueAsString(new TreeMap<>(input));
            hash = HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(serialized.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        } catch (Exception e) { throw new DdProcessingException("任务内容无法保存"); }
        if (key != null) {
            if (key.isBlank() || key.length() > 100) throw new DdProcessingException("提交标识无效，请刷新后重试");
            Optional<DdAiJob> existing = jobs.findByProjectIdAndUserIdAndKindAndIdempotencyKey(projectId, userId, kind, key);
            if (existing.isPresent()) {
                if (!Objects.equals(existing.get().getInputHash(), hash)) throw new DdProcessingException("本次提交内容已经改变，请重新发起");
                return existing.get();
            }
        }
        if (jobs.countByStatusIn(List.of("QUEUED", "RUNNING")) >= 64) throw new DdProcessingException("当前处理较多，请稍后重试；尚未发起AI请求");
        DdAiJob job = new DdAiJob();
        job.setId(UUID.randomUUID().toString()); job.setProjectId(projectId); job.setUserId(userId);
        job.setKind(kind); job.setItemId(itemId); job.setSubmissionId(submissionId);
        job.setInputJson(serialized); job.setInputHash(hash); job.setIdempotencyKey(key);
        return jobs.save(job);
    }

    public Map<String, Object> view(DdAiJob job) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", job.getId()); out.put("status", job.getStatus()); out.put("stage", job.getStage());
        out.put("createdAt", job.getCreatedAt()); out.put("startedAt", job.getStartedAt());
        out.put("finishedAt", job.getFinishedAt()); out.put("error", job.getError());
        out.put("resultJson", job.getResultJson());
        try { out.put("result", job.getResultJson() == null ? null : json.readTree(job.getResultJson())); }
        catch (IOException ignored) { out.put("result", null); }
        return out;
    }

    public DdAiJob get(String id) { return jobs.findById(id).orElseThrow(() -> new DdProcessingException("任务不存在")); }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    @org.springframework.transaction.annotation.Transactional(propagation = org.springframework.transaction.annotation.Propagation.REQUIRES_NEW)
    public void submitted(DdSubmissionCreated event) {
        try { reviewSubmission(event.submissionId()); }
        catch (DdProcessingException e) {
            try { submissions.updateAssessment(event.submissionId(), "MANUAL_REQUIRED", json.writeValueAsString(
                    Map.of("verdict", "MANUAL_REQUIRED", "summary", e.getMessage(), "checks", List.of()))); }
            catch (IOException ignored) { /* constant scalar JSON */ }
        }
    }

    public synchronized DdAiJob reviewSubmission(Long submissionId) {
        DdSubmission submission = submissions.findById(submissionId).orElseThrow(() -> new DdProcessingException("提交记录不存在"));
        DdRequest request = dd.getRequest(submission.getRequestId());
        if (!"PUBLISHED".equals(request.getStatus()) || !items.findById(submission.getItemId())
                .map(item -> submissionId.equals(item.getCurrentSubmissionId())).orElse(false))
            throw new DdProcessingException("仅能核验进行中清单的当前材料版本");
        if (!submission.isAiConsent() || !Boolean.TRUE.equals(request.getAiReviewEnabled()) || !"FILES".equals(submission.getType()))
            throw new DdProcessingException("这份提交按人工复核处理");
        Optional<DdAiJob> existing = jobs.findFirstByKindAndSubmissionIdAndStatusInOrderByCreatedAtDesc(
                "VERIFY", submissionId, List.of("QUEUED", "RUNNING"));
        if (existing.isPresent()) return existing.get();
        if ("PASSED".equals(submission.getAiStatus())) return jobs.findFirstByKindAndSubmissionIdAndStatusInOrderByCreatedAtDesc(
                "VERIFY", submissionId, List.of("SUCCEEDED")).orElseThrow(() -> new DdProcessingException("本版材料已完成AI核验"));
        if (jobs.countByKindAndSubmissionId("VERIFY", submissionId) >= 3)
            throw new DdProcessingException("本版材料已核验三次，请补传更清晰的材料或提交律师复核");
        Long reviewer = request.getPublishedBy() != null ? request.getPublishedBy() : request.getCreatedBy();
        DdAiJob job = enqueue(request.getProjectId(), reviewer, "VERIFY", submission.getItemId(), submissionId, Map.of());
        submissions.updateAssessment(submissionId, "QUEUED", null);
        return job;
    }

    public synchronized DdAiJob example(Long itemId, Long userId) {
        DdItem item = items.findById(itemId).orElseThrow(() -> new DdProcessingException("清单项不存在"));
        if (!"DRAFT".equals(dd.getRequest(item.getDdRequestId()).getStatus())) throw new DdProcessingException("已发布清单的示例不能直接替换");
        Optional<DdAiJob> existing = jobs.findFirstByKindAndItemIdAndStatusInOrderByCreatedAtDesc("EXAMPLE", itemId, List.of("QUEUED", "RUNNING"));
        if (existing.isPresent()) return existing.get();
        return enqueue(dd.getProjectIdByItemId(itemId), userId, "EXAMPLE", itemId, null,
                Map.of("title", item.getTitle(), "description", Objects.toString(item.getDescription(), "")));
    }

    @EventListener(ApplicationReadyEvent.class)
    public void recoverInterrupted() {
        List<DdAiJob> interrupted;
        do {
            interrupted = jobs.findTop8ByStatusOrderByCreatedAtAsc("RUNNING");
            for (DdAiJob job : interrupted)
                fail(job, "服务重启中断了本次处理。材料已保留，请重试；系统没有自动重复付费请求。");
        } while (!interrupted.isEmpty());
    }

    @Scheduled(fixedDelay = 1500)
    public void dispatch() {
        if (running.get() >= 2) return;
        for (DdAiJob candidate : jobs.findTop8ByStatusOrderByCreatedAtAsc("QUEUED")) {
            if (running.incrementAndGet() > 2) { running.decrementAndGet(); break; }
            if (jobs.claim(candidate.getId()) != 1) { running.decrementAndGet(); continue; }
            workers.execute(() -> {
                DdAiJob job = candidate;
                try {
                    job = get(candidate.getId());
                    if (!members.hasWritePermission(job.getProjectId(), job.getUserId())) throw new DdProcessingException("项目授权已变更，请由当前负责律师重新发起");
                    JsonNode input = json.readTree(job.getInputJson());
                    Object result = switch (job.getKind()) {
                        case "VERIFY" -> verify(job);
                        case "EXAMPLE" -> generateExample(job, input);
                        case "IMPORT" -> importChecklist(job, input);
                        case "MATERIALS" -> materials.getObject().importMaterials(job, input);
                        case "REPORT" -> materials.getObject().report(job, input);
                        default -> throw new DdProcessingException("未知处理任务");
                    };
                    jobs.finish(job.getId(), "SUCCEEDED", "处理完成", json.writeValueAsString(result), null);
                } catch (Exception e) {
                    // Provider bodies, file text and credentials must not enter logs or public errors.
                    String message = e instanceof DdProcessingException ? e.getMessage() : null;
                    if (e instanceof com.checkba.service.platform.GatewayException gateway) message = gateway.userHint();
                    fail(job, message == null || message.isBlank() || message.length() > 500 ? "处理未完成，原材料已保留，请重试或联系律师复核" : message);
                } finally { running.decrementAndGet(); }
            });
        }
    }

    public void stage(DdAiJob job, String stage) {
        if (jobs.progress(job.getId(), stage) != 1) throw new DdProcessingException("任务已结束或项目已删除");
    }

    private void fail(DdAiJob job, String reason) {
        if (jobs.finish(job.getId(), "FAILED", "需要处理", null, reason) != 1) return;
        if ("VERIFY".equals(job.getKind()) && job.getSubmissionId() != null) {
            try { submissions.updateAssessment(job.getSubmissionId(), "MANUAL_REQUIRED",
                    json.writeValueAsString(Map.of("verdict", "MANUAL_REQUIRED", "summary", reason, "checks", List.of()))); }
            catch (IOException ignored) { /* constant scalar JSON is serializable */ }
        }
    }

    private Map<String, Object> verify(DdAiJob job) throws IOException {
        DdSubmission submission = submissions.findById(job.getSubmissionId()).orElseThrow();
        DdItem item = items.findById(submission.getItemId()).orElseThrow();
        if (!submission.isAiConsent() || !"FILES".equals(submission.getType())) throw new DdProcessingException("本次提交未启用AI核验");
        submissions.updateAssessment(submission.getId(), "RUNNING", null);
        stage(job, "读取提交材料");
        Map<Long, String> texts = new LinkedHashMap<>(); List<String> unreadable = new ArrayList<>();
        int total = 0;
        for (Long id : submission.getFileIds()) {
            ProjectFile file = files.findById(id).filter(f -> job.getProjectId().equals(f.getProjectId())).orElseThrow();
            String text = extractor.textOf(file, job.getUserId());
            if (text == null || text.isBlank()) unreadable.add(file.getName());
            else { total += text.length(); texts.put(id, text); }
        }
        JsonNode result;
        if (!unreadable.isEmpty() || texts.isEmpty() || total > 160_000) {
            result = json.valueToTree(Map.of("verdict", "MANUAL_REQUIRED", "summary",
                    total > 160_000 ? "材料较长，需要律师完整复核；已保留全部文件。" : "以下材料无法完整读取：" + String.join("、", unreadable) + "。可上传清晰的图片或可读取的PDF，也可提交说明请律师复核。", "checks", List.of()));
        } else {
            stage(job, "逐项比对材料要求");
            result = ai.structured(job.getProjectId(), job.getUserId(), """
                你是尽调收件核验助手。只检查提交的文件是否满足本清单项的收件要求，不能判断证照真伪、法律合规或替律师作专业结论。
                按文件类型、要求的主体/日期/版本、内容完整性分别检查。不同于示例的排版不是不合格理由。
                文件文字提到某事项不等于已核实。看不清、页码缺失、主体/版本不确定一律MANUAL_REQUIRED，明确如何补正。
                返回 {"verdict":"PASSED|FAILED|MANUAL_REQUIRED","summary":"给客户的具体原因与下一步",
                "checks":[{"requirement":"核验要求","status":"PASS|FAIL|UNKNOWN","reason":"判断依据",
                "fileId":数字,"quote":"从该文件原文逐字摘录的依据"}]}。
                每条quote只复制原文中一处连续的短句，尽量不跨行；不能拼接、调序、概括或插入省略号。主体、日期、上下级关系分开检查，各自引用对应短句。
                quote解码后必须是文件原文的连续子串。确需跨行时使用JSON换行转义，不能把反斜杠和字母n作为引文文字。
                PASSED必须至少三项检查全为PASS并有确切原文依据；明确不符合要求才FAILED；未要求的字段不得擅自变成必交条件。
                """, json.writeValueAsString(Map.of("title", item.getTitle(), "requirements", Objects.toString(item.getDescription(), ""), "files", texts)));
            result = validateReview(result, texts, json);
        }
        String status = result.path("verdict").asText("MANUAL_REQUIRED");
        // The AI owns only its assessment. It cannot update the lawyer's decision or the current file pointer.
        submissions.updateAssessment(submission.getId(), status, json.writeValueAsString(result));
        return json.convertValue(result, new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {});
    }

    public static JsonNode validateReview(JsonNode result, Map<Long, String> texts, ObjectMapper json) {
        if (result == null || !result.isObject() || !Set.of("PASSED", "FAILED", "MANUAL_REQUIRED").contains(result.path("verdict").asText())
                || result.path("summary").asText().isBlank() || !result.path("checks").isArray())
            throw new DdProcessingException("AI核验结果不完整，请重试或交由律师复核");
        boolean complete = result.path("checks").size() >= 3;
        boolean validFailure = false, invalidEvidence = false;
        Set<Long> covered = new HashSet<>();
        for (JsonNode check : result.path("checks")) {
            String quote = check.path("quote").asText(), text = texts.get(check.path("fileId").asLong());
            boolean grounded = !quote.isBlank() && text != null && text.contains(quote);
            complete &= "PASS".equals(check.path("status").asText()) && grounded
                    && !check.path("requirement").asText().isBlank() && !check.path("reason").asText().isBlank();
            if (grounded) covered.add(check.path("fileId").asLong());
            boolean meaningful = !check.path("requirement").asText().isBlank() && !check.path("reason").asText().isBlank();
            validFailure |= "FAIL".equals(check.path("status").asText()) && meaningful;
            // Missing pages may have no positive quote; a claimed quote must always be authentic.
            invalidEvidence |= check.hasNonNull("fileId") && text == null || !quote.isBlank() && !grounded;
        }
        complete &= covered.containsAll(texts.keySet());
        if ("PASSED".equals(result.path("verdict").asText()) && !complete
                || "FAILED".equals(result.path("verdict").asText()) && (!validFailure || invalidEvidence)) {
            ObjectNode safe = result.deepCopy(); safe.put("verdict", "MANUAL_REQUIRED");
            safe.put("summary", "AI未能为全部检查提供可核对的原文依据，请律师复核。材料已保留。"); return safe;
        }
        return result;
    }

    private Map<String, Object> generateExample(DdAiJob job, JsonNode input) throws IOException {
        stage(job, "生成材料准备参考图");
        byte[] image = ai.example(job.getProjectId(), job.getUserId(), input.path("title").asText(), input.path("description").asText());
        java.awt.image.BufferedImage picture;
        try (var stream = javax.imageio.ImageIO.createImageInputStream(new ByteArrayInputStream(image))) {
            var readers = javax.imageio.ImageIO.getImageReaders(stream);
            if (!readers.hasNext()) throw new DdProcessingException("生成的参考图无法读取，请重试");
            var reader = readers.next();
            try {
                reader.setInput(stream);
                if (reader.getWidth(0) > 8192 || reader.getHeight(0) > 8192) throw new DdProcessingException("生成的参考图尺寸过大，请重试");
                picture = reader.read(0);
            } finally { reader.dispose(); }
        }
        ByteArrayOutputStream png = new ByteArrayOutputStream(); javax.imageio.ImageIO.write(picture, "png", png);
        return transactions.execute(tx -> {
            Long requestId = items.findRequestIdById(job.getItemId()).orElseThrow();
            DdRequest request = requests.findByIdForUpdate(requestId).orElseThrow();
            if (!"DRAFT".equals(request.getStatus())) throw new DdProcessingException("生成期间清单已发布，本次结果未替换已发布的参考示例");
            DdItem item = items.findByIdForUpdate(job.getItemId()).orElseThrow();
            if (!Objects.equals(item.getTitle(), input.path("title").asText()) || !Objects.equals(Objects.toString(item.getDescription(), ""), input.path("description").asText()))
                throw new DdProcessingException("生成期间材料要求已修改，请按最新要求重新生成");
            ProjectFile file = saveFile(job.getProjectId(), job.getUserId(), "示例-" + input.path("title").asText().substring(0, Math.min(60, input.path("title").asText().length())) + ".png", "png", png.toByteArray(), null);
            item.setExampleFileId(file.getId()); items.save(item);
            return Map.<String, Object>of("fileId", file.getId(), "itemId", job.getItemId());
        });
    }

    private Map<String, Object> importChecklist(DdAiJob job, JsonNode input) throws IOException {
        stage(job, "拆分清单事项与提交要求");
        JsonNode parsed = ai.structured(job.getProjectId(), job.getUserId(), """
            将律师已有清单忠实拆成可逐项提交的事项，不新增原文没有的义务或材料。保留层级、日期、版本、主体及替代材料说明。
            返回 {"items":[{"title":"材料名称","description":"完整提交要求","sourceQuote":"对应原文逐字片段","parentIndex":null或先前父项的0起始索引}]}。
            标题最多200字、说明最多1000字，最多300项，父项必须先于子项。一个事项多附件仍为一个事项。只负责拆分，不评价法律要求。
            """, input.path("content").asText());
        JsonNode rows = parsed.path("items");
        if (!rows.isArray() || rows.isEmpty() || rows.size() > 300) throw new DdProcessingException("未识别到完整的清单事项，请检查原文件或粘贴清单文字重试");
        String source = input.path("content").asText();
        for (int index = 0; index < rows.size(); index++) {
            JsonNode row = rows.get(index);
            if (row.path("title").asText().isBlank() || row.path("title").asText().length() > 200 || row.path("description").asText().length() > 1000
                    || row.path("sourceQuote").asText().isBlank() || !source.contains(row.path("sourceQuote").asText())
                    || row.hasNonNull("parentIndex") && (!row.path("parentIndex").isInt() || row.path("parentIndex").asInt() < 0 || row.path("parentIndex").asInt() >= index))
                throw new DdProcessingException("部分拆分事项无法与原文对应，请重试；没有发布不完整清单");
        }
        stage(job, "保存待律师确认的清单");
        return transactions.execute(tx -> {
            requireActiveProject(job.getProjectId(), job.getUserId());
            DdRequest request = dd.createRequest(job.getProjectId(), input.path("name").asText("导入的尽调清单"), "", job.getUserId());
            List<DdItem> created = new ArrayList<>();
            for (JsonNode row : rows) {
                DdItem parent = row.hasNonNull("parentIndex") ? created.get(row.path("parentIndex").asInt()) : null;
                DdItem item = dd.addItem(request.getId(), parent == null ? null : parent.getId());
                dd.updateItemInfo(item.getId(), row.path("title").asText(), row.path("description").asText()); created.add(item);
            }
            return Map.<String, Object>of("requestId", request.getId(), "count", created.size(), "status", "DRAFT");
        });
    }

    public ProjectFile saveFile(Long projectId, Long userId, String name, String type, byte[] bytes, Long parentId) {
        return transactions.execute(tx -> {
            requireActiveProject(projectId, userId);
            String safeName = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
            ProjectFile file = projectFiles.createFile(projectId, parentId, safeName, type, (long) bytes.length, null,
                    "dd_" + UUID.randomUUID().toString().replace("-", ""), userId, ProjectFileService.ConflictPolicy.RENAME);
            org.springframework.transaction.support.TransactionSynchronizationManager.registerSynchronization(
                new org.springframework.transaction.support.TransactionSynchronization() {
                    @Override public void afterCompletion(int status) {
                        if (status == STATUS_ROLLED_BACK) try { storage.getStorageService().delete(file.getFilePath()); }
                        catch (RuntimeException ignored) { /* Keep original transaction failure. */ }
                    }
                });
            try { storage.getStorageService().save(file.getFilePath(), new ByteArrayInputStream(bytes)); }
            catch (com.checkba.storage.StorageException e) { throw new DdProcessingException("文件保存失败，请重试"); }
            return file;
        });
    }

    void requireActiveProject(Long projectId, Long userId) {
        if (projects.lockForImWrite(projectId).isEmpty() || !members.hasWritePermission(projectId, userId))
            throw new DdProcessingException("项目已删除或授权已变更，处理已停止");
    }

    @PreDestroy public void close() { workers.shutdownNow(); }
}
