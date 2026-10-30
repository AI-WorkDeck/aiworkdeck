// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.tools;

import com.checkba.repository.ProjectAiMessageAttachmentRepository;
import com.checkba.repository.ProjectAiMessageRepository;
import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;

import java.util.Objects;

/** Pages the persisted attachment manifest without expanding every filename into the model context. */
@Component
@RequiredArgsConstructor
public class AttachmentTools implements AgentToolComponent {
    private final ProjectAiMessageRepository messages;
    private final ProjectAiMessageAttachmentRepository attachments;
    private final com.checkba.service.ProjectMemberService projectMembers;

    @ToolMeta(displayName = "列出本轮附件", category = "file")
    @Tool("List the attachments of a USER message in this conversation. Use the messageId supplied in the attachment "
            + "manifest. Returns at most 100 references, not file contents. Start with afterId=0 and follow nextAfterId "
            + "until complete. Read each file/folder with extract_file_text; folder listings also have pagination.")
    public String list_attached_files(
            @P("Message ID from the attachment manifest") Long messageId,
            @P(value = "Cursor from nextAfterId; omit or use 0 for the first page", required = false) Long afterId,
            Long userId, Long projectId, String conversationId) {
        if (messageId == null || userId == null || projectId == null || conversationId == null) return denied();
        var message = messages.findById(messageId).orElse(null);
        if (message == null || !"USER".equals(message.getRole())
                || !Objects.equals(message.getUserId(), userId)
                || !Objects.equals(message.getProjectId(), projectId)
                || !Objects.equals(message.getConversationId(), conversationId)
                || !projectMembers.hasReadPermission(projectId, userId)) return denied();
        long cursor = afterId == null ? 0 : Math.max(0, afterId);
        var rows = attachments.findPageAfter(messageId, cursor, PageRequest.of(0, 101));
        if (rows.isEmpty() && cursor == 0) {
            return AttachmentMessages.error("manifestUnavailable");
        }
        StringBuilder result = new StringBuilder(AttachmentMessages.text("manifestHeader"));
        int shown = 0;
        long next = cursor;
        for (var row : rows) {
            String line = "[" + row.getKind() + "] fileId=" + row.getFileId() + " name="
                    + safeName(row.getName()) + "\n";
            if (shown == 100 || (shown > 0 && result.length() + line.length() > 12000)) break;
            result.append(line);
            next = row.getId();
            shown++;
        }
        if (shown < rows.size()) {
            result.append("nextAfterId=").append(next).append("\n")
                    .append("list_attached_files(messageId=").append(messageId)
                    .append(", afterId=").append(next).append(")\n");
        } else {
            result.append(AttachmentMessages.text("manifestEnd"));
        }
        return result.toString();
    }

    private static String denied() {
        return AttachmentMessages.error("manifestDenied");
    }

    private static String safeName(String name) {
        if (name == null) return "";
        String clean = name.replace('\n', ' ').replace('\r', ' ');
        int end = clean.offsetByCodePoints(0, Math.min(300, clean.codePointCount(0, clean.length())));
        return end < clean.length() ? clean.substring(0, end) + "…" : clean;
    }
}
