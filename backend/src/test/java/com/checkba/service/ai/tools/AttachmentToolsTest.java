// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.tools;

import com.checkba.model.entity.ProjectAiMessage;
import com.checkba.model.entity.ProjectAiMessageAttachment;
import com.checkba.repository.ProjectAiMessageAttachmentRepository;
import com.checkba.repository.ProjectAiMessageRepository;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Pageable;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class AttachmentToolsTest {
    private final ProjectAiMessageRepository messages = mock(ProjectAiMessageRepository.class);
    private final ProjectAiMessageAttachmentRepository attachments = mock(ProjectAiMessageAttachmentRepository.class);
    private final com.checkba.service.ProjectMemberService members = mock(com.checkba.service.ProjectMemberService.class);
    private final AttachmentTools tools = new AttachmentTools(messages, attachments, members);

    private void ownMessage() {
        ProjectAiMessage message = new ProjectAiMessage();
        message.setRole("USER"); message.setUserId(1L); message.setProjectId(2L); message.setConversationId("own");
        when(messages.findById(77L)).thenReturn(Optional.of(message));
        when(members.hasReadPermission(2L, 1L)).thenReturn(true);
    }

    private static ProjectAiMessageAttachment row(long id, int nameChars) {
        var row = new ProjectAiMessageAttachment();
        row.setId(id); row.setFileId(String.valueOf(10000 + id)); row.setKind("file");
        row.setName("证".repeat(nameChars) + id + ".pdf");
        return row;
    }

    @Test
    void all501AttachmentsAreReachableWithStableCursorAndBoundedQueries() {
        ownMessage();
        List<ProjectAiMessageAttachment> all = new ArrayList<>();
        for (long i = 1; i <= 501; i++) all.add(row(i, 4));
        when(attachments.findPageAfter(eq(77L), anyLong(), any(Pageable.class))).thenAnswer(inv -> {
            long after = inv.getArgument(1);
            Pageable page = inv.getArgument(2);
            assertEquals(101, page.getPageSize());
            return all.stream().filter(r -> r.getId() > after).limit(page.getPageSize()).toList();
        });
        long cursor = 0;
        StringBuilder complete = new StringBuilder();
        int pages = 0;
        while (true) {
            String page = tools.list_attached_files(77L, cursor, 1L, 2L, "own");
            assertTrue(page.length() < 12500);
            complete.append(page);
            pages++;
            var next = java.util.regex.Pattern.compile("nextAfterId=(\\d+)").matcher(page);
            if (!next.find()) break;
            long value = Long.parseLong(next.group(1));
            assertTrue(value > cursor);
            cursor = value;
        }
        assertEquals(6, pages);
        for (long i = 1; i <= 501; i++) assertTrue(complete.toString().contains("fileId=" + (10000 + i) + " "));
    }

    @Test
    void characterBudgetAlsoProvidesAResumableCursor() {
        ownMessage();
        List<ProjectAiMessageAttachment> rows = new ArrayList<>();
        for (long i = 1; i <= 101; i++) rows.add(row(i, 500));
        when(attachments.findPageAfter(eq(77L), eq(0L), any())).thenReturn(rows);
        String result = tools.list_attached_files(77L, null, 1L, 2L, "own");
        assertTrue(result.length() < 12500);
        assertTrue(result.contains("nextAfterId="));
        assertFalse(result.contains("fileId=10100 "));
    }

    @Test
    void missingManifestIsAnErrorRatherThanFalseCompletion() {
        ownMessage();
        when(attachments.findPageAfter(eq(77L), eq(0L), any())).thenReturn(List.of());
        String result = tools.list_attached_files(77L, null, 1L, 2L, "own");
        assertTrue(result.startsWith("错误") || result.startsWith("Error:"));
        assertFalse(result.contains("nextAfterId="));
    }

    @Test
    void revokingProjectReadPermissionBlocksFollowingPages() {
        ownMessage();
        when(members.hasReadPermission(2L, 1L)).thenReturn(false);
        String result = tools.list_attached_files(77L, 100L, 1L, 2L, "own");
        assertFalse(result.contains("fileId="));
        verifyNoInteractions(attachments);
    }

    @Test
    void longUnicodeFilenameCannotOverflowPageAndKeepsItsId() {
        ownMessage();
        var item = row(1L, 1);
        item.setName("\ud83d\udcc4".repeat(10000));
        when(attachments.findPageAfter(eq(77L), eq(0L), any())).thenReturn(List.of(item));
        String result = tools.list_attached_files(77L, null, 1L, 2L, "own");
        assertTrue(result.length() < 12000);
        assertTrue(result.contains("fileId=10001"));
        assertFalse(result.contains("\ud83d…"));
    }

    @Test
    void forgedConversationUserProjectAndUnknownMessageCannotReadManifest() {
        ownMessage();
        for (Object[] args : List.of(new Object[]{2L, 2L, "own"}, new Object[]{1L, 3L, "own"},
                new Object[]{1L, 2L, "foreign"})) {
            String result = tools.list_attached_files(77L, 0L, (Long) args[0], (Long) args[1], (String) args[2]);
            assertFalse(result.contains("fileId="));
        }
        tools.list_attached_files(77L, 0L, null, 2L, "own");
        tools.list_attached_files(88L, 0L, 1L, 2L, "own");
        verifyNoInteractions(attachments);
    }
}
