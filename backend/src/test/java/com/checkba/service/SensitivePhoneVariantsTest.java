// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service;

import com.checkba.service.sensitive.SensitiveTextEngine;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class SensitivePhoneVariantsTest {
    @ParameterizedTest
    @ValueSource(strings = {"138 0000 1111", "138-0000-1111", "１３８００００１１１１", "１３８　００００　１１１１"})
    void commonPhoneFormattingIsRedactedAndRestoredExactly(String phone) {
        String text = "手机号：" + phone + "；备注：已联系";
        for (boolean reversible : List.of(true, false)) {
            var engine = new SensitiveTextEngine(List.of("PHONE"), reversible, List.of(), List.of());
            String output = engine.apply(text);
            assertFalse(output.contains(phone), output);
            assertEquals(1, engine.counts().get("PHONE"));
            assertTrue(output.startsWith("手机号：")); assertTrue(output.endsWith("；备注：已联系"));
            if (reversible) assertEquals(text, SensitiveTextEngine.apply(output,
                    SensitiveTextEngine.restoreEdits(output, engine.recovery())));
            else assertTrue(output.contains("****"), output);
        }
    }
    @ParameterizedTest
    @ValueSource(strings = {"订单号：９９１３８００００１１１１９９", "订单号：99138 0000 111199",
            "两行数值：138\n0000\n1111", "不完整号码：138 000 1111", "年份区间：138-0000-111"})
    void doesNotJoinLinesOrCutLongerNumbers(String text) {
        var engine = new SensitiveTextEngine(List.of("PHONE"), true, List.of(), List.of());
        assertEquals(text, engine.apply(text));
    }
}
