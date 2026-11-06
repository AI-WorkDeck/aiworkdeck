// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.account;

import com.checkba.service.LangText;

import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 包晴天积分通道（billingLine=bqt）的透传与错误码。
 *
 * <p>官网是余额与扣点的唯一权威：桌面只把 {@code billingLine}/{@code bqtMember} 原样转给前端，
 * 并把网关/账户端点回的 {@code bqt_*} 错误码翻成「去包晴天 App 处理」的提示。
 * 这些码都不是凭据失效，绝不能走 401/403 的掉线分支，也不能打开 AI WorkDeck 的充值弹层。
 */
public final class BqtBilling {

    public static final Set<String> ERROR_CODES = Set.of(
            "bqt_member_invalid", "bqt_ai_closed", "bqt_insufficient_points",
            "bqt_outstanding_debt", "bqt_unavailable", "bqt_recharge_via_bqt");

    private static final Set<String> BILLING_LINES = Set.of("bqt", "circle", "standard");
    private static final Pattern CODE_IN_TEXT = Pattern.compile(
            "\\b(bqt_(?:member_invalid|ai_closed|insufficient_points|outstanding_debt|unavailable|recharge_via_bqt))\\b");

    private BqtBilling() {
    }

    /**
     * 把官网账户响应里的 billingLine/bqtMember 抄到给前端的 map。旧官网没有这两个字段：
     * billingLine 记 standard、bqtMember 记 null，前端据此保持原有行为。
     */
    public static void copyBillingFields(Map<String, Object> source, Map<String, Object> target) {
        Object line = source == null ? null : source.get("billingLine");
        String billingLine = line instanceof String s && BILLING_LINES.contains(s) ? s : "standard";
        Object member = source == null ? null : source.get("bqtMember");
        target.put("billingLine", billingLine);
        target.put("bqtMember", "bqt".equals(billingLine) && member instanceof Map<?, ?> ? member : null);
    }

    /** 文本（响应体、异常 message）里出现的第一个 bqt 错误码；没有则 null。 */
    public static String errorCodeIn(String text) {
        if (text == null || text.isEmpty()) return null;
        Matcher m = CODE_IN_TEXT.matcher(text);
        return m.find() ? m.group(1) : null;
    }

    /** 沿异常链找 bqt 错误码（模型网关把响应体放在 OpenAiHttpException 的 message 里）。 */
    public static String errorCodeIn(Throwable err) {
        for (Throwable t = err; t != null; t = t.getCause() == t ? null : t.getCause()) {
            if (t instanceof AccountException ae && ERROR_CODES.contains(ae.getReason())) return ae.getReason();
            String code = errorCodeIn(t.getMessage());
            if (code != null) return code;
        }
        return null;
    }

    /**
     * 给用户的一句话。文案红线同 {@link AccountService}：不得含「登录」「未授权」「请先」
     * （前端曾用这三个子串判掉线）。前端另按 reason 取 20 语种词条，这里是 zh/en 兜底。
     */
    public static String message(String code) {
        return switch (code == null ? "" : code) {
            case "bqt_member_invalid" -> LangText.of("包晴天会员已失效，请在包晴天 App 续费会员后重试",
                    "Your Baoqingtian membership is no longer active. Renew it in the Baoqingtian app and try again");
            case "bqt_ai_closed" -> LangText.of("包晴天会员有效，但 AI 工作台已在包晴天关闭。请在包晴天 App 中开启后重试",
                    "Your Baoqingtian membership is active, but the AI workbench is switched off in Baoqingtian. Turn it on in the Baoqingtian app and try again");
            case "bqt_insufficient_points" -> LangText.of("包晴天积分不足，请在包晴天 App 充值积分后重试",
                    "Not enough Baoqingtian points. Recharge points in the Baoqingtian app and try again");
            case "bqt_outstanding_debt" -> LangText.of("此前有一笔扣点未成功。请在包晴天 App 充值积分，然后联系客服处理",
                    "A previous points deduction failed. Recharge points in the Baoqingtian app, then contact support");
            case "bqt_unavailable" -> LangText.of("包晴天服务暂时不可用，请稍后重试",
                    "The Baoqingtian service is temporarily unavailable. Please try again later");
            case "bqt_recharge_via_bqt" -> LangText.of("包晴天会员请在包晴天 App 充值或续费",
                    "Baoqingtian members recharge or renew in the Baoqingtian app");
            default -> LangText.of("包晴天账户状态异常，请在包晴天 App 查看",
                    "Your Baoqingtian account needs attention. Check it in the Baoqingtian app");
        };
    }

    /** 统一的业务拒绝：REJECTED + reason=bqt 码，不触发掉线、不触发充值弹层。 */
    public static AccountException rejected(String code) {
        return new AccountException(AccountException.Kind.REJECTED, message(code), code);
    }
}
