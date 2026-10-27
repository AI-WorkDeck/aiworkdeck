// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.storage;

import org.apache.poi.xslf.usermodel.XMLSlideShow;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BlankOfficeTemplateTest {

    private LocalFileStorageService storage(Path root, boolean withWordTemplate) throws Exception {
        Path template = root.resolve("template.docx");
        if (withWordTemplate) {
            try (XWPFDocument doc = new XWPFDocument(); var out = Files.newOutputStream(template)) {
                doc.createParagraph().createRun().setText("Word template text must not enter PPT or Excel");
                doc.write(out);
            }
        }
        StorageProperties props = new StorageProperties();
        props.getLocal().setRootPath(root.toString());
        props.getLocal().setTemplatePath(template.toString());
        return new LocalFileStorageService(new ProjectStorageResolver(props, null));
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void newExcelOpensWithOneBlankSheetWhetherWordTemplateExists(boolean withWordTemplate,
            @TempDir Path root) throws Exception {
        LocalFileStorageService storage = storage(root, withWordTemplate);
        String key = "projects/1/Untitled.xlsx";

        storage.createFromTemplate(key);

        try (var in = storage.load(key).getInputStream(); XSSFWorkbook book = new XSSFWorkbook(in)) {
            assertEquals(1, book.getNumberOfSheets());
            assertEquals(0, book.getSheetAt(0).getPhysicalNumberOfRows());
        }
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void newPptOpensWithOneBlankSlideWhetherWordTemplateExists(boolean withWordTemplate,
            @TempDir Path root) throws Exception {
        LocalFileStorageService storage = storage(root, withWordTemplate);
        String key = "projects/1/Untitled.pptx";

        storage.createFromTemplate(key);

        try (var in = storage.load(key).getInputStream(); XMLSlideShow slides = new XMLSlideShow(in)) {
            assertEquals(1, slides.getSlides().size());
            assertTrue(slides.getSlides().get(0).getShapes().isEmpty());
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"xlsx", "pptx"})
    void creationLeavesExistingFilesUntouchedAndReadingMissingFilesDoesNotCreateThem(String extension,
            @TempDir Path root) throws Exception {
        LocalFileStorageService storage = storage(root, true);
        Path existing = root.resolve("projects/1/Existing." + extension);
        Files.createDirectories(existing.getParent());
        Files.writeString(existing, "existing user content");

        storage.createFromTemplate("projects/1/Existing." + extension);

        assertEquals("existing user content", Files.readString(existing));
        String missing = "projects/1/Missing." + extension;
        assertThrows(StorageException.class, () -> storage.load(missing));
        assertFalse(Files.exists(root.resolve(missing)));
    }
}
