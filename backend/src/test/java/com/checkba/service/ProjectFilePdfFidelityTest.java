// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service;

import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.ai.LitigationPngService;
import com.checkba.storage.StorageServiceFactory;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.apache.poi.xwpf.usermodel.BreakType;
import org.apache.poi.wp.usermodel.HeaderFooterType;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import java.io.ByteArrayOutputStream;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;

class ProjectFilePdfFidelityTest {
    static byte[] fixture() throws Exception {
        try (var doc = new XWPFDocument(); var out = new ByteArrayOutputStream()) {
            doc.createHeader(HeaderFooterType.DEFAULT).createParagraph().createRun().setText("HEADER 1385");
            doc.createFooter(HeaderFooterType.DEFAULT).createParagraph().createRun().setText("FOOTER 1385");
            var run = doc.createParagraph().createRun();
            run.setText("合同金额 CNY 100");
            var table = doc.createTable(1, 2);
            table.getRow(0).getCell(0).setText("付款期限");
            table.getRow(0).getCell(1).setText("TABLE 1385");
            doc.createParagraph().createRun().addBreak(BreakType.PAGE);
            doc.createParagraph().createRun().setText("第二页 SECOND PAGE");
            doc.write(out);
            return out.toByteArray();
        }
    }
    @Test void absentLayoutEngineMustRejectInsteadOfDroppingChineseAndLayout() throws Exception {
        var converter = new LibreOfficePdfConverter();
        ReflectionTestUtils.setField(converter, "configuredExecutable", "/definitely/missing/soffice");
        var service = new ProjectFilePdfService(mock(ProjectFileService.class), mock(ProjectFileRepository.class),
                mock(ProjectFileAccessService.class), mock(StorageServiceFactory.class), converter,
                mock(LitigationPngService.class));
        var error = assertThrows(LibreOfficePdfConverter.ConversionException.class,
                () -> service.convertBytesToPdf(fixture(), "docx", "synthetic.docx"));
        assertEquals(LibreOfficePdfConverter.Failure.NOT_INSTALLED, error.failure);
    }

    @Test void realInstalledLayoutEnginePreservesChineseTableHeaderFooterAndPageBreak() throws Exception {
        var converter = new LibreOfficePdfConverter();
        org.junit.jupiter.api.Assumptions.assumeTrue(converter.findExecutable() != null,
                "Native LibreOffice is optional; absence behavior is covered without installation");
        byte[] bytes = converter.convert(fixture(), "docx");
        try (var pdf = Loader.loadPDF(bytes)) {
            String text = new PDFTextStripper().getText(pdf);
            assertAll(() -> assertTrue(text.contains("合同金额"), text),
                    () -> assertTrue(text.contains("付款期限") && text.contains("TABLE 1385"), text),
                    () -> assertTrue(text.contains("HEADER 1385") && text.contains("FOOTER 1385"), text),
                    () -> assertTrue(text.contains("第二页") && text.contains("SECOND PAGE"), text),
                    () -> assertEquals(2, pdf.getNumberOfPages(), text));
        }
    }
}
