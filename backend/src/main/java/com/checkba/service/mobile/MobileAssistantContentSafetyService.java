// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;

import com.checkba.model.entity.UserFeedback;
import com.checkba.repository.UserFeedbackRepository;
import com.checkba.service.LangText;
import com.checkba.service.UserActivityLogService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.time.LocalDateTime;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/** Bounded, deterministic screening for the public mobile assistant; no content is sent to another service. */
@Service
public class MobileAssistantContentSafetyService {
    public static final String RULES_VERSION = "mobile-assistant-text-rules-2026-11-09";
    private static final String ACTION_TYPE = "mobile_assistant_content";

    private enum Stage { INPUT, OUTPUT }
    private enum Action { ALLOW, BLOCK, REVIEW }
    private record Rule(String category, Pattern pattern) {}

    private static final List<Rule> BLOCK_RULES = List.of(
            new Rule("dangerous_goods", Pattern.compile("(?:制作|制造|组装|购买|出售|非法获取).{0,12}(?:炸药|爆炸物|枪支|弹药|毒品)|(?:build|make|buy|sell|acquire).{0,12}(?:bomb|explosive|firearm|ammunition|illegal drugs)")),
            new Rule("credential_or_personal_data_theft", Pattern.compile("(?:窃取|盗取|非法获取|批量获取|购买|出售).{0,12}(?:账号|密码|凭据|令牌|身份证|个人信息|手机号|住址)|(?:steal|harvest|buy|sell).{0,12}(?:passwords?|credentials?|tokens?|personal data|identity numbers?)")),
            new Rule("system_abuse", Pattern.compile("(?:入侵|攻击|瘫痪|绕过|破解).{0,12}(?:网站|系统|服务器|防火墙|验证码|人脸识别|实名认证|密码)|(?:hack|attack|bypass|crack).{0,12}(?:website|system|server|firewall|captcha|face recognition|password)")),
            new Rule("fraud_instructions", Pattern.compile("(?:教我|帮我|提供|编写|生成).{0,8}(?:诈骗|电信诈骗|洗钱|赌博).{0,8}(?:话术|教程|方法|步骤|平台|软件)|(?:teach|help|write|generate).{0,8}(?:fraud|scam|money laundering).{0,8}(?:script|tutorial|method|steps)")),
            new Rule("violence_instructions", Pattern.compile("(?:杀人|伤害|殴打|绑架).{0,8}(?:方法|步骤|教程|计划)|(?:kill|assault|kidnap).{0,8}(?:method|steps|tutorial|plan)")),
            new Rule("sexual_minor", Pattern.compile("(?:儿童|未成年|幼女|幼男).{0,12}(?:色情|性爱|裸露)|(?:child|minor|underage).{0,12}(?:porn|sexual|nude)"))
    );
    private static final List<Rule> REVIEW_RULES = List.of(
            new Rule("self_harm", Pattern.compile("(?:我想|我准备|我想要|怎么|如何|方法|步骤).{0,8}(?:自杀|自残|轻生)|(?:自杀|自残|轻生).{0,8}(?:方法|步骤|工具)|(?:i want|i plan|how|method|steps).{0,8}(?:suicide|self-harm)|(?:suicide|self-harm).{0,8}(?:method|steps)")),
            new Rule("targeted_harm_or_defamation", Pattern.compile("(?:造谣|诽谤|污蔑|恐吓|威胁).{0,12}(?:他人|别人|某人|同事|公司|方法|话术)|(?:defame|threaten|intimidate).{0,12}(?:person|colleague|company|method|script)"))
    );

    private final UserActivityLogService activityLogs;
    private final UserFeedbackRepository feedback;
    private final ObjectMapper json = new ObjectMapper();

    public MobileAssistantContentSafetyService(UserActivityLogService activityLogs, UserFeedbackRepository feedback) {
        this.activityLogs = activityLogs;
        this.feedback = feedback;
    }

    public void checkInput(Long userId, String conversationId, String requestId, String text,
                           UserActivityLogService.RequestMetadata metadata) {
        check(userId, conversationId, requestId, text, metadata, Stage.INPUT);
    }

    public void checkOutput(Long userId, String conversationId, String requestId, String text,
                            UserActivityLogService.RequestMetadata metadata) {
        check(userId, conversationId, requestId, text, metadata, Stage.OUTPUT);
    }

    private void check(Long userId, String conversationId, String requestId, String text,
                       UserActivityLogService.RequestMetadata metadata, Stage stage) {
        String normalized = normalize(text);
        Rule matched = firstMatch(normalized, BLOCK_RULES);
        Action action = matched == null ? Action.ALLOW : Action.BLOCK;
        if (matched == null) {
            matched = firstMatch(normalized, REVIEW_RULES);
            if (matched != null) action = Action.REVIEW;
        }
        String category = matched == null ? "none" : matched.category();
        Long reviewId = action == Action.REVIEW
                ? reviewTicket(userId, conversationId, requestId, stage, category, sha256(text)) : null;
        audit(userId, conversationId, requestId, stage, action, category, sha256(text), reviewId, metadata);
        if (action == Action.BLOCK) {
            throw new IllegalArgumentException(LangText.of(
                    "内容未通过安全检查，本次未继续处理。请调整输入后重试。",
                    "The content did not pass the safety check and was not processed. Please revise it and try again."));
        }
        if (action == Action.REVIEW) {
            throw new IllegalArgumentException(LangText.of(
                    "内容已转入人工复核，本次未继续生成或展示回答。可在反馈记录中查看处理进展。",
                    "The content was routed for human review and no answer was generated or displayed. Track it in your feedback history."));
        }
    }

    private Long reviewTicket(Long userId, String conversationId, String requestId, Stage stage,
                              String category, String contentHash) {
        String installId = "mobile-assistant-" + userId;
        String clientRef = "review-" + requestId + "-" + stage.name();
        var existing = feedback.findByInstallIdAndClientRef(installId, clientRef);
        if (existing.isPresent()) return existing.get().getId();

        UserFeedback row = new UserFeedback();
        row.setUserId(userId);
        row.setSource(UserFeedback.SOURCE_CLOUD);
        row.setInstallId(installId);
        row.setClientRef(clientRef);
        row.setUploaded(true);
        row.setKind(UserFeedback.KIND_BUG);
        row.setText(LangText.of("个人助理内容安全复核（系统发起）", "Personal assistant content safety review (system-generated)"));
        row.setPage("mobile/personal/assistant");
        row.setPlatform("system-content-review");
        row.setStatus(UserFeedback.STATUS_NEW);
        row.setAttempts(0);
        row.setCreatedAt(LocalDateTime.now());
        Map<String, Object> client = new LinkedHashMap<>();
        client.put("type", "ai-content-report");
        client.put("platform", "system-content-review");
        client.put("conversationId", conversationId);
        Map<String, Object> review = new LinkedHashMap<>();
        review.put("systemGenerated", true);
        review.put("requestId", requestId);
        review.put("stage", stage.name());
        review.put("category", category);
        review.put("contentSha256", contentHash);
        review.put("rulesVersion", RULES_VERSION);
        try {
            row.setContextJson(json.writeValueAsString(Map.of("client", client, "review", review)));
        } catch (Exception e) {
            throw new IllegalStateException("Could not serialize content review metadata", e);
        }
        return feedback.save(row).getId();
    }

    private void audit(Long userId, String conversationId, String requestId, Stage stage, Action action,
                       String category, String contentHash, Long reviewId,
                       UserActivityLogService.RequestMetadata metadata) {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("conversationId", conversationId);
        details.put("requestId", requestId);
        details.put("stage", stage.name());
        details.put("decision", action.name());
        details.put("category", category);
        details.put("contentSha256", contentHash);
        details.put("rulesVersion", RULES_VERSION);
        details.put("reviewFeedbackId", reviewId);
        try {
            activityLogs.logActivity(userId, ACTION_TYPE, reviewId, stage.name(), 0L,
                    json.writeValueAsString(details), null, metadata);
        } catch (Exception e) {
            throw new IllegalStateException(LangText.of("内容安全记录暂不可用，请稍后重试",
                    "Content safety records are temporarily unavailable; please retry later"), e);
        }
    }

    private static Rule firstMatch(String text, List<Rule> rules) {
        for (Rule rule : rules) if (rule.pattern().matcher(text).find()) return rule;
        return null;
    }

    private static String normalize(String value) {
        return Normalizer.normalize(value == null ? "" : value, Normalizer.Form.NFKC)
                .toLowerCase(Locale.ROOT).replaceAll("[\\s\\p{Z}\\u200B-\\u200D\\uFEFF]+", "");
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest((value == null ? "" : value).getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
