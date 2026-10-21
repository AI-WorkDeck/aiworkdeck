// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ocr;

import com.checkba.service.OcrService;
import org.springframework.stereotype.Service;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.rendering.PDFRenderer;
import java.nio.file.Path;
import java.io.ByteArrayOutputStream;
import java.util.Base64;
import javax.imageio.ImageIO;

/** Complete-page conversion: no page cap, swallowed errors or partial Word output. */
@Service
public class PdfCloudOcrService {
    private final OcrService ocr;
    public PdfCloudOcrService(OcrService ocr) { this.ocr = ocr; }
    @FunctionalInterface
    public interface UploadGuard { void check() throws Exception; }

    public String recognize(Path path, UploadGuard guard) throws Exception {
        try (var pdf = Loader.loadPDF(path.toFile())) {
            if (pdf.getNumberOfPages() == 0) throw new IllegalStateException("PDF 没有页面");
            var renderer = new PDFRenderer(pdf);
            var text = new StringBuilder();
            for (int page = 0; page < pdf.getNumberOfPages(); page++) {
                try {
                    guard.check(); // Cancellation also applies to blank pages and expensive rendering.
                    var image = renderer.renderImageWithDPI(page, 150);
                    try (var bytes = new ByteArrayOutputStream()) {
                        text.append("## 第 ").append(page + 1).append(" 页\n\n");
                        if (isWhite(image)) continue;
                        ImageIO.write(image, "png", bytes);
                        guard.check(); // Immediately before each billable upload, not merely before the document.
                        OcrResult result = ocr.recognizeGeneral(Base64.getEncoder().encodeToString(bytes.toByteArray()));
                        if (result == null || result.getText() == null || result.getText().isBlank())
                            throw new IllegalStateException("未返回可识别文字");
                        text.append(escapeMarkdown(result.getText())).append("\n\n");
                    } finally { image.flush(); }
                } catch (Exception error) {
                    throw new IllegalStateException("云端 OCR 第 " + (page + 1) + " 页未完成：" + error.getMessage()
                            + "。未生成不完整 Word；已完成页的识别可能已计费，重试会重新识别。", error);
                }
            }
            guard.check(); // A cancellation during the final HTTP request must not produce a late document.
            return text.toString();
        }
    }

    private static boolean isWhite(java.awt.image.BufferedImage image) {
        for (int y = 0; y < image.getHeight(); y++)
            for (int x = 0; x < image.getWidth(); x++)
                if ((image.getRGB(x, y) & 0xffffff) != 0xffffff) return false;
        return true;
    }

    static String escapeMarkdown(String text) {
        // CommonMark backslash escapes preserve literal OCR punctuation, including HTML and tables.
        StringBuilder escaped = new StringBuilder();
        for (char c : text.toCharArray()) {
            if ((c >= '!' && c <= '/') || (c >= ':' && c <= '@')
                    || (c >= '[' && c <= '`') || (c >= '{' && c <= '~')) escaped.append('\\');
            escaped.append(c);
        }
        return escaped.toString();
    }
}
