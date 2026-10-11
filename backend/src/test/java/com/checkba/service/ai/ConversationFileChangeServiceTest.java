// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import com.checkba.model.entity.ConversationFileChange;
import com.checkba.repository.ConversationFileChangeRepository;
import org.junit.jupiter.api.Test;
import java.util.ArrayList;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class ConversationFileChangeServiceTest {
    @Test void retainsActualIdentityAndTurnWithoutDeduplicatingSeparateTurnsOrSameNameFiles() {
        var repository = mock(ConversationFileChangeRepository.class);
        List<ConversationFileChange> saved = new ArrayList<>();
        when(repository.findByConversationId("conv")).thenReturn(saved);
        when(repository.save(any())).thenAnswer(inv -> { saved.add(inv.getArgument(0)); return inv.getArgument(0); });
        var service = new ConversationFileChangeService(repository);
        service.saveFileChange("conv", "合同.docx", "MODIFIED", 42L, 9L, 100L);
        service.saveFileChange("conv", "合同.docx", "MODIFIED", 42L, 9L, 100L);
        service.saveFileChange("conv", "合同.docx", "MODIFIED", 43L, 9L, 100L);
        service.saveFileChange("conv", "合同.docx", "MODIFIED", 42L, 9L, 101L);
        service.saveFileChange("conv", "旧记录.docx", "ADDED");
        assertEquals(4, saved.size());
        assertEquals(42L, saved.get(0).getFileId());
        assertEquals(9L, saved.get(0).getProjectId());
        assertEquals(100L, saved.get(0).getAssistantMessageId());
        assertEquals(101L, saved.get(2).getAssistantMessageId());
        assertNull(saved.get(3).getFileId());
        assertNull(saved.get(3).getAssistantMessageId());
    }
}
