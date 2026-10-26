// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service;

import com.checkba.util.AppLocale;
import com.checkba.util.ZhHantConverter;

import java.util.Map;

/**
 * 静态语言文案桥：非 Spring 托管的产文案点（enum、new 出来的 handler、静态方法）
 * 经它按应用语言取用户可见文案，Spring bean 也可直接用它避免构造器扩散。
 *
 * <p>指针由 AppLanguageService 的 @PostConstruct 登记——只登记 Spring 容器里的那个实例，
 * 单测里 new 出来的不登记，避免跨测试类污染静态状态。未登记（启动早期 / 纯单测）或取值
 * 抛异常一律回退中文，与存量行为逐字节一致（v0.15.0 static 指针顺序的教训：静态指针必须
 * null 安全回退，不搞全局监听器）。
 */
public final class LangText {

    private static volatile AppLanguageService languageService;

    private LangText() {
    }

    /** 由 AppLanguageService @PostConstruct 调用；测试可显式登记后在收尾 reset()。 */
    public static void register(AppLanguageService service) {
        languageService = service;
    }

    /** 测试收尾用：清掉登记，回到「未初始化=中文」的默认态。 */
    public static void reset() {
        languageService = null;
    }

    public static boolean isEnglish() {
        // Early desktop requests already resolved the language from the lightweight store.
        // Honor their scope before asking a Spring service whose repository may still be starting.
        String scoped = AppLanguageScope.current();
        if (scoped != null) return !AppLocale.fromCode(scoped).isChinese();
        AppLanguageService svc = languageService;
        if (svc == null) return false;
        try {
            return svc.isEnglish();
        } catch (Exception e) {
            // 语言取不到时宁可回退中文，也不能让一条进度文案把整轮对话带崩
            return false;
        }
    }

    public static String localeCode() {
        String scoped = AppLanguageScope.current();
        if (scoped != null) return AppLocale.fromCode(scoped).code();
        AppLanguageService svc = languageService;
        if (svc == null) return AppLanguageService.ZH_CN;
        try {
            String language = svc.language();
            if (language != null) return language;
            return svc.isEnglish() ? AppLanguageService.EN_US : AppLanguageService.ZH_CN;
        } catch (Exception e) {
            return AppLanguageService.ZH_CN;
        }
    }

    public static AppLocale locale() {
        return AppLocale.fromCode(localeCode());
    }

    /** 中英双语入口兼容既有调用方；繁体中文由简体中文自动转换。 */
    public static String of(String zh, String en) {
        if (isEnglish()) return en;
        if (locale() == AppLocale.ZH_TW) return ZhHantConverter.toTraditional(zh);
        return zh;
    }

    public static String of(Map<String, String> localized) {
        if (localized == null) return null;
        AppLocale current = locale();
        for (AppLocale candidate : current.fallbackChain()) {
            String value = localized.get(candidate.code());
            if (value == null || value.isBlank()) continue;
            if (current == AppLocale.ZH_TW && candidate == AppLocale.ZH_CN) {
                return ZhHantConverter.toTraditional(value);
            }
            return value;
        }
        return null;
    }
}
