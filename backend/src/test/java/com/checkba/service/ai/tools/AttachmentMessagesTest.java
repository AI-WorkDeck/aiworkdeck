// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.tools;

import com.checkba.service.AppLanguageScope;
import com.checkba.util.AppLocale;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class AttachmentMessagesTest {
    @Test
    void localizedFailuresRemainFailuresForEverySupportedLanguage() {
        for (var locale : AppLocale.values()) {
            AppLanguageScope.run(locale.code(), () -> {
                for (String key : java.util.List.of("manifestDenied", "manifestUnavailable")) {
                    var result = new com.checkba.service.ai.ToolRegistry.ToolResult(AttachmentMessages.error(key), null, true);
                    assertFalse(result.success(), locale.code() + ":" + key);
                }
            });
        }
    }

    @Test
    void everyAttachmentMessageHasAllSupportedLocalesAndUsesTheirExactText() {
        assertEquals(18, AttachmentMessages.MESSAGES.size());
        for (var entry : AttachmentMessages.MESSAGES.entrySet()) {
            assertEquals(AppLocale.values().length, entry.getValue().size(), entry.getKey());
            for (var locale : AppLocale.values()) {
                String expected = entry.getValue().get(locale.code());
                assertNotNull(expected, entry.getKey() + ":" + locale.code());
                assertFalse(expected.isBlank());
                AppLanguageScope.run(locale.code(), () ->
                        assertEquals(expected, AttachmentMessages.text(entry.getKey())));
            }
        }
    }
}
