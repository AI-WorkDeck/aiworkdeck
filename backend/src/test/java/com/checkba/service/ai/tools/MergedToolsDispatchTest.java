// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.tools;

import com.checkba.service.ai.EditorBridgeService;
import com.checkba.service.ai.OfficeBridgeService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * tool-system-v2 V4：合并后的新工具各 action 下发的编辑器 / 任务窗格命令逐条钉住，
 * 旧名兼容壳下发同一条命令、回执多一句「已并入 X」；destructive 的删除行列不与插入并名。
 */
class MergedToolsDispatchTest {

    private EditorBridgeService editor;
    private OfficeBridgeService office;
    private DocumentEditTools doc;
    private OfficeEditTools word;

    @BeforeEach
    void setUp() {
        editor = mock(EditorBridgeService.class);
        office = mock(OfficeBridgeService.class);
        when(editor.executeEditorCommand(any(), any())).thenReturn("OK");
        when(office.executeOfficeCommand(any(), any(), anyMap())).thenReturn("OK");
        doc = new DocumentEditTools(null, null, editor, null, null, null, null, null);
        word = new OfficeEditTools(office, new com.fasterxml.jackson.databind.ObjectMapper(), null, null,
                new com.checkba.service.ai.InlineContentCache(), new com.checkba.service.ai.OfficePassStateStore(),
                mock(com.checkba.service.ai.SseEmitterService.class));
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> lastEditorParams(String command) {
        ArgumentCaptor<Map<String, Object>> params = ArgumentCaptor.forClass(Map.class);
        verify(editor, org.mockito.Mockito.atLeastOnce()).executeEditorCommand(eq(command), params.capture());
        return params.getValue();
    }

    @Test
    @DisplayName("doc_revisions：四个 action 分别下发 resolve_revision / resolve_all_revisions；缺 index 与未知 action 报错且不碰桥")
    void docRevisions() {
        assertEquals("OK", doc.doc_revisions("accept", 2));
        assertEquals(Map.of("index", 2, "action", "accept"), lastEditorParams("resolve_revision"));
        assertEquals("OK", doc.doc_revisions("reject_all", null));
        assertEquals(Map.of("action", "reject"), lastEditorParams("resolve_all_revisions"));
        assertTrue(doc.doc_revisions("accept", null).startsWith("Error"));
        assertTrue(doc.doc_revisions("burn", 1).startsWith("Error"));
    }

    @Test
    @DisplayName("旧名壳：同一条命令 + 回执末尾「已并入 doc_revisions」")
    void shimsDelegateAndHint() {
        String out = doc.doc_accept_all_revisions();
        assertTrue(out.startsWith("OK"));
        assertTrue(out.contains("已并入 doc_revisions"), out);
        assertEquals(Map.of("action", "accept"), lastEditorParams("resolve_all_revisions"));
        assertTrue(doc.doc_reject_revision(3).contains("已并入 doc_revisions"));
        assertEquals(Map.of("index", 3, "action", "reject"), lastEditorParams("resolve_revision"));
    }

    @Test
    @DisplayName("doc_update_comment：reply / resolve / reopen 对应 reply_comment / set_comment_resolved")
    void docUpdateComment() {
        doc.doc_update_comment("c1", "reply", "同意");
        assertEquals(Map.of("id", "c1", "text", "同意"), lastEditorParams("reply_comment"));
        doc.doc_update_comment("c1", "reopen", null);
        assertEquals(Map.of("id", "c1", "resolved", false), lastEditorParams("set_comment_resolved"));
        assertTrue(doc.doc_update_comment(" ", "reply", "x").startsWith("Error"));
        assertTrue(doc.doc_update_comment("c1", "delete", null).startsWith("Error"));
        assertTrue(doc.doc_resolve_comment("c1", null).contains("已并入 doc_update_comment"));
    }

    @Test
    @DisplayName("doc_table_insert / doc_table_delete：row 与 col 走各自的 table_* 命令；删除另立且必须给 target")
    void docTableInsertAndDelete() {
        doc.doc_table_insert("row", "3", 2, 0, null);
        assertEquals(Map.of("position", 3, "count", 2, "tableIndex", 0), lastEditorParams("table_add_row"));
        doc.doc_table_insert("col", "B", null, null, null);
        assertEquals(Map.of("position", "B"), lastEditorParams("table_add_col"));
        doc.doc_table_delete("col", "C", null, null, null);
        assertEquals(Map.of("position", "C"), lastEditorParams("table_delete_col"));
        assertTrue(doc.doc_table_delete("row", null, null, null, null).startsWith("Error"));
        assertTrue(doc.doc_table_delete("row", "abc", null, null, null).startsWith("Error"));
        assertTrue(doc.doc_table_insert("diagonal", null, null, null, null).startsWith("Error"));
        // 旧签名（含 position 弃用别名）仍可用
        assertTrue(doc.doc_table_add_row(5, null, null, null, null).contains("已并入 doc_table_insert"));
    }

    @Test
    @DisplayName("doc_select：start/end 走 goto，anchor 走 set_selection，paragraph 走 select_paragraph，collapse 走 collapse_selection")
    void docSelect() {
        doc.doc_select("end", null, null, null);
        assertEquals(Map.of("type", "end", "target", ""), lastEditorParams("goto"));
        doc.doc_select("anchor", "a-1", null, null);
        assertEquals(Map.of("anchor", "a-1"), lastEditorParams("set_selection"));
        doc.doc_select("paragraph", null, 4, 6);
        assertEquals(Map.of("index", 4, "endIndex", 6), lastEditorParams("select_paragraph"));
        doc.doc_select("collapse_start", null, null, null);
        assertEquals(Map.of("to", "start"), lastEditorParams("collapse_selection"));
        assertTrue(doc.doc_select("anchor", null, null, null).startsWith("Error"));
        assertTrue(doc.doc_collapse_cursor("end").contains("已并入 doc_select"));
    }

    @Test
    @DisplayName("doc_insert_note：footnote / endnote 下发 insert_footnote / insert_endnote，缺 text 报错")
    void docInsertNote() {
        doc.doc_insert_note("endnote", "见附件", "a-9");
        assertEquals(Map.of("anchor", "a-9", "text", "见附件"), lastEditorParams("insert_endnote"));
        assertTrue(doc.doc_insert_note("footnote", " ", null).startsWith("Error"));
        assertTrue(doc.doc_insert_note("margin", "x", null).startsWith("Error"));
    }

    @Test
    @DisplayName("office_revisions：accept_all 下发 {all:true}；单条要 revisionIndex")
    void officeRevisions() {
        word.office_revisions("c", "accept_all", null);
        verify(office).executeOfficeCommand(eq("c"), eq("accept_revision"), eq(Map.of("all", true)));
        word.office_revisions("c", "reject", 1);
        verify(office).executeOfficeCommand(eq("c"), eq("reject_revision"), eq(Map.of("all", false, "revisionIndex", 1)));
        assertTrue(word.office_revisions("c", "accept", null).startsWith("Error"));
        assertTrue(word.office_accept_revision("c", null, true).contains("已并入 office_revisions"));
    }

    @Test
    @DisplayName("office_table_insert / office_table_delete：0 基位置；删除必须给 at")
    void officeTable() {
        word.office_table_insert("c", "col", null, null, null);
        verify(office).executeOfficeCommand(eq("c"), eq("table_add_col"),
                eq(Map.of("tableIndex", 0, "position", -1, "count", 1)));
        word.office_table_delete("c", "row", 2, 3, 1);
        verify(office).executeOfficeCommand(eq("c"), eq("table_delete_row"),
                eq(Map.of("tableIndex", 1, "position", 2, "count", 3)));
        assertTrue(word.office_table_delete("c", "row", null, null, null).startsWith("Error"));
        assertTrue(word.office_table_delete_col("c", null, 1, null).contains("已并入 office_table_delete"));
    }

    @Test
    @DisplayName("office_file：create / save / export_pdf 下发 file_*；未知 action 不碰桥")
    void officeFile() {
        word.office_file("c", "create", null, null);
        verify(office).executeOfficeCommand(eq("c"), eq("file_create"), eq(Map.of()));
        word.office_file("c", "export_pdf", null, "a.pdf");
        verify(office).executeOfficeCommand(eq("c"), eq("file_export_pdf"), eq(Map.of("fileName", "a.pdf")));
        assertTrue(word.office_file("c", "export_pdf", null, "../a.pdf").startsWith("Error"));
        assertTrue(word.office_file("c", "burn", null, null).startsWith("Error"));
        assertTrue(word.office_file_save("c").contains("已并入 office_file"));
    }

    @Test
    @DisplayName("office_excel_set_values：整块以 = 开头走 excel_set_formulas，混合内容仍走 excel_set_values")
    void excelFormulasFoldIntoSetValues() {
        word.office_excel_set_values("c", null, "B2", "[[\"=SUM(A1:A3)\"]]", null);
        verify(office).executeOfficeCommand(eq("c"), eq("excel_set_formulas"), anyMap());
        word.office_excel_set_values("c", null, "B2", "[[\"=1+1\",\"合计\"]]", null);
        verify(office).executeOfficeCommand(eq("c"), eq("excel_set_values"), anyMap());
        word.office_excel_update_comment("c", "reply", null, "B2", "已核对");
        verify(office).executeOfficeCommand(eq("c"), eq("excel_reply_comment"), anyMap());
        word.office_excel_update_comment("c", "reopen", null, "B2", null);
        verify(office).executeOfficeCommand(eq("c"), eq("excel_resolve_comment"),
                eq(Map.of("sheetName", "", "cellAddress", "B2", "resolved", false)));
        verify(office, never()).executeOfficeCommand(eq("c"), eq("excel_delete_comment"), anyMap());
    }
}
