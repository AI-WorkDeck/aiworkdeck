// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import cn.hutool.json.JSONObject;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;

import static org.assertj.core.api.Assertions.assertThat;

class ToolRegistryIgnoredArgumentsTest {

    @SuppressWarnings("unused")
    public String sample(String color, Boolean bold, String conversationId) { return ""; }

    private static Method sample() throws Exception {
        return ToolRegistryIgnoredArgumentsTest.class.getMethod("sample", String.class, Boolean.class, String.class);
    }

    @Test
    void misnamedArgumentIsReportedWithTheValidNames() throws Exception {
        String note = ToolRegistry.ignoredArgumentsNote(sample(), new JSONObject().set("textColor", "#FF0000").set("bold", true), "{\"success\":true}");
        assertThat(note).contains("textColor").contains("color").contains("bold").doesNotContain("conversationId");
    }

    @Test
    void knownArgumentsServerParamsAndErrorsAddNothing() throws Exception {
        assertThat(ToolRegistry.ignoredArgumentsNote(sample(), new JSONObject().set("color", "#F00").set("conversationId", "x"), "ok")).isEmpty();
        assertThat(ToolRegistry.ignoredArgumentsNote(sample(), new JSONObject().set("textColor", "#F00"), "Error: bad")).isEmpty();
    }
}
