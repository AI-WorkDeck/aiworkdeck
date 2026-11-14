// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.config;

import com.checkba.exception.FeatureNotConfiguredException;
import com.checkba.exception.UnauthorizedException;
import com.checkba.service.LangText;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;

import java.util.HashMap;
import java.util.Map;

/**
 * 全局异常处理器
 * 统一处理所有异常，返回统一的错误响应格式
 * 所有接口统一返回 HTTP 200，通过响应体中的 code 字段区分成功（code=0）或失败（code=1）
 */
@ControllerAdvice
@lombok.extern.slf4j.Slf4j
public class GlobalExceptionHandler {

    /**
     * 未登录/会话过期的机器可读码（PR4-0）。前端 api.js 只认这个 code 来清会话/跳登录，
     * 不再做「登录/未授权/请先」中文子串匹配——那套判定会误伤含「请先」的业务文案，
     * 且后端文案英文化后整条失效。
     */
    public static final int CODE_UNAUTHENTICATED = 4010;

    @ExceptionHandler(UnauthorizedException.class)
    public ResponseEntity<Map<String, Object>> handleUnauthorizedException(UnauthorizedException e) {
        log.warn("GlobalExceptionHandler caught UnauthorizedException: {}", e.getMessage());
        Map<String, Object> result = new HashMap<>();
        result.put("code", CODE_UNAUTHENTICATED);
        result.put("message", localizedAuthMessage(e.getMessage() != null ? e.getMessage() : "请先登录"));
        // 统一返回 HTTP 200，通过 code 字段表示失败
        return ResponseEntity.ok().body(result);
    }

    /**
     * 按用户限频（UserRateLimiter）：真 HTTP 429 + Retry-After，不走「统一 200」口径——
     * 前端 request() 对非 200 直接拿 message 报错，fetch 调用方按 status 识别。
     */
    @ExceptionHandler(com.checkba.exception.RateLimitedException.class)
    public ResponseEntity<Map<String, Object>> handleRateLimited(com.checkba.exception.RateLimitedException e) {
        return rateLimitedResponse(e.getRetryAfterSeconds(), e.getMessage());
    }

    /** 同一份 429 响应，供自带 catch-all 的控制器（如上传）直接返回。 */
    public static ResponseEntity<Map<String, Object>> rateLimitedResponse(long retryAfterSeconds) {
        return rateLimitedResponse(retryAfterSeconds, com.checkba.exception.RateLimitedException.message(retryAfterSeconds));
    }

    public static ResponseEntity<Map<String, Object>> rateLimitedResponse(long retryAfterSeconds, String message) {
        Map<String, Object> result = new HashMap<>();
        result.put("code", 4290);
        result.put("status", "error");
        result.put("reason", "RATE_LIMITED");
        result.put("message", message);
        result.put("retryAfterSeconds", retryAfterSeconds);
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header("Retry-After", String.valueOf(retryAfterSeconds))
                .body(result);
    }

    /**
     * 功能未配置：返回可识别的 code=4001 + feature 字段，前端据此引导"去设置"
     * 而非显示通用报错。/ Feature not configured — return a recognizable
     * code=4001 with a feature id so the frontend can prompt "go to settings".
     */
    @ExceptionHandler(FeatureNotConfiguredException.class)
    public ResponseEntity<Map<String, Object>> handleFeatureNotConfigured(FeatureNotConfiguredException e) {
        log.info("Feature not configured [{}]: {}", e.getFeature(), e.getMessage());
        Map<String, Object> result = new HashMap<>();
        result.put("code", 4001);
        result.put("feature", e.getFeature());
        result.put("configured", false);
        result.put("message", e.getMessage());
        // 统一返回 HTTP 200，通过 code=4001 表示"功能未配置"
        return ResponseEntity.ok().body(result);
    }

    /**
     * 文件缓存区免费额度已满：code=4003 + feature=stage.unlimited，前端据此显示解锁引导。
     * 与 4001（功能未配置）区分开——这里功能是好的，只是额度到顶了，下一步是解锁而非去设置。
     */
    @ExceptionHandler(com.checkba.exception.StageQuotaExceededException.class)
    public ResponseEntity<Map<String, Object>> handleStageQuota(com.checkba.exception.StageQuotaExceededException e) {
        log.info("文件缓存区额度已满: {}", e.getMessage());
        Map<String, Object> result = new HashMap<>();
        result.put("code", 4003);
        result.put("feature", com.checkba.service.entitlement.FeatureCatalog.STAGE_UNLIMITED);
        result.put("message", e.getMessage());
        Map<String, Object> usage = new HashMap<>();
        usage.put("fileCount", e.getFileCount());
        usage.put("totalBytes", e.getTotalBytes());
        usage.put("maxFiles", e.getMaxFiles());
        usage.put("maxBytes", e.getMaxBytes());
        result.put("usage", usage);
        return ResponseEntity.ok().body(result);
    }

    /**
     * 平台服务网关失败：<b>永远是业务错误，绝不是掉线</b>。
     *
     * <p>不接这条的话，网关异常会落到下面那个兜底 handler，被压成一句
     * 「服务器内部错误」——而三类故障（未开放 / 上游挂 / 我们挂）在用户眼里
     * 长得一样、下一步却完全不同，正是这一族错误码存在的全部理由。
     *
     * <p>{@code code=1} 而不是 4001「功能未配置」：平台档下用户什么都不用配，
     * 把他导去设置页填 Key 只有在 {@code canUseOwnKey} 时才是**一条**出路，
     * 余额不足时那是错的。具体摆哪个入口交给前端按 kind 决定。
     */
    @ExceptionHandler(com.checkba.service.platform.GatewayException.class)
    public ResponseEntity<Map<String, Object>> handleGateway(
            com.checkba.service.platform.GatewayException e) {
        log.warn("平台服务网关失败 kind={}: {}", e.getKind(), e.getMessage());
        Map<String, Object> result = new HashMap<>();
        result.put("code", 1);
        if (e.getKind() == com.checkba.service.platform.GatewayException.Kind.NOT_CONNECTED) {
            // 登录后置（dev-board#1046）：未连接账户统一回 4011，前端就地弹登录层。
            // gatewayKind / canUseOwnKey 照旧带着——只加字段，不改既有字段。
            result.put("code", com.checkba.service.account.AccountRequired.CODE);
            result.put("kind", com.checkba.service.account.AccountException.Kind.NOT_CONNECTED.name());
            result.put("reason", com.checkba.service.account.AccountRequired.REASON_GATEWAY);
        }
        result.put("gatewayKind", e.getKind().name());
        if (e.getReason() != null) result.put("reason", e.getReason());
        result.put("canUseOwnKey", e.suggestsByok());
        result.put("message", e.getMessage());
        return ResponseEntity.ok().body(result);
    }

    /**
     * 账户类失败（dev-board#1046）：{@code NOT_CONNECTED} → <b>4011 account_required</b>，
     * 其余 kind 维持 {@code code=1 + kind}。形状定义在
     * {@link com.checkba.service.account.AccountRequired#envelope(com.checkba.service.account.AccountException)}。
     *
     * <p>{@code AccountController} 与 {@code PlatformAiKeyController} 各有一个本地 handler，
     * Spring 按「控制器内优先」匹配，那两处维持 code=1——设置页 / 个人资料读账户状态时
     * 本来就是「没连就降级显示」，不该因此弹登录层。
     */
    @ExceptionHandler(com.checkba.service.account.AccountException.class)
    public ResponseEntity<Map<String, Object>> handleAccountException(
            com.checkba.service.account.AccountException e) {
        log.info("账户类失败 kind={} reason={}: {}", e.getKind(), e.getReason(), e.getMessage());
        return ResponseEntity.ok().body(
                new HashMap<>(com.checkba.service.account.AccountRequired.envelope(e)));
    }

    /**
     * 手机端统一账户余额/充值失败：{@code code=1} + <b>机器可读的 {@code kind}</b>
     * （dev-board#425 复审 C2）。
     *
     * <p>不接这条的话，这一族错误会落到下面的 IllegalArgumentException handler，
     * 只剩一句 message——而 message 经 {@link com.checkba.service.LangText} 在英文部署下
     * 会变成英文，客户端拿它做分支必然落空（安卓那版逐字硬编码中文串、小程序判 code===-1，
     * 两套都判错了）。八个 kind 的取值集合钉在
     * {@link com.checkba.service.mobile.MobileBillingKind} 与 {@code openapi/mobile-v1.yaml}。
     *
     * <p>{@code outTradeNo} 只在 ALREADY_PAID / IDEMPOTENCY_CONFLICT 时出现：官网连同 409
     * 一起回的既有单号，是「App 被杀后没存下单号」的恢复路径，客户端据此转去查单。
     */
    @ExceptionHandler(com.checkba.service.mobile.MobileBillingFailureException.class)
    public ResponseEntity<Map<String, Object>> handleMobileBilling(
            com.checkba.service.mobile.MobileBillingFailureException e) {
        log.warn("手机端统一账户失败 kind={} outTradeNo={}: {}", e.getKind(), e.getOutTradeNo(), e.getMessage());
        Map<String, Object> result = new HashMap<>();
        result.put("code", 1);
        result.put("kind", e.getKind().name());
        if (e.getOutTradeNo() != null && !e.getOutTradeNo().isEmpty()) {
            result.put("outTradeNo", e.getOutTradeNo());
        }
        result.put("message", e.getMessage());
        return ResponseEntity.ok().body(result);
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, Object>> handleIllegalArgumentException(IllegalArgumentException e) {
        log.warn("GlobalExceptionHandler caught IllegalArgumentException: {}", e.getMessage());
        Map<String, Object> result = new HashMap<>();
        // 全站 ~100 处鉴权失败写的是 throw new IllegalArgumentException("未登录")，
        // 判定收敛在这一处：message 恰为这两个字面量时视为未登录，回 4010。
        // 只做精确匹配，不做子串——「请先选择文件」这类业务提示必须仍是 code=1。
        boolean isAuthFailure = "未登录".equals(e.getMessage()) || "请先登录".equals(e.getMessage());
        result.put("code", isAuthFailure ? CODE_UNAUTHENTICATED : 1);
        result.put("message", isAuthFailure ? localizedAuthMessage(e.getMessage())
                : e.getMessage() != null ? e.getMessage() : LangText.of("请求参数错误", "Invalid request parameters"));
        // 统一返回 HTTP 200，通过 code 字段表示失败
        return ResponseEntity.ok().body(result);
    }

    /**
     * 没有这个路径：真 HTTP 404，不走「统一 200」口径，也不打 ERROR。
     * 此前落到下面的兜底变成 200 + 「服务器内部错误」，而各端判「旧后端没有这个端点」
     * 认的都是 HTTP 404（office-addin api.js、MobileRelayClientService、CloudSyncService）。
     * 主端口上没有 /actuator/**，同样走这里；管理端口的 actuator 端点不受影响。
     */
    @ExceptionHandler({org.springframework.web.servlet.resource.NoResourceFoundException.class,
            org.springframework.web.servlet.NoHandlerFoundException.class})
    public ResponseEntity<Map<String, Object>> handleNotFound(Exception e) {
        log.debug("No handler: {}", e.getMessage());
        Map<String, Object> result = new HashMap<>();
        result.put("code", 1);
        result.put("message", LangText.of("接口不存在", "API endpoint not found"));
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(result);
    }

    /** 路径存在但方法不对：真 HTTP 405 + Allow 头，理由同上。 */
    @ExceptionHandler(org.springframework.web.HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<Map<String, Object>> handleMethodNotAllowed(
            org.springframework.web.HttpRequestMethodNotSupportedException e) {
        log.debug("Method not allowed: {}", e.getMessage());
        Map<String, Object> result = new HashMap<>();
        result.put("code", 1);
        result.put("message", LangText.of("该接口不支持此请求方法", "HTTP method not allowed for this endpoint"));
        var response = ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED);
        if (e.getSupportedHttpMethods() != null && !e.getSupportedHttpMethods().isEmpty()) {
            response.allow(e.getSupportedHttpMethods().toArray(org.springframework.http.HttpMethod[]::new));
        }
        return response.body(result);
    }

    /**
     * 路径参数类型不对（如 GET /api/projects/list 落到 /{id} 而 id 是 Long）：HTTP 400，
     * 是调用方的错不是服务器故障，不打 ERROR 堆栈。
     */
    @ExceptionHandler(org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class)
    public ResponseEntity<Map<String, Object>> handleTypeMismatch(
            org.springframework.web.method.annotation.MethodArgumentTypeMismatchException e) {
        log.debug("Argument type mismatch: {}", e.getMessage());
        Map<String, Object> result = new HashMap<>();
        result.put("code", 1);
        result.put("message", LangText.of("请求参数格式不正确：" + e.getName(), "Invalid request parameter: " + e.getName()));
        return ResponseEntity.badRequest().body(result);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleException(Exception e) {
        log.error("GlobalExceptionHandler caught Exception: ", e);
        Map<String, Object> result = new HashMap<>();
        result.put("code", 1);
        // 不回显内部异常 message（可能含 SQL/表名/文件路径/SDK 细节等），统一通用文案；详情仅进日志
        result.put("message", LangText.of("服务器内部错误", "Internal server error"));
        // 统一返回 HTTP 200，通过 code 字段表示失败
        return ResponseEntity.ok().body(result);
    }

    /**
     * 未登录的两个中文字面量在出口处按请求语言翻译。抛出点保持中文字面量不动：
     * 上面的 4010 判定靠精确匹配它们，在抛出点就翻成英文会让判定落空。
     */
    private static String localizedAuthMessage(String message) {
        if ("未登录".equals(message)) return LangText.of("未登录", "Not signed in");
        if ("请先登录".equals(message)) return LangText.of("请先登录", "Please sign in first");
        return message;
    }
}
