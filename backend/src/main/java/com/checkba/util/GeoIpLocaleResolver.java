// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.util;

import jakarta.servlet.http.HttpServletRequest;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Resolves a default {@link AppLocale} from CDN / reverse-proxy Geo-IP country headers
 * ({@code CF-IPCountry}, {@code X-Vercel-IP-Country}, {@code CloudFront-Viewer-Country},
 * {@code Ali-Cdn-Real-Country}, {@code X-Geo-Country}, {@code X-Country-Code}) for
 * first-time visitors who have not explicitly chosen a language.
 */
public final class GeoIpLocaleResolver {

    public static final List<String> GEO_COUNTRY_HEADERS = List.of(
            "CF-IPCountry",
            "X-Vercel-IP-Country",
            "CloudFront-Viewer-Country",
            "Ali-Cdn-Real-Country",
            "X-Geo-Country",
            "X-Country-Code"
    );

    private static final Map<String, AppLocale> COUNTRY_TO_LOCALE;

    static {
        Map<String, AppLocale> map = new LinkedHashMap<>();
        // Simplified Chinese
        map.put("CN", AppLocale.ZH_CN);
        map.put("SG", AppLocale.ZH_CN);
        // Traditional Chinese
        map.put("TW", AppLocale.ZH_TW);
        map.put("HK", AppLocale.ZH_TW);
        map.put("MO", AppLocale.ZH_TW);
        // Japanese / Korean
        map.put("JP", AppLocale.JA_JP);
        map.put("KR", AppLocale.KO_KR);
        // Southeast Asia
        map.put("TH", AppLocale.TH_TH);
        map.put("MY", AppLocale.MS_MY);
        map.put("BN", AppLocale.MS_MY);
        map.put("ID", AppLocale.ID_ID);
        map.put("VN", AppLocale.VI_VN);
        // French
        map.put("FR", AppLocale.FR_FR);
        map.put("MC", AppLocale.FR_FR);
        map.put("SN", AppLocale.FR_FR);
        map.put("CI", AppLocale.FR_FR);
        // German
        map.put("DE", AppLocale.DE_DE);
        map.put("AT", AppLocale.DE_DE);
        map.put("LI", AppLocale.DE_DE);
        // Spanish
        for (String cc : new String[] {
                "ES", "MX", "AR", "CO", "CL", "PE", "VE", "EC", "GT", "CU",
                "BO", "DO", "HN", "PY", "SV", "NI", "CR", "PA", "UY"
        }) {
            map.put(cc, AppLocale.ES_ES);
        }
        // Portuguese
        for (String cc : new String[] {"BR", "PT", "AO", "MZ"}) {
            map.put(cc, AppLocale.PT_BR);
        }
        // Italian
        for (String cc : new String[] {"IT", "SM", "VA"}) {
            map.put(cc, AppLocale.IT_IT);
        }
        // Russian
        for (String cc : new String[] {"RU", "BY", "KZ", "KG"}) {
            map.put(cc, AppLocale.RU_RU);
        }
        // Greek
        map.put("GR", AppLocale.EL_GR);
        map.put("CY", AppLocale.EL_GR);
        // Turkish
        map.put("TR", AppLocale.TR_TR);
        // Dutch
        map.put("NL", AppLocale.NL_NL);
        map.put("SR", AppLocale.NL_NL);
        // Hindi / India
        map.put("IN", AppLocale.HI_IN);
        // Arabic (MENA)
        for (String cc : new String[] {
                "SA", "AE", "EG", "QA", "KW", "BH", "OM", "JO", "LB", "IQ",
                "MA", "DZ", "TN", "LY", "YE", "SY", "PS", "SD"
        }) {
            map.put(cc, AppLocale.AR_SA);
        }
        // English-primary countries/regions
        for (String cc : new String[] {"US", "GB", "AU", "CA", "NZ", "IE", "ZA", "PH", "NG", "KE"}) {
            map.put(cc, AppLocale.EN_US);
        }
        COUNTRY_TO_LOCALE = Collections.unmodifiableMap(map);
    }

    private GeoIpLocaleResolver() {
    }

    /**
     * Maps an ISO 3166-1 alpha-2 country code (e.g. {@code "JP"}, {@code "TW"}, {@code "SA"})
     * to a supported {@link AppLocale}, or {@code null} if unknown/invalid.
     */
    public static AppLocale fromCountryCode(String countryCode) {
        if (countryCode == null) {
            return null;
        }
        String code = countryCode.trim().toUpperCase(Locale.ROOT);
        if (code.length() != 2
                || !Character.isLetter(code.charAt(0))
                || !Character.isLetter(code.charAt(1))
                || "XX".equals(code)
                || "T1".equals(code)) {
            return null;
        }
        return COUNTRY_TO_LOCALE.get(code);
    }

    /**
     * Extracts the normalized ISO 3166-1 alpha-2 country code from CDN / reverse-proxy headers
     * on the given HTTP request, or {@code null} if none is present.
     */
    public static String extractCountryCode(HttpServletRequest request) {
        if (request == null) {
            return null;
        }
        for (String header : GEO_COUNTRY_HEADERS) {
            String raw = request.getHeader(header);
            if (raw != null) {
                String code = raw.trim().toUpperCase(Locale.ROOT);
                if (code.length() == 2
                        && Character.isLetter(code.charAt(0))
                        && Character.isLetter(code.charAt(1))
                        && !"XX".equals(code)
                        && !"T1".equals(code)) {
                    return code;
                }
            }
        }
        return null;
    }

    /**
     * Resolves the {@link AppLocale} for the request's Geo-IP country header, or {@code null} if unavailable.
     */
    public static AppLocale resolveFromRequest(HttpServletRequest request) {
        return fromCountryCode(extractCountryCode(request));
    }
}
