// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.util;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Canonical 20-locale catalog for AI WorkDeck.
 *
 * <p>Provides locale normalization (handling legacy aliases, BCP-47 tags, and
 * {@code Accept-Language} headers), metadata ({@code nativeName}, {@code englishName},
 * {@code rtl}), and deterministic fallback chains.
 */
public enum AppLocale {
    ZH_CN("zh-CN", "zh", "zh-Hans", "简体中文", "Simplified Chinese", false),
    ZH_TW("zh-TW", "zh-hant", "zh-Hant", "繁體中文", "Traditional Chinese", false),
    EN_US("en-US", "en", "en", "English", "English", false),
    JA_JP("ja-JP", "ja", "ja", "日本語", "Japanese", false),
    KO_KR("ko-KR", "ko", "ko", "한국어", "Korean", false),
    TH_TH("th-TH", "th", "th", "ไทย", "Thai", false),
    MS_MY("ms-MY", "ms", "ms", "Bahasa Melayu", "Malay", false),
    ID_ID("id-ID", "id", "id", "Bahasa Indonesia", "Indonesian", false),
    VI_VN("vi-VN", "vi", "vi", "Tiếng Việt", "Vietnamese", false),
    FR_FR("fr-FR", "fr", "fr", "Français", "French", false),
    DE_DE("de-DE", "de", "de", "Deutsch", "German", false),
    ES_ES("es-ES", "es", "es", "Español", "Spanish", false),
    PT_BR("pt-BR", "pt", "pt-BR", "Português (Brasil)", "Portuguese (Brazil)", false),
    IT_IT("it-IT", "it", "it", "Italiano", "Italian", false),
    RU_RU("ru-RU", "ru", "ru", "Русский", "Russian", false),
    EL_GR("el-GR", "el", "el", "Ελληνικά", "Greek", false),
    TR_TR("tr-TR", "tr", "tr", "Türkçe", "Turkish", false),
    NL_NL("nl-NL", "nl", "nl", "Nederlands", "Dutch", false),
    HI_IN("hi-IN", "hi", "hi", "हिन्दी", "Hindi", false),
    AR_SA("ar-SA", "ar", "ar", "العربية", "Arabic", true);

    public static final String SYSTEM_PREFERENCE = "system";

    private static final Map<String, AppLocale> BY_LOWER_CODE;
    private static final Map<String, AppLocale> BY_SLUG;
    private static final Set<String> SUPPORTED_CODES;

    static {
        Map<String, AppLocale> byCode = new LinkedHashMap<>();
        Map<String, AppLocale> bySlug = new LinkedHashMap<>();
        Set<String> codes = new LinkedHashSet<>();
        for (AppLocale locale : values()) {
            byCode.put(locale.code.toLowerCase(Locale.ROOT), locale);
            byCode.put(locale.mobileCode.toLowerCase(Locale.ROOT), locale);
            bySlug.put(locale.slug.toLowerCase(Locale.ROOT), locale);
            codes.add(locale.code);
        }
        BY_LOWER_CODE = Collections.unmodifiableMap(byCode);
        BY_SLUG = Collections.unmodifiableMap(bySlug);
        SUPPORTED_CODES = Collections.unmodifiableSet(codes);
    }

    private final String code;
    private final String slug;
    private final String mobileCode;
    private final String nativeName;
    private final String englishName;
    private final boolean rtl;

    AppLocale(String code, String slug, String mobileCode, String nativeName, String englishName, boolean rtl) {
        this.code = code;
        this.slug = slug;
        this.mobileCode = mobileCode;
        this.nativeName = nativeName;
        this.englishName = englishName;
        this.rtl = rtl;
    }

    public String code() {
        return code;
    }

    public String slug() {
        return slug;
    }

    public String mobileCode() {
        return mobileCode;
    }

    public String nativeName() {
        return nativeName;
    }

    public String englishName() {
        return englishName;
    }

    public boolean isRtl() {
        return rtl;
    }

    public boolean isSimplifiedChinese() {
        return this == ZH_CN;
    }

    public boolean isTraditionalChinese() {
        return this == ZH_TW;
    }

    public boolean isChinese() {
        return this == ZH_CN || this == ZH_TW;
    }

    /**
     * Returns the ordered locale fallback chain for resource lookup.
     *
     * <ul>
     *   <li>{@code zh-CN}: {@code [zh-CN]}</li>
     *   <li>{@code zh-TW}: {@code [zh-TW, zh-CN]}</li>
     *   <li>{@code en-US}: {@code [en-US, zh-CN]}</li>
     *   <li>All other locales: {@code [<code>, en-US, zh-CN]}</li>
     * </ul>
     */
    public List<AppLocale> fallbackChain() {
        if (this == ZH_CN) {
            return List.of(ZH_CN);
        }
        if (this == ZH_TW) {
            return List.of(ZH_TW, ZH_CN);
        }
        if (this == EN_US) {
            return List.of(EN_US, ZH_CN);
        }
        return List.of(this, EN_US, ZH_CN);
    }

    /**
     * Returns all 20 canonical locale codes in catalog order.
     */
    public static Set<String> supportedCodes() {
        return SUPPORTED_CODES;
    }

    /**
     * Returns true if {@code raw} can be normalized to one of the 20 supported locales.
     */
    public static boolean isSupported(String raw) {
        return resolve(raw) != null;
    }

    /**
     * Returns true if {@code raw} is {@code "system"} (case-insensitive) or normalizes to a supported locale.
     */
    public static boolean isSupportedOrSystem(String raw) {
        return normalizeOrSystem(raw) != null;
    }

    /**
     * Normalizes a raw locale tag, legacy alias, or {@code Accept-Language} header to its canonical code,
     * or returns {@code "system"} if {@code raw} is {@code "system"}/{@code "auto"}, or {@code null} if unsupported.
     */
    public static String normalizeOrSystem(String raw) {
        if (raw == null) {
            return null;
        }
        String trimmed = raw.trim();
        if (trimmed.isEmpty()) {
            return null;
        }
        if ("system".equalsIgnoreCase(trimmed) || "auto".equalsIgnoreCase(trimmed)) {
            return SYSTEM_PREFERENCE;
        }
        return normalize(trimmed);
    }

    /**
     * Normalizes a raw locale tag, legacy alias, or {@code Accept-Language} header to one of the
     * 20 canonical codes (e.g. {@code "zh-CN"}, {@code "zh-TW"}, {@code "en-US"}, {@code "ja-JP"}),
     * or {@code null} if empty or unsupported.
     */
    public static String normalize(String raw) {
        AppLocale resolved = resolve(raw);
        return resolved != null ? resolved.code : null;
    }

    /**
     * Resolves {@code raw} to an {@link AppLocale}, falling back to {@link #ZH_CN} when null/unrecognized.
     */
    public static AppLocale fromCode(String raw) {
        AppLocale resolved = resolve(raw);
        return resolved != null ? resolved : ZH_CN;
    }

    /**
     * Resolves {@code raw} (including multi-tag {@code Accept-Language} values) to an {@link AppLocale},
     * or {@code null} when null, blank, or unsupported.
     */
    public static AppLocale resolve(String raw) {
        if (raw == null) {
            return null;
        }
        String trimmed = raw.trim();
        if (trimmed.isEmpty()) {
            return null;
        }
        // Support multi-entry Accept-Language headers such as "fr-CH, fr;q=0.9, en;q=0.8"
        if (trimmed.indexOf(',') >= 0) {
            for (String part : trimmed.split(",")) {
                AppLocale candidate = resolveSingleTag(part);
                if (candidate != null) {
                    return candidate;
                }
            }
            return null;
        }
        return resolveSingleTag(trimmed);
    }

    private static AppLocale resolveSingleTag(String part) {
        if (part == null) {
            return null;
        }
        String token = part.trim();
        int semi = token.indexOf(';');
        if (semi >= 0) {
            token = token.substring(0, semi).trim();
        }
        if (token.isEmpty() || "*".equals(token)) {
            return null;
        }
        String lower = token.replace('_', '-').toLowerCase(Locale.ROOT);

        // 1. Exact canonical or mobile code match
        AppLocale exact = BY_LOWER_CODE.get(lower);
        if (exact != null) {
            return exact;
        }

        // 2. Chinese variants: distinguish Traditional (TW, HK, MO, Hant) from Simplified (CN, SG, Hans, zh)
        if (lower.equals("zh") || lower.startsWith("zh-")) {
            if (lower.contains("hant")
                    || lower.endsWith("-tw")
                    || lower.endsWith("-hk")
                    || lower.endsWith("-mo")
                    || lower.contains("-tw-")
                    || lower.contains("-hk-")
                    || lower.contains("-mo-")) {
                return ZH_TW;
            }
            return ZH_CN;
        }

        // 3. Legacy/regional aliases and language prefix matching
        if (lower.equals("in") || lower.startsWith("in-")) {
            // Legacy ISO 639-1 code for Indonesian
            return ID_ID;
        }

        AppLocale slugMatch = BY_SLUG.get(lower);
        if (slugMatch != null) {
            return slugMatch;
        }

        int dash = lower.indexOf('-');
        if (dash > 0) {
            String primary = lower.substring(0, dash);
            return BY_SLUG.get(primary);
        }

        return null;
    }

    /**
     * Converts this locale entry into a serializable metadata map for API responses.
     */
    public Map<String, Object> toMetadataMap() {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("code", code);
        map.put("slug", slug);
        map.put("mobileCode", mobileCode);
        map.put("nativeName", nativeName);
        map.put("englishName", englishName);
        map.put("rtl", rtl);
        return map;
    }

    /**
     * Returns metadata maps for all 20 supported locales.
     */
    public static List<Map<String, Object>> catalogMetadata() {
        List<Map<String, Object>> list = new ArrayList<>(values().length);
        for (AppLocale locale : values()) {
            list.add(locale.toMetadataMap());
        }
        return list;
    }
}
