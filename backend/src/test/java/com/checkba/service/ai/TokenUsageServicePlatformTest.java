// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import com.checkba.model.entity.TokenUsage;
import com.checkba.repository.TokenUsageRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class TokenUsageServicePlatformTest {
    @Test void explicitPlatformUsageKeepsActualModelAndRequesterWithoutConsultingGlobalProvider() {
        var repository=mock(TokenUsageRepository.class);
        var models=mock(ChatModelFactory.class);
        var accountant=mock(PlatformUsageAccountant.class);
        when(repository.save(any())).thenAnswer(call -> {TokenUsage row=call.getArgument(0);row.setId(123L);return row;});
        var service=new TokenUsageService(repository,models,accountant);
        service.recordPlatformUsage(null,72L,"actual-platform-model",new dev.langchain4j.model.output.TokenUsage(10,2),"im-conversation");
        var capture=ArgumentCaptor.forClass(TokenUsage.class);verify(repository).save(capture.capture());
        TokenUsage row=capture.getValue();assertEquals(72L,row.getUserId());assertEquals("actual-platform-model",row.getModel());
        assertEquals("im-conversation",row.getConversationId());assertEquals("platform",row.getCostSource());assertNull(row.getCost());
        assertEquals(12,row.getTotalTokens());verify(accountant).reconcileAsync(123L,72L);
        verifyNoInteractions(models);
    }
}
