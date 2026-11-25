// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.account;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

/**
 * The "not connected" messages came back half-converted for zh-TW (「…点右上角的帳戶按钮…」): the
 * converter lacked 点/钮, and the First-user journeys zh-TW settings step went red for every PR.
 * Both messages now carry an explicit zh-TW text.
 */
class NotConnectedMessageZhTwTest {
    private static final String SIMPLIFIED_ONLY = "点钮账户连连云";

    @Test
    void accountServiceMessageHasAFullTraditionalText() {
        String tw = AccountService.NOT_CONNECTED_MESSAGE.get("zh-TW");
        assertNotNull(tw);
        for (char c : SIMPLIFIED_ONLY.toCharArray()) assertTrue(tw.indexOf(c) < 0, "Simplified '" + c + "' in: " + tw);
        assertTrue(AccountService.NOT_CONNECTED_MESSAGE.get("zh-CN").contains("连接"), "zh-CN wording unchanged");
    }

    @Test
    void platformChannelMessageHasAFullTraditionalText() throws Exception {
        String src = Files.readString(Path.of("src/main/java/com/checkba/service/ai/PlatformAiChannel.java"));
        int at = src.indexOf("\"zh-TW\", \"「AI WorkDeck 雲端」");
        assertTrue(at > 0, "explicit zh-TW text present");
        String tw = src.substring(at + 9, src.indexOf("\",", at + 9));
        for (char c : SIMPLIFIED_ONLY.toCharArray()) assertTrue(tw.indexOf(c) < 0, "Simplified '" + c + "' in: " + tw);
    }
}
