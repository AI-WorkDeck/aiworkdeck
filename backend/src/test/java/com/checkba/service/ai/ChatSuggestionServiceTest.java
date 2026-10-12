// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.service.ProjectAiMessageService;
import dev.langchain4j.model.chat.ChatLanguageModel;
import dev.langchain4j.data.message.AiMessage;
import dev.langchain4j.model.output.Response;
import dev.langchain4j.model.output.TokenUsage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class ChatSuggestionServiceTest {
    ProjectAiMessageService messages = mock(ProjectAiMessageService.class);
    AgentRunStateService runs = mock(AgentRunStateService.class);
    ChatModelFactory models = mock(ChatModelFactory.class);
    TokenUsageService usage = mock(TokenUsageService.class);
    ChatSuggestionRepository repo = mock(ChatSuggestionRepository.class);
    AgentInboxItemRepository inbox = mock(AgentInboxItemRepository.class);
    ChatLanguageModel model = mock(ChatLanguageModel.class);
    ChatSuggestionService service = new ChatSuggestionService(messages, runs, models, usage, repo, inbox);
    ProjectAiMessage assistant;
    @BeforeEach void setup() {
        when(messages.canUseConversation("c", 7L)).thenReturn(true);
        when(runs.statusName("c")).thenReturn("FINISHED");
        assistant = new ProjectAiMessage(); assistant.setId(10L); assistant.setRole("ASSISTANT");
        assistant.setProjectId(1L); assistant.setContent("<process>private tool payload</process>已梳理三项风险。");
        when(messages.listByConversationIdPage(eq("c"), isNull(), anyInt())).thenReturn(List.of(assistant));
        when(models.resolveEffectiveModelId("chosen")).thenReturn("chosen");
        when(models.getChatModel(eq("chosen"), any(Duration.class), eq(256))).thenReturn(model);
        when(model.generate(any(dev.langchain4j.data.message.ChatMessage[].class))).thenReturn(Response.from(AiMessage.from("请逐条列出修改建议。"), new TokenUsage(10, 5)));
    }
    @Test void actualModelSuggestionIsBoundedBilledAndStoredWithoutToolPayloads() {
        var result = service.suggest(7L, "c", "chosen");
        assertEquals("请逐条列出修改建议。", result.text());
        assertEquals(10L, result.sourceMessageId());
        verify(models).getChatModel("chosen", Duration.ofSeconds(15), 256);
        verify(usage).recordUsage(eq(1L), eq(7L), eq("chosen"), any(), eq("c"));
        verify(model).generate(any(dev.langchain4j.data.message.SystemMessage.class), argThat(message ->
                !message.toString().contains("private tool payload") && message.toString().contains("三项风险")));
        verify(repo).save(argThat(item -> item.getUserId().equals(7L) && item.getOutcome().equals("shown")));
        assertNull(PlatformAiUserScope.current());
    }
    @Test void unauthorizedAndRunningOrRecoveryNeverCallModel() {
        assertThrows(ResponseStatusException.class, () -> service.suggest(8L, "c", "chosen"));
        when(runs.statusName("c")).thenReturn("RUNNING", "AWAITING_INPUT", null);
        for (int i=0; i<3; i++) assertNull(service.suggest(7L, "c", "chosen"));
        verifyNoInteractions(models);
    }
    @Test void changedConversationDiscardsLateSuggestion() {
        when(runs.statusName("c")).thenReturn("FINISHED", "RUNNING");
        assertNull(service.suggest(7L, "c", "chosen"));
        verify(repo, never()).save(any());
    }
    @Test void malformedOutputAndNoneDoNotCreateSuggestions() {
        for (String text : List.of("NONE", "<tool>run</tool>", "two\nlines", "x".repeat(241))) {
            when(model.generate(any(dev.langchain4j.data.message.ChatMessage[].class))).thenReturn(Response.from(AiMessage.from(text)));
            assertNull(service.suggest(7L, "c", "chosen"));
        }
        verify(repo, never()).save(any());
    }
    ChatSuggestion item() {
        var item = new ChatSuggestion(); item.setId("s"); item.setUserId(7L); item.setConversationId("c");
        item.setText("请列出建议"); item.setOutcome("shown"); item.setCreatedAt(LocalDateTime.now().minusMinutes(1));
        when(repo.findById("s")).thenReturn(Optional.of(item)); return item;
    }
    @Test void feedbackRequiresDurableReceiptAndDoesNotTrustClientAcceptance() {
        var item = item();
        assertThrows(ResponseStatusException.class, () -> service.feedback(7L,"s","not-received",false));
        assertEquals("shown",item.getOutcome());
        var receipt = new AgentInboxItem(); receipt.setMessage("只列第 3 条"); receipt.setCreatedAt(LocalDateTime.now());
        when(inbox.findByConversationIdAndUserIdAndClientRequestId("c",7L,"received")).thenReturn(Optional.of(receipt));
        service.feedback(7L,"s","received",false);
        assertEquals("edited",item.getOutcome()); assertEquals("只列第 3 条",item.getCorrection());
        service.feedback(7L,"s","received",false);
        verify(repo,times(1)).save(item);
    }
    @Test void acceptedAndDismissedAreDistinctAndCrossUserFeedbackRejected() {
        var item = item();
        assertThrows(ResponseStatusException.class, () -> service.feedback(8L,"s",null,true));
        var receipt = new AgentInboxItem(); receipt.setMessage(item.getText()); receipt.setCreatedAt(LocalDateTime.now());
        when(inbox.findByConversationIdAndUserIdAndClientRequestId("c",7L,"received")).thenReturn(Optional.of(receipt));
        service.feedback(7L,"s","received",false); assertEquals("accepted",item.getOutcome());
        item.setOutcome("shown"); service.feedback(7L,"s",null,true); assertEquals("dismissed",item.getOutcome());
    }
    @Test void duplicateRequestsReuseStoredSuggestionAndFeedbackGuidesNextRequest() {
        var item = item(); item.setSourceMessageId(10L);
        when(repo.findFirstByUserIdAndConversationIdAndSourceMessageIdAndModelIdOrderByCreatedAtDesc(7L,"c",10L,"chosen")).thenReturn(Optional.of(item));
        assertEquals("s",service.suggest(7L,"c","chosen").id()); verifyNoInteractions(model);
        when(repo.findFirstByUserIdAndConversationIdAndSourceMessageIdAndModelIdOrderByCreatedAtDesc(7L,"c",10L,"chosen")).thenReturn(Optional.empty());
        item.setOutcome("edited"); item.setCorrection("只列第 3 条");
        when(repo.findTop3ByUserIdAndConversationIdAndOutcomeInOrderByCreatedAtDesc(eq(7L),eq("c"),any())).thenReturn(List.of(item));
        service.suggest(7L,"c","chosen");
        verify(model).generate(any(dev.langchain4j.data.message.SystemMessage.class), argThat(message -> message.toString().contains("只列第 3 条")));
    }
}
