// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * LangText 静态语言桥的回退契约：未登记 / 取值抛异常一律回退中文
 * （v0.15.0 static 指针顺序的教训——静态指针必须 null 安全，不能因初始化顺序把对话带崩）。
 */
class LangTextTest {

    @AfterEach
    void reset() {
        LangText.reset();
    }

    @Test
    void unregistered_fallsBackToChinese() {
        LangText.reset();
        assertFalse(LangText.isEnglish());
        assertEquals("中文", LangText.of("中文", "English"));
    }

    @Test
    void registeredEnglish_picksEnglish() {
        AppLanguageService en = mock(AppLanguageService.class);
        when(en.isEnglish()).thenReturn(true);
        LangText.register(en);
        assertTrue(LangText.isEnglish());
        assertEquals("English", LangText.of("中文", "English"));
    }

    @Test
    void registeredChinese_picksChinese() {
        AppLanguageService zh = mock(AppLanguageService.class);
        when(zh.isEnglish()).thenReturn(false);
        LangText.register(zh);
        assertEquals("中文", LangText.of("中文", "English"));
    }

    @Test
    void languageLookupFailure_fallsBackToChinese() {
        AppLanguageService broken = mock(AppLanguageService.class);
        when(broken.isEnglish()).thenThrow(new RuntimeException("db down"));
        LangText.register(broken);
        // 语言取不到时宁可回退中文，也不能让一条进度文案把整轮对话带崩
        assertEquals("中文", LangText.of("中文", "English"));
    }

    @Test
    void traditionalChinese_convertsSimplifiedPairAndMapFallback() {
        AppLanguageService zhTw = mock(AppLanguageService.class);
        when(zhTw.language()).thenReturn("zh-TW");
        LangText.register(zhTw);

        assertEquals("請設定網路資料夾", LangText.of("请设置网络文件夹", "Settings"));
        assertEquals("設定詞條", LangText.of(java.util.Map.of(
                "zh-CN", "设置词条", "en-US", "Entry")));
        assertEquals("原生繁體", LangText.of(java.util.Map.of(
                "zh-TW", "原生繁體", "zh-CN", "简体")));
    }

    @Test
    void localizedMap_usesCurrentLocaleThenEnglishThenChinese() {
        AppLanguageService fr = mock(AppLanguageService.class);
        when(fr.language()).thenReturn("fr-FR");
        when(fr.isEnglish()).thenReturn(true);
        LangText.register(fr);

        assertEquals("Bonjour", LangText.of(java.util.Map.of(
                "fr-FR", "Bonjour", "en-US", "Hello", "zh-CN", "你好")));
        assertEquals("Hello", LangText.of(java.util.Map.of(
                "en-US", "Hello", "zh-CN", "你好")));
        assertEquals("你好", LangText.of(java.util.Map.of("zh-CN", "你好")));
        assertNull(LangText.of(java.util.Map.of("ja-JP", "こんにちは")));
        assertNull(LangText.of((java.util.Map<String, String>) null));
    }

    @Test
    void nullLanguageWithLegacyEnglishMock_keepsEnglishCompatibility() {
        AppLanguageService en = mock(AppLanguageService.class);
        when(en.isEnglish()).thenReturn(true);
        LangText.register(en);

        assertEquals("en-US", LangText.localeCode());
        assertEquals(com.checkba.util.AppLocale.EN_US, LangText.locale());
        assertEquals("Hello", LangText.of(java.util.Map.of("en-US", "Hello", "zh-CN", "你好")));
    }

    @Test
    void resetRestoresChineseDefault() {
        AppLanguageService en = mock(AppLanguageService.class);
        when(en.isEnglish()).thenReturn(true);
        LangText.register(en);
        assertTrue(LangText.isEnglish());
        LangText.reset();
        assertFalse(LangText.isEnglish());
    }
}
