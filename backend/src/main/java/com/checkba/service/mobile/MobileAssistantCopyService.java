// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;

import com.checkba.model.entity.ProjectAiMessage;
import com.checkba.repository.ProjectAiMessageRepository;
import com.checkba.repository.ProjectRepository;
import com.checkba.service.LangText;
import com.checkba.service.ProjectMemberService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

/** Transcript copy, not a copy of the source case files referenced by the assistant. */
@Service
@RequiredArgsConstructor
public class MobileAssistantCopyService {
    private final MobileAssistantService assistant;
    private final ProjectRepository projects;
    private final ProjectMemberService members;
    private final ProjectAiMessageRepository messages;
    public record Result(String mode, boolean sourcePreserved, String sourceConversationId,
                         String conversationId, Long targetProjectId, int messageCount, boolean filesCopied) {}

    @Transactional
    public Result copy(Long user, String conversationId, Long targetProjectId) {
        if (user == null || targetProjectId == null) throw denied();
        var target = projects.findById(targetProjectId).orElseThrow(MobileAssistantCopyService::denied);
        if (!user.equals(target.getUserId()) || target.isScratchWorkspace() || target.isLooseFileWorkspace()
                || !members.hasWritePermission(targetProjectId, user)) throw denied();
        // Takes the same consent row lock as chat and consent revocation; validates every historical source.
        var turns = assistant.readableConversationForCopy(user, conversationId);
        String newId = "conv-" + UUID.randomUUID();
        int count = 0;
        for (var turn : turns) {
            count += save(user, targetProjectId, newId, "USER", turn.getQuestion(), turn.getCreatedAt());
            if ("completed".equals(turn.getStatus())) {
                String answer = turn.getAnswer();
                if (turn.getSourcesJson() != null && !turn.getSourcesJson().isBlank()) {
                    try {
                        var sources = new com.fasterxml.jackson.databind.ObjectMapper().readTree(turn.getSourcesJson());
                        StringBuilder notes = new StringBuilder();
                        for (var source : sources) {
                            notes.append("\n- ").append(source.path("projectName").asText())
                                    .append(" · ").append(source.path("sourceUpdatedAt").asText());
                        }
                        if (!notes.isEmpty()) answer += LangText.of("\n\n来源项目（本次仅复制对话记录，未复制来源文件）：", "\n\nSource projects (transcript copied; source files were not copied):") + notes;
                    } catch (java.io.IOException e) { throw new IllegalStateException("Unreadable assistant source records", e); }
                }
                count += save(user, targetProjectId, newId, "ASSISTANT", answer, turn.getCreatedAt());
            }
        }
        return new Result("copy", true, conversationId, newId, targetProjectId, count, false);
    }
    private int save(Long user, Long project, String conversation, String role, String text, java.time.Instant time) {
        ProjectAiMessage row = new ProjectAiMessage();
        row.setUserId(user); row.setProjectId(project); row.setConversationId(conversation);
        row.setRole(role); row.setContent(text); row.setCreatedAt(LocalDateTime.ofInstant(time, ZoneOffset.UTC));
        messages.save(row); return 1;
    }
    private static IllegalArgumentException denied() {
        return new IllegalArgumentException(LangText.of("请选择本人有写入权限的正式项目", "Choose your own writable formal project"));
    }
}
