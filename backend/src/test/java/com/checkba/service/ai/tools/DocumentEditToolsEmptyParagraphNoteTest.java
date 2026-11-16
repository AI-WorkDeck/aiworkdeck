// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.tools;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** g16「删除第三条」回放：整段标删后回执为空段落，必须带「完成、勿再清理空段落」的说明。 */
class DocumentEditToolsEmptyParagraphNoteTest {

    @Test
    @DisplayName("整段删除回执（paragraphAfterEdit 为空）追加完成说明且仍是合法 JSON 尾")
    void emptyParagraphGetsNote() {
        String out = DocumentEditTools.withEmptyParagraphNote(
                "{\"success\":true,\"paragraphAfterEdit\":\"\",\"paragraphAfterEditLength\":0}");
        assertTrue(out.endsWith("\"}"), out);
        assertTrue(out.contains("\"note\":\"") && out.contains("不要再查找"), out);
    }

    @Test
    @DisplayName("非空回执与错误串原样返回")
    void otherResultsUntouched() {
        String ok = "{\"success\":true,\"paragraphAfterEdit\":\"x\"}";
        assertEquals(ok, DocumentEditTools.withEmptyParagraphNote(ok));
        assertEquals("Error: boom", DocumentEditTools.withEmptyParagraphNote("Error: boom"));
        assertEquals(null, DocumentEditTools.withEmptyParagraphNote(null));
    }
}
