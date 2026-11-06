// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.mcpserver;

import com.checkba.service.SystemSettingService;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class LocalMcpServerSettingsTest {

    private final Map<String, String> store = new HashMap<>();
    private final LocalMcpServerSettings settings = new LocalMcpServerSettings(fakeSettings());

    private SystemSettingService fakeSettings() {
        SystemSettingService s = mock(SystemSettingService.class);
        when(s.get(anyString(), anyString())).thenAnswer(i -> store.getOrDefault(i.getArgument(0), i.getArgument(1)));
        doAnswer(i -> store.put(i.getArgument(0), i.getArgument(1))).when(s).set(anyString(), anyString());
        return s;
    }

    @Test
    void offByDefaultAndRejectsEverything() {
        assertFalse(settings.isEnabled());
        assertFalse(settings.verify(null));
        assertFalse(settings.verify("awdm_anything"));
    }

    @Test
    void enableIssuesTokenStoredOnlyAsHash() {
        String token = settings.enableAndIssueToken();
        assertTrue(token.startsWith("awdm_"));
        assertTrue(settings.isEnabled());
        assertTrue(settings.verify(token));
        assertFalse(settings.verify(token + "x"));
        assertFalse(store.containsValue(token), "明文令牌不得落库");
    }

    @Test
    void rotateInvalidatesOldTokenAndDisableInvalidatesAll() {
        String first = settings.enableAndIssueToken();
        String second = settings.enableAndIssueToken();
        assertNotEquals(first, second);
        assertFalse(settings.verify(first));
        assertTrue(settings.verify(second));
        settings.disable();
        assertFalse(settings.isEnabled());
        assertFalse(settings.verify(second));
    }
}
