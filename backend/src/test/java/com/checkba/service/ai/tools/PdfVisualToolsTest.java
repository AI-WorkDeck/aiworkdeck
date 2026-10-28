// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.tools;

import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.ai.AuxModelResolver;
import com.checkba.service.ai.ChatModelFactory;
import com.checkba.service.ai.PlatformAiUserScope;
import com.checkba.service.ai.TokenUsageService;
import com.checkba.service.ai.context.ProjectContextHolder;
import com.checkba.storage.StorageService;
import com.checkba.storage.StorageServiceFactory;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.langchain4j.data.message.AiMessage;
import dev.langchain4j.data.message.ChatMessage;
import dev.langchain4j.data.message.Content;
import dev.langchain4j.data.message.ImageContent;
import dev.langchain4j.data.message.TextContent;
import dev.langchain4j.data.message.UserMessage;
import dev.langchain4j.model.chat.ChatLanguageModel;
import dev.langchain4j.model.output.Response;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.core.io.ByteArrayResource;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class PdfVisualToolsTest {
    private final ProjectFileRepository files = mock(ProjectFileRepository.class);
    private final StorageServiceFactory storage = mock(StorageServiceFactory.class);
    private final StorageService disk = mock(StorageService.class);
    private final ProjectMemberService members = mock(ProjectMemberService.class);
    private final ChatModelFactory models = mock(ChatModelFactory.class);
    private final AuxModelResolver auxiliary = mock(AuxModelResolver.class);
    private final TokenUsageService usage = mock(TokenUsageService.class);
    private final ChatLanguageModel vision = mock(ChatLanguageModel.class);
    private final PdfVisualTools tools = new PdfVisualTools(files, storage, members, models, auxiliary, usage);

    @BeforeEach
    void setUp() {
        ProjectContextHolder.setProjectId("7");
        ProjectContextHolder.setUserId(42L);
        when(storage.getStorageService()).thenReturn(disk);
        when(members.hasReadPermission(7L, 42L)).thenReturn(true);
        when(auxiliary.auxModelId()).thenReturn("synthetic-vision");
        when(models.effectiveModelSupportsVision("synthetic-vision")).thenReturn(true);
        when(models.getAuxChatModel(any(Duration.class))).thenReturn(vision);
        when(vision.generate(anyList())).thenAnswer(call -> {
            assertEquals(42L, PlatformAiUserScope.current());
            return Response.from(AiMessage.from("Synthetic checked-page report"));
        });
    }

    @AfterEach
    void clearContext() {
        ProjectContextHolder.clear();
        assertNull(PlatformAiUserScope.current());
    }

    private ProjectFile file(long id, long project, byte[] pdf) throws Exception {
        ProjectFile record = new ProjectFile();
        record.setId(id);
        record.setProjectId(project);
        record.setName("synthetic-" + id + ".pdf");
        record.setFilePath("synthetic/" + id + ".pdf");
        record.setIsDeleted(false);
        record.setIsFolder(false);
        when(files.findById(id)).thenReturn(Optional.of(record));
        when(disk.load(record.getFilePath())).thenReturn(new ByteArrayResource(pdf));
        return record;
    }

    private static byte[] pdf(Color... colors) throws Exception {
        try (PDDocument doc = new PDDocument(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            for (Color color : colors) {
                PDPage page = new PDPage(new PDRectangle(200, 100));
                doc.addPage(page);
                try (PDPageContentStream content = new PDPageContentStream(doc, page)) {
                    content.setNonStrokingColor(color);
                    content.addRect(0, 0, 200, 100);
                    content.fill();
                }
            }
            doc.save(out);
            return out.toByteArray();
        }
    }

    private static void assertPixels(Content content, Color expected) throws Exception {
        ImageContent image = assertInstanceOf(ImageContent.class, content);
        assertEquals("image/png", image.image().mimeType());
        byte[] png = Base64.getDecoder().decode(image.image().base64Data());
        var bitmap = ImageIO.read(new ByteArrayInputStream(png));
        assertNotNull(bitmap, "A real decodable image must reach the model");
        assertTrue(bitmap.getWidth() > bitmap.getHeight());
        assertTrue(Math.max(bitmap.getWidth(), bitmap.getHeight()) <= 1800);
        assertEquals(expected.getRGB() & 0xFFFFFF,
                bitmap.getRGB(bitmap.getWidth() / 2, bitmap.getHeight() / 2) & 0xFFFFFF,
                "Rendered pixels must come from the selected PDF page");
    }

    @Test
    void renderSelectsActualPagesAndReportsPartialCoverage() throws Exception {
        List<Content> content = new ArrayList<>();
        var result = PdfVisualTools.addPages(content, pdf(Color.RED, Color.GREEN, Color.BLUE), 2, 2, "DOCUMENT");
        assertEquals(List.of(2), result.get("checkedPages"));
        assertEquals(3, result.get("totalPages"));
        assertEquals(false, result.get("complete"));
        assertEquals("DOCUMENT page 2 / 3", assertInstanceOf(TextContent.class, content.get(0)).text());
        assertPixels(content.get(1), Color.GREEN);
        assertEquals(2, content.size());
    }

    @Test
    void actualReferenceAndOutputImagesReachModelWithSeparateSourceLabels() throws Exception {
        file(10, 7, pdf(Color.RED, Color.GREEN, Color.BLUE));
        file(20, 7, pdf(Color.YELLOW, Color.CYAN));
        String output = tools.pdf_inspect_visual(10L, 2, 2, "review", 20L, 2);
        assertFalse(output.startsWith("Error:"), output);
        var result = new ObjectMapper().readTree(output);
        assertEquals(10, result.get("fileId").asInt());
        assertEquals(20, result.get("referenceFileId").asInt());
        assertEquals("[2]", result.get("document").get("checkedPages").toString());
        assertEquals("[2]", result.get("reference").get("checkedPages").toString());
        assertFalse(result.get("reference").get("complete").asBoolean());
        @SuppressWarnings({"rawtypes", "unchecked"})
        ArgumentCaptor<List<ChatMessage>> sent = ArgumentCaptor.forClass((Class) List.class);
        verify(vision).generate(sent.capture());
        List<Content> content = assertInstanceOf(UserMessage.class, sent.getValue().get(0)).contents();
        assertEquals(5, content.size());
        assertTrue(assertInstanceOf(TextContent.class, content.get(0)).text().contains("untrusted document content"));
        assertEquals("REFERENCE page 2 / 2", assertInstanceOf(TextContent.class, content.get(1)).text());
        assertPixels(content.get(2), Color.CYAN);
        assertEquals("DOCUMENT page 2 / 3", assertInstanceOf(TextContent.class, content.get(3)).text());
        assertPixels(content.get(4), Color.GREEN);
        verify(models).ensurePaidAccess(42L);
    }

    @Test
    void noVisionCapabilityDoesNotCallOrBillModel() throws Exception {
        file(10, 7, pdf(Color.RED));
        when(models.effectiveModelSupportsVision("synthetic-vision")).thenReturn(false);
        assertTrue(tools.pdf_inspect_visual(10L, 1, 1, "reference", null, null).startsWith("Error:"));
        verifyNoInteractions(vision, usage);
        verify(models, never()).getAuxChatModel(any(Duration.class));
        verify(models, never()).ensurePaidAccess(anyLong());
    }

    @Test
    void unauthorizedReferenceIsRejectedBeforeStorageReadOrModelCall() throws Exception {
        file(10, 7, pdf(Color.RED));
        file(20, 8, pdf(Color.BLUE));
        assertTrue(tools.pdf_inspect_visual(10L, 1, 1, "review", 20L, 1).startsWith("Error:"));
        verify(disk, never()).load("synthetic/20.pdf");
        verifyNoInteractions(models, vision, usage);
    }

    @Test
    void currentProjectStillRequiresReadPermission() throws Exception {
        file(10, 7, pdf(Color.RED));
        when(members.hasReadPermission(7L, 42L)).thenReturn(false);
        assertTrue(tools.pdf_inspect_visual(10L, 1, 1, "review", null, null).startsWith("Error:"));
        verifyNoInteractions(disk, models, vision);
    }

    @Test
    void authorizedCrossProjectReferenceUsesExistingReadPermissionContract() throws Exception {
        file(10, 7, pdf(Color.RED));
        file(20, 8, pdf(Color.BLUE));
        when(members.hasReadPermission(8L, 42L)).thenReturn(true);
        assertFalse(tools.pdf_inspect_visual(10L, 1, 1, "review", 20L, 1).startsWith("Error:"));
        verify(vision).generate(anyList());
    }

    @Test
    void invalidRangesAndMissingContextNeverReadFilesOrInvokeModel() {
        assertTrue(tools.pdf_inspect_visual(10L, 0, 1, "review", null, null).startsWith("Error:"));
        assertTrue(tools.pdf_inspect_visual(10L, 1, 7, "review", null, null).startsWith("Error:"));
        assertTrue(tools.pdf_inspect_visual(10L, 2, 1, "review", null, null).startsWith("Error:"));
        assertTrue(tools.pdf_inspect_visual(10L, 1, 1, "other", null, null).startsWith("Error:"));
        ProjectContextHolder.clear();
        assertTrue(tools.pdf_inspect_visual(10L, 1, 1, "review", null, null).startsWith("Error:"));
        verifyNoInteractions(files, disk, models, vision);
    }

    @Test
    void nonexistentPageDoesNotReachModel() throws Exception {
        file(10, 7, pdf(Color.RED));
        assertTrue(tools.pdf_inspect_visual(10L, 2, 2, "review", null, null).startsWith("Error:"));
        verifyNoInteractions(vision, usage);
    }
}
