// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.tools;

import com.checkba.model.entity.ProjectFile;
import com.checkba.service.ProjectFileService;
import com.checkba.service.ai.*;
import com.checkba.service.ai.context.ProjectContextHolder;
import com.checkba.service.pack.ModelPresence;
import com.checkba.service.pack.NativePackService;
import com.checkba.storage.ProjectStorageResolver;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.InOrder;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class PdfOcrDependenciesTest {
    @TempDir Path tmp;
    PdfEditService pdf = mock(PdfEditService.class);
    ProjectFileService files = mock(ProjectFileService.class);
    EditorBridgeService bridge = mock(EditorBridgeService.class);
    AiDocxExportService export = mock(AiDocxExportService.class);
    PptxServiceClient client = mock(PptxServiceClient.class);
    NativePackService packs = mock(NativePackService.class);
    ModelPresence models = mock(ModelPresence.class);
    ProjectStorageResolver storage = mock(ProjectStorageResolver.class);
    com.checkba.service.ocr.OcrRoutingService routing = mock(com.checkba.service.ocr.OcrRoutingService.class);
    com.checkba.service.ocr.PdfCloudOcrService cloud = mock(com.checkba.service.ocr.PdfCloudOcrService.class);
    PdfTools tools;
    Path source;

    @BeforeEach void setup() throws Exception {
        ProjectContextHolder.setProjectId("3");
        source = Files.writeString(tmp.resolve("synthetic-scan.pdf"), "%PDF synthetic fixture");
        ProjectFile file = new ProjectFile();
        file.setId(7L); file.setProjectId(3L); file.setName("synthetic-scan.pdf");
        file.setFilePath(source.toString());
        when(files.getFile(7L)).thenReturn(file);
        when(storage.resolve(source.toString())).thenReturn(source);
        when(pdf.extractMarkdown(source)).thenReturn(new PdfEditService.ExtractedText("Page 1", true));
        when(packs.knownSizes(anyString())).thenReturn(new NativePackService.Sizes(1048576L, 0));
        when(routing.route(any(), any())).thenReturn(com.checkba.service.ocr.OcrRoutingService.Route.LOCAL);
        tools = new PdfTools(pdf, files, null, bridge, export, client, storage, packs, models, routing, cloud);
    }

    @AfterEach void cleanup() { ProjectContextHolder.clear(); ToolContextHolder.clear(); }

    @Test void preparesEntryThenOcrRuntimeAndModelsAndOnlyThenConverts() throws Exception {
        String first = tools.pdf_to_word(7L, null, null);
        assertTrue(first.contains("已请用户确认下载"), first);
        verify(bridge).sendComponentRequiredAction(eq("pptx-runtime"), eq("pptx-service"), isNull(),
                anyLong(), anyList(), eq("pdf_to_word"));
        verifyNoInteractions(client, export, models);
        verify(packs, never()).isReady("mineru-runtime");

        when(packs.isReady("pptx-runtime")).thenReturn(true);
        String second = tools.pdf_to_word(7L, null, null);
        assertTrue(second.contains("运行组件和模型"), second);
        verifyNoInteractions(client, export);

        when(packs.isReady("mineru-runtime")).thenReturn(true);
        String third = tools.pdf_to_word(7L, null, null);
        assertTrue(third.contains("识别模型"), third);
        verifyNoInteractions(client, export);
        verify(bridge, times(2)).sendComponentRequiredAction(eq("mineru-runtime"), eq("mineru-service"),
                eq("mineru-models"), anyLong(), anyList(), eq("pdf_to_word"));

        when(models.installed("mineru-models")).thenReturn(true);
        when(client.isHealthy()).thenReturn(true);
        when(client.ocrPdfToMarkdown(source.toString())).thenReturn("Recognized synthetic content");
        ProjectFile docx = new ProjectFile(); docx.setId(9L); docx.setName("synthetic-scan.docx");
        when(export.exportMarkdownToDocx(eq(3L), isNull(), anyLong(), anyString(), eq("Recognized synthetic content")))
                .thenReturn(docx);
        String fourth = tools.pdf_to_word(7L, null, null);
        assertTrue(fourth.contains("本地 MinerU OCR"), fourth);
        InOrder order = inOrder(client, export, bridge);
        order.verify(client).isHealthy();
        order.verify(client).ocrPdfToMarkdown(source.toString());
        order.verify(export).exportMarkdownToDocx(eq(3L), isNull(), anyLong(), anyString(), eq("Recognized synthetic content"));
        order.verify(bridge).noteGenerated(anyString(), eq(9L));
        order.verify(bridge).sendRefreshFilesAction();
        order.verify(bridge).sendOpenFileAction(docx);
        verify(bridge, times(3)).sendComponentRequiredAction(anyString(), anyString(), any(), anyLong(), anyList(), anyString());
    }

    @Test void localFailureNeverExportsThinTextEvenWhenStructuralFallbackAllowed() throws Exception {
        ready();
        when(client.ocrPdfToMarkdown(anyString())).thenThrow(new RuntimeException("synthetic local service unavailable"));
        String out = tools.pdf_to_word(7L, null, true);
        assertTrue(out.contains("本地 OCR 未完成"), out);
        assertTrue(out.contains("选择云端识别"), out);
        verifyNoInteractions(cloud);
        verifyNoInteractions(export);
        verify(client, never()).convertPdfToDocx(anyString(), anyString());
        verify(bridge, never()).sendComponentRequiredAction(anyString(), anyString(), any(), anyLong(), anyList(), anyString());
        verify(bridge, never()).sendOpenFileAction(any());
    }

    @Test void emptyLocalResultDoesNotProduceAWordFile() {
        ready();
        when(client.ocrPdfToMarkdown(anyString())).thenReturn("  ");
        assertTrue(tools.pdf_to_word(7L, null, null).contains("本地 OCR 未返回解析内容"));
        verifyNoInteractions(export);
        verify(bridge, never()).sendOpenFileAction(any());
    }

    @Test void oldRuntimeRequiresAnUpdateWithoutAnotherDownloadLoop() {
        ready();
        when(client.ocrPdfToMarkdown(anyString())).thenThrow(new PptxServiceClient.LocalOcrUnsupportedException());
        String out = tools.pdf_to_word(7L, null, null);
        assertTrue(out.contains("更新"), out);
        assertTrue(out.contains("暂不可用"), out);
        assertFalse(out.contains("重新执行"), out);
        verifyNoInteractions(export);
        verify(bridge, never()).sendComponentRequiredAction(anyString(), anyString(), any(), anyLong(), anyList(), anyString());
    }

    @Test void stoppedEntryServiceIsNotMisreportedAsMissingOcrModel() {
        ready();
        when(client.isHealthy()).thenReturn(false);
        String out = tools.pdf_to_word(7L, null, null);
        assertTrue(out.contains("PDF 转换入口服务未启动"), out);
        assertFalse(out.contains("识别模型"), out);
        verify(client, never()).ocrPdfToMarkdown(anyString());
        verifyNoInteractions(export);
    }

    @Test void noChoiceOffersUiAndNeverUploads() throws Exception {
        when(routing.route(any(), any())).thenReturn(com.checkba.service.ocr.OcrRoutingService.Route.ASK);
        assertTrue(tools.pdf_to_word(7L, null, null).contains("选择云端"));
        verify(routing).offer(any(), eq(source), anyString(), eq(true));
        verifyNoInteractions(cloud, export);
    }

    @Test void savedCloudChoiceAutomaticallyHandlesMissingLocalComponents() throws Exception {
        when(routing.route(any(), any())).thenReturn(com.checkba.service.ocr.OcrRoutingService.Route.CLOUD);
        successfulCloud();
        String result = tools.pdf_to_word(7L, null, null);
        assertTrue(result.contains("云端 OCR"), result);
        verifyNoInteractions(client);
        verify(cloud).recognize(eq(source), any());
        verify(routing, never()).offer(any(), any(), anyString(), anyBoolean());
    }

    @Test void localFailureCanContinueWithAlreadyAuthorizedCloud() throws Exception {
        ready();
        when(routing.route(any(), any())).thenReturn(com.checkba.service.ocr.OcrRoutingService.Route.CLOUD);
        when(client.ocrPdfToMarkdown(anyString())).thenThrow(new RuntimeException("local failed"));
        successfulCloud();
        assertTrue(tools.pdf_to_word(7L, null, null).contains("云端 OCR"));
        verify(cloud).recognize(eq(source), any());
    }

    @Test void cloudFailureOffersRetryOrLocalWithoutGeneratingPartialWord() throws Exception {
        when(routing.route(any(), any())).thenReturn(com.checkba.service.ocr.OcrRoutingService.Route.CLOUD);
        when(cloud.recognize(eq(source), any())).thenThrow(new IllegalStateException("第 2 页余额不足"));
        String result = tools.pdf_to_word(7L, null, null);
        assertTrue(result.contains("重试云端或改用本地"), result);
        verify(routing).offer(any(), eq(source), contains("余额不足"), eq(true));
        verifyNoInteractions(export);
    }

    @Test void explicitCloudClickSkipsTheAlreadyFailedLocalService() throws Exception {
        ready();
        when(routing.route(any(), any())).thenReturn(com.checkba.service.ocr.OcrRoutingService.Route.CLOUD);
        when(routing.cloudChosenForTask(any(), any())).thenReturn(true);
        successfulCloud();
        assertTrue(tools.pdf_to_word(7L, null, null).contains("云端 OCR"));
        verifyNoInteractions(client);
    }

    @Test void withdrawingCloudPreferenceDuringLocalAttemptPreventsFallback() throws Exception {
        ready();
        when(routing.route(any(), any())).thenReturn(com.checkba.service.ocr.OcrRoutingService.Route.CLOUD,
                com.checkba.service.ocr.OcrRoutingService.Route.ASK);
        when(client.ocrPdfToMarkdown(anyString())).thenThrow(new RuntimeException("local failed"));
        assertTrue(tools.pdf_to_word(7L, null, null).contains("选择云端"));
        verifyNoInteractions(cloud, export);
    }

    @Test void uploadGuardUsesOriginalRunCancellationAndDoesNotOfferAnotherDecision() throws Exception {
        when(routing.route(any(), any())).thenReturn(com.checkba.service.ocr.OcrRoutingService.Route.CLOUD);
        var cancelled = new java.util.concurrent.atomic.AtomicBoolean(false);
        ToolContextHolder.set(new ToolContext(3L, "conv", 1L, "model", java.util.List.of(), java.util.Set.of(), "run", java.util.Set.of(), cancelled::get));
        when(cloud.recognize(eq(source), any())).thenAnswer(i -> {
            var guard = (com.checkba.service.ocr.PdfCloudOcrService.UploadGuard)i.getArgument(1);
            guard.check();
            cancelled.set(true);
            guard.check();
            return "should never complete";
        });
        assertTrue(tools.pdf_to_word(7L, null, null).contains("任务已取消"));
        verify(routing, times(1)).requireCloudPermission(any(), eq(source));
        verify(routing, never()).offer(any(), any(), anyString(), anyBoolean());
        verifyNoInteractions(export);
    }

    @Test void cancellationAfterFinalCloudResultCannotExportWord() throws Exception {
        when(routing.route(any(), any())).thenReturn(com.checkba.service.ocr.OcrRoutingService.Route.CLOUD);
        var cancelled = new java.util.concurrent.atomic.AtomicBoolean(false);
        ToolContextHolder.set(new ToolContext(3L, "conv", 1L, "model", java.util.List.of(), java.util.Set.of(), "run", java.util.Set.of(), cancelled::get));
        when(cloud.recognize(eq(source), any())).thenAnswer(i -> { cancelled.set(true); return "Completed late"; });
        assertTrue(tools.pdf_to_word(7L, null, null).contains("任务已取消"));
        verifyNoInteractions(export);
        verify(routing, never()).offer(any(), any(), anyString(), anyBoolean());
    }
    @Test void cancellationByDecisionAfterFinalCloudResultCannotExportWord() throws Exception {
        when(routing.route(any(), any())).thenReturn(com.checkba.service.ocr.OcrRoutingService.Route.CLOUD);
        when(cloud.recognize(eq(source), any())).thenAnswer(i -> {
            when(routing.route(any(), any())).thenReturn(com.checkba.service.ocr.OcrRoutingService.Route.CANCELLED);
            return "Completed late";
        });
        assertTrue(tools.pdf_to_word(7L, null, null).contains("任务已取消"));
        verifyNoInteractions(export);
    }

    private void successfulCloud() throws Exception {
        when(cloud.recognize(eq(source), any())).thenReturn("Full synthetic OCR");
        ProjectFile output = new ProjectFile(); output.setId(9L); output.setName("synthetic.docx");
        when(export.exportMarkdownToDocx(anyLong(), any(), anyLong(), anyString(), eq("Full synthetic OCR"))).thenReturn(output);
    }

    private void ready() {
        when(packs.isReady("pptx-runtime")).thenReturn(true);
        when(packs.isReady("mineru-runtime")).thenReturn(true);
        when(models.installed("mineru-models")).thenReturn(true);
        when(client.isHealthy()).thenReturn(true);
    }
}
