// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.model.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.PreRemove;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.Getter;

import java.time.LocalDateTime;

@Entity
@Table(name = "feedback_handling_event", indexes = @Index(name = "idx_fhe_feedback", columnList = "feedback_id"))
@Getter
public class FeedbackHandlingEvent {

    public static final String TYPE_PROGRESS = "PROGRESS";
    public static final String TYPE_RESOLVED = "RESOLVED";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "feedback_id", nullable = false)
    private Long feedbackId;

    @Column(name = "event_type", length = 16, nullable = false)
    private String eventType;

    @Column(columnDefinition = "TEXT")
    private String conclusion;

    @Column(name = "action_taken", columnDefinition = "TEXT")
    private String actionTaken;

    @Column(name = "handler_id", nullable = false)
    private Long handlerId;

    @Column(name = "handler_name", length = 128, nullable = false)
    private String handlerName;

    @Column(name = "occurred_at", nullable = false)
    private LocalDateTime occurredAt;

    @Column(name = "evidence_ref", length = 2000)
    private String evidenceRef;

    @Column(name = "reporter_response", columnDefinition = "TEXT")
    private String reporterResponse;

    protected FeedbackHandlingEvent() {
    }

    public static FeedbackHandlingEvent create(Long feedbackId, String eventType, String conclusion,
                                               String actionTaken, Long handlerId, String handlerName,
                                               LocalDateTime occurredAt, String evidenceRef,
                                               String reporterResponse) {
        FeedbackHandlingEvent event = new FeedbackHandlingEvent();
        event.feedbackId = feedbackId;
        event.eventType = eventType;
        event.conclusion = conclusion;
        event.actionTaken = actionTaken;
        event.handlerId = handlerId;
        event.handlerName = handlerName;
        event.occurredAt = occurredAt;
        event.evidenceRef = evidenceRef;
        event.reporterResponse = reporterResponse;
        return event;
    }

    @PreUpdate
    @PreRemove
    void rejectMutation() {
        throw new IllegalStateException("Feedback handling events are append-only");
    }
}
