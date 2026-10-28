// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.tools;

import com.checkba.service.AppLanguageScope;
import com.checkba.service.ai.ClientCapabilityService;
import com.checkba.service.ai.DocumentCheckpointService;
import com.checkba.service.ai.PluginService;
import com.checkba.service.ai.ToolRegistry;
import com.checkba.service.ai.context.ProjectContextHolder;
import dev.langchain4j.agent.tool.ToolSpecifications;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class CheckpointToolsTest {
    private DocumentCheckpointService checkpoints;
    private ToolRegistry registry;
    private final ToolContext context = new ToolContext(5L, "conv-restore", 7L, null);
    private static final String CONFIRMED = "{\"confirmation\":\"discard_current_turn_changes\",\"reason\":\"Undo broken layout\"}";

    @BeforeEach
    void setUp() {
        ProjectContextHolder.clear();
        checkpoints = mock(DocumentCheckpointService.class);
        registry = new ToolRegistry(List.of(new CheckpointTools(checkpoints)), new PluginService(), new ClientCapabilityService());
        registry.init();
    }

    @AfterEach
    void cleanup() {
        ProjectContextHolder.clear();
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {
            "{}", "{\"reason\":\"export PDF\"}",
            "{\"confirmation\":\"export_pdf\",\"reason\":\"export PDF\"}",
            "{\"confirmation\":\" discard_current_turn_changes\",\"reason\":\"rollback\"}",
            "{\"confirmation\":\"DISCARD_CURRENT_TURN_CHANGES\",\"reason\":\"rollback\"}",
            "{\"confirmation\":null,\"reason\":\"rollback\"}"
    })
    void missingOrInexactConfirmationNeverRestoresThroughBinding(String args) {
        var result = registry.execute("doc_restore_checkpoint", args, context);
        assertTrue(result.output().startsWith("Error"), result.output());
        assertTrue(result.output().contains("confirmation"), result.output());
        verifyNoInteractions(checkpoints);
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "{\"confirmation\":\"discard_current_turn_changes\"}",
            "{\"confirmation\":\"discard_current_turn_changes\",\"reason\":null}",
            "{\"confirmation\":\"discard_current_turn_changes\",\"reason\":\"\"}",
            "{\"confirmation\":\"discard_current_turn_changes\",\"reason\":\"  \\n\\t\"}"
    })
    void missingOrBlankReasonNeverRestoresThroughBinding(String args) {
        var result = registry.execute("doc_restore_checkpoint", args, context);
        assertTrue(result.output().startsWith("Error"), result.output());
        assertTrue(result.output().contains("reason"), result.output());
        verifyNoInteractions(checkpoints);
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"  "})
    void missingSessionNeverRestoresEvenWhenConfirmed(String conversationId) {
        var result = registry.execute("doc_restore_checkpoint", CONFIRMED,
                new ToolContext(5L, conversationId, 7L, null));
        assertTrue(result.output().startsWith("Error"), result.output());
        verifyNoInteractions(checkpoints);
    }

    @Test
    void explicitIntentRestoresCurrentSessionExactlyOnce() {
        when(checkpoints.restore("conv-restore")).thenReturn("restored");
        assertEquals("restored", registry.execute("doc_restore_checkpoint", CONFIRMED, context).output());
        verify(checkpoints).restore("conv-restore");
        verifyNoMoreInteractions(checkpoints);
    }

    @Test
    void rejectionUsesTheCurrentLanguage() {
        var result = AppLanguageScope.call("en-US",
                () -> registry.execute("doc_restore_checkpoint", "{}", context));
        assertTrue(result.output().contains("Restore was not performed"), result.output());
        verifyNoInteractions(checkpoints);
    }

    @Test
    void confirmationAndReasonAreRequiredInModelSchema() throws Exception {
        var spec = ToolSpecifications.toolSpecificationFrom(
                CheckpointTools.class.getMethod("doc_restore_checkpoint", String.class, String.class));
        assertEquals(List.of("confirmation", "reason"), spec.parameters().required());
    }
}
