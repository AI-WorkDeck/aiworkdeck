// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service;

import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.ai.LitigationPngService;
import com.checkba.storage.StorageServiceFactory;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.multipdf.PDFMergerUtility;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.graphics.image.LosslessFactory;
import org.apache.pdfbox.pdmodel.graphics.image.PDImageXObject;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * 资源管理器右键「转为 PDF」与多选「合并为 PDF」（dev-board#1291）。
 *
 * <p>支持的文件类型：
 * <ul>
 *   <li>Word：{@code doc}、{@code docx}</li>
 *   <li>PPT：{@code ppt}、{@code pptx}</li>
 *   <li>Excel：{@code xls}、{@code xlsx}</li>
 *   <li>图片：{@code png}、{@code jpg}、{@code jpeg}、{@code gif}、{@code webp}、{@code bmp}、{@code svg}</li>
 *   <li>多选合并时还允许混入已有的 {@code pdf} 文件一并按顺序合并。</li>
 * </ul>
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ProjectFilePdfService {

    public static final Set<String> WORD_EXTENSIONS = Set.of("doc", "docx");
    public static final Set<String> PPT_EXTENSIONS = Set.of("ppt", "pptx");
    public static final Set<String> EXCEL_EXTENSIONS = Set.of("xls", "xlsx");
    public static final Set<String> IMAGE_EXTENSIONS = Set.of("png", "jpg", "jpeg", "gif", "webp", "bmp", "svg");

    public static final Set<String> CONVERTIBLE_EXTENSIONS = Set.of(
            "doc", "docx", "ppt", "pptx", "xls", "xlsx",
            "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"
    );

    public static final Set<String> MERGEABLE_EXTENSIONS = Set.of(
            "doc", "docx", "ppt", "pptx", "xls", "xlsx",
            "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "pdf"
    );

    private static final int MAX_MERGE_FILES = 50;
    private static final float MARGIN = 42f;

    private final ProjectFileService projectFileService;
    private final ProjectFileRepository projectFileRepository;
    private final ProjectFileAccessService fileAccess;
    private final StorageServiceFactory storageServiceFactory;
    private final LibreOfficePdfConverter libreOfficePdfConverter;
    private final LitigationPngService litigationPngService;

    /**
     * 将单个项目文件（Word/PPT/Excel/图片）转为 PDF 并保存在同一目录下（同名自动加序号）。
     */
    @Transactional
    public ProjectFile convertFileToPdf(Long projectId, Long fileId, Long userId) {
        ProjectFile source = requireValidProjectFile(projectId, fileId, userId, false);
        byte[] pdfBytes = convertSingleFileToPdfBytes(source);
        String targetName = fileStem(source.getName()) + ".pdf";
        return saveGeneratedPdf(projectId, source.getParentId(), targetName, pdfBytes, userId);
    }

    /**
     * 将多个项目文件按传入顺序分别转为 PDF 后合并为一个 PDF，保存在首份文件所在目录下。
     */
    @Transactional
    public ProjectFile mergeFilesToPdf(Long projectId, List<Long> fileIds, Long userId) {
        if (fileIds == null || fileIds.isEmpty()) {
            throw new IllegalArgumentException(LangText.of("请至少选择 2 个文件进行合并", "Please select at least 2 files to merge"));
        }
        LinkedHashSet<Long> uniqueIds = new LinkedHashSet<>(fileIds);
        if (uniqueIds.size() < 2) {
            throw new IllegalArgumentException(LangText.of("请至少选择 2 个不同的文件进行合并", "Please select at least 2 different files to merge"));
        }
        if (uniqueIds.size() > MAX_MERGE_FILES) {
            throw new IllegalArgumentException(LangText.of(
                    "一次最多合并 " + MAX_MERGE_FILES + " 个文件",
                    "Cannot merge more than " + MAX_MERGE_FILES + " files at once"));
        }

        List<ProjectFile> sources = new ArrayList<>(uniqueIds.size());
        for (Long id : uniqueIds) {
            sources.add(requireValidProjectFile(projectId, id, userId, true));
        }

        List<PDDocument> opened = new ArrayList<>(sources.size());
        byte[] mergedBytes;
        try (PDDocument dest = new PDDocument();
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            PDFMergerUtility merger = new PDFMergerUtility();
            for (ProjectFile src : sources) {
                byte[] singlePdf = convertSingleFileToPdfBytes(src);
                PDDocument doc = Loader.loadPDF(singlePdf);
                if (doc.isEncrypted()) {
                    doc.close();
                    throw new IllegalArgumentException(LangText.of(
                            "文件「" + src.getName() + "」已加密，无法合并",
                            "File \"" + src.getName() + "\" is encrypted and cannot be merged"));
                }
                opened.add(doc);
                merger.appendDocument(dest, doc);
            }
            dest.save(out);
            mergedBytes = out.toByteArray();
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            log.error("合并 PDF 失败 projectId={} fileIds={}", projectId, uniqueIds, e);
            throw new IllegalArgumentException(LangText.of(
                    "合并 PDF 失败: " + e.getMessage(),
                    "Failed to merge PDFs: " + e.getMessage()), e);
        } finally {
            for (PDDocument d : opened) {
                try {
                    d.close();
                } catch (IOException ignored) {
                }
            }
        }

        ProjectFile first = sources.get(0);
        String mergedName = fileStem(first.getName())
                + LangText.of("等" + sources.size() + "份合并.pdf", "_merged_" + sources.size() + ".pdf");
        return saveGeneratedPdf(projectId, first.getParentId(), mergedName, mergedBytes, userId);
    }

    private ProjectFile requireValidProjectFile(Long projectId, Long fileId, Long userId, boolean allowPdf) {
        if (fileId == null) {
            throw new IllegalArgumentException(LangText.of("文件 ID 不能为空", "File ID must not be empty"));
        }
        ProjectFile file = projectFileService.getFile(fileId);
        if (!projectId.equals(file.getProjectId()) || Boolean.TRUE.equals(file.getIsDeleted())) {
            throw new IllegalArgumentException(LangText.of("文件不存在或不属于该项目", "File does not exist or does not belong to this project"));
        }
        if (Boolean.TRUE.equals(file.getIsFolder())) {
            throw new IllegalArgumentException(LangText.of(
                    "文件夹「" + file.getName() + "」不支持转为 PDF，请选择具体文件",
                    "Folder \"" + file.getName() + "\" cannot be converted to PDF"));
        }
        fileAccess.requireRead(file, userId);
        String ext = resolveExtension(file);
        Set<String> allowed = allowPdf ? MERGEABLE_EXTENSIONS : CONVERTIBLE_EXTENSIONS;
        if (!allowed.contains(ext)) {
            throw new IllegalArgumentException(LangText.of(
                    "不支持将「" + file.getName() + "」转为 PDF（仅支持 Word、PPT、Excel、图片" + (allowPdf ? "及 PDF" : "") + "）",
                    "Unsupported file type for PDF conversion: " + file.getName()));
        }
        return file;
    }

    private ProjectFile saveGeneratedPdf(Long projectId, Long parentId, String fileName, byte[] pdfBytes, Long userId) {
        if (pdfBytes == null || pdfBytes.length == 0) {
            throw new IllegalArgumentException(LangText.of("生成的 PDF 内容为空", "Generated PDF is empty"));
        }
        String wpsFileId = projectFileService.generateWpsFileId(projectId);
        ProjectFile created = projectFileService.createFile(
                projectId, parentId, fileName, "pdf", (long) pdfBytes.length,
                null, wpsFileId, userId, ProjectFileService.ConflictPolicy.RENAME);
        try {
            storageServiceFactory.getStorageService().save(created.getFilePath(), new ByteArrayInputStream(pdfBytes));
        } catch (Exception e) {
            try {
                storageServiceFactory.getStorageService().delete(created.getFilePath());
            } catch (Exception ignored) {
            }
            throw new IllegalArgumentException(LangText.of("保存 PDF 文件失败: " + e.getMessage(), "Failed to save PDF: " + e.getMessage()), e);
        }
        created.setFileSize((long) pdfBytes.length);
        created.setUpdatedAt(LocalDateTime.now());
        return projectFileRepository.save(created);
    }

    byte[] convertSingleFileToPdfBytes(ProjectFile file) {
        String ext = resolveExtension(file);
        byte[] rawBytes;
        try {
            rawBytes = projectFileService.getFileBytes(file.getId());
        } catch (IOException e) {
            throw new IllegalArgumentException(LangText.of(
                    "读取源文件「" + file.getName() + "」失败: " + e.getMessage(),
                    "Failed to read source file \"" + file.getName() + "\": " + e.getMessage()), e);
        }
        if (rawBytes == null || rawBytes.length == 0) {
            throw new IllegalArgumentException(LangText.of(
                    "文件「" + file.getName() + "」内容为空",
                    "File \"" + file.getName() + "\" is empty"));
        }
        return convertBytesToPdf(rawBytes, ext, file.getName());
    }

    public byte[] convertBytesToPdf(byte[] rawBytes, String ext, String fileName) {
        String lowerExt = ext == null ? "" : ext.toLowerCase(Locale.ROOT);
        if ("pdf".equals(lowerExt)) {
            return rawBytes;
        }
        if (IMAGE_EXTENSIONS.contains(lowerExt)) {
            return convertImageToPdf(rawBytes, lowerExt, fileName);
        }
        // Office 需要完整排版引擎；不可将抽取正文重画成新页面后仍宣称转换成功。
        if (WORD_EXTENSIONS.contains(lowerExt) || EXCEL_EXTENSIONS.contains(lowerExt) || PPT_EXTENSIONS.contains(lowerExt)) {
            return libreOfficePdfConverter.convert(rawBytes, lowerExt);
        }
        throw new IllegalArgumentException(LangText.of(
                "不支持的文件格式: " + lowerExt,
                "Unsupported file format: " + lowerExt));
    }

    // ==================== 图片 -> PDF ====================

    private byte[] convertImageToPdf(byte[] rawBytes, String ext, String fileName) {
        byte[] imageBytes = rawBytes;
        if ("svg".equals(ext)) {
            imageBytes = rasterizeSvgToPng(rawBytes);
        }
        try (PDDocument doc = new PDDocument();
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            PDImageXObject pdImage = loadPdfImage(doc, imageBytes, fileName);
            int imgW = Math.max(1, pdImage.getWidth());
            int imgH = Math.max(1, pdImage.getHeight());
            boolean landscape = imgW > imgH * 1.15;
            PDRectangle pageSize = landscape
                    ? new PDRectangle(PDRectangle.A4.getHeight(), PDRectangle.A4.getWidth())
                    : PDRectangle.A4;
            PDPage page = new PDPage(pageSize);
            doc.addPage(page);

            float availW = pageSize.getWidth() - MARGIN * 2;
            float availH = pageSize.getHeight() - MARGIN * 2;
            float scale = Math.min(availW / imgW, availH / imgH);
            // 小图不强行放大超过原尺寸（72dpi 基准），大图等比缩放到页面版心内
            if (scale > 1.0f) scale = 1.0f;
            float drawW = imgW * scale;
            float drawH = imgH * scale;
            float x = (pageSize.getWidth() - drawW) / 2f;
            float y = (pageSize.getHeight() - drawH) / 2f;

            try (PDPageContentStream cs = new PDPageContentStream(doc, page)) {
                cs.drawImage(pdImage, x, y, drawW, drawH);
            }
            doc.save(out);
            return out.toByteArray();
        } catch (Exception e) {
            throw new IllegalArgumentException(LangText.of(
                    "图片「" + fileName + "」转 PDF 失败: " + e.getMessage(),
                    "Failed to convert image \"" + fileName + "\" to PDF: " + e.getMessage()), e);
        }
    }

    private byte[] rasterizeSvgToPng(byte[] svgBytes) {
        Path tempSvg = null;
        Path tempPng = null;
        try {
            tempSvg = Files.createTempFile("awd-svg-", ".svg");
            Files.write(tempSvg, svgBytes);
            tempPng = litigationPngService.rasterize(tempSvg);
            if (tempPng != null && Files.isRegularFile(tempPng)) {
                return Files.readAllBytes(tempPng);
            }
            org.apache.batik.transcoder.image.PNGTranscoder transcoder =
                    new org.apache.batik.transcoder.image.PNGTranscoder();
            ByteArrayOutputStream pngOut = new ByteArrayOutputStream();
            transcoder.transcode(
                    new org.apache.batik.transcoder.TranscoderInput(new ByteArrayInputStream(svgBytes)),
                    new org.apache.batik.transcoder.TranscoderOutput(pngOut));
            return pngOut.toByteArray();
        } catch (Exception e) {
            throw new IllegalArgumentException(LangText.of("SVG 矢量图光栅化失败: " + e.getMessage(), "Failed to rasterize SVG: " + e.getMessage()), e);
        } finally {
            deleteQuietly(tempSvg);
            deleteQuietly(tempPng);
        }
    }

    private PDImageXObject loadPdfImage(PDDocument doc, byte[] imageBytes, String name) throws IOException {
        try {
            BufferedImage bimg = ImageIO.read(new ByteArrayInputStream(imageBytes));
            if (bimg != null) {
                return LosslessFactory.createFromImage(doc, bimg);
            }
        } catch (Exception ignored) {
        }
        return PDImageXObject.createFromByteArray(doc, imageBytes, name);
    }

    public static String resolveExtension(ProjectFile file) {
        if (file == null) return "";
        if (StringUtils.hasText(file.getFileType())) {
            return file.getFileType().trim().toLowerCase(Locale.ROOT);
        }
        String name = file.getName();
        if (StringUtils.hasText(name)) {
            int dot = name.lastIndexOf('.');
            if (dot > 0 && dot < name.length() - 1) {
                return name.substring(dot + 1).trim().toLowerCase(Locale.ROOT);
            }
        }
        return "";
    }

    private static String fileStem(String fileName) {
        if (!StringUtils.hasText(fileName)) return "document";
        String trimmed = fileName.trim();
        int dot = trimmed.lastIndexOf('.');
        String stem = dot > 0 ? trimmed.substring(0, dot).trim() : trimmed;
        return stem.isEmpty() ? "document" : stem;
    }

    private static void deleteQuietly(Path p) {
        if (p != null) {
            try {
                Files.deleteIfExists(p);
            } catch (IOException ignored) {
            }
        }
    }

}
