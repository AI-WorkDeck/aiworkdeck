// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.dd;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.service.*;
import com.checkba.service.ai.StyleProfileResolver;
import com.checkba.service.evidence.*;
import com.checkba.storage.StorageServiceFactory;
import com.checkba.util.DocxStyleHelper;
import com.checkba.version.CloudSyncService;
import com.fasterxml.jackson.databind.*;
import lombok.RequiredArgsConstructor;
import org.apache.poi.xwpf.usermodel.*;
import org.docx4j.openpackaging.packages.WordprocessingMLPackage;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import java.io.*;
import java.math.BigInteger;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Service @RequiredArgsConstructor
public class DdMaterialService {
    private final DdAiService jobs;
    private final DdAiGateway ai;
    private final DdService dd;
    private final DdWorkflowService workflow;
    private final DdSubmissionRepository submissions;
    private final ProjectFileRepository files;
    private final ProjectFileService projectFiles;
    private final ProjectRemoteRepository remotes;
    private final CloudSyncService cloud;
    private final DdMaterialMirrorRepository mirrors;
    private final StorageServiceFactory storage;
    private final EvidenceTextExtractor extractor;
    private final EvidenceLinkService evidence;
    private final StyleProfileResolver styles;
    private final ObjectMapper json;
    private final TransactionTemplate transactions;
    private final Map<Long, Object> locks = new ConcurrentHashMap<>();

    public record Material(ProjectFile file, Long itemId, Long submissionId, int version, String title, String reviewStatus, String aiStatus) {}
    public record Snapshot(JsonNode request, List<JsonNode> items, List<Material> materials) {}
    private record Paragraph(String text, String section, String linkKey, List<EvidenceLinkViews.TargetInput> targets) {}

    public Map<String, Object> importMaterials(DdAiJob job, JsonNode input) throws Exception {
        Snapshot snapshot = collect(job, input.path("requestId").asLong());
        return Map.of("files", snapshot.materials().stream().map(Material::file).toList(), "materials", snapshot.materials());
    }

    private Snapshot collect(DdAiJob job, Long requestId) throws Exception {
        jobs.stage(job, "读取清单与材料版本");
        ProjectRemote binding = remotes.findByProjectId(job.getProjectId()).orElse(null);
        JsonNode request; List<JsonNode> itemRows = new ArrayList<>(); Map<Long, JsonNode> current = new HashMap<>();
        if (binding != null) {
            JsonNode details = remoteJson(job.getProjectId(), "/requests/" + requestId);
            request = details.path("request");
            if (!binding.getRemoteProjectId().equals(request.path("projectId").asText())) throw new DdProcessingException("清单不属于当前受邀项目");
            boolean legacy = false;
            for (JsonNode row : details.path("items")) legacy |= row.hasNonNull("uploadedFileId") && !row.hasNonNull("currentSubmissionId");
            if (legacy) {
                var prepared = cloud.proxyDd(job.getProjectId(), "POST", "/requests/" + requestId + "/prepare-materials", "", "{}".getBytes(StandardCharsets.UTF_8), "application/json");
                if (prepared.status() != 200 || !json.readTree(prepared.body()).path("prepared").asBoolean())
                    throw new DdProcessingException("案件库尚未完成旧材料版本整理，请稍后重试");
                details = remoteJson(job.getProjectId(), "/requests/" + requestId);
            }
            details.path("items").forEach(itemRows::add);
            details.path("submissionsByItem").fields().forEachRemaining(e -> current.put(Long.parseLong(e.getKey()), e.getValue()));
        } else {
            DdRequest local = dd.getRequest(requestId);
            if (!job.getProjectId().equals(local.getProjectId())) throw new DdProcessingException("清单不属于当前项目");
            workflow.prepareMaterials(requestId, job.getUserId());
            request = json.valueToTree(local);
            for (DdItem item : dd.getItems(requestId)) {
                itemRows.add(json.valueToTree(item));
                if (item.getCurrentSubmissionId() != null) submissions.findById(item.getCurrentSubmissionId()).ifPresent(s -> current.put(item.getId(), json.valueToTree(s)));
            }
        }
        List<Material> result = new ArrayList<>();
        for (JsonNode item : itemRows) {
            Long itemId = item.path("id").asLong(); JsonNode submission = current.get(itemId);
            if (submission == null || !"FILES".equals(submission.path("type").asText())) continue;
            Long submissionId = submission.path("id").asLong(); int version = submission.path("version").asInt();
            JsonNode fileIds = submission.path("fileIds");
            if (!fileIds.isArray()) throw new DdProcessingException("材料版本缺少文件目录，请刷新清单重试");
            for (JsonNode fileIdNode : fileIds) {
                Long remoteFileId = fileIdNode.asLong();
                jobs.stage(job, "归档材料：" + item.path("title").asText());
                ProjectFile localFile;
                if (binding == null) {
                    localFile = files.findById(remoteFileId).filter(f -> job.getProjectId().equals(f.getProjectId()) && !Boolean.TRUE.equals(f.getIsDeleted())).orElseThrow();
                } else {
                    String key = binding.getConnectionId() + ":" + binding.getRemoteProjectId() + ":" + requestId + ":" + itemId + ":" + submissionId + ":" + remoteFileId;
                    synchronized (locks.computeIfAbsent(job.getProjectId(), id -> new Object())) {
                        Optional<DdMaterialMirror> old = mirrors.findByProjectIdAndSourceKey(job.getProjectId(), key);
                        localFile = old.flatMap(m -> files.findById(m.getLocalFileId())).filter(f -> !Boolean.TRUE.equals(f.getIsDeleted())).orElse(null);
                        if (localFile == null || !old.get().getSha256().equals(hash(readFile(localFile)))) {
                            var response = cloud.proxyDd(job.getProjectId(), "GET", "/items/" + itemId + "/submissions/" + submissionId + "/files/" + remoteFileId, "", null, null);
                            if (response.status() != 200 || response.body() == null || response.contentType() != null && response.contentType().contains("application/json"))
                                throw new DdProcessingException("底稿文件下载未完成，已归档的材料保留，请稍后重试");
                            byte[] bytes = response.body(); if (bytes.length > 100 * 1024 * 1024) throw new DdProcessingException("单份底稿超过100MB，请在清单中分拆");
                            String name = "材料-" + remoteFileId;
                            for (JsonNode meta : submission.path("files")) if (meta.path("fileId").asLong() == remoteFileId) name = meta.path("name").asText(name);
                            Long folder = folder(job.getProjectId(), job.getUserId(), null, "尽调底稿");
                            folder = folder(job.getProjectId(), job.getUserId(), folder, safeName(request.path("name").asText()) + "-" + requestId);
                            folder = folder(job.getProjectId(), job.getUserId(), folder, safeName(item.path("title").asText()) + "-" + itemId + "-第" + version + "版");
                            String extension = name.contains(".") ? name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT) : "bin";
                            localFile = jobs.saveFile(job.getProjectId(), job.getUserId(), safeName(name), extension, bytes, folder);
                            DdMaterialMirror mirror = old.orElseGet(DdMaterialMirror::new);
                            mirror.setProjectId(job.getProjectId()); mirror.setSourceKey(key); mirror.setLocalFileId(localFile.getId()); mirror.setSha256(hash(bytes)); mirrors.save(mirror);
                        }
                    }
                }
                result.add(new Material(localFile, itemId, submissionId, version, item.path("title").asText(), submission.path("reviewStatus").asText(), submission.path("aiStatus").asText()));
            }
        }
        return new Snapshot(request, itemRows, result);
    }

    private JsonNode remoteJson(Long projectId, String path) throws IOException {
        var response = cloud.proxyDd(projectId, "GET", path, "", null, null);
        if (response.status() != 200) throw new DdProcessingException("案件库暂时无法连接，请稍后重试");
        JsonNode value = json.readTree(response.body());
        if (value.has("code") && value.path("code").asInt() != 0) throw new DdProcessingException("案件库暂时无法读取这份清单，请刷新后重试");
        return value;
    }

    private Long folder(Long projectId, Long userId, Long parentId, String name) {
        return projectFiles.getFilesByParent(projectId, parentId).stream().filter(f -> Boolean.TRUE.equals(f.getIsFolder()) && name.equals(f.getName()))
                .map(ProjectFile::getId).findFirst().orElseGet(() -> projectFiles.createFolder(projectId, parentId, name, userId).getId());
    }
    private static String safeName(String name) { String value = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").strip(); return value.isBlank() ? "材料" : value.substring(0, Math.min(value.length(), 160)); }
    private byte[] readFile(ProjectFile file) throws IOException { try (InputStream in = storage.getStorageService().load(file.getFilePath()).getInputStream()) { return in.readNBytes(100 * 1024 * 1024 + 1); } }
    private static String hash(byte[] bytes) throws Exception { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }

    public Map<String, Object> report(DdAiJob job, JsonNode input) throws Exception {
        Snapshot snapshot = collect(job, input.path("requestId").asLong());
        List<Paragraph> paragraphs = new ArrayList<>();
        Map<Long, List<Material>> byItem = new LinkedHashMap<>();
        Map<Long, String> sourceHashes = new HashMap<>();
        Set<Long> parents = new HashSet<>();
        snapshot.items().stream().filter(i -> i.hasNonNull("parentId")).forEach(i -> parents.add(i.path("parentId").asLong()));
        for (Material material : snapshot.materials()) byItem.computeIfAbsent(material.itemId(), id -> new ArrayList<>()).add(material);
        for (JsonNode item : snapshot.items()) {
            if (parents.contains(item.path("id").asLong()) && !byItem.containsKey(item.path("id").asLong())) continue;
            String title = item.path("title").asText(); List<Material> accepted = byItem.getOrDefault(item.path("id").asLong(), List.of()).stream().filter(m -> "APPROVED".equals(m.reviewStatus())).toList();
            if (accepted.isEmpty()) {
                paragraphs.add(new Paragraph("【待核实】尚无经律师确认可用于本事项分析的文件；材料未取得或未确认，不表示该事项不存在。", title, null, List.of())); continue;
            }
            jobs.stage(job, "依据底稿起草：" + title);
            Map<Long, String> texts = new LinkedHashMap<>(); int total = 0;
            for (Material m : accepted) {
                sourceHashes.put(m.file().getId(), hash(readFile(m.file())));
                String text = extractor.textOf(m.file(), job.getUserId());
                if (text != null && !text.isBlank()) { total += text.length(); texts.put(m.file().getId(), text); }
            }
            if (texts.size() != accepted.size() || total > 160_000) {
                paragraphs.add(new Paragraph("【待核实】已归档本事项材料，但尚未完整读取全部内容，需要律师进一步核查。", title, null, List.of())); continue;
            }
            JsonNode response = ai.structured(job.getProjectId(), job.getUserId(), """
                根据本项提交要求与底稿撰写尽调报告初稿的事实分析段落，不是收件总结。仅依据所给文件，不编造法条、日期、主体、核验过程或最终合规结论。
                说明材料记载的事实、相互一致或冲突、尚待核实的问题。不得把“未取得材料”写成“不存在该事项”，不得把AI核验或律师收件确认写成已完成所有专业核查。
                每个段落最多800字，必须逐条提供支持陈述的原文引用；最多8段。返回
                {"paragraphs":[{"text":"正文","citations":[{"fileId":数字,"quote":"从原文逐字摘录的片段"}]}]}。
                无法依据材料判断时用“尚待核实”并说明缺口，不能虚构引用。
                """, json.writeValueAsString(Map.of("item", title, "requirements", item.path("description").asText(""), "files", texts)));
            JsonNode rows = response.path("paragraphs");
            if (!rows.isArray() || rows.isEmpty() || rows.size() > 8) throw new DdProcessingException("报告段落未完整生成；已归档材料保留，请重试");
            for (JsonNode row : rows) {
                List<EvidenceLinkViews.TargetInput> targets = validatedTargets(row, texts, accepted);
                String text = row.path("text").asText();
                if (text.isBlank() || text.length() > 1000 || targets.isEmpty())
                    paragraphs.add(new Paragraph("【待核实】AI未能为本段分析提供可核对的底稿依据，请律师补充分析。", title, null, List.of()));
                else paragraphs.add(new Paragraph(text, title, "EVID_DD_" + UUID.randomUUID().toString().replace("-", ""), targets));
            }
        }
        jobs.stage(job, "保存报告与原文勾稽");
        for (Material material : snapshot.materials()) if (sourceHashes.containsKey(material.file().getId())
                && !sourceHashes.get(material.file().getId()).equals(hash(readFile(material.file()))))
            throw new DdProcessingException("生成期间底稿发生修改，请按最新材料重新起草；没有保存与原文不一致的报告");
        requireCurrentApprovals(job, snapshot);
        String name = safeName(snapshot.request().path("name").asText()) + "-尽调报告初稿.docx";
        byte[] bytes = render(job.getProjectId(), snapshot.request().path("name").asText(), paragraphs);
        ProjectFile report = transactions.execute(tx -> {
            Long folder = folder(job.getProjectId(), job.getUserId(), null, "_交付件");
            ProjectFile created = jobs.saveFile(job.getProjectId(), job.getUserId(), name, "docx", bytes, folder);
            for (Paragraph p : paragraphs) if (p.linkKey() != null)
                evidence.create(job.getUserId(), job.getProjectId(), created.getId(), p.linkKey(), p.text(), p.section(), p.section(), "ai", p.targets());
            return created;
        });
        return Map.of("report", report, "files", List.of(report), "linkedParagraphs", paragraphs.stream().filter(p -> p.linkKey() != null).count(),
                "gaps", paragraphs.stream().filter(p -> p.linkKey() == null).count());
    }

    private void requireCurrentApprovals(DdAiJob job, Snapshot snapshot) throws IOException {
        Map<Long, Long> currentIds = new HashMap<>(); Map<Long, String> decisions = new HashMap<>();
        if (remotes.findByProjectId(job.getProjectId()).isPresent()) {
            JsonNode latest = remoteJson(job.getProjectId(), "/requests/" + snapshot.request().path("id").asLong());
            for (JsonNode item : latest.path("items")) currentIds.put(item.path("id").asLong(), item.path("currentSubmissionId").asLong());
            latest.path("submissionsByItem").fields().forEachRemaining(e -> decisions.put(e.getValue().path("id").asLong(), e.getValue().path("reviewStatus").asText()));
        } else {
            for (DdItem item : dd.getItems(snapshot.request().path("id").asLong())) currentIds.put(item.getId(), item.getCurrentSubmissionId());
            for (DdSubmission s : submissions.findAllById(currentIds.values().stream().filter(Objects::nonNull).toList())) decisions.put(s.getId(), s.getReviewStatus());
        }
        for (Material material : snapshot.materials()) if ("APPROVED".equals(material.reviewStatus())
                && (!Objects.equals(currentIds.get(material.itemId()), material.submissionId()) || !"APPROVED".equals(decisions.get(material.submissionId()))))
            throw new DdProcessingException("生成期间材料版本或律师确认已变更，请刷新清单后重新起草");
    }

    private List<EvidenceLinkViews.TargetInput> validatedTargets(JsonNode paragraph, Map<Long, String> texts, List<Material> materials) throws IOException {
        List<EvidenceLinkViews.TargetInput> targets = new ArrayList<>();
        if (!paragraph.path("citations").isArray()) return targets;
        for (JsonNode citation : paragraph.path("citations")) {
            long id = citation.path("fileId").asLong(); String quote = citation.path("quote").asText();
            if (quote.isBlank() || !texts.containsKey(id) || !texts.get(id).contains(quote)) return List.of();
            Material source = materials.stream().filter(m -> m.file().getId() == id).findFirst().orElseThrow();
            targets.add(new EvidenceLinkViews.TargetInput(id, json.writeValueAsString(Map.of("type", "text", "quote", quote)), "supports", "written_review", null,
                    "清单项 " + source.itemId() + "；提交 " + source.submissionId() + " 第" + source.version() + "版；AI起草，待律师核实陈述与依据"));
        }
        return targets;
    }

    private byte[] render(Long projectId, String title, List<Paragraph> paragraphs) throws Exception {
        ByteArrayOutputStream raw = new ByteArrayOutputStream();
        try (XWPFDocument doc = new XWPFDocument()) {
            doc.createStyles();
            XWPFParagraph heading = doc.createParagraph(); heading.setStyle("Title"); heading.createRun().setText(title + " · 尽职调查报告初稿");
            doc.createParagraph().createRun().setText("本稿依据收集并经律师确认的指定版本材料起草。文中勾稽链接对应具体底稿及原文位置，分析结论和缺口仍需律师审阅。生成时间：" + java.time.LocalDateTime.now());
            String previous = null; int bookmarkId = 1;
            for (Paragraph p : paragraphs) {
                if (!Objects.equals(previous, p.section())) { XWPFParagraph h = doc.createParagraph(); h.setStyle("Heading1"); h.createRun().setText(p.section()); previous = p.section(); }
                XWPFParagraph line = doc.createParagraph();
                if (p.linkKey() == null) line.createRun().setText(p.text());
                else {
                    var start = line.getCTP().addNewBookmarkStart(); start.setId(BigInteger.valueOf(bookmarkId)); start.setName(p.linkKey());
                    String inner = "checkba://filelink?k=" + p.linkKey() + "&projectId=" + projectId;
                    XWPFHyperlinkRun run = line.createHyperlinkRun(EvidenceAnchorService.INTERNAL_LINK_BASE + "?u=" + URLEncoder.encode(inner, StandardCharsets.UTF_8));
                    run.setText(p.text());
                    line.getCTP().addNewBookmarkEnd().setId(BigInteger.valueOf(bookmarkId++));
                }
            }
            doc.write(raw);
        }
        WordprocessingMLPackage styled = WordprocessingMLPackage.load(new ByteArrayInputStream(raw.toByteArray()));
        DocxStyleHelper.addMissingStyles(styled); DocxStyleHelper.applyProfile(styled, styles.resolve(projectId, null));
        ByteArrayOutputStream output = new ByteArrayOutputStream(); styled.save(output); return output.toByteArray();
    }
}
