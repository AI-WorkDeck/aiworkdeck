// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import com.checkba.service.LangText;
import com.checkba.util.AppLocale;
import com.checkba.util.ZhHantConverter;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * X47: the website registry carries hand-written Traditional Chinese in {@code i18n['zh-hant']}
 * ({@code name}, {@code description}, skills also {@code triggers}). In the zh-TW UI the market
 * lists prefer it; without it they fall back to converting the Simplified text.
 */
public final class RegistryZhHant {

    private RegistryZhHant() {
    }

    public static boolean active() {
        return LangText.locale() == AppLocale.ZH_TW;
    }

    /** The zh-hant text for {@code field}, or the converted {@code fallback} when the registry has none. */
    public static String text(Map<String, Object> i18n, String field, String fallback) {
        Object value = entry(i18n).get(field);
        if (value instanceof String s && !s.isBlank()) {
            return s;
        }
        return fallback == null ? null : ZhHantConverter.toTraditional(fallback);
    }

    /** The zh-hant list for {@code field}, or the converted {@code fallback} when the registry has none. */
    public static List<String> list(Map<String, Object> i18n, String field, List<String> fallback) {
        Object value = entry(i18n).get(field);
        if (value instanceof List<?> items && !items.isEmpty()) {
            List<String> out = new ArrayList<>(items.size());
            for (Object item : items) {
                if (item != null) {
                    out.add(String.valueOf(item));
                }
            }
            return out;
        }
        if (fallback == null) {
            return null;
        }
        List<String> out = new ArrayList<>(fallback.size());
        for (String item : fallback) {
            out.add(ZhHantConverter.toTraditional(item));
        }
        return out;
    }

    private static Map<?, ?> entry(Map<String, Object> i18n) {
        Object hant = i18n == null ? null : i18n.get("zh-hant");
        return hant instanceof Map<?, ?> map ? map : Map.of();
    }
}
