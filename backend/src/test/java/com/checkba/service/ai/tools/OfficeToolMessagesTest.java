// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.tools;

import com.checkba.service.AppLanguageScope;
import com.checkba.util.AppLocale;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class OfficeToolMessagesTest {
    @Test void everyNewMessageHasAllSupportedLocalesAndUsesTheirExactText() {
        assertEquals(18, OfficeToolMessages.MESSAGES.size());
        for (var entry : OfficeToolMessages.MESSAGES.entrySet()) {
            assertEquals(AppLocale.values().length, entry.getValue().size(), entry.getKey());
            for (var locale : AppLocale.values()) {
                var expected = entry.getValue().get(locale.code());
                assertNotNull(expected, entry.getKey() + ":" + locale.code());
                assertFalse(expected.isBlank());
                AppLanguageScope.run(locale.code(), () ->
                        assertEquals(expected, OfficeToolMessages.text(entry.getKey())));
            }
        }
    }
}
