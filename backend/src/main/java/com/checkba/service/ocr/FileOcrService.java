// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ocr;

import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.LangText;
import com.checkba.service.OcrService;
import com.checkba.service.ProjectFileAccessService;
import com.checkba.service.ProjectFileService;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.ai.AiDocxExportService;
import com.checkba.service.ai.context.FileContentExtractorService;
import com.checkba.service.file.PdfTextLayer;
import com.checkba.storage.StorageServiceFactory;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
import org.springframework.stereotype.Service;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CancellationException;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Explorer right-click「识别文字（OCR）」(tutorial-series#155).
 *
 * <p>No new provider and no new outbound request: images go through the single metered entry
 * {@link OcrService#recognizeGeneral}; scanned PDFs are rendered page by page and sent through the same
 * entry by {@link PdfCloudOcrService#recognizePages} (no page cap, all-or-nothing). PDFs with a usable
 * text layer ({@link PdfTextLayer}) are returned directly, free and without any upload.
 *
 * <p>Consent: the same versioned notice and per-user preference as scanned-PDF conversion
 * ({@link OcrRoutingService}). {@code cloud} preference proceeds; {@code ask} requires the caller to
 * echo the current notice version (the batch confirmation dialog); {@code local} never uploads.
 */
@Service
public class FileOcrService {
    public enum Output { TEXT, TXT, DOCX, LAYOUT_DOCX, SEARCHABLE_PDF }
    /**
     * @param route {@code "cloud"} = the user explicitly chose cloud for this job after local
     *              recognition failed (still needs the consent version unless cloud is remembered)
     */
    public record Request(String jobId, Output output, String name, String consentVersion, String route) {
        public Request(String jobId, Output output, String name, String consentVersion) {
            this(jobId, output, name, consentVersion, null);
        }
    }
    public record Outcome(String status, String text, ProjectFile file, String source, int pages,
                          String notice, String version) {
        static Outcome of(String status) { return new Outcome(status, null, null, null, 0, null, null); }
    }

    private static final Duration CANCEL_TTL = Duration.ofHours(2);

    private final OcrService ocr;
    private final PdfCloudOcrService pdfOcr;
    private final OcrRoutingService routing;
    private final FileContentExtractorService extractor;
    private final ProjectFileService files;
    private final ProjectFileAccessService access;
    private final ProjectMemberService members;
    private final ProjectFileRepository repository;
    private final StorageServiceFactory storageFactory;
    private final AiDocxExportService docxExport;
    private final OcrExportService exports;
    /** key = userId + ":" + jobId, so one user's cancel never stops another user's batch. */
    private final Map<String, Instant> cancelled = new ConcurrentHashMap<>();

    public FileOcrService(OcrService ocr, PdfCloudOcrService pdfOcr, OcrRoutingService routing,
                          FileContentExtractorService extractor, ProjectFileService files,
                          ProjectFileAccessService access, ProjectMemberService members,
                          ProjectFileRepository repository, StorageServiceFactory storageFactory,
                          AiDocxExportService docxExport, OcrExportService exports) {
        this.ocr = ocr; this.pdfOcr = pdfOcr; this.routing = routing; this.extractor = extractor;
        this.files = files; this.access = access; this.members = members; this.repository = repository;
        this.storageFactory = storageFactory; this.docxExport = docxExport; this.exports = exports;
    }

    public void cancel(Long userId, String jobId) {
        if (userId == null || jobId == null || jobId.isBlank()) return;
        Instant now = Instant.now();
        cancelled.values().removeIf(at -> at.plus(CANCEL_TTL).isBefore(now));
        cancelled.put(userId + ":" + jobId, now);
    }

    private boolean isCancelled(Long userId, String jobId) {
        return jobId != null && cancelled.containsKey(userId + ":" + jobId);
    }

    public Outcome run(Long projectId, Long fileId, Long userId, Request request) throws Exception {
        Output output = request.output() == null ? Output.TEXT : request.output();
        ProjectFile file = files.getFile(fileId);
        if (file == null || !projectId.equals(file.getProjectId()) || Boolean.TRUE.equals(file.getIsDeleted()))
            throw new IllegalArgumentException(LangText.of("文件不存在或不属于该项目", "File does not exist or does not belong to this project"));
        if (Boolean.TRUE.equals(file.getIsFolder()) || !extractor.isOcrSupported(file.getName()))
            throw new IllegalArgumentException(LangText.of(
                    "「" + file.getName() + "」不支持识别文字（仅支持 PDF 与常见图片）",
                    "\"" + file.getName() + "\" is not supported for OCR (PDF and common images only)"));
        if (access.isClient(projectId, userId))
            throw new IllegalArgumentException(LangText.of("客户无权访问资源管理器", "Clients do not have access to the Explorer"));
        access.requireRead(file, userId);
        if (output != Output.TEXT && !members.hasWritePermission(projectId, userId))
            throw new IllegalArgumentException(LangText.of("无权修改该项目的文件", "You do not have permission to modify files in this project"));
        String jobId = request.jobId();
        if (isCancelled(userId, jobId)) return Outcome.of("cancelled");

        byte[] bytes = files.getFileBytes(fileId);
        if (bytes == null || bytes.length == 0)
            throw new IllegalArgumentException(LangText.of("文件内容为空", "The file is empty"));
        boolean pdf = file.getName().toLowerCase(Locale.ROOT).endsWith(".pdf");

        List<String> pages;
        String source;
        Path temp = null;
        try {
            String layer = null;
            if (pdf) {
                temp = Files.createTempFile("awd_explorer_ocr_", ".pdf");
                Files.write(temp, bytes);
                try (var doc = Loader.loadPDF(temp.toFile())) {
                    layer = new PDFTextStripper().getText(doc);
                }
            }
            boolean layoutOutput = output == Output.LAYOUT_DOCX || output == Output.SEARCHABLE_PDF;
            if (layer != null && PdfTextLayer.isUsable(layer)) {
                if (output == Output.SEARCHABLE_PDF) return Outcome.of("already_searchable");
                if (output == Output.LAYOUT_DOCX) {
                    // Local pdf2docx keeps the real layout of a digital PDF; free, no upload.
                    byte[] converted = exports == null ? null : exports.layoutDocxFromTextPdf(bytes);
                    if (converted != null) {
                        ProjectFile saved = saveBytes(file, userId,
                                outputName(file.getName(), request.name(), ".docx", layoutSuffix()), "docx", converted);
                        return new Outcome("done", null, saved, "text", 1, null, null);
                    }
                }
                pages = List.of(layer);
                source = "text";
            } else {
                Map<String, Object> preference = routing.preference(userId);
                String choice = String.valueOf(preference.get("choice"));
                boolean forceCloud = "cloud".equals(request.route());
                // An installed local engine is preferred unless the user chose cloud (decided 2026-11-05):
                // free and nothing leaves the machine. Its failure is reported, never silently sent to cloud.
                if (!forceCloud && !"cloud".equals(choice) && exports != null && exports.localReady()) {
                    byte[] pdfBytes;
                    OcrExportService.LocalResult local;
                    try {
                        pdfBytes = OcrExportService.asPdf(bytes, pdf);
                        local = exports.local(bytes, pdfBytes, layoutOutput);
                    } catch (CancellationException e) {
                        return Outcome.of("cancelled");
                    } catch (Exception e) {
                        if (isCancelled(userId, jobId)) return Outcome.of("cancelled");
                        return new Outcome("local_failed", null, null, "local", 0, e.getMessage(), OcrRoutingService.VERSION);
                    }
                    if (isCancelled(userId, jobId)) return Outcome.of("cancelled");
                    if (layoutOutput) {
                        return layoutFile(file, userId, request, output, "local", 0, () -> output == Output.LAYOUT_DOCX
                                ? exports.layoutDocxFromLocal(pdfBytes, local) : exports.searchablePdfFromLocal(pdfBytes, local));
                    }
                    pages = List.of(OcrExportService.plainText(local.markdown()));
                    source = "local";
                    return finish(projectId, file, userId, request, output, pages, source);
                }
                if ("local".equals(choice) && !forceCloud) return Outcome.of("local_only");
                if (!"cloud".equals(choice) && !OcrRoutingService.VERSION.equals(request.consentVersion()))
                    return new Outcome("consent_required", null, null, null, 0,
                            String.valueOf(preference.get("notice")), OcrRoutingService.VERSION);
                PdfCloudOcrService.UploadGuard guard = () -> {
                    if (Thread.currentThread().isInterrupted() || isCancelled(userId, jobId))
                        throw new CancellationException(LangText.of("任务已取消，后续页面未上传", "Cancelled; remaining pages were not uploaded"));
                };
                if (layoutOutput) {
                    byte[] pdfBytes = OcrExportService.asPdf(bytes, pdf);
                    List<String> raws;
                    try {
                        raws = exports.cloudPages(bytes, pdfBytes, guard);
                    } catch (CancellationException e) {
                        return Outcome.of("cancelled");
                    } catch (OcrExportService.LayoutUnsupportedException e) {
                        return new Outcome("layout_unsupported", null, null, "ocr", 0, e.getMessage(), null);
                    } catch (IllegalStateException e) {
                        if (isCancelled(userId, jobId)) return Outcome.of("cancelled");
                        throw new IllegalArgumentException(e.getMessage(), e);
                    }
                    if (isCancelled(userId, jobId)) return Outcome.of("cancelled");
                    return layoutFile(file, userId, request, output, "ocr", raws.size(), () -> output == Output.LAYOUT_DOCX
                            ? exports.layoutDocxFromCloud(pdfBytes, raws) : exports.searchablePdfFromCloud(pdfBytes, raws));
                }
                try {
                    if (pdf) {
                        pages = pdfOcr.recognizePages(temp, guard);
                    } else {
                        guard.check();
                        OcrResult result = ocr.recognizeGeneral(Base64.getEncoder().encodeToString(bytes));
                        pages = List.of(result == null || result.getText() == null ? "" : result.getText());
                    }
                } catch (CancellationException e) {
                    return Outcome.of("cancelled");
                } catch (IllegalStateException e) {
                    if (isCancelled(userId, jobId)) return Outcome.of("cancelled");
                    throw new IllegalArgumentException(e.getMessage(), e);
                }
                source = "ocr";
            }
        } finally {
            if (temp != null) try { Files.deleteIfExists(temp); } catch (Exception ignore) { /* temp dir is reclaimed */ }
        }
        // A cancel that arrived while the last request was in flight must not produce a late file.
        if (isCancelled(userId, jobId)) return Outcome.of("cancelled");
        return finish(projectId, file, userId, request, output, pages, source);
    }

    /** Text outputs (copy / TXT / text-first Word) from recognized page texts. */
    private Outcome finish(Long projectId, ProjectFile file, Long userId, Request request, Output output,
                           List<String> pages, String source) {
        if (output == Output.LAYOUT_DOCX) output = Output.DOCX; // digital PDF without local pdf2docx
        String suffixedName = request.output() == Output.LAYOUT_DOCX
                ? outputName(file.getName(), request.name(), ".docx", layoutSuffix()) : null;
        List<String> nonEmpty = new ArrayList<>();
        for (String page : pages) if (page != null && !page.isBlank()) nonEmpty.add(page.strip());
        String text = String.join("\n\n", nonEmpty);
        ProjectFile created = null;
        if (output == Output.TXT) {
            created = saveTxt(file, userId, outputName(file.getName(), request.name(), ".txt"), text);
        } else if (output == Output.DOCX) {
            created = docxExport.exportMarkdownToDocx(projectId, file.getParentId(), userId,
                    suffixedName != null ? suffixedName : outputName(file.getName(), request.name(), ".docx"), toMarkdown(text));
        }
        return new Outcome("done", output == Output.TEXT ? text : null, created, source, pages.size(), null, null);
    }

    interface FileBuilder { byte[] build() throws Exception; }

    /** Layout Word / searchable PDF: build the bytes, then save them beside the source file. */
    private Outcome layoutFile(ProjectFile file, Long userId, Request request, Output output, String source, int pages,
                               FileBuilder builder) throws Exception {
        byte[] data;
        try {
            data = builder.build();
        } catch (OcrExportService.ComponentOutdatedException e) {
            return new Outcome("component_outdated", null, null, source, pages, e.getMessage(), null);
        } catch (IllegalStateException e) {
            throw new IllegalArgumentException(e.getMessage(), e);
        }
        if (isCancelled(userId, request.jobId())) return Outcome.of("cancelled");
        boolean docx = output == Output.LAYOUT_DOCX;
        String ext = docx ? ".docx" : ".pdf";
        String name = outputName(file.getName(), request.name(), ext, docx ? layoutSuffix() : searchableSuffix());
        return new Outcome("done", null, saveBytes(file, userId, name, docx ? "docx" : "pdf", data), source, pages, null, null);
    }

    static String layoutSuffix() { return LangText.of("-识别版式", "-OCR layout"); }

    static String searchableSuffix() { return LangText.of("-可搜索", "-searchable"); }

    private ProjectFile saveTxt(ProjectFile source, Long userId, String name, String text) {
        return saveBytes(source, userId, name, "txt", text.getBytes(StandardCharsets.UTF_8));
    }

    private ProjectFile saveBytes(ProjectFile source, Long userId, String name, String type, byte[] data) {
        Long projectId = source.getProjectId();
        ProjectFile created = files.createFile(projectId, source.getParentId(), name, type, (long) data.length,
                null, files.generateWpsFileId(projectId), userId, ProjectFileService.ConflictPolicy.RENAME);
        var storage = storageFactory.getStorageService();
        try {
            storage.save(created.getFilePath(), new ByteArrayInputStream(data));
        } catch (Exception e) {
            try { storage.delete(created.getFilePath()); } catch (Exception ignored) { /* best effort */ }
            throw new IllegalArgumentException(LangText.of("保存文件失败: " + e.getMessage(), "Failed to save the file: " + e.getMessage()), e);
        }
        created.setFileSize((long) data.length);
        created.setUpdatedAt(LocalDateTime.now());
        return repository.save(created);
    }

    /** Frontend proposes the localized name; anything unsafe or with the wrong extension falls back. */
    static String outputName(String sourceName, String proposed, String ext) {
        return outputName(sourceName, proposed, ext, LangText.of("-识别文字", "-OCR text"));
    }

    static String outputName(String sourceName, String proposed, String ext, String fallbackSuffix) {
        String p = proposed == null ? "" : proposed.trim();
        boolean safe = !p.isEmpty() && p.length() <= 200 && !p.contains("/") && !p.contains("\\")
                && !p.contains("..") && p.chars().noneMatch(c -> c < 0x20)
                && p.toLowerCase(Locale.ROOT).endsWith(ext) && p.length() > ext.length();
        if (safe) return p;
        String name = sourceName == null ? "file" : sourceName;
        int dot = name.lastIndexOf('.');
        String stem = dot > 0 ? name.substring(0, dot) : name;
        return stem + fallbackSuffix + ext;
    }

    /**
     * Plain OCR text → Markdown for the existing write_docx renderer: every Markdown character is
     * escaped (OCR text must not turn into headings/lists), single newlines become hard line breaks,
     * blank lines separate paragraphs. Text-first, not a layout reconstruction.
     */
    public static String toMarkdown(String text) {
        String normalized = text == null ? "" : text.replace("\r\n", "\n").replace('\r', '\n');
        List<String> paragraphs = new ArrayList<>();
        List<String> current = new ArrayList<>();
        for (String line : normalized.split("\n", -1)) {
            String stripped = line.strip();
            if (stripped.isEmpty()) {
                if (!current.isEmpty()) { paragraphs.add(String.join("\\\n", current)); current = new ArrayList<>(); }
            } else {
                current.add(PdfCloudOcrService.escapeMarkdown(stripped));
            }
        }
        if (!current.isEmpty()) paragraphs.add(String.join("\\\n", current));
        return String.join("\n\n", paragraphs);
    }
}
