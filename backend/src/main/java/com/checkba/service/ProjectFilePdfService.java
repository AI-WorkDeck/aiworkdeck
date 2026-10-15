// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service;

import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.ai.LitigationPngService;
import com.checkba.service.ai.PdfEditService;
import com.checkba.storage.StorageServiceFactory;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.fontbox.ttf.TrueTypeCollection;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.multipdf.PDFMergerUtility;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.apache.pdfbox.pdmodel.graphics.image.JPEGFactory;
import org.apache.pdfbox.pdmodel.graphics.image.LosslessFactory;
import org.apache.pdfbox.pdmodel.graphics.image.PDImageXObject;
import org.apache.poi.hslf.usermodel.HSLFSlideShow;
import org.apache.poi.hwpf.HWPFDocument;
import org.apache.poi.hwpf.extractor.WordExtractor;
import org.apache.poi.hwpf.usermodel.Paragraph;
import org.apache.poi.hwpf.usermodel.Range;
import org.apache.poi.hwpf.usermodel.Table;
import org.apache.poi.hwpf.usermodel.TableCell;
import org.apache.poi.hwpf.usermodel.TableIterator;
import org.apache.poi.hwpf.usermodel.TableRow;
import org.apache.poi.sl.usermodel.Slide;
import org.apache.poi.sl.usermodel.SlideShow;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.FormulaEvaluator;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.usermodel.WorkbookFactory;
import org.apache.poi.xslf.usermodel.XMLSlideShow;
import org.apache.poi.xwpf.usermodel.IBodyElement;
import org.apache.poi.xwpf.usermodel.ParagraphAlignment;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.apache.poi.xwpf.usermodel.XWPFParagraph;
import org.apache.poi.xwpf.usermodel.XWPFPicture;
import org.apache.poi.xwpf.usermodel.XWPFPictureData;
import org.apache.poi.xwpf.usermodel.XWPFRun;
import org.apache.poi.xwpf.usermodel.XWPFTable;
import org.apache.poi.xwpf.usermodel.XWPFTableCell;
import org.apache.poi.xwpf.usermodel.XWPFTableRow;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.Dimension;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.AffineTransform;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.TimeUnit;

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
    private final PdfEditService pdfEditService;
    private final LitigationPngService litigationPngService;
    private final DocumentTextService documentTextService;

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
        // Office 文档优先尝试本机 LibreOffice headless（若机器上装有 soffice），未安装或失败走纯 Java 渲染兜底
        byte[] viaSoffice = tryConvertViaSoffice(rawBytes, lowerExt);
        if (viaSoffice != null && viaSoffice.length > 0) {
            return viaSoffice;
        }
        if (WORD_EXTENSIONS.contains(lowerExt)) {
            return convertWordToPdf(rawBytes, lowerExt, fileName);
        }
        if (EXCEL_EXTENSIONS.contains(lowerExt)) {
            return convertExcelToPdf(rawBytes, fileName);
        }
        if (PPT_EXTENSIONS.contains(lowerExt)) {
            return convertPptToPdf(rawBytes, lowerExt, fileName);
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

    // ==================== Word (doc / docx) -> PDF ====================

    private byte[] convertWordToPdf(byte[] rawBytes, String ext, String fileName) {
        TrueTypeCollection[] ttcHolder = new TrueTypeCollection[1];
        try (PDDocument doc = new PDDocument();
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            PDFont font = loadFont(doc, ttcHolder);
            LayoutCursor cursor = new LayoutCursor(doc, PDRectangle.A4, font);
            if ("docx".equals(ext)) {
                renderDocx(rawBytes, doc, cursor);
            } else {
                renderDoc(rawBytes, cursor, fileName);
            }
            cursor.close();
            doc.save(out);
            return out.toByteArray();
        } catch (Exception e) {
            throw new IllegalArgumentException(LangText.of(
                    "Word 文档「" + fileName + "」转 PDF 失败: " + e.getMessage(),
                    "Failed to convert Word document \"" + fileName + "\" to PDF: " + e.getMessage()), e);
        } finally {
            closeTtc(ttcHolder[0]);
        }
    }

    private void renderDocx(byte[] rawBytes, PDDocument pdfDoc, LayoutCursor cursor) throws IOException {
        try (XWPFDocument docx = new XWPFDocument(new ByteArrayInputStream(rawBytes))) {
            boolean anyContent = false;
            for (IBodyElement elem : docx.getBodyElements()) {
                if (elem instanceof XWPFParagraph para) {
                    String text = para.getText();
                    float fontSize = resolveParagraphFontSize(para);
                    ParagraphAlignment align = para.getAlignment();
                    if (StringUtils.hasText(text)) {
                        cursor.writeParagraph(text, fontSize, align == ParagraphAlignment.CENTER);
                        anyContent = true;
                    }
                    for (XWPFRun run : para.getRuns()) {
                        for (XWPFPicture pic : run.getEmbeddedPictures()) {
                            XWPFPictureData picData = pic.getPictureData();
                            if (picData != null && picData.getData() != null && picData.getData().length > 0) {
                                cursor.writeInlineImage(pdfDoc, picData.getData(), picData.getFileName());
                                anyContent = true;
                            }
                        }
                    }
                } else if (elem instanceof XWPFTable table) {
                    List<List<String>> rows = new ArrayList<>();
                    for (XWPFTableRow r : table.getRows()) {
                        List<String> cells = new ArrayList<>();
                        for (XWPFTableCell c : r.getTableCells()) {
                            cells.add(c.getText() == null ? "" : c.getText().trim());
                        }
                        if (!cells.isEmpty()) rows.add(cells);
                    }
                    if (!rows.isEmpty()) {
                        cursor.writeTable(rows, 9.5f, false);
                        anyContent = true;
                    }
                }
            }
            if (!anyContent) {
                cursor.ensureFirstPage();
            }
        }
    }

    private float resolveParagraphFontSize(XWPFParagraph para) {
        String style = para.getStyle();
        if (style != null) {
            String s = style.toLowerCase(Locale.ROOT);
            if (s.contains("heading1") || s.contains("标题1") || "1".equals(s)) return 16f;
            if (s.contains("heading2") || s.contains("标题2") || "2".equals(s)) return 14f;
            if (s.contains("heading3") || s.contains("标题3") || "3".equals(s)) return 12.5f;
        }
        for (XWPFRun run : para.getRuns()) {
            Double pt = run.getFontSizeAsDouble();
            if (pt != null && pt >= 8.0 && pt <= 36.0) {
                return pt.floatValue();
            }
        }
        return 11f;
    }

    private void renderDoc(byte[] rawBytes, LayoutCursor cursor, String fileName) throws IOException {
        try (HWPFDocument hwpf = new HWPFDocument(new ByteArrayInputStream(rawBytes))) {
            Range range = hwpf.getRange();
            TableIterator tableIt = new TableIterator(range);
            int numParas = range.numParagraphs();
            int pIdx = 0;
            while (pIdx < numParas) {
                Paragraph p = range.getParagraph(pIdx);
                if (p.isInTable() && tableIt.hasNext()) {
                    Table table = tableIt.next();
                    List<List<String>> rows = new ArrayList<>();
                    for (int r = 0; r < table.numRows(); r++) {
                        TableRow tr = table.getRow(r);
                        List<String> cells = new ArrayList<>();
                        for (int c = 0; c < tr.numCells(); c++) {
                            TableCell tc = tr.getCell(c);
                            cells.add(cleanControlChars(tc.text()).trim());
                        }
                        if (!cells.isEmpty()) rows.add(cells);
                    }
                    if (!rows.isEmpty()) {
                        cursor.writeTable(rows, 9.5f, false);
                    }
                    while (pIdx < numParas && range.getParagraph(pIdx).isInTable()) {
                        pIdx++;
                    }
                } else {
                    String text = cleanControlChars(p.text()).trim();
                    if (!text.isEmpty()) {
                        cursor.writeParagraph(text, 11f, p.getJustification() == 1);
                    }
                    pIdx++;
                }
            }
            cursor.ensureFirstPage();
        } catch (Exception oleEx) {
            // 兼容伪装成 .doc 的纯文本 / RTF / XML 文档
            try (WordExtractor extractor = new WordExtractor(new ByteArrayInputStream(rawBytes))) {
                for (String para : extractor.getParagraphText()) {
                    String clean = cleanControlChars(para).trim();
                    if (!clean.isEmpty()) cursor.writeParagraph(clean, 11f, false);
                }
                cursor.ensureFirstPage();
            } catch (Exception fallbackEx) {
                String text = new String(rawBytes, StandardCharsets.UTF_8);
                for (String line : text.split("\\r?\\n")) {
                    String clean = cleanControlChars(line).trim();
                    if (!clean.isEmpty()) cursor.writeParagraph(clean, 11f, false);
                }
                cursor.ensureFirstPage();
            }
        }
    }

    // ==================== Excel (xls / xlsx) -> PDF ====================

    private byte[] convertExcelToPdf(byte[] rawBytes, String fileName) {
        TrueTypeCollection[] ttcHolder = new TrueTypeCollection[1];
        try (Workbook wb = WorkbookFactory.create(new ByteArrayInputStream(rawBytes));
             PDDocument doc = new PDDocument();
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            PDFont font = loadFont(doc, ttcHolder);
            PDRectangle landscapeA4 = new PDRectangle(PDRectangle.A4.getHeight(), PDRectangle.A4.getWidth());
            LayoutCursor cursor = new LayoutCursor(doc, landscapeA4, font);
            DataFormatter formatter = new DataFormatter();
            FormulaEvaluator evaluator = null;
            try {
                evaluator = wb.getCreationHelper().createFormulaEvaluator();
            } catch (Exception ignored) {
            }

            int numSheets = wb.getNumberOfSheets();
            boolean anyContent = false;
            for (int s = 0; s < numSheets; s++) {
                Sheet sheet = wb.getSheetAt(s);
                if (sheet == null) continue;
                List<List<String>> rows = extractSheetRows(sheet, formatter, evaluator);
                if (rows.isEmpty()) continue;
                if (anyContent) {
                    cursor.newPage();
                }
                String sheetTitle = StringUtils.hasText(sheet.getSheetName()) ? sheet.getSheetName() : ("Sheet" + (s + 1));
                cursor.writeParagraph(sheetTitle, 13f, false);
                cursor.writeTable(rows, 9f, true);
                anyContent = true;
            }
            if (!anyContent) {
                cursor.ensureFirstPage();
            }
            cursor.close();
            doc.save(out);
            return out.toByteArray();
        } catch (Exception e) {
            throw new IllegalArgumentException(LangText.of(
                    "表格「" + fileName + "」转 PDF 失败: " + e.getMessage(),
                    "Failed to convert spreadsheet \"" + fileName + "\" to PDF: " + e.getMessage()), e);
        } finally {
            closeTtc(ttcHolder[0]);
        }
    }

    private List<List<String>> extractSheetRows(Sheet sheet, DataFormatter formatter, FormulaEvaluator evaluator) {
        int firstRow = sheet.getFirstRowNum();
        int lastRow = sheet.getLastRowNum();
        if (lastRow < firstRow) return List.of();
        int maxCols = 0;
        List<Row> rawRows = new ArrayList<>();
        for (int r = firstRow; r <= lastRow; r++) {
            Row row = sheet.getRow(r);
            if (row == null) continue;
            int lastCell = row.getLastCellNum();
            if (lastCell > maxCols) maxCols = Math.min(lastCell, 24);
            rawRows.add(row);
        }
        if (maxCols == 0 || rawRows.isEmpty()) return List.of();
        List<List<String>> out = new ArrayList<>();
        for (Row row : rawRows) {
            List<String> cells = new ArrayList<>(maxCols);
            boolean nonBlank = false;
            for (int c = 0; c < maxCols; c++) {
                Cell cell = row.getCell(c);
                String val = "";
                if (cell != null) {
                    try {
                        val = evaluator != null
                                ? formatter.formatCellValue(cell, evaluator)
                                : formatter.formatCellValue(cell);
                    } catch (Exception ignored) {
                        val = cell.toString();
                    }
                }
                val = cleanControlChars(val).trim();
                if (!val.isEmpty()) nonBlank = true;
                cells.add(val);
            }
            if (nonBlank) out.add(cells);
        }
        return out;
    }

    // ==================== PPT (ppt / pptx) -> PDF ====================

    private byte[] convertPptToPdf(byte[] rawBytes, String ext, String fileName) {
        TrueTypeCollection[] ttcHolder = new TrueTypeCollection[1];
        try (SlideShow<?, ?> slideShow = "pptx".equals(ext)
                ? new XMLSlideShow(new ByteArrayInputStream(rawBytes))
                : new HSLFSlideShow(new ByteArrayInputStream(rawBytes));
             PDDocument doc = new PDDocument();
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {

            registerAwtCjkFont();
            Dimension pgSize = slideShow.getPageSize();
            int width = pgSize != null && pgSize.width > 0 ? pgSize.width : 720;
            int height = pgSize != null && pgSize.height > 0 ? pgSize.height : 540;
            PDRectangle slideRect = new PDRectangle(width, height);

            List<? extends Slide<?, ?>> slides = slideShow.getSlides();
            if (slides.isEmpty()) {
                doc.addPage(new PDPage(slideRect));
            } else {
                double scale = 2.0;
                int imgW = (int) Math.round(width * scale);
                int imgH = (int) Math.round(height * scale);
                for (Slide<?, ?> slide : slides) {
                    BufferedImage img = new BufferedImage(imgW, imgH, BufferedImage.TYPE_INT_RGB);
                    Graphics2D g2d = img.createGraphics();
                    try {
                        g2d.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
                        g2d.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
                        g2d.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
                        g2d.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
                        g2d.setColor(Color.WHITE);
                        g2d.fillRect(0, 0, imgW, imgH);
                        g2d.setTransform(AffineTransform.getScaleInstance(scale, scale));
                        slide.draw(g2d);
                    } catch (Exception drawEx) {
                        log.debug("Slide draw fallback on {}: {}", fileName, drawEx.getMessage());
                    } finally {
                        g2d.dispose();
                    }
                    PDPage page = new PDPage(slideRect);
                    doc.addPage(page);
                    PDImageXObject pdImage = JPEGFactory.createFromImage(doc, img, 0.92f);
                    try (PDPageContentStream cs = new PDPageContentStream(doc, page)) {
                        cs.drawImage(pdImage, 0, 0, width, height);
                    }
                }
            }
            doc.save(out);
            return out.toByteArray();
        } catch (Exception e) {
            throw new IllegalArgumentException(LangText.of(
                    "演示文稿「" + fileName + "」转 PDF 失败: " + e.getMessage(),
                    "Failed to convert presentation \"" + fileName + "\" to PDF: " + e.getMessage()), e);
        } finally {
            closeTtc(ttcHolder[0]);
        }
    }

    private void registerAwtCjkFont() {
        try {
            File fontFile = pdfEditService.resolveCjkFontFile();
            if (fontFile != null && fontFile.isFile()) {
                java.awt.Font[] fonts = java.awt.Font.createFonts(fontFile);
                java.awt.GraphicsEnvironment ge = java.awt.GraphicsEnvironment.getLocalGraphicsEnvironment();
                for (java.awt.Font f : fonts) {
                    ge.registerFont(f);
                }
            }
        } catch (Exception ignored) {
        }
    }

    // ==================== 本机 LibreOffice CLI 优先通道（可选） ====================

    private byte[] tryConvertViaSoffice(byte[] rawBytes, String ext) {
        String soffice = findSofficeExecutable();
        if (soffice == null) return null;
        Path workDir = null;
        try {
            workDir = Files.createTempDirectory("awd-soffice-pdf-");
            Path input = workDir.resolve("input." + ext);
            Path profileDir = workDir.resolve("profile");
            Files.write(input, rawBytes);
            ProcessBuilder pb = new ProcessBuilder(
                    soffice,
                    "--headless",
                    "--nologo",
                    "--nofirststartwizard",
                    "-env:UserInstallation=" + profileDir.toUri(),
                    "--convert-to", "pdf",
                    "--outdir", workDir.toString(),
                    input.toString()
            );
            pb.redirectErrorStream(true);
            Process proc = pb.start();
            boolean finished = proc.waitFor(30, TimeUnit.SECONDS);
            if (!finished) {
                proc.destroyForcibly();
                return null;
            }
            Path outPdf = workDir.resolve("input.pdf");
            if (proc.exitValue() == 0 && Files.isRegularFile(outPdf) && Files.size(outPdf) > 0) {
                return Files.readAllBytes(outPdf);
            }
        } catch (Exception e) {
            log.debug("soffice 转 PDF 未生效，回退内置转换器: {}", e.getMessage());
        } finally {
            deleteDirectoryQuietly(workDir);
        }
        return null;
    }

    private static String findSofficeExecutable() {
        String[] candidates = {
                "/Applications/LibreOffice.app/Contents/MacOS/soffice",
                "/usr/bin/soffice",
                "/usr/local/bin/soffice",
                "C:\\Program Files\\LibreOffice\\program\\soffice.exe"
        };
        for (String c : candidates) {
            File f = new File(c);
            if (f.isFile() && f.canExecute()) return c;
        }
        return null;
    }

    // ==================== PDF 排版游标（段落 / 表格 / 内嵌图） ====================

    private PDFont loadFont(PDDocument doc, TrueTypeCollection[] ttcHolder) throws IOException {
        File fontFile = pdfEditService.resolveCjkFontFile();
        if (fontFile != null) {
            try {
                return pdfEditService.loadEmbeddedCjkFont(doc, fontFile, ttcHolder);
            } catch (Exception e) {
                log.warn("加载 CJK 字体失败，退回标准字体: {}", e.getMessage());
            }
        }
        return new PDType1Font(Standard14Fonts.FontName.HELVETICA);
    }

    private static void closeTtc(TrueTypeCollection ttc) {
        if (ttc != null) {
            try {
                ttc.close();
            } catch (IOException ignored) {
            }
        }
    }

    private static final class LayoutCursor {
        private final PDDocument doc;
        private final PDRectangle pageSize;
        private final PDFont font;
        private PDPage currentPage;
        private PDPageContentStream cs;
        private float y;

        LayoutCursor(PDDocument doc, PDRectangle pageSize, PDFont font) {
            this.doc = doc;
            this.pageSize = pageSize;
            this.font = font;
        }

        void ensureFirstPage() throws IOException {
            if (currentPage == null) {
                newPage();
            }
        }

        void newPage() throws IOException {
            if (cs != null) {
                cs.close();
            }
            currentPage = new PDPage(pageSize);
            doc.addPage(currentPage);
            cs = new PDPageContentStream(doc, currentPage);
            y = pageSize.getHeight() - MARGIN;
        }

        void writeParagraph(String text, float fontSize, boolean center) throws IOException {
            ensureFirstPage();
            float maxWidth = pageSize.getWidth() - MARGIN * 2;
            float lineHeight = fontSize * 1.45f;
            for (String rawLine : text.split("\\r?\\n")) {
                List<String> wrapped = wrapText(rawLine, font, fontSize, maxWidth);
                for (String line : wrapped) {
                    if (y - lineHeight < MARGIN) {
                        newPage();
                    }
                    y -= lineHeight;
                    String safe = filterEncodable(line, font);
                    if (!safe.isEmpty()) {
                        float x = MARGIN;
                        if (center) {
                            float w = safeWidth(safe, font, fontSize);
                            x = Math.max(MARGIN, (pageSize.getWidth() - w) / 2f);
                        }
                        cs.beginText();
                        cs.setFont(font, fontSize);
                        cs.newLineAtOffset(x, y);
                        cs.showText(safe);
                        cs.endText();
                    }
                }
            }
            y -= fontSize * 0.35f;
        }

        void writeInlineImage(PDDocument pdfDoc, byte[] imgBytes, String name) throws IOException {
            try {
                PDImageXObject img = PDImageXObject.createFromByteArray(pdfDoc, imgBytes, name);
                ensureFirstPage();
                float maxW = pageSize.getWidth() - MARGIN * 2;
                float maxH = (pageSize.getHeight() - MARGIN * 2) * 0.6f;
                float scale = Math.min(1f, Math.min(maxW / Math.max(1, img.getWidth()), maxH / Math.max(1, img.getHeight())));
                float drawW = img.getWidth() * scale;
                float drawH = img.getHeight() * scale;
                if (y - drawH < MARGIN) {
                    newPage();
                }
                y -= drawH;
                cs.drawImage(img, MARGIN, y, drawW, drawH);
                y -= 8f;
            } catch (Exception ignored) {
            }
        }

        void writeTable(List<List<String>> rows, float fontSize, boolean shadeHeader) throws IOException {
            if (rows.isEmpty()) return;
            ensureFirstPage();
            int cols = rows.stream().mapToInt(List::size).max().orElse(1);
            if (cols <= 0) return;
            float tableWidth = pageSize.getWidth() - MARGIN * 2;
            float colWidth = tableWidth / cols;
            float cellPad = 4f;
            float lineHeight = fontSize * 1.35f;

            for (int rIdx = 0; rIdx < rows.size(); rIdx++) {
                List<String> row = rows.get(rIdx);
                List<List<String>> wrappedCells = new ArrayList<>(cols);
                int maxLines = 1;
                for (int c = 0; c < cols; c++) {
                    String cellText = c < row.size() && row.get(c) != null ? row.get(c) : "";
                    List<String> lines = wrapText(cellText, font, fontSize, Math.max(16f, colWidth - cellPad * 2));
                    if (lines.size() > 8) {
                        lines = new ArrayList<>(lines.subList(0, 8));
                    }
                    wrappedCells.add(lines);
                    if (lines.size() > maxLines) maxLines = lines.size();
                }
                float rowHeight = maxLines * lineHeight + cellPad * 2;
                if (y - rowHeight < MARGIN) {
                    newPage();
                }
                float topY = y;
                float bottomY = y - rowHeight;
                if (shadeHeader && rIdx == 0) {
                    cs.setNonStrokingColor(0.93f, 0.95f, 0.97f);
                    cs.addRect(MARGIN, bottomY, tableWidth, rowHeight);
                    cs.fill();
                    cs.setNonStrokingColor(0f, 0f, 0f);
                }
                cs.setStrokingColor(0.75f, 0.78f, 0.82f);
                cs.setLineWidth(0.5f);
                for (int c = 0; c < cols; c++) {
                    float cellX = MARGIN + c * colWidth;
                    cs.addRect(cellX, bottomY, colWidth, rowHeight);
                    cs.stroke();
                    List<String> lines = wrappedCells.get(c);
                    float textY = topY - cellPad - fontSize;
                    for (String line : lines) {
                        String safe = filterEncodable(line, font);
                        if (!safe.isEmpty()) {
                            cs.beginText();
                            cs.setFont(font, fontSize);
                            cs.newLineAtOffset(cellX + cellPad, textY);
                            cs.showText(safe);
                            cs.endText();
                        }
                        textY -= lineHeight;
                    }
                }
                cs.setStrokingColor(0f, 0f, 0f);
                y = bottomY;
            }
            y -= 8f;
        }

        void close() throws IOException {
            if (cs != null) {
                cs.close();
                cs = null;
            }
        }
    }

    private static List<String> wrapText(String text, PDFont font, float fontSize, float maxWidth) {
        String cleaned = cleanControlChars(text);
        if (cleaned.isEmpty()) return List.of("");
        List<String> lines = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        for (int i = 0; i < cleaned.length(); ) {
            int cp = cleaned.codePointAt(i);
            String ch = new String(Character.toChars(cp));
            i += Character.charCount(cp);
            if (!canEncode(font, ch)) continue;
            String candidate = current + ch;
            if (safeWidth(candidate, font, fontSize) > maxWidth && current.length() > 0) {
                lines.add(current.toString());
                current.setLength(0);
                current.append(ch);
            } else {
                current.append(ch);
            }
        }
        if (current.length() > 0 || lines.isEmpty()) {
            lines.add(current.toString());
        }
        return lines;
    }

    private static String filterEncodable(String text, PDFont font) {
        if (text == null || text.isEmpty()) return "";
        StringBuilder sb = new StringBuilder(text.length());
        for (int i = 0; i < text.length(); ) {
            int cp = text.codePointAt(i);
            String ch = new String(Character.toChars(cp));
            i += Character.charCount(cp);
            if (canEncode(font, ch)) sb.append(ch);
        }
        return sb.toString();
    }

    private static boolean canEncode(PDFont font, String s) {
        try {
            font.encode(s);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static float safeWidth(String s, PDFont font, float fontSize) {
        try {
            return font.getStringWidth(s) / 1000f * fontSize;
        } catch (Exception e) {
            return s.length() * fontSize * 0.6f;
        }
    }

    private static String cleanControlChars(String s) {
        if (s == null) return "";
        return s.replace("\t", "    ")
                .replaceAll("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]", "");
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

    private static void deleteDirectoryQuietly(Path dir) {
        if (dir == null || !Files.exists(dir)) return;
        try (var stream = Files.walk(dir)) {
            stream.sorted(java.util.Comparator.reverseOrder()).forEach(ProjectFilePdfService::deleteQuietly);
        } catch (IOException ignored) {
        }
    }
}
