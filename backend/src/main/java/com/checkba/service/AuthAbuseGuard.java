// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;

/**
 * 注册闸 + 登录/注册防滥用（插件云后端加固）。
 *
 * <h3>背景</h3>
 * server 模式此前是内网团队服务器假设：开放注册、无限流。官方要托管一个 server 实例
 * 作为 Office 插件云后端，公网暴露后这两条都要闸住。
 *
 * <h3>四道闸，全部只在 server 模式生效（local-mode 一律旁路）</h3>
 * <ul>
 *   <li><b>注册闸</b>：{@code security.registration-mode: open|closed}，默认 open 保持
 *       团队服务器现状；closed 时注册返回业务错误。</li>
 *   <li><b>凭据失败锁定</b>：按 IP+用户名维度计失败次数，{@value #MAX_LOGIN_FAILURES} 次
 *       失败锁 {@code LOCKOUT} 分钟。锁定期内的请求在校验凭据之前就被拒绝，不再计数
 *       （否则轮询会把锁无限续期）。</li>
 *   <li><b>注册限频</b>：按 IP 每小时最多 {@value #MAX_REGISTRATIONS_PER_WINDOW} 个新账号。</li>
 *   <li><b>成员查询限频</b>：按发起的项目管理员，每 10 分钟最多
 *       {@value #MAX_MEMBER_LOOKUPS_PER_WINDOW} 次「按手机号找同事」——查人与加人
 *       共用这一个计数（dev-board#444）。</li>
 * </ul>
 *
 * <h3>实现边界（刻意接受）</h3>
 * <ul>
 *   <li>进程内内存计数，无 Redis 依赖。<b>多实例部署时各实例独立计数，必须在前置
 *       nginx 配 limit_req 作为真正的限流层</b>；本类只是单实例基线。</li>
 *   <li>调用方传进来的 IP 一律取自 {@link com.checkba.util.ClientIp#of}：基线部署 nginx 与后端
 *       同机反代，remoteAddr 恒为 127.0.0.1，只有回环来源才采信 nginx 覆盖写入的 X-Real-IP，
 *       IP 维度因此是真实客户端维度，不会退化成全站一个桶。</li>
 *   <li>不看 X-Forwarded-For（不可信，与 LocalModeAccessFilter 同一立场）。</li>
 * </ul>
 *
 * 失败文案红线：不得含「登录」「未授权」「请先」子串——前端 api.js 对 code=1 的 message
 * 做子串匹配识别掉线，命中会清本地会话（licensing 领域地雷 1）。
 */
@Service
public class AuthAbuseGuard {

    static final int MAX_LOGIN_FAILURES = 5;
    static final Duration LOCKOUT = Duration.ofMinutes(10);
    /** 失败计数窗口：距上次失败超过该时长则计数归零重来。 */
    static final Duration FAILURE_WINDOW = Duration.ofMinutes(10);

    static final int MAX_REGISTRATIONS_PER_WINDOW = 10;
    static final Duration REGISTRATION_WINDOW = Duration.ofHours(1);

    static final int MAX_CODE_SENDS_PER_WINDOW = 20;
    static final Duration CODE_WINDOW = Duration.ofHours(1);

    /**
     * 客户访问码的全站失败上限：按 IP 锁定之外再兜一层，压分布式猜码；额度给得宽，
     * 单个 IP 最多贡献 {@value #MAX_LOGIN_FAILURES} 次，一个来源拖不垮全部客户。
     */
    static final int MAX_CLIENT_CODE_FAILURES_GLOBAL = 200;
    static final Duration CLIENT_CODE_GLOBAL_WINDOW = Duration.ofMinutes(10);

    static final int MAX_MEMBER_LOOKUPS_PER_WINDOW = 30;
    static final Duration MEMBER_LOOKUP_WINDOW = Duration.ofMinutes(10);

    /** 内存兜底：超过该条数触发一次过期清理，防止被海量伪造维度撑爆内存。 */
    private static final int PURGE_THRESHOLD = 10_000;

    private final boolean localMode;
    private final String registrationMode;
    private final LongSupplier nowMillis;

    private final Map<String, FailureState> loginFailures = new ConcurrentHashMap<>();
    private final Map<String, Object> loginLocks = new ConcurrentHashMap<>();
    private final Map<String, WindowCounter> registrations = new ConcurrentHashMap<>();
    private final Map<String, WindowCounter> captchaChallenges = new ConcurrentHashMap<>();
    private final Map<String, WindowCounter> codeSends = new ConcurrentHashMap<>();
    private final Map<String, WindowCounter> memberLookups = new ConcurrentHashMap<>();
    private final WindowCounter clientCodeFailures = new WindowCounter();

    @Autowired
    public AuthAbuseGuard(
            @Value("${security.local-mode:false}") boolean localMode,
            @Value("${security.registration-mode:open}") String registrationMode) {
        this(localMode, registrationMode, System::currentTimeMillis);
    }

    /** 测试用：可控时钟。 */
    AuthAbuseGuard(boolean localMode, String registrationMode, LongSupplier nowMillis) {
        this.localMode = localMode;
        this.registrationMode = registrationMode;
        this.nowMillis = nowMillis;
    }

    // ==================== 注册闸 ====================

    /** closed 时抛业务错误。local-mode 不受影响（单机产品的注册本就不对公网暴露）。 */
    public void requireRegistrationOpen() {
        if (localMode) return;
        if (!"closed".equalsIgnoreCase(registrationMode)) return;
        throw new IllegalArgumentException(LangText.of("本服务器未开放自助注册，请联系服务器管理员开通账号",
                "Self-service registration is not open on this server; please ask the server administrator to create an account for you"));
    }

    // ==================== 登录失败锁定 ====================

    /** 锁定期内直接拒绝（在校验凭据之前调用）。 */
    public void checkLoginAttempt(String ip, String username) {
        if (localMode) return;
        FailureState state = loginFailures.get(loginKey(ip, username));
        if (state != null && state.lockedUntil > nowMillis.getAsLong()) {
            throw new IllegalArgumentException(LangText.of(
                    "尝试次数过多，该账号已临时锁定，" + LOCKOUT.toMinutes() + " 分钟后自动解除",
                    "Too many attempts. This account is temporarily locked and will unlock automatically in "
                            + LOCKOUT.toMinutes() + " minutes"));
        }
    }

    /** 同 ip+用户名的登录串行化用的监视器：让每次尝试都能看到上一次的失败记录。local-mode 不限流，不需要串行。 */
    public Object loginLock(String ip, String username) {
        return localMode ? new Object() : loginLocks.computeIfAbsent(loginKey(ip, username), k -> new Object());
    }

    public void recordLoginFailure(String ip, String username) {
        if (localMode) return;
        purgeIfOversized();
        long now = nowMillis.getAsLong();
        loginFailures.compute(loginKey(ip, username), (k, state) -> {
            if (state == null || now - state.lastFailureAt > FAILURE_WINDOW.toMillis()) {
                state = new FailureState();
            }
            state.count++;
            state.lastFailureAt = now;
            if (state.count >= MAX_LOGIN_FAILURES) {
                state.lockedUntil = now + LOCKOUT.toMillis();
                state.count = 0; // 锁定期满后重新给满额尝试次数
            }
            return state;
        });
    }

    public void recordLoginSuccess(String ip, String username) {
        if (localMode) return;
        loginFailures.remove(loginKey(ip, username));
    }

    // ==================== 客户访问码全站上限 ====================

    /** 全站访问码失败在窗口内达到上限时拒绝（在按 IP 锁定之后、校验访问码之前调用）。 */
    public void checkClientCodeGlobalCeiling() {
        if (localMode) return;
        long now = nowMillis.getAsLong();
        synchronized (clientCodeFailures) {
            if (now - clientCodeFailures.windowStart <= CLIENT_CODE_GLOBAL_WINDOW.toMillis()
                    && clientCodeFailures.count >= MAX_CLIENT_CODE_FAILURES_GLOBAL) {
                // 文案红线（见类注释）：不含「登录」「未授权」「请先」
                throw new IllegalArgumentException(LangText.of(
                        "访问码尝试次数过多，请几分钟后再试",
                        "Too many access code attempts. Please try again in a few minutes"));
            }
        }
    }

    public void recordClientCodeFailure() {
        if (localMode) return;
        long now = nowMillis.getAsLong();
        synchronized (clientCodeFailures) {
            if (now - clientCodeFailures.windowStart > CLIENT_CODE_GLOBAL_WINDOW.toMillis()) {
                clientCodeFailures.windowStart = now;
                clientCodeFailures.count = 0;
            }
            clientCodeFailures.count++;
        }
    }

    // ==================== 注册限频 ====================

    public void checkRegistrationRate(String ip) {
        if (localMode) return;
        WindowCounter counter = registrations.get(ip);
        long now = nowMillis.getAsLong();
        if (counter != null
                && now - counter.windowStart <= REGISTRATION_WINDOW.toMillis()
                && counter.count >= MAX_REGISTRATIONS_PER_WINDOW) {
            throw new IllegalArgumentException(LangText.of("注册过于频繁，请稍后再试",
                    "Too many sign-ups, please try again later"));
        }
    }

    public void recordRegistration(String ip) {
        if (localMode) return;
        purgeIfOversized();
        long now = nowMillis.getAsLong();
        registrations.compute(ip, (k, counter) -> {
            if (counter == null || now - counter.windowStart > REGISTRATION_WINDOW.toMillis()) {
                counter = new WindowCounter();
                counter.windowStart = now;
            }
            counter.count++;
            return counter;
        });
    }

    // ==================== 验证码发送限频（按 IP，短信与邮件共用；手机号/邮箱维度在 VerificationCodeStore） ====================

    /** Image refreshes use a separate, atomic quota and never consume paid-delivery attempts. */
    public void recordCaptchaChallenge(String ip) {
        if (localMode) return;
        purgeIfOversized();
        long now = nowMillis.getAsLong();
        captchaChallenges.compute(ip, (key, counter) -> {
            if (counter == null || now - counter.windowStart > Duration.ofMinutes(10).toMillis()) {
                counter = new WindowCounter();
                counter.windowStart = now;
            }
            if (counter.count >= 60) throw new IllegalArgumentException(LangText.of(
                    "安全验证图片请求过于频繁，请稍后再试", "Too many security image requests, please retry later"));
            counter.count++;
            return counter;
        });
    }

    public void checkCodeSendRate(String ip) {
        if (localMode) return;
        WindowCounter counter = codeSends.get(ip);
        long now = nowMillis.getAsLong();
        if (counter != null
                && now - counter.windowStart <= CODE_WINDOW.toMillis()
                && counter.count >= MAX_CODE_SENDS_PER_WINDOW) {
            throw new IllegalArgumentException(LangText.of("验证码发送过于频繁，请稍后再试",
                    "Verification codes are being requested too often, please try again later"));
        }
    }

    public void recordCodeSend(String ip) {
        if (localMode) return;
        purgeIfOversized();
        long now = nowMillis.getAsLong();
        codeSends.compute(ip, (k, counter) -> {
            if (counter == null || now - counter.windowStart > CODE_WINDOW.toMillis()) {
                counter = new WindowCounter();
                counter.windowStart = now;
            }
            counter.count++;
            return counter;
        });
    }

    // ==================== 成员查询限频（按发起的项目管理员，查人与加人共用） ====================
    //
    // 「按手机号把同事加进案卷」这件事顺带造出一个探测口：换着号码调一次就知道
    // 那个号有没有注册过 AI WorkDeck。查人端点（回头像姓名）与加人端点是同一个
    // 探测面，**必须共用一个计数**——分开计等于把额度翻倍，交替调两个端点即可绕开。
    //
    // 维度是发起人（项目管理员）而不是 IP：这条路必须先过项目管理员权限，攻击者拿到的
    // 是一个具体账号，IP 可以随便换，账号不能。

    public void checkMemberLookupRate(Long requesterId) {
        if (localMode) return;
        WindowCounter counter = memberLookups.get(memberLookupKey(requesterId));
        long now = nowMillis.getAsLong();
        if (counter != null
                && now - counter.windowStart <= MEMBER_LOOKUP_WINDOW.toMillis()
                && counter.count >= MAX_MEMBER_LOOKUPS_PER_WINDOW) {
            // 文案红线（见类注释）：不含「登录」「未授权」「请先」
            throw new IllegalArgumentException(com.checkba.service.LangText.of(
                    "查找同事过于频繁，稍后再试",
                    "Too many colleague lookups just now - try again in a few minutes"));
        }
    }

    public void recordMemberLookup(Long requesterId) {
        if (localMode) return;
        purgeIfOversized();
        long now = nowMillis.getAsLong();
        memberLookups.compute(memberLookupKey(requesterId), (k, counter) -> {
            if (counter == null || now - counter.windowStart > MEMBER_LOOKUP_WINDOW.toMillis()) {
                counter = new WindowCounter();
                counter.windowStart = now;
            }
            counter.count++;
            return counter;
        });
    }

    // ==================== 内部 ====================

    private static String memberLookupKey(Long requesterId) {
        return requesterId == null ? "-" : String.valueOf(requesterId);
    }

    private static String loginKey(String ip, String username) {
        return (ip == null ? "-" : ip) + "|" + (username == null ? "-" : username);
    }

    private void purgeIfOversized() {
        long now = nowMillis.getAsLong();
        if (loginLocks.size() > PURGE_THRESHOLD) {
            loginLocks.clear();
        }
        if (loginFailures.size() > PURGE_THRESHOLD) {
            loginFailures.entrySet().removeIf(e ->
                    e.getValue().lockedUntil < now
                            && now - e.getValue().lastFailureAt > FAILURE_WINDOW.toMillis());
        }
        if (registrations.size() > PURGE_THRESHOLD) {
            registrations.entrySet().removeIf(e ->
                    now - e.getValue().windowStart > REGISTRATION_WINDOW.toMillis());
        }
        if (captchaChallenges.size() > PURGE_THRESHOLD) {
            captchaChallenges.entrySet().removeIf(e -> now - e.getValue().windowStart > Duration.ofMinutes(10).toMillis());
        }
        if (codeSends.size() > PURGE_THRESHOLD) {
            codeSends.entrySet().removeIf(e ->
                    now - e.getValue().windowStart > CODE_WINDOW.toMillis());
        }
        if (memberLookups.size() > PURGE_THRESHOLD) {
            memberLookups.entrySet().removeIf(e ->
                    now - e.getValue().windowStart > MEMBER_LOOKUP_WINDOW.toMillis());
        }
    }

    private static final class FailureState {
        int count;
        long lastFailureAt;
        long lockedUntil;
    }

    private static final class WindowCounter {
        int count;
        long windowStart;
    }
}
