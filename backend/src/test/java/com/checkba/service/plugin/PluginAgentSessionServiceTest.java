// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.plugin;

import com.checkba.model.entity.AgentInboxItem;
import com.checkba.model.entity.AgentRunRecord;
import com.checkba.model.entity.PluginAgentSession;
import com.checkba.plugin.api.ToolCall;
import com.checkba.repository.*;
import com.checkba.service.ProjectAiMessageService;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.ai.*;
import com.checkba.service.ai.skill.SkillDefinition;
import com.checkba.service.ai.skill.SkillRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class PluginAgentSessionServiceTest {
    private static final String KEY = "session-12345678-1234-1234-1234-123456789abc";
    private static final ToolCall CALL = new ToolCall(1L, null, 7L, null);
    private final Map<String, PluginAgentSession> bindings = new HashMap<>();
    private final Map<String, AgentInboxItem> inputs = new LinkedHashMap<>();
    private final PluginAgentSessionRepository repository = mock(PluginAgentSessionRepository.class);
    private final ConversationIssuanceService issuance = mock(ConversationIssuanceService.class);
    private final ProjectMemberService members = mock(ProjectMemberService.class);
    private final ProjectAiMessageService messages = mock(ProjectAiMessageService.class);
    private final PluginService plugins = mock(PluginService.class);
    private final SkillRegistry skills = mock(SkillRegistry.class);
    private final AgentOrchestrator orchestrator = mock(AgentOrchestrator.class);
    private final AgentRunStateService states = mock(AgentRunStateService.class);
    private final AgentRunRecordRepository runs = mock(AgentRunRecordRepository.class);
    private final ChatModelFactory models = mock(ChatModelFactory.class);
    private final AgentInboxItemRepository inboxRepository = mock(AgentInboxItemRepository.class);
    private AgentInboxService inbox;
    private PluginAgentSessionService service;
    private SkillDefinition skill;
    private final AtomicInteger executions = new AtomicInteger();

    private String scope(String plugin, Long user, Long project, String key) {
        return plugin + ":" + user + ":" + project + ":" + key;
    }

    private PluginAgentSessionService newService() {
        return new PluginAgentSessionService(repository, issuance, members, messages, plugins, skills,
                inbox, orchestrator, states, runs, models);
    }

    @BeforeEach
    void setup() {
        when(members.hasWritePermission(anyLong(), anyLong())).thenReturn(true);
        for (String id : List.of("dpia", "other")) {
            var meta = new PluginService.PluginMetadata();
            meta.setId(id);
            meta.setPermissions(List.of("file_read", "file_write", "ai"));
            when(plugins.getPlugin(id)).thenReturn(meta);
            when(plugins.isEnabled(id)).thenReturn(true);
        }
        AtomicInteger issued = new AtomicInteger();
        when(issuance.issue(anyLong(), anyLong())).thenAnswer(i -> "conv-native-" + issued.incrementAndGet());
        when(repository.findByPluginIdAndUserIdAndProjectIdAndSessionKey(anyString(), anyLong(), anyLong(), anyString()))
                .thenAnswer(i -> Optional.ofNullable(bindings.get(scope(i.getArgument(0), i.getArgument(1),
                        i.getArgument(2), i.getArgument(3)))));
        when(repository.saveAndFlush(any())).thenAnswer(i -> {
            PluginAgentSession s = i.getArgument(0);
            bindings.put(scope(s.getPluginId(), s.getUserId(), s.getProjectId(), s.getSessionKey()), s);
            return s;
        });
        skill = new SkillDefinition();
        skill.setId("dpia-assess");
        skill.setSourcePluginId("dpia");
        when(skills.getSkill("dpia-assess")).thenReturn(Optional.of(skill));
        when(skills.isAvailable(skill)).thenReturn(true);
        when(inboxRepository.saveAndFlush(any())).thenAnswer(i -> save(i.getArgument(0)));
        when(inboxRepository.save(any())).thenAnswer(i -> save(i.getArgument(0)));
        when(inboxRepository.findById(anyString())).thenAnswer(i -> Optional.ofNullable(inputs.get(i.getArgument(0))));
        when(inboxRepository.findConversationIdById(anyString())).thenAnswer(i ->
                Optional.ofNullable(inputs.get(i.getArgument(0))).map(AgentInboxItem::getConversationId));
        when(inboxRepository.findByConversationIdOrderByPositionAscCreatedAtAsc(anyString()))
                .thenAnswer(i -> rows(i.getArgument(0), null));
        when(inboxRepository.findByConversationIdAndStateOrderByPositionAscCreatedAtAsc(anyString(), anyString()))
                .thenAnswer(i -> rows(i.getArgument(0), i.getArgument(1)));
        when(inboxRepository.findByConversationIdAndUserIdAndClientRequestId(anyString(), anyLong(), anyString()))
                .thenAnswer(i -> inputs.values().stream().filter(r -> Objects.equals(r.getConversationId(), i.getArgument(0))
                        && Objects.equals(r.getUserId(), i.getArgument(1))
                        && Objects.equals(r.getClientRequestId(), i.getArgument(2))).findFirst());
        inbox = new AgentInboxService(inboxRepository, mock(SseEmitterService.class), states);
        when(orchestrator.acceptInboxSubmission(anyString(), eq(false))).thenAnswer(i -> {
            var item = inbox.require(i.getArgument(0));
            if (AgentInboxService.PENDING.equals(item.getState())) {
                executions.incrementAndGet();
                inbox.claim(item.getId(), "run-1", false);
            }
            return "run-1";
        });
        service = newService();
    }

    private AgentInboxItem save(AgentInboxItem item) { inputs.put(item.getId(), item); return item; }
    private List<AgentInboxItem> rows(String conv, String state) {
        return inputs.values().stream().filter(i -> Objects.equals(conv, i.getConversationId())
                && (state == null || state.equals(i.getState()))).toList();
    }
    private void ensure() { service.ensure("dpia", CALL, KEY, "DPIA assessment"); }
    private boolean submit(String text) {
        return service.submit("dpia", CALL, KEY, "request-1", text, List.of("dpia-assess"));
    }

    @Test
    void durableCreationAndScopeSurviveServiceReconstruction() {
        var first = service.ensure("dpia", CALL, KEY, "DPIA assessment");
        assertEquals(first.conversationId(), newService().ensure("dpia", CALL, KEY, "Renamed").conversationId());
        assertEquals(1, bindings.size());
        assertThrows(NoSuchElementException.class, () -> service.status("other", CALL, KEY));
        assertThrows(NoSuchElementException.class, () -> service.status("dpia", new ToolCall(2L, null, 7L, null), KEY));
        assertThrows(NoSuchElementException.class, () -> service.status("dpia", new ToolCall(1L, null, 8L, null), KEY));
        assertNotEquals(first.conversationId(), service.ensure("other", CALL, KEY, "Other").conversationId());
        verify(issuance, times(2)).issue(7L, 1L);
    }

    @Test
    void receiptRetryKeepsFrozenInboxAndDoesNotExecuteTwice() {
        ensure();
        assertTrue(submit("Frozen prompt"));
        service = newService();
        assertTrue(submit("Changed retry must not replace the frozen prompt"));
        assertEquals(1, inputs.size());
        assertEquals(1, executions.get());
        var row = inputs.values().iterator().next();
        assertEquals("Frozen prompt", row.getMessage());
        assertEquals(1L, row.getProjectId());
        assertEquals(7L, row.getUserId());
        var request = inbox.requestOf(row);
        assertEquals("none", request.getClientCapability());
        assertEquals("queue", request.getSubmissionMode());
        assertEquals(List.of("dpia-assess"), request.getSkillIds());
        verify(orchestrator, never()).handleUserMessage(any(), any());
    }

    @Test
    void lostExecutionAcknowledgementReusesPersistedInput() {
        ensure();
        doThrow(new IllegalStateException("lost acknowledgement")).when(orchestrator).acceptInboxSubmission(anyString(), eq(false));
        assertThrows(IllegalStateException.class, () -> submit("Frozen"));
        assertEquals(1, inputs.size());
        assertTrue(service.status("dpia", CALL, KEY).running());
        doReturn("run-recovered").when(orchestrator).acceptInboxSubmission(anyString(), eq(false));
        assertTrue(submit("Frozen"));
        assertEquals(1, inputs.size());
    }

    @Test
    void revokedMembershipPluginPermissionAndOwnershipFailClosed() {
        ensure();
        when(members.hasWritePermission(1L, 7L)).thenReturn(false);
        assertThrows(SecurityException.class, () -> submit("No"));
        when(members.hasWritePermission(1L, 7L)).thenReturn(true);
        when(plugins.isEnabled("dpia")).thenReturn(false);
        assertThrows(SecurityException.class, () -> service.status("dpia", CALL, KEY));
        when(plugins.isEnabled("dpia")).thenReturn(true);
        when(messages.countByConversationId(anyString())).thenReturn(1L);
        assertThrows(SecurityException.class, () -> service.cancel("dpia", CALL, KEY));
        verifyNoInteractions(models);
        assertTrue(inputs.isEmpty());
    }

    @Test
    void foreignOrDisabledSkillsCannotReachInbox() {
        ensure();
        skill.setSourcePluginId("other");
        assertThrows(SecurityException.class, () -> submit("No"));
        skill.setSourcePluginId("dpia");
        when(skills.isAvailable(skill)).thenReturn(false);
        assertThrows(SecurityException.class, () -> submit("No"));
        assertThrows(IllegalArgumentException.class, () -> service.submit("dpia", CALL, KEY, "r", "No", List.of()));
        verifyNoInteractions(models);
        assertTrue(inputs.isEmpty());
    }

    @Test
    void paidAccessGateRunsBeforeInboxAdmission() {
        ensure();
        doThrow(new IllegalStateException("not entitled")).when(models).ensurePaidAccess(7L);
        assertThrows(IllegalStateException.class, () -> submit("No"));
        assertTrue(inputs.isEmpty());
    }

    @Test
    void cancellationDeletesPendingInputsAndRetryCannotResurrectThem() {
        ensure();
        doReturn("running-earlier").when(orchestrator).acceptInboxSubmission(anyString(), eq(false));
        assertTrue(submit("Queued"));
        assertTrue(service.status("dpia", CALL, KEY).running());
        assertTrue(service.cancel("dpia", CALL, KEY));
        assertEquals(AgentInboxService.DELETED, inputs.values().iterator().next().getState());
        assertFalse(submit("Queued"));
        assertFalse(service.status("dpia", CALL, KEY).running());
        verify(orchestrator).setCancelled("conv-native-1");
        verify(orchestrator, times(1)).acceptInboxSubmission(anyString(), eq(false));
    }

    @Test
    void persistedRunningStateIsNotMistakenForCompletionAfterRestart() {
        ensure();
        var record = new AgentRunRecord();
        record.setStatus("RUNNING");
        when(runs.findByConversationId("conv-native-1")).thenReturn(Optional.of(record));
        assertTrue(service.status("dpia", CALL, KEY).running());
        record.setStatus("INTERRUPTED");
        assertFalse(service.status("dpia", CALL, KEY).running());
    }
    @Test
    void authorizationRejectsClientAndRequiresAiOnlyForSubmission() {
        ensure();
        plugins.getPlugin("dpia").setPermissions(List.of("file_read", "file_write"));
        assertDoesNotThrow(() -> service.authorize("dpia", CALL));
        assertThrows(SecurityException.class, () -> submit("No AI permission"));
        when(members.isClient(1L, 7L)).thenReturn(true);
        assertThrows(SecurityException.class, () -> service.authorize("dpia", CALL));
        assertThrows(SecurityException.class, () -> service.authorize("dpia", null));
        assertTrue(inputs.isEmpty());
    }

}
