// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class AppLanguageServiceTest {

    private final SystemSettingService settings = mock(SystemSettingService.class);
    private final AppLanguageService service = new AppLanguageService(settings);

    @Test
    void defaultsToChineseWhenUnset() {
        when(settings.get(eq(AppLanguageService.KEY), eq(AppLanguageService.ZH_CN)))
                .thenReturn(AppLanguageService.ZH_CN);
        assertEquals("zh-CN", service.language());
        assertFalse(service.isEnglish());
    }

    @Test
    void invalidStoredValueFallsBackToChinese() {
        when(settings.get(eq(AppLanguageService.KEY), eq(AppLanguageService.ZH_CN)))
                .thenReturn("tlh-KL");
        assertEquals("zh-CN", service.language());
    }

    @Test
    void supportedStoredLocalesAreNormalizedAndExposed() {
        for (String language : new String[] {"ja-JP", "fr-FR", "zh-TW", "ar-SA"}) {
            when(settings.get(eq(AppLanguageService.KEY), eq(AppLanguageService.ZH_CN)))
                    .thenReturn(language);
            assertEquals(language, service.language());
            assertEquals(language, service.locale().code());
            assertEquals(!language.startsWith("zh-"), service.isEnglish());
        }
        when(settings.get(eq(AppLanguageService.KEY), eq(AppLanguageService.ZH_CN)))
                .thenReturn("pt-PT");
        assertEquals("pt-BR", service.language());
    }

    @Test
    void setPersistsSupportedLanguage() {
        when(settings.get(eq(AppLanguageService.KEY), eq(AppLanguageService.ZH_CN)))
                .thenReturn(AppLanguageService.EN_US);
        String effective = service.setLanguage("en-US");
        verify(settings).set(AppLanguageService.KEY, "en-US");
        assertEquals("en-US", effective);
        assertTrue(service.isEnglish());
    }

    @Test
    void setNormalizesSupportedLanguage() {
        when(settings.get(eq(AppLanguageService.KEY), eq(AppLanguageService.ZH_CN)))
                .thenReturn("ar-SA");
        assertEquals("ar-SA", service.setLanguage("ar"));
        verify(settings).set(AppLanguageService.KEY, "ar-SA");
    }

    @Test
    void setIgnoresUnsupportedLanguage() {
        when(settings.get(eq(AppLanguageService.KEY), eq(AppLanguageService.ZH_CN)))
                .thenReturn(AppLanguageService.ZH_CN);
        service.setLanguage("tlh-KL");
        service.setLanguage("eo");
        service.setLanguage(null);
        verify(settings, never()).set(anyString(), anyString());
    }
}
