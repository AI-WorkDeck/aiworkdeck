// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.*;

class FeedbackConsoleAiReportTest {

    @Test
    void consoleHasBilingualSafeHandlingFormAndDuplicateSubmitGuard() throws Exception {
        String html;
        try (var input = getClass().getResourceAsStream("/static/feedback-console/index.html")) {
            assertNotNull(input);
            html = new String(input.readAllBytes(), StandardCharsets.UTF_8);
        }
        assertTrue(html.contains("/ai-report-resolution"));
        assertTrue(html.contains("handlingBusy"));
        assertTrue(html.contains("expectedVersion"));
        assertTrue(html.contains("aiProgressSaved: '核查进展已保存"));
        assertTrue(html.contains("aiProgressSaved: 'Progress saved."));
        assertTrue(html.contains("published to the feedback record"));
        assertFalse(html.contains(".innerHTML"));
    }
}
