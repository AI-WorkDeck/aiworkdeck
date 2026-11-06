// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.tools;

import com.checkba.service.ai.EditorBridgeService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** doc_replace_selection 的 expectedText 必须原样下发给 worker（核对在 worker 同一条命令里完成）。 */
class DocumentEditToolsReplaceSelectionTest {

    @SuppressWarnings("unchecked")
    private static Map<String, Object> run(String text, String expected) {
        EditorBridgeService bridge = Mockito.mock(EditorBridgeService.class);
        when(bridge.executeEditorCommand(eq("replace_selection"), Mockito.anyMap())).thenReturn("{\"success\":true}");
        new DocumentEditTools(null, null, bridge, null, null, null, null, null).doc_replace_selection(text, expected);
        ArgumentCaptor<Map<String, Object>> params = ArgumentCaptor.forClass(Map.class);
        verify(bridge).executeEditorCommand(eq("replace_selection"), params.capture());
        return params.getValue();
    }

    @Test
    @DisplayName("传 expectedText 时随命令下发")
    void forwardsExpectedText() {
        Map<String, Object> p = run("新文本", "旧文本");
        assertEquals("新文本", p.get("text"));
        assertEquals("旧文本", p.get("expectedText"));
    }

    @Test
    @DisplayName("不传或为空时不下发 expectedText，保持存量行为")
    void omitsBlankExpectedText() {
        assertFalse(run("新文本", null).containsKey("expectedText"));
        assertFalse(run("新文本", "").containsKey("expectedText"));
    }
}
