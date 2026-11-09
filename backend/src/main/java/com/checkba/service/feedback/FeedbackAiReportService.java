// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.feedback;

import com.checkba.model.entity.FeedbackHandlingEvent;
import com.checkba.model.entity.User;
import com.checkba.model.entity.UserFeedback;
import com.checkba.repository.FeedbackHandlingEventRepository;
import com.checkba.repository.UserFeedbackRepository;
import com.checkba.service.LangText;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

@Service
@RequiredArgsConstructor
public class FeedbackAiReportService {

    private static final int MAX_LONG_TEXT = 20000;
    private static final int MAX_EVIDENCE_REF = 2000;
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final UserFeedbackRepository feedbackRepository;
    private final FeedbackHandlingEventRepository eventRepository;

    @Transactional
    public UserFeedback record(Long feedbackId, User handler, AiReportResolutionCommand command) {
        if (command == null) {
            throw new IllegalArgumentException(LangText.of("请求内容不能为空", "Request body is required"));
        }
        UserFeedback feedback = feedbackRepository.findById(feedbackId).orElseThrow(NotFoundException::new);
        if (!isAiContentReport(feedback)) {
            throw new IllegalArgumentException(LangText.of(
                    "只有 AI 内容举报可以使用人工处置端点",
                    "Only AI content reports can use the manual handling endpoint"));
        }
        if (UserFeedback.STATUS_RESOLVED.equals(feedback.getStatus())) {
            throw new ConflictException(LangText.of("该举报已结案，不能重复处置", "This report is already resolved"));
        }
        if (command.expectedVersion() == null || command.expectedVersion() != feedback.getVersion()) {
            throw new ConflictException(LangText.of(
                    "记录已被其他人更新，请重新加载后再提交",
                    "The record was updated by someone else. Reload it before submitting again"));
        }

        String eventType = command.eventType() == null ? "" : command.eventType().trim();
        if (!FeedbackHandlingEvent.TYPE_PROGRESS.equals(eventType)
                && !FeedbackHandlingEvent.TYPE_RESOLVED.equals(eventType)) {
            throw new IllegalArgumentException(LangText.of("处置类型无效", "Invalid handling event type"));
        }
        String conclusion = text(command.conclusion(), MAX_LONG_TEXT, "conclusion");
        String actionTaken = text(command.actionTaken(), MAX_LONG_TEXT, "actionTaken");
        String evidenceRef = text(command.evidenceRef(), MAX_EVIDENCE_REF, "evidenceRef");
        String reporterResponse = text(command.reporterResponse(), MAX_LONG_TEXT, "reporterResponse");
        boolean resolving = FeedbackHandlingEvent.TYPE_RESOLVED.equals(eventType);
        if (resolving && (conclusion == null || actionTaken == null)) {
            throw new IllegalArgumentException(LangText.of(
                    "结案必须填写人工核验结论和实际措施",
                    "Resolving a report requires both the human conclusion and the action taken"));
        }
        if (conclusion == null && actionTaken == null && evidenceRef == null && reporterResponse == null) {
            throw new IllegalArgumentException(LangText.of(
                    "请至少填写一项核查进展",
                    "Provide at least one item of review progress"));
        }

        LocalDateTime now = LocalDateTime.now();
        FeedbackHandlingEvent event = FeedbackHandlingEvent.create(
                feedbackId, eventType, conclusion, actionTaken,
                handler.getId(), handler.getUsername(), now, evidenceRef, reporterResponse);
        eventRepository.save(event);

        if (reporterResponse != null) {
            feedback.setReporterResponse(reporterResponse);
            feedback.setResponsePublishedAt(now);
        }
        if (resolving) {
            feedback.setStatus(UserFeedback.STATUS_RESOLVED);
            feedback.setResolvedAt(now);
            feedback.setResolvedBy(handler.getUsername());
        }
        return feedbackRepository.saveAndFlush(feedback);
    }

    public List<FeedbackHandlingEvent> history(Long feedbackId) {
        return eventRepository.findByFeedbackIdOrderByIdAsc(feedbackId);
    }

    public static boolean isAiContentReport(UserFeedback feedback) {
        if (feedback == null || feedback.getContextJson() == null) return false;
        try {
            JsonNode root = MAPPER.readTree(feedback.getContextJson());
            return "ai-content-report".equals(root.path("client").path("type").asText());
        } catch (Exception ignored) {
            return false;
        }
    }

    private static String text(String value, int maxLength, String field) {
        if (value == null) return null;
        String trimmed = value.trim();
        if (trimmed.isEmpty()) return null;
        if (trimmed.length() > maxLength) {
            String label = switch (field) {
                case "conclusion" -> LangText.of("人工核验结论", "Human conclusion");
                case "actionTaken" -> LangText.of("实际措施", "Action taken");
                case "evidenceRef" -> LangText.of("证据定位/编号", "Evidence reference");
                default -> LangText.of("给举报人的答复", "Reporter response");
            };
            throw new IllegalArgumentException(LangText.of(
                    label + "不能超过 " + maxLength + " 个字符",
                    switch (field) {
                        case "conclusion" -> "Human conclusion";
                        case "actionTaken" -> "Action taken";
                        case "evidenceRef" -> "Evidence reference";
                        default -> "Reporter response";
                    } + " must not exceed " + maxLength + " characters"));
        }
        return trimmed;
    }

    public record AiReportResolutionCommand(String eventType, String conclusion, String actionTaken,
                                            String evidenceRef, String reporterResponse,
                                            Long expectedVersion) {
    }

    public static class NotFoundException extends RuntimeException {
    }

    public static class ConflictException extends RuntimeException {
        public ConflictException(String message) {
            super(message);
        }
    }
}
