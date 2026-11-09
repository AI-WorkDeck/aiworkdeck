// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.model.entity;

import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.*;

class FeedbackHandlingEventTest {

    @Test
    void historyHasNoSettersAndJpaUpdateOrDeleteIsRejected() {
        FeedbackHandlingEvent event = FeedbackHandlingEvent.create(
                7L, "PROGRESS", "original conclusion", "original action",
                1L, "admin", LocalDateTime.of(2026, 11, 9, 10, 0), "evidence-1", "response");
        assertFalse(Arrays.stream(FeedbackHandlingEvent.class.getMethods())
                .anyMatch(method -> method.getName().startsWith("set")));
        assertThrows(IllegalStateException.class, event::rejectMutation);
        assertEquals("original conclusion", event.getConclusion());
        assertEquals("original action", event.getActionTaken());
        assertEquals("evidence-1", event.getEvidenceRef());
    }
}
