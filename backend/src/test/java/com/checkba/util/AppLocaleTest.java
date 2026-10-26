// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.util;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

class AppLocaleTest {

    private static final Set<String> EXPECTED_CODES = Set.of(
            "zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR", "th-TH", "ms-MY", "id-ID", "vi-VN",
            "fr-FR", "de-DE", "es-ES", "pt-BR", "it-IT", "ru-RU", "el-GR", "tr-TR", "nl-NL",
            "hi-IN", "ar-SA");

    @Test
    void normalizesAllTwentyLocalesAndTheirCommonForms() {
        assertEquals(EXPECTED_CODES, AppLocale.supportedCodes());
        assertEquals(20, AppLocale.catalogMetadata().size());
        for (AppLocale locale : AppLocale.values()) {
            assertEquals(locale.code(), AppLocale.normalize(locale.code()));
            assertEquals(locale.code(), AppLocale.normalize(locale.code().toLowerCase()));
            assertEquals(locale.code(), AppLocale.normalize(locale.mobileCode()));
            assertEquals(locale, AppLocale.fromCode(locale.code()));
        }
        assertEquals("zh-TW", AppLocale.normalize("zh-Hant-TW"));
        assertEquals("zh-TW", AppLocale.normalize("zh_HK"));
        assertEquals("en-US", AppLocale.normalize("en-GB"));
        assertEquals("ja-JP", AppLocale.normalize("ja"));
        assertEquals("pt-BR", AppLocale.normalize("pt-PT"));
        assertEquals("id-ID", AppLocale.normalize("in-ID"));
    }

    @Test
    void rejectsUnknownAndEmptyLocales() {
        for (String raw : new String[] {null, "", "  ", "tlh-KL", "eo", "xx-YY", "*"}) {
            assertNull(AppLocale.normalize(raw), raw);
        }
    }

    @Test
    void resolvesFirstSupportedAcceptLanguageTag() {
        assertEquals("fr-FR", AppLocale.normalize("tlh-KL;q=1, fr-CH;q=0.9, en;q=0.8"));
        assertEquals("zh-TW", AppLocale.normalize("zh-Hant-TW, zh;q=0.8"));
        assertNull(AppLocale.normalize("eo, tlh-KL;q=0.5"));
    }

    @Test
    void fallbackChainsIncludeExpectedResources() {
        assertEquals(List.of(AppLocale.ZH_CN), AppLocale.ZH_CN.fallbackChain());
        assertEquals(List.of(AppLocale.ZH_TW, AppLocale.ZH_CN), AppLocale.ZH_TW.fallbackChain());
        assertEquals(List.of(AppLocale.EN_US, AppLocale.ZH_CN), AppLocale.EN_US.fallbackChain());
        assertEquals(List.of(AppLocale.JA_JP, AppLocale.EN_US, AppLocale.ZH_CN),
                AppLocale.JA_JP.fallbackChain());
        assertEquals(List.of(AppLocale.AR_SA, AppLocale.EN_US, AppLocale.ZH_CN),
                AppLocale.AR_SA.fallbackChain());
    }

    @Test
    void simplifiedChineseFallsBackToTraditionalCharactersAndPhrases() {
        assertEquals("請設定網路資料夾", ZhHantConverter.toTraditional("请设置网络文件夹"));
        assertEquals("帳戶餘額不足", ZhHantConverter.toTraditional("账户余额不足"));
        assertNull(ZhHantConverter.toTraditional(null));
    }

    @Test
    void geoIpCountryCodeResolvesToExpectedDefaultLocale() {
        assertEquals(AppLocale.ZH_CN, GeoIpLocaleResolver.fromCountryCode("CN"));
        assertEquals(AppLocale.ZH_TW, GeoIpLocaleResolver.fromCountryCode("TW"));
        assertEquals(AppLocale.ZH_TW, GeoIpLocaleResolver.fromCountryCode("HK"));
        assertEquals(AppLocale.JA_JP, GeoIpLocaleResolver.fromCountryCode("JP"));
        assertEquals(AppLocale.KO_KR, GeoIpLocaleResolver.fromCountryCode("KR"));
        assertEquals(AppLocale.AR_SA, GeoIpLocaleResolver.fromCountryCode("SA"));
        assertEquals(AppLocale.PT_BR, GeoIpLocaleResolver.fromCountryCode("BR"));
        assertEquals(AppLocale.EN_US, GeoIpLocaleResolver.fromCountryCode("US"));
        assertNull(GeoIpLocaleResolver.fromCountryCode("XX"));
        assertNull(GeoIpLocaleResolver.fromCountryCode(null));
    }
}
