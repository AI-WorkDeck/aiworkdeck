// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import com.checkba.service.LangText;
import com.checkba.service.SystemSettingService;
import com.checkba.service.account.AccountException;
import com.checkba.service.account.AccountService;
import com.checkba.service.site.SiteProfileService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 平台 AI 通道的跨境单独同意（个保法第三十九条），按「账户 + 站点」记录与判定（dev-board#1713，问题 130）。
 *
 * <h3>为什么不再是机器级</h3>
 * 同意原先只是两条机器级 system_setting（时间 + 告知版本），切站、换账户都不清空——
 * 新账户、新站点（另一个商业实体）沿用了别人在别处给的同意。现在记录带上账户与站点，
 * 判定时版本、账户、站点三者都对上才算数。
 *
 * <h3>同意先于连接：pending 绑定</h3>
 * 所有连接账户的入口（登录弹层、设置页粘 Key、解锁页）都在<b>连接之前</b>记同意
 * （前端 {@code utils/accountConsent.js}），那一刻还不知道要连的是谁。所以记同意时同时记一个
 * pending 时间戳；随后 {@code AccountSwitchCleanup.afterConnect} 调 {@link #bindPendingToCurrentAccount()}，
 * 把这份同意绑到刚连上的账户。超过 {@link #PENDING_WINDOW} 的 pending 作废，不会绑给以后某个不相干的账户。
 *
 * <h3>旧数据迁移</h3>
 * 没有站点字段的旧记录 = 升级前的机器级同意：视为当前登录账户、当前站点的同意，
 * 第一次在已连接状态下判定时补写账户与站点，老用户不会被突然拦住。
 *
 * <h3>运行时闸</h3>
 * {@link #requireForPlatformCall()} 由 {@link ChatModelFactory} 取平台通道密钥前调用：
 * 撤回同意后平台 AI 当场停用，与告知文案「撤回后平台 AI 通道停用」一致；
 * DataInitializer 首启把通道默认成平台通道也不再绕得过去。
 */
@Service
@Slf4j
public class CrossBorderConsentService {

    public static final String KEY_AT = "ai.crossBorder.consentAt";
    public static final String KEY_VERSION = "ai.crossBorder.consentVersion";
    /** 同意所属账户：官网 accountId；老盘没有 accountId 时用 Key 指纹（每次登录都会重新征求，见类注释）。 */
    public static final String KEY_ACCOUNT = "ai.crossBorder.consentAccount";
    public static final String KEY_SITE = "ai.crossBorder.consentSite";
    public static final String KEY_PENDING_AT = "ai.crossBorder.consentPendingAt";

    /** 当前告知文本的版本号；改了跨境告知的实质内容就要 +1，让旧同意失效并重新征求 */
    public static final String NOTICE_VERSION = "2026-10-29";

    /** 记同意到连上账户之间允许的最长间隔（扫码登录可能要几分钟）。 */
    static final Duration PENDING_WINDOW = Duration.ofMinutes(30);

    /** 运行时拒绝的机器码，前端可据此定向处理。 */
    public static final String REASON = "cross_border_consent_required";

    private final SystemSettingService settings;
    private final AccountService accountService;
    private final SiteProfileService siteProfileService;

    public CrossBorderConsentService(SystemSettingService settings, AccountService accountService,
                                     SiteProfileService siteProfileService) {
        this.settings = settings;
        this.accountService = accountService;
        this.siteProfileService = siteProfileService;
    }

    /** 当前账户、当前站点下是否有有效（同版本）的同意。 */
    public boolean hasConsent() {
        String at = settings.get(KEY_AT, "");
        String version = settings.get(KEY_VERSION, "");
        if (at == null || at.isBlank() || !NOTICE_VERSION.equals(version)) return false;
        String site = settings.get(KEY_SITE, null);
        String account = settings.get(KEY_ACCOUNT, null);
        String currentSite = siteProfileService.currentSite();
        String currentAccount = currentAccountIdentity();
        if (site == null || site.isBlank()) {
            // 旧的机器级同意：视为当前账户、当前站点的同意；连着账户时顺手补写，之后按三者判定
            if (currentAccount != null) {
                Map<String, String> migrated = new LinkedHashMap<>();
                migrated.put(KEY_ACCOUNT, currentAccount);
                migrated.put(KEY_SITE, currentSite);
                settings.setMany(migrated);
                log.info("跨境同意旧记录已迁移到当前账户与站点 {}", currentSite);
            }
            return true;
        }
        if (!site.equals(currentSite)) return false;
        if (account == null || account.isBlank()) {
            // 未连接账户时记下的同意，还没绑给任何账户：只在仍未连接时算数
            return currentAccount == null;
        }
        return account.equals(currentAccount);
    }

    /** 给设置页展示的同意时间：当前账户、当前站点没有有效同意时为空串。 */
    public String consentAtForDisplay() {
        return hasConsent() ? settings.get(KEY_AT, "") : "";
    }

    /**
     * 给一批即将写库的设置补上同意的账户与站点。{@code AdminConfigController.toSettingsUpdates}
     * 只写时间与版本（静态、拿不到账户），两个保存入口在它之后调这里。
     * 本批没动同意就什么都不做；撤回时连同账户、站点、pending 一起清空。
     */
    public void stampIdentity(Map<String, String> updates) {
        if (!updates.containsKey(KEY_AT)) return;
        String at = updates.get(KEY_AT);
        if (at == null || at.isBlank()) {
            updates.put(KEY_ACCOUNT, "");
            updates.put(KEY_SITE, "");
            updates.put(KEY_PENDING_AT, "");
            return;
        }
        String account = currentAccountIdentity();
        updates.put(KEY_ACCOUNT, account == null ? "" : account);
        updates.put(KEY_SITE, siteProfileService.currentSite());
        updates.put(KEY_PENDING_AT, Instant.now().toString());
    }

    /** 刚连上账户：把连接前记下的同意绑到这个账户。超时或站点对不上的 pending 不绑。 */
    public void bindPendingToCurrentAccount() {
        String pending = settings.get(KEY_PENDING_AT, "");
        if (pending == null || pending.isBlank()) return;
        Map<String, String> updates = new LinkedHashMap<>();
        updates.put(KEY_PENDING_AT, "");
        String account = currentAccountIdentity();
        if (isFresh(pending) && account != null
                && siteProfileService.currentSite().equals(settings.get(KEY_SITE, ""))) {
            updates.put(KEY_ACCOUNT, account);
        }
        settings.setMany(updates);
    }

    /**
     * 平台通道调用前的运行时闸。未连接账户时放行——下游会报 4011，由登录弹层承接，
     * 而登录弹层本身就征求同意；连着账户却没有有效同意时拒绝。
     */
    public void requireForPlatformCall() {
        if (currentAccountIdentity() == null) return;
        if (hasConsent()) return;
        // 文案红线：不得含「登录」「未授权」「请先」——前端 api.js 用这三个子串判掉线并清会话
        throw new AccountException(AccountException.Kind.CONFLICT, LangText.of(
                "平台 AI 通道已停用：当前账户在本站点还没有有效的跨境传输单独同意（或已撤回）。"
                        + "到「设置 → AI 服务配置」勾选同意后即可继续；不想让内容出境，可以改用本机模型。",
                "The platform AI channel is paused: this account has no valid cross-border transfer consent on this site (or it was withdrawn). "
                        + "Check the consent box under Settings → AI Service Settings to continue, or use a local model to keep content on this device."),
                REASON);
    }

    /** 当前连接账户的身份；未连接返回 null。 */
    String currentAccountIdentity() {
        String id = accountService.currentAccountIdOrNull();
        if (id != null && !id.isBlank()) return id;
        String fingerprint = accountService.accountFingerprintOrNull();
        return fingerprint == null || fingerprint.isBlank() ? null : "fp:" + fingerprint;
    }

    private static boolean isFresh(String instant) {
        try {
            return Instant.parse(instant).isAfter(Instant.now().minus(PENDING_WINDOW));
        } catch (RuntimeException e) {
            return false;
        }
    }
}
