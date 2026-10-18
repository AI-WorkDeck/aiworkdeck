// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.plugin;

import com.checkba.controller.ai.AiAgentController.AgentChatRequest;
import com.checkba.model.entity.PluginAgentSession;
import com.checkba.plugin.api.PluginSession;
import com.checkba.plugin.api.ToolCall;
import com.checkba.repository.AgentRunRecordRepository;
import com.checkba.repository.PluginAgentSessionRepository;
import com.checkba.service.ProjectAiMessageService;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.ai.*;
import com.checkba.service.ai.skill.SkillRegistry;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.NoSuchElementException;
import java.util.Objects;

/** Admission boundary for plugin-created native sessions; never accepts user/project IDs from a plugin. */
@Service
@RequiredArgsConstructor
public class PluginAgentSessionService {
    // Bounded plugin input; the ordinary Agent endpoint currently has no explicit message length cap.
    static final int MAX_PROMPT_CHARS = 200_000;
    private final PluginAgentSessionRepository sessions;
    private final ConversationIssuanceService issuance;
    private final ProjectMemberService members;
    private final ProjectAiMessageService messages;
    private final PluginService plugins;
    private final SkillRegistry skills;
    private final AgentInboxService inbox;
    private final AgentOrchestrator orchestrator;
    private final AgentRunStateService runStates;
    private final AgentRunRecordRepository runRecords;
    private final ChatModelFactory models;

    private void requireScope(String pluginId, ToolCall call) {
        if (call == null || call.userId() == null || call.projectId() == null
                || !members.hasWritePermission(call.projectId(), call.userId())
                || members.isClient(call.projectId(), call.userId())) {
            throw new SecurityException("No access to this plugin Agent workspace");
        }
        var plugin = plugins.getPlugin(pluginId);
        if (plugin == null || !plugins.isEnabled(pluginId) || plugins.revokedReason(pluginId) != null
                || plugin.getPermissions() == null
                || !plugin.getPermissions().containsAll(List.of("file_read", "file_write"))) {
            throw new SecurityException("Plugin requires enabled file_read and file_write permissions");
        }
    }

    public void authorize(String pluginId, ToolCall call) {
        requireScope(pluginId, call);
    }

    private static void validateKey(String key) {
        if (key == null || !key.matches("session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")) {
            throw new IllegalArgumentException("Invalid plugin session key");
        }
    }

    private PluginAgentSession find(String pluginId, ToolCall call, String key) {
        requireScope(pluginId, call);
        validateKey(key);
        var session = sessions.findByPluginIdAndUserIdAndProjectIdAndSessionKey(
                pluginId, call.userId(), call.projectId(), key)
                .orElseThrow(() -> new NoSuchElementException("Plugin session not found"));
        // Empty shells are owned by our durable binding, including after issuance's memory expires.
        if (messages.countByConversationId(session.getConversationId()) > 0
                && !messages.isConversationOwnedBy(session.getConversationId(), call.userId())) {
            throw new SecurityException("Conversation ownership changed");
        }
        return session;
    }

    public synchronized PluginSession ensure(String pluginId, ToolCall call, String key, String title) {
        requireScope(pluginId, call);
        validateKey(key);
        if (title == null || title.isBlank() || title.length() > 120) {
            throw new IllegalArgumentException("Session title must contain 1–120 characters");
        }
        var existing = sessions.findByPluginIdAndUserIdAndProjectIdAndSessionKey(
                pluginId, call.userId(), call.projectId(), key);
        PluginAgentSession session;
        if (existing.isPresent()) {
            session = find(pluginId, call, key);
            session.setTitle(title.trim());
            sessions.saveAndFlush(session);
        } else {
            session = new PluginAgentSession();
            session.setPluginId(pluginId);
            session.setUserId(call.userId());
            session.setProjectId(call.projectId());
            session.setSessionKey(key);
            session.setConversationId(issuance.issue(call.userId(), call.projectId()));
            session.setTitle(title.trim());
            try {
                session = sessions.saveAndFlush(session);
            } catch (DataIntegrityViolationException race) {
                session = find(pluginId, call, key);
            }
        }
        messages.updateConversationTitle(session.getConversationId(), session.getTitle());
        return view(session);
    }

    public PluginSession status(String pluginId, ToolCall call, String key) {
        return view(find(pluginId, call, key));
    }

    private PluginSession view(PluginAgentSession session) {
        String conversation = session.getConversationId();
        synchronized (inbox.conversationLock(conversation)) {
            boolean running = orchestrator.activeRunId(conversation) != null
                    || inbox.nextPending(conversation).isPresent();
            String state = runStates.statusName(conversation);
            if (state == null) state = runRecords.findByConversationId(conversation)
                    .map(com.checkba.model.entity.AgentRunRecord::getStatus).orElse(null);
            running |= "RUNNING".equals(state);
            return new PluginSession(session.getSessionKey(), conversation, running);
        }
    }

    public boolean submit(String pluginId, ToolCall call, String key, String requestId,
                          String prompt, List<String> skillIds) {
        var session = find(pluginId, call, key);
        if (requestId == null || requestId.isBlank() || requestId.length() > 128
                || prompt == null || prompt.isBlank() || prompt.length() > MAX_PROMPT_CHARS) {
            throw new IllegalArgumentException("Invalid Agent prompt or request ID");
        }
        if (skillIds == null || skillIds.isEmpty() || skillIds.size() > 16) {
            throw new IllegalArgumentException("At least one plugin-owned skill is required");
        }
        List<String> selected = List.copyOf(skillIds);
        for (String id : selected) {
            var skill = skills.getSkill(id).orElseThrow(() -> new SecurityException("Unknown plugin skill"));
            if (!Objects.equals(pluginId, skill.getSourcePluginId()) || !skills.isAvailable(skill)) {
                throw new SecurityException("Skill is not available from this plugin");
            }
        }
        if (messages.isMirroredConversation(session.getConversationId())) {
            throw new SecurityException("Mirrored conversations are read-only");
        }
        if (!plugins.getPlugin(pluginId).getPermissions().contains("ai")) {
            throw new SecurityException("Plugin requires the ai permission");
        }
        models.ensurePaidAccess(call.userId());
        AgentChatRequest request = new AgentChatRequest();
        request.setProjectId(call.projectId());
        request.setConversationId(session.getConversationId());
        request.setMessage(prompt);
        request.setClientRequestId(requestId);
        request.setSubmissionMode(AgentInboxService.QUEUE);
        request.setMode("AGENT");
        request.setClientCapability("none");
        request.setSkillIds(selected);
        request.setModel(call.modelId());
        var item = inbox.submit(request, call.userId());
        // A tombstone must never be treated as a freshly accepted run or resurrected on retry.
        if (AgentInboxService.DELETED.equals(item.getState())) return false;
        String runId = orchestrator.acceptInboxSubmission(item.getId(), false);
        messages.updateConversationTitle(session.getConversationId(), session.getTitle());
        return "accepted".equals(inbox.receipt(item, runId).status());
    }

    public boolean cancel(String pluginId, ToolCall call, String key) {
        var session = find(pluginId, call, key);
        String conversation = session.getConversationId();
        synchronized (inbox.conversationLock(conversation)) {
            // Pending requests must not start later after the current run is cancelled.
            for (var item : inbox.snapshot(conversation).items()) {
                if (AgentInboxService.PENDING.equals(item.state())) {
                    inbox.delete(conversation, item.id(), item.revision());
                }
            }
            orchestrator.setCancelled(conversation);
            return true;
        }
    }
}
