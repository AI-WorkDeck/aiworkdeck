// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.repository;

import com.checkba.model.entity.FeedbackHandlingEvent;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.*;

@DataJpaTest
class FeedbackHandlingEventRepositoryTest {

    @Autowired
    private FeedbackHandlingEventRepository repository;
    @Autowired
    private EntityManager entityManager;

    @Test
    void progressAndResolutionAreSeparateImmutableHistoryRows() {
        repository.save(event("PROGRESS"));
        repository.save(event("RESOLVED"));
        repository.flush();
        entityManager.clear();

        var history = repository.findByFeedbackIdOrderByIdAsc(7L);
        assertEquals(2, history.size());
        assertEquals("PROGRESS", history.get(0).getEventType());
        assertEquals("RESOLVED", history.get(1).getEventType());
        assertNotEquals(history.get(0).getId(), history.get(1).getId());
    }

    @Test
    void jpaUpdateIsRejectedOnFlush() {
        FeedbackHandlingEvent event = repository.save(event("PROGRESS"));
        ReflectionTestUtils.setField(event, "conclusion", "tampered");

        assertThrows(RuntimeException.class, repository::flush);
    }

    @Test
    void jpaDeleteIsRejectedBeforeFlush() {
        FeedbackHandlingEvent event = repository.save(event("PROGRESS"));

        assertThrows(RuntimeException.class, () -> repository.delete(event));
    }

    private static FeedbackHandlingEvent event(String type) {
        return FeedbackHandlingEvent.create(7L, type, "conclusion", "action", 1L, "admin",
                LocalDateTime.of(2026, 11, 9, 12, 0), "evidence-1", "response");
    }
}
