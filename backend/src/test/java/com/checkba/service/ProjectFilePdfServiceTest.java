// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service;

import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.ai.LitigationPngService;
import com.checkba.service.ai.PdfEditService;
import com.checkba.storage.StorageService;
import com.checkba.storage.StorageServiceFactory;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.apache.poi.xslf.usermodel.XMLSlideShow;
import org.apache.poi.xslf.usermodel.XSLFSlide;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.apache.poi.xwpf.usermodel.XWPFParagraph;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ProjectFilePdfServiceTest {

    @TempDir
    Path tempDir;

    ProjectFileService projectFileService = mock(ProjectFileService.class);
    ProjectFileRepository projectFileRepository = mock(ProjectFileRepository.class);
    ProjectFileAccessService fileAccess = mock(ProjectFileAccessService.class);
    StorageServiceFactory storageServiceFactory = mock(StorageServiceFactory.class);
    StorageService storageService = mock(StorageService.class);
    PdfEditService pdfEditService = new PdfEditService();
    LitigationPngService litigationPngService = new LitigationPngService();
    DocumentTextService documentTextService = mock(DocumentTextService.class);

    final Map<Long, ProjectFile> store = new ConcurrentHashMap<>();
    final Map<Long, byte[]> contentStore = new ConcurrentHashMap<>();
    final AtomicLong idSeq = new AtomicLong(100L);

    ProjectFilePdfService service;

    @BeforeEach
    void setUp() throws Exception {
        when(storageServiceFactory.getStorageService()).thenReturn(storageService);
        when(projectFileService.getFile(anyLong())).thenAnswer(inv -> {
            ProjectFile pf = store.get(inv.getArgument(0, Long.class));
            if (pf == null) throw new IllegalArgumentException("File not found");
            return pf;
        });
        when(projectFileService.getFileBytes(anyLong())).thenAnswer(inv ->
                contentStore.get(inv.getArgument(0, Long.class)));
        when(projectFileService.generateWpsFileId(anyLong())).thenReturn("wps_test_id");

        when(projectFileService.createFile(
                anyLong(), any(), anyString(), anyString(), anyLong(), any(), anyString(), anyLong(), any()
        )).thenAnswer(inv -> {
            Long projectId = inv.getArgument(0, Long.class);
            Long parentId = inv.getArgument(1, Long.class);
            String name = inv.getArgument(2, String.class);
            String fileType = inv.getArgument(3, String.class);
            Long size = inv.getArgument(4, Long.class);
            Long userId = inv.getArgument(7, Long.class);

            Path outPath = tempDir.resolve(name);
            ProjectFile saved = new ProjectFile();
            saved.setId(idSeq.incrementAndGet());
            saved.setProjectId(projectId);
            saved.setParentId(parentId);
            saved.setIsFolder(false);
            saved.setIsDeleted(false);
            saved.setName(name);
            saved.setFileType(fileType);
            saved.setFileSize(size);
            saved.setFilePath(outPath.toString());
            saved.setUserId(userId);
            store.put(saved.getId(), saved);
            return saved;
        });

        when(storageService.save(anyString(), any(InputStream.class))).thenAnswer(inv -> {
            String pathStr = inv.getArgument(0, String.class);
            InputStream in = inv.getArgument(1, InputStream.class);
            byte[] bytes = in.readAllBytes();
            Files.write(Path.of(pathStr), bytes);
            return pathStr;
        });

        when(projectFileRepository.save(any(ProjectFile.class))).thenAnswer(inv -> {
            ProjectFile pf = inv.getArgument(0, ProjectFile.class);
            store.put(pf.getId(), pf);
            if (pf.getFilePath() != null && Files.isRegularFile(Path.of(pf.getFilePath()))) {
                contentStore.put(pf.getId(), Files.readAllBytes(Path.of(pf.getFilePath())));
            }
            return pf;
        });

        service = new ProjectFilePdfService(
                projectFileService,
                projectFileRepository,
                fileAccess,
                storageServiceFactory,
                pdfEditService,
                litigationPngService,
                documentTextService
        );
    }

    @Test
    @DisplayName("Word / Excel / PPT / 图片可单文件转为同目录 PDF，且多选可分别转 PDF 后合并为单个 PDF（dev-board#1291）")
    void convertAndMergeSupportedFilesIntoPdf() throws Exception {
        ProjectFile docxFile = registerFile("服务合同.docx", "docx", createSampleDocx("第一条 合同标的与履行要求"));
        ProjectFile xlsxFile = registerFile("付款台账.xlsx", "xlsx", createSampleXlsx("期次", "100万元"));
        ProjectFile pptxFile = registerFile("项目汇报.pptx", "pptx", createSamplePptx());
        ProjectFile pngFile = registerFile("营业执照.png", "png", createSamplePng());

        ProjectFile convertedDocx = service.convertFileToPdf(1L, docxFile.getId(), 9L);
        assertEquals("服务合同.pdf", convertedDocx.getName());
        assertEquals("pdf", convertedDocx.getFileType());
        assertTrue(convertedDocx.getFileSize() > 0);
        try (PDDocument doc = Loader.loadPDF(Path.of(convertedDocx.getFilePath()).toFile())) {
            assertTrue(doc.getNumberOfPages() >= 1);
        }

        ProjectFile merged = service.mergeFilesToPdf(
                1L,
                List.of(docxFile.getId(), xlsxFile.getId(), pptxFile.getId(), pngFile.getId()),
                9L
        );
        assertNotNull(merged);
        assertEquals("服务合同等4份合并.pdf", merged.getName());
        assertEquals("pdf", merged.getFileType());
        try (PDDocument mergedDoc = Loader.loadPDF(Path.of(merged.getFilePath()).toFile())) {
            assertTrue(mergedDoc.getNumberOfPages() >= 4,
                    "4 份文件分别转 PDF 后合并应至少包含 4 页，实际页数=" + mergedDoc.getNumberOfPages());
        }
    }

    @Test
    @DisplayName("不支持转 PDF 的文件或少于 2 个文件的合并请求应明确拒绝（dev-board#1291）")
    void rejectsUnsupportedExtensionsAndSingleFileMerge() throws Exception {
        ProjectFile pdfFile = registerFile("已转文档.pdf", "pdf", createSampleDocx("占位"));
        assertThrows(IllegalArgumentException.class,
                () -> service.convertFileToPdf(1L, pdfFile.getId(), 9L));
        assertThrows(IllegalArgumentException.class,
                () -> service.mergeFilesToPdf(1L, List.of(pdfFile.getId()), 9L));
    }

    private ProjectFile registerFile(String name, String ext, byte[] bytes) throws Exception {
        Path p = tempDir.resolve(name);
        Files.write(p, bytes);
        ProjectFile pf = new ProjectFile();
        pf.setId(idSeq.incrementAndGet());
        pf.setProjectId(1L);
        pf.setParentId(10L);
        pf.setIsFolder(false);
        pf.setIsDeleted(false);
        pf.setName(name);
        pf.setFileType(ext);
        pf.setFilePath(p.toString());
        pf.setFileSize((long) bytes.length);
        store.put(pf.getId(), pf);
        contentStore.put(pf.getId(), bytes);
        return pf;
    }

    private static byte[] createSampleDocx(String text) throws Exception {
        try (XWPFDocument doc = new XWPFDocument();
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            XWPFParagraph p = doc.createParagraph();
            p.createRun().setText(text);
            doc.write(out);
            return out.toByteArray();
        }
    }

    private static byte[] createSampleXlsx(String col1, String col2) throws Exception {
        try (XSSFWorkbook wb = new XSSFWorkbook();
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            Sheet sheet = wb.createSheet("台账");
            Row row = sheet.createRow(0);
            row.createCell(0).setCellValue(col1);
            row.createCell(1).setCellValue(col2);
            wb.write(out);
            return out.toByteArray();
        }
    }

    private static byte[] createSamplePptx() throws Exception {
        try (XMLSlideShow ppt = new XMLSlideShow();
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            XSLFSlide slide = ppt.createSlide();
            assertNotNull(slide);
            ppt.write(out);
            return out.toByteArray();
        }
    }

    private static byte[] createSamplePng() throws Exception {
        BufferedImage img = new BufferedImage(120, 80, BufferedImage.TYPE_INT_RGB);
        Graphics2D g2d = img.createGraphics();
        g2d.setColor(Color.WHITE);
        g2d.fillRect(0, 0, 120, 80);
        g2d.setColor(Color.BLUE);
        g2d.drawRect(10, 10, 100, 60);
        g2d.dispose();
        try (ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            ImageIO.write(img, "png", out);
            return out.toByteArray();
        }
    }
}
