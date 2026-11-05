// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ocr;

import cn.hutool.json.JSONArray;
import cn.hutool.json.JSONObject;
import com.checkba.service.LangText;
import com.checkba.service.OcrService;
import com.checkba.service.ai.PdfEditService;
import com.checkba.service.ai.PptxServiceClient;
import com.checkba.service.pack.ModelPresence;
import com.checkba.service.pack.NativePackService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.fontbox.ttf.TrueTypeCollection;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.graphics.image.LosslessFactory;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.nio.file.Path;
import java.util.*;

/**
 * The two layout-aware explorer exports (tutorial-series#155 phase 2): 「导出 Word（保留版式）」 and
 * 「生成可搜索 PDF」, for both recognition routes.
 *
 * <ul>
 *   <li><b>Cloud</b>: pages go through the single metered entry {@link OcrService#recognizeGeneral}
 *       with {@code layout=true} (coordinates, stamps, tables, paragraphs; same price, one call per
 *       page). The first page is checked for coordinates right away, so a gateway that does not
 *       support layout yet stops the job after one page instead of billing the whole document.</li>
 *   <li><b>Local</b>: MinerU via pptx-service ({@link PptxServiceClient#ocrPdfLocal}); never uploads.</li>
 * </ul>
 * Results are cached by file content ({@link OcrResultCache}), so the second export of the same
 * scan neither uploads nor bills again. No new provider and no new outbound request.
 */
@Service
public class OcrExportService {

    /** Rendering resolution shared with {@link PdfCloudOcrService}: coordinates are in this pixel frame. */
    static final int DPI = 150;
    static final String CLOUD = "cloud-layout";
    static final String LOCAL_LAYOUT = "local-layout";
    static final String LOCAL_TEXT = "local-text";

    /** The OCR result has no coordinates: the platform gateway has not been updated yet. */
    public static final class LayoutUnsupportedException extends IllegalStateException {
        LayoutUnsupportedException(String message) { super(message); }
    }

    /** The installed local component predates layout output (pptx-runtime < 1.0.6). */
    public static final class ComponentOutdatedException extends IllegalStateException {
        ComponentOutdatedException(String message) { super(message); }
    }

    /** MinerU output: markdown plus, with layout, per-page lines and referenced images. */
    public record LocalResult(String markdown, List<MineruLayoutReader.PageLines> pages,
                              Map<String, String> images, boolean hasLayout) {}

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final OcrService ocr;
    private final PptxServiceClient pptx;
    private final NativePackService packs;
    private final ModelPresence models;
    private final PdfEditService pdfEdit;
    private final OcrResultCache cache;

    @Autowired
    public OcrExportService(OcrService ocr, PptxServiceClient pptx, NativePackService packs, ModelPresence models,
                            PdfEditService pdfEdit, @Value("${storage.local.root-path:data}") String storageRoot) {
        this(ocr, pptx, packs, models, pdfEdit, new OcrResultCache(Path.of(storageRoot).toAbsolutePath().resolve(".ocr-cache"), 300));
    }

    OcrExportService(OcrService ocr, PptxServiceClient pptx, NativePackService packs, ModelPresence models,
                     PdfEditService pdfEdit, OcrResultCache cache) {
        this.ocr = ocr; this.pptx = pptx; this.packs = packs; this.models = models;
        this.pdfEdit = pdfEdit; this.cache = cache;
    }

    /** Same readiness rule as scanned-PDF conversion in {@code PdfTools}. */
    public boolean localReady() {
        try {
            return packs != null && models != null && packs.isReady("pptx-runtime")
                    && packs.isReady("mineru-runtime") && models.installed("mineru-models");
        } catch (Exception e) {
            return false;
        }
    }

    // =================================================================== documents

    /** Source as a PDF: PDFs as they are, an image as one page at {@link #DPI}. */
    static byte[] asPdf(byte[] bytes, boolean pdf) throws Exception {
        if (pdf) return bytes;
        BufferedImage image = ImageIO.read(new ByteArrayInputStream(bytes));
        if (image == null) throw new IllegalArgumentException(LangText.of("无法读取该图片", "This image cannot be read"));
        try (PDDocument doc = new PDDocument(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            float w = image.getWidth() * 72f / DPI, h = image.getHeight() * 72f / DPI;
            PDPage page = new PDPage(new PDRectangle(w, h));
            doc.addPage(page);
            var xobject = LosslessFactory.createFromImage(doc, image);
            try (var content = new PDPageContentStream(doc, page)) {
                content.drawImage(xobject, 0, 0, w, h);
            }
            doc.save(out);
            return out.toByteArray();
        }
    }

    /** Displayed page size in points (crop box, rotation applied). */
    static double[] displaySize(PDPage page) {
        PDRectangle box = page.getCropBox();
        int rotation = ((page.getRotation() % 360) + 360) % 360;
        boolean sideways = rotation == 90 || rotation == 270;
        return new double[]{sideways ? box.getHeight() : box.getWidth(), sideways ? box.getWidth() : box.getHeight()};
    }

    // =================================================================== cloud

    /**
     * One raw RecognizeAllText result per page ("" for a blank page that was not uploaded).
     * All-or-nothing like {@link PdfCloudOcrService#recognizePages}; cached only with coordinates.
     */
    public List<String> cloudPages(byte[] sourceBytes, byte[] pdfBytes, PdfCloudOcrService.UploadGuard guard) throws Exception {
        String cached = cache.get(sourceBytes, CLOUD);
        if (cached != null) {
            List<String> pages = new ArrayList<>();
            for (JsonNode raw : MAPPER.readTree(cached).path("pages")) pages.add(raw.asText(""));
            if (!pages.isEmpty()) return pages;
        }
        List<String> pages = new ArrayList<>();
        try (PDDocument doc = Loader.loadPDF(pdfBytes)) {
            if (doc.getNumberOfPages() == 0) throw new IllegalStateException(LangText.of("PDF 没有页面", "PDF has no pages"));
            PDFRenderer renderer = new PDFRenderer(doc);
            for (int i = 0; i < doc.getNumberOfPages(); i++) {
                guard.check();
                BufferedImage image = renderer.renderImageWithDPI(i, DPI);
                try {
                    if (PdfCloudOcrService.isWhite(image)) { pages.add(""); continue; }
                    ByteArrayOutputStream png = new ByteArrayOutputStream();
                    ImageIO.write(image, "png", png);
                    guard.check(); // immediately before each billable upload
                    String raw;
                    try {
                        raw = ocr.recognizeGeneral(Base64.getEncoder().encodeToString(png.toByteArray()), true).getRaw();
                    } catch (Exception error) {
                        throw new IllegalStateException(LangText.of(
                                "云端 OCR 第 " + (i + 1) + " 页未完成：" + error.getMessage() + "。未生成文件；已完成页的识别可能已计费，重试会重新识别。",
                                "Cloud OCR failed on page " + (i + 1) + ": " + error.getMessage() + ". No file was generated; completed pages may have been billed, and retrying will re-run OCR."), error);
                    }
                    try {
                        AliyunLayoutReader.searchLines(raw);
                    } catch (AliyunLayoutReader.MissingLayoutException e) {
                        throw new LayoutUnsupportedException(LangText.of(
                                "云端识别服务暂不支持保留版式（未返回文字位置），已在第 " + (i + 1) + " 页停止，未生成文件；该页可能已计费。请稍后再试，或在设置中改用本地识别。",
                                "The cloud OCR service does not support layout yet (no text positions returned). Stopped at page " + (i + 1)
                                        + "; no file was generated and that page may have been billed. Try again later or switch to local recognition in Settings."));
                    }
                    pages.add(raw);
                } finally {
                    image.flush();
                }
            }
        }
        guard.check(); // a cancel during the last request must not produce a late file
        cache.put(sourceBytes, CLOUD, MAPPER.writeValueAsString(Map.of("pages", pages)));
        return pages;
    }

    public byte[] layoutDocxFromCloud(byte[] pdfBytes, List<String> raws) throws Exception {
        List<OcrLayout.Page> pages = new ArrayList<>();
        try (PDDocument doc = Loader.loadPDF(pdfBytes)) {
            PDFRenderer renderer = new PDFRenderer(doc);
            for (int i = 0; i < doc.getNumberOfPages() && i < raws.size(); i++) {
                double[] size = displaySize(doc.getPage(i));
                String raw = raws.get(i);
                if (raw == null || raw.isBlank()) {
                    pages.add(new OcrLayout.Page(size[0], size[1], 72, 72, 72, 72, 12, 20, List.of()));
                    continue;
                }
                // the page image is only needed to cut out seals
                BufferedImage image = raw.contains("stampPoints") ? renderer.renderImageWithDPI(i, DPI) : null;
                try {
                    pages.add(AliyunLayoutReader.read(raw, size[0], size[1], image));
                } finally {
                    if (image != null) image.flush();
                }
            }
        }
        return LayoutDocxWriter.write(pages);
    }

    public byte[] searchablePdfFromCloud(byte[] pdfBytes, List<String> raws) throws Exception {
        List<SearchablePdfWriter.PageText> texts = new ArrayList<>();
        for (String raw : raws) {
            texts.add(raw == null || raw.isBlank()
                    ? new SearchablePdfWriter.PageText(1, 1, List.of())
                    : AliyunLayoutReader.searchLines(raw));
        }
        return searchable(pdfBytes, texts);
    }

    // =================================================================== local

    public LocalResult local(byte[] sourceBytes, byte[] pdfBytes, boolean layout) throws Exception {
        String variant = layout ? LOCAL_LAYOUT : LOCAL_TEXT;
        String cached = cache.get(sourceBytes, variant);
        JSONObject data;
        if (cached != null) {
            data = new JSONObject(cached);
        } else {
            if (!pptx.isHealthy())
                throw new IllegalStateException(LangText.of("本机识别服务未启动或不可达", "The local recognition service is not running"));
            Path temp = java.nio.file.Files.createTempFile("awd_explorer_ocr_local_", ".pdf");
            try {
                java.nio.file.Files.write(temp, pdfBytes);
                data = pptx.ocrPdfLocal(temp.toString(), layout);
            } finally {
                java.nio.file.Files.deleteIfExists(temp);
            }
            if (data == null || data.getStr("markdown", "").isBlank())
                throw new IllegalStateException(LangText.of("本地识别未返回内容", "Local recognition returned no content"));
            cache.put(sourceBytes, variant, data.toString());
        }
        return parseLocal(data);
    }

    static LocalResult parseLocal(JSONObject data) {
        List<MineruLayoutReader.PageLines> pages = new ArrayList<>();
        JSONArray rawPages = data.getJSONArray("pages");
        if (rawPages != null) {
            for (Object o : rawPages) {
                JSONObject p = (JSONObject) o;
                List<SearchablePdfWriter.Line> lines = new ArrayList<>();
                JSONArray rawLines = p.getJSONArray("lines");
                if (rawLines != null) for (Object l : rawLines) {
                    JSONObject line = (JSONObject) l;
                    JSONArray b = line.getJSONArray("bbox");
                    if (b == null || b.size() < 4) continue;
                    lines.add(new SearchablePdfWriter.Line(line.getStr("text", ""),
                            b.getDouble(0), b.getDouble(1), b.getDouble(2), b.getDouble(3)));
                }
                pages.add(new MineruLayoutReader.PageLines(p.getDouble("width", 0d), p.getDouble("height", 0d), lines));
            }
        }
        Map<String, String> images = new HashMap<>();
        JSONObject rawImages = data.getJSONObject("images");
        if (rawImages != null) rawImages.forEach((k, v) -> images.put(k, String.valueOf(v)));
        return new LocalResult(data.getStr("markdown", ""), pages, images, rawPages != null);
    }

    public byte[] layoutDocxFromLocal(byte[] pdfBytes, LocalResult result) throws Exception {
        double w = 595.3, h = 841.9;
        try (PDDocument doc = Loader.loadPDF(pdfBytes)) {
            if (doc.getNumberOfPages() > 0) { double[] s = displaySize(doc.getPage(0)); w = s[0]; h = s[1]; }
        }
        return LayoutDocxWriter.write(MineruLayoutReader.read(result.markdown(), result.images(), w, h));
    }

    public byte[] searchablePdfFromLocal(byte[] pdfBytes, LocalResult result) throws Exception {
        if (!result.hasLayout()) throw new ComponentOutdatedException(LangText.of(
                "本机识别组件版本较旧，不支持生成可搜索 PDF。请在组件管理中更新「PPT 生成与 PDF 转 Word」组件后重试。",
                "The local recognition component is too old to make searchable PDFs. Update the \"PPT generation and PDF to Word\" component in Components and try again."));
        return searchable(pdfBytes, MineruLayoutReader.searchLines(result.pages()));
    }

    /** MinerU markdown → plain text for copy / TXT / text-first Word. */
    public static String plainText(String markdown) {
        StringBuilder out = new StringBuilder();
        for (OcrLayout.Page page : MineruLayoutReader.read(markdown, Map.of(), 595, 842)) {
            for (OcrLayout.Block b : page.blocks()) {
                if (out.length() > 0) out.append("\n\n");
                if (b instanceof OcrLayout.Para p) out.append(p.text());
                else if (b instanceof OcrLayout.Table t) {
                    for (int r = 0; r < t.rows(); r++) {
                        final int row = r;
                        if (r > 0) out.append('\n');
                        out.append(String.join("\t", t.cells().stream().filter(c -> c.r0() == row).map(OcrLayout.Cell::text).toList()));
                    }
                }
            }
        }
        return out.toString().replaceAll("\n{3,}", "\n\n").strip();
    }

    /**
     * PDF that already has a text layer → layout-level Word via the local pdf2docx conversion (free,
     * no upload). Null when that component is not available; the caller then falls back to the
     * text-first Word.
     */
    public byte[] layoutDocxFromTextPdf(byte[] pdfBytes) {
        try {
            if (packs == null || !packs.isReady("pptx-runtime") || !pptx.isHealthy()) return null;
        } catch (Exception e) {
            return null;
        }
        Path in = null, out = null;
        try {
            in = java.nio.file.Files.createTempFile("awd_explorer_layout_", ".pdf");
            out = java.nio.file.Files.createTempFile("awd_explorer_layout_", ".docx");
            java.nio.file.Files.write(in, pdfBytes);
            pptx.convertPdfToDocx(in.toString(), out.toString());
            byte[] docx = java.nio.file.Files.readAllBytes(out);
            return docx.length > 0 ? docx : null;
        } catch (Exception e) {
            return null;
        } finally {
            try { if (in != null) java.nio.file.Files.deleteIfExists(in); } catch (Exception ignored) { /* temp */ }
            try { if (out != null) java.nio.file.Files.deleteIfExists(out); } catch (Exception ignored) { /* temp */ }
        }
    }

    // =================================================================== searchable PDF

    byte[] searchable(byte[] pdfBytes, List<SearchablePdfWriter.PageText> texts) throws Exception {
        File fontFile = pdfEdit.resolveCjkFontFile();
        if (fontFile == null) throw new IllegalStateException(LangText.of(
                "未找到可嵌入的中文字体，无法生成可搜索 PDF", "No embeddable Chinese font was found, so a searchable PDF cannot be made"));
        TrueTypeCollection[] holder = new TrueTypeCollection[1];
        try (PDDocument doc = Loader.loadPDF(pdfBytes); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            PDFont font = pdfEdit.loadEmbeddedCjkFont(doc, fontFile, holder);
            String aliased = SearchablePdfWriter.aliasedCharacters(font, texts);
            if (!aliased.isEmpty()) throw new IllegalStateException(LangText.of(
                    "当前中文字体会让部分文字（" + aliased + "）无法被搜索，未生成文件。请在设置中配置其他中文字体。",
                    "The current Chinese font would make some characters (" + aliased + ") unsearchable; no file was generated. Configure another Chinese font in Settings."));
            SearchablePdfWriter.addTextLayer(doc, texts, font);
            doc.save(out);
            return out.toByteArray();
        } finally {
            if (holder[0] != null) try { holder[0].close(); } catch (Exception ignored) { /* closed after save */ }
        }
    }
}
