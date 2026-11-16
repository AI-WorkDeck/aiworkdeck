// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.tools;

import com.checkba.service.ai.AgentOrchestratorViewedPagesAccess;
import com.checkba.service.ai.AuxModelResolver;
import com.checkba.service.ai.ChatModelFactory;
import com.checkba.service.ai.EditorBridgeService;
import com.checkba.service.ai.TokenUsageService;
import com.checkba.service.ai.ToolImageInbox;
import dev.langchain4j.data.message.ChatMessage;
import dev.langchain4j.data.message.ImageContent;
import dev.langchain4j.data.message.UserMessage;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class DocViewToolsTest {

    private final EditorBridgeService bridge = mock(EditorBridgeService.class);
    private final ToolImageInbox inbox = new ToolImageInbox();
    private final ChatModelFactory models = mock(ChatModelFactory.class);
    private final AuxModelResolver aux = mock(AuxModelResolver.class);
    private final TokenUsageService usage = mock(TokenUsageService.class);
    private final DocViewTools tools = new DocViewTools(bridge, inbox, models, aux, usage);

    @AfterEach
    void clear() {
        ToolContextHolder.clear();
    }

    private static String pdfBase64(int pages) throws Exception {
        try (PDDocument doc = new PDDocument(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            for (int i = 0; i < pages; i++) doc.addPage(new PDPage());
            doc.save(out);
            return Base64.getEncoder().encodeToString(out.toByteArray());
        }
    }

    private void context(String model) {
        ToolContextHolder.set(new ToolContext(7L, "conv-view", 42L, model, null, null, "run", null, null, null, null, null));
    }

    @Test
    void visionModelGetsRenderedPagesThroughTheInboxCappedAtFourPages() throws Exception {
        when(bridge.executeEditorCommand(eq("export_pdf"), anyMap())).thenReturn("{\"base64\":\"" + pdfBase64(6) + "\"}");
        when(models.effectiveModelSupportsVision("vision-model")).thenReturn(true);
        context("vision-model");

        String out = tools.doc_view_pages(2, 9, null);

        assertThat(out).contains("2–5").contains("6");
        ToolImageInbox.Batch batch = inbox.take("conv-view");
        assertThat(batch).isNotNull();
        assertThat(batch.images()).hasSize(4);
        assertThat(batch.caption()).contains("doc_view_pages");
        verifyNoInteractions(aux);
    }

    @Test
    void outOfRangeStartPageIsAnActionableError() throws Exception {
        when(bridge.executeEditorCommand(eq("export_pdf"), anyMap())).thenReturn("{\"base64\":\"" + pdfBase64(2) + "\"}");
        when(models.effectiveModelSupportsVision(any())).thenReturn(true);
        context("vision-model");

        assertThat(tools.doc_view_pages(5, null, null)).startsWith("Error").contains("2");
        assertThat(inbox.take("conv-view")).isNull();
    }

    @Test
    void editorErrorsAreReturnedWithoutRendering() {
        when(bridge.executeEditorCommand(eq("export_pdf"), anyMap())).thenReturn("{\"error\":\"当前文档类型不支持导出 PDF\"}");
        context("vision-model");
        assertThat(tools.doc_view_pages(1, null, null)).startsWith("Error").contains("不支持");
    }

    @Test
    void newerViewReplacesOlderPageImagesInTheMessageStack() {
        List<ChatMessage> messages = new ArrayList<>();
        ImageContent img = ImageContent.from(Base64.getEncoder().encodeToString(new byte[]{1, 2, 3}), "image/png");
        AgentOrchestratorViewedPagesAccess.append(messages, new ToolImageInbox.Batch("doc_view_pages 第 1 页", List.of(img)));
        AgentOrchestratorViewedPagesAccess.append(messages, new ToolImageInbox.Batch("doc_view_pages 第 2 页", List.of(img, img)));

        assertThat(messages).hasSize(2);
        assertThat(((UserMessage) messages.get(0)).contents()).noneMatch(c -> c instanceof ImageContent);
        assertThat(((UserMessage) messages.get(1)).contents()).filteredOn(c -> c instanceof ImageContent).hasSize(2);
    }
}
