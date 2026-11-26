// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.BiFunction;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** 写后核对（gap P5）的触发条件与「每轮最多一次」。 */
class PostWriteCheckTest {

    private static final String BEFORE = doc("第一条 标的：设备。", "第二条 付款：30 日内付款。", "第三条 争议：仲裁。");
    private static final String BROKEN = doc("第一条 标的：设备。", "第二条 付款：45 日内付款。", "第二条 不可抗力：免责。",
            "第三条 争议：仲裁。");
    private static final String CLEAN = doc("第一条 标的：设备。", "第二条 付款：45 日内付款。", "不可抗力：因不可抗力不能履行的，免除责任。",
            "第三条 争议：仲裁。");

    private static String doc(String... texts) {
        StringBuilder sb = new StringBuilder("{\"paragraphs\":[");
        for (int i = 0; i < texts.length; i++) {
            if (i > 0) sb.append(',');
            sb.append("{\"index\":").append(i).append(",\"text\":\"").append(texts[i]).append("\"}");
        }
        return sb.append("],\"truncated\":false}").toString();
    }

    /** 依次返回给定回包，记下调用次数。 */
    private static final class Bridge implements BiFunction<String, Map<String, Object>, String> {
        final List<String> replies;
        final List<String> actions = new ArrayList<>();

        Bridge(String... replies) {
            this.replies = List.of(replies);
        }

        @Override
        public String apply(String action, Map<String, Object> params) {
            actions.add(action);
            return replies.get(Math.min(actions.size() - 1, replies.size() - 1));
        }
    }

    @Test
    void twoWritesWithoutReadBackAreVerifiedOnceAndReportTheNumberingBreak() {
        Bridge bridge = new Bridge(BEFORE, BROKEN);
        PostWriteCheck c = new PostWriteCheck();
        c.beforeTool("doc_replace_at_anchor", 1L, bridge);
        c.afterTool("doc_replace_at_anchor", "{\"newText\":\"45\"}", true);
        c.beforeTool("doc_insert_at_cursor", 1L, bridge);
        c.afterTool("doc_insert_at_cursor", "{\"text\":\"第二条 不可抗力：免责。\"}", true);
        assertEquals(1, bridge.actions.size(), "底稿只在第一次写入前读一次");
        assertTrue(c.due());
        String reminder = c.verify("conv", 1L, bridge);
        assertNotNull(reminder);
        assertTrue(reminder.contains("编号断裂") && reminder.contains("段 2「第二条 不可抗力"), reminder);
        assertFalse(c.due(), "每轮最多一次");
        assertEquals(List.of("get_document_text", "get_document_text"), bridge.actions);
    }

    @Test
    void cleanResultIsSilent() {
        Bridge bridge = new Bridge(BEFORE, CLEAN);
        PostWriteCheck c = new PostWriteCheck();
        c.beforeTool("doc_replace_at_anchor", 1L, bridge);
        c.afterTool("doc_replace_at_anchor", "{}", true);
        c.afterTool("doc_insert_at_cursor", "{\"text\":\"不可抗力\",\"newParagraph\":true}", true);
        assertTrue(c.due());
        assertNull(c.verify("conv", 1L, bridge));
    }

    @Test
    void singleNonStructuralEditIsNotDueButAStructuralOneIs() {
        Bridge bridge = new Bridge(BEFORE);
        PostWriteCheck single = new PostWriteCheck();
        single.beforeTool("doc_replace_at_anchor", 1L, bridge);
        single.afterTool("doc_replace_at_anchor", "{\"newText\":\"45\"}", true);
        assertFalse(single.due());

        PostWriteCheck structural = new PostWriteCheck();
        structural.beforeTool("doc_insert_at_cursor", 1L, bridge);
        structural.afterTool("doc_insert_at_cursor", "{\"text\":\"x\",\"newParagraph\":\"true\"}", true);
        assertTrue(structural.due());
    }

    @Test
    void modelReadBackAfterLastWriteMeansNoHarnessCheck() {
        Bridge bridge = new Bridge(BEFORE);
        PostWriteCheck c = new PostWriteCheck();
        c.beforeTool("doc_find_replace", 1L, bridge);
        c.afterTool("doc_find_replace", "{}", true);
        c.afterTool("doc_find_replace", "{}", true);
        c.afterTool("doc_get_paragraph", "{}", true);
        assertFalse(c.due());
        c.afterTool("doc_modify_paragraph", "{\"newText\":\"y\"}", true);
        assertTrue(c.due(), "回读之后又写了一次，最后一次写入之后没读");
    }

    @Test
    void structuralWriteIsCheckedEvenAfterModelReadBack() {
        Bridge bridge = new Bridge(BEFORE);
        PostWriteCheck c = new PostWriteCheck();
        c.beforeTool("doc_insert_at_cursor", 1L, bridge);
        c.afterTool("doc_insert_at_cursor", "{\"newParagraph\":true}", true);
        c.afterTool("doc_get_document_text", "{}", true);
        assertTrue(c.due(), "插入新段落后模型回读过也要系统核对（模型回读常看不出条号重复）");
    }

    @Test
    void failedWritesAndFormattingDoNotCount() {
        Bridge bridge = new Bridge(BEFORE);
        PostWriteCheck c = new PostWriteCheck();
        c.beforeTool("doc_format_selection", 1L, bridge);
        assertTrue(bridge.actions.isEmpty(), "格式类不改文字，不读底稿");
        c.beforeTool("doc_replace_at_anchor", 1L, bridge);
        c.afterTool("doc_replace_at_anchor", "{}", false);
        c.afterTool("doc_format_selection", "{}", true);
        c.afterTool("doc_add_comment", "{}", true);
        c.afterTool("doc_replace_at_anchor", "{}", true);
        assertFalse(c.due());
    }

    @Test
    void unreadableBaselineOrSwitchedDocumentNeverReports() {
        Bridge broken = new Bridge("{\"error\":\"EDITOR_BOOTING\"}", BROKEN);
        PostWriteCheck noBaseline = new PostWriteCheck();
        noBaseline.beforeTool("doc_insert_under_heading", 1L, broken);
        noBaseline.afterTool("doc_insert_under_heading", "{}", true);
        assertFalse(noBaseline.due());

        Bridge bridge = new Bridge(BEFORE, BROKEN);
        PostWriteCheck switched = new PostWriteCheck();
        switched.beforeTool("doc_delete_selection", 1L, bridge);
        switched.afterTool("doc_delete_selection", "{}", true);
        assertTrue(switched.due());
        assertNull(switched.verify("conv", 2L, bridge));
        assertEquals(1, bridge.actions.size(), "换了文档就不再回读");

        Bridge afterFails = new Bridge(BEFORE, "{\"error\":\"timeout\"}");
        PostWriteCheck unavailable = new PostWriteCheck();
        unavailable.beforeTool("doc_delete_selection", 1L, afterFails);
        unavailable.afterTool("doc_delete_selection", "{}", true);
        assertNull(unavailable.verify("conv", 1L, afterFails));
    }

    @Test
    void structuralWritesAreRecognised() {
        assertTrue(PostWriteCheck.isStructural("doc_insert_at_cursor", "{\"text\":\"a\\nb\"}"));
        assertFalse(PostWriteCheck.isStructural("doc_insert_at_cursor", "{\"text\":\"ab\\n\"}"));
        assertTrue(PostWriteCheck.isStructural("doc_modify_paragraph", "{\"paragraphIndex\":3,\"newText\":\"\"}"));
        assertFalse(PostWriteCheck.isStructural("doc_modify_paragraph", "{\"paragraphIndex\":3,\"newText\":\"x\"}"));
        assertTrue(PostWriteCheck.isStructural("doc_delete_selection", null));
        assertFalse(PostWriteCheck.isStructural("doc_replace_at_anchor", "not json"));
    }

    @Test
    void reminderIsBilingual() {
        String en = com.checkba.service.AppLanguageScope.call("en", () -> PostWriteCheck.reminder(List.of(
                new com.checkba.service.ai.review.PostWriteAudit.Issue(
                        com.checkba.service.ai.review.PostWriteAudit.Kind.DUPLICATE, 4, "abc", "dup"))));
        assertTrue(en.startsWith("[System reminder]") && en.contains("paragraph 4") && en.contains("duplicate"), en);
    }

    // ---- Q26: clause numbering at the end of the turn (finished or stopped) ----

    private static final String Q26_BEFORE = doc("第十二条 争议：仲裁。", "第十三条 不可抗力：免责。", "第十四条 生效：签字生效。");
    private static final String Q26_DUPLICATE = doc("第十二条 争议：仲裁。", "第十三条 网络安全责任保险：乙方投保。",
            "第十三条 不可抗力：免责。", "第十四条 生效：签字生效。");
    private static final String Q26_RENUMBERED = doc("第十二条 争议：仲裁。", "第十三条 网络安全责任保险：乙方投保。",
            "第十四条 不可抗力：免责。", "第十五条 生效：签字生效。");

    @Test
    void writingAClauseLabelIsStructural() {
        assertTrue(PostWriteCheck.isStructural("doc_replace_at_anchor", "{\"newText\":\"第十三条 网络安全责任保险\"}"));
        assertTrue(PostWriteCheck.isStructural("doc_insert_at_cursor", "{\"text\":\"第13条 保险\"}"));
        assertTrue(PostWriteCheck.isStructural("doc_find_replace", "{\"findText\":\"x\",\"replaceText\":\"第五條\"}"));
        assertFalse(PostWriteCheck.isStructural("doc_replace_at_anchor", "{\"newText\":\"三十日内付款\"}"));
        assertFalse(PostWriteCheck.isStructural("doc_format_text", "{\"text\":\"第十三条\"}"), "formatting is not a text write");
    }

    @Test
    void stoppedAfterInsertingADuplicateClauseTellsTheUser() {
        // The QA run: the AI inserted a second 第十三条, the user pressed stop before the turn could finish.
        Bridge bridge = new Bridge(Q26_BEFORE, Q26_DUPLICATE);
        PostWriteCheck c = new PostWriteCheck();
        c.beforeTool("doc_insert_at_cursor", 1L, bridge);
        c.afterTool("doc_insert_at_cursor", "{\"text\":\"第十三条 网络安全责任保险：乙方投保。\"}", true);
        String notice = c.numberingNotice("conv", 1L, bridge);
        assertNotNull(notice);
        assertTrue(notice.contains("条款编号需要核对") && notice.contains("第13条重复出现"), notice);
        assertTrue(notice.contains("AI 没有自动改号"), notice);
        assertNull(c.numberingNotice("conv", 1L, bridge), "at most once per turn");
        assertEquals(2, bridge.actions.size());
    }

    @Test
    void renumberedClausesNeedNoNotice() {
        Bridge bridge = new Bridge(Q26_BEFORE, Q26_RENUMBERED);
        PostWriteCheck c = new PostWriteCheck();
        c.beforeTool("doc_insert_at_cursor", 1L, bridge);
        c.afterTool("doc_insert_at_cursor", "{\"text\":\"第十三条 网络安全责任保险：乙方投保。\"}", true);
        assertNull(c.numberingNotice("conv", 1L, bridge));
    }

    @Test
    void reminderWasIgnoredSoTheFinalNoticeReportsIt() {
        Bridge bridge = new Bridge(Q26_BEFORE, Q26_DUPLICATE, Q26_DUPLICATE);
        PostWriteCheck c = new PostWriteCheck();
        c.beforeTool("doc_insert_at_cursor", 1L, bridge);
        c.afterTool("doc_insert_at_cursor", "{\"text\":\"第十三条 网络安全责任保险：乙方投保。\"}", true);
        assertNotNull(c.verify("conv", 1L, bridge), "hidden reminder to the model first");
        assertNotNull(c.numberingNotice("conv", 1L, bridge), "still broken at the end: tell the user");
    }

    @Test
    void cleanVerifyWithNoLaterWritesSkipsTheExtraRead() {
        Bridge bridge = new Bridge(Q26_BEFORE, Q26_RENUMBERED);
        PostWriteCheck c = new PostWriteCheck();
        c.beforeTool("doc_insert_at_cursor", 1L, bridge);
        c.afterTool("doc_insert_at_cursor", "{\"text\":\"第十三条 网络安全责任保险：乙方投保。\"}", true);
        assertNull(c.verify("conv", 1L, bridge));
        assertNull(c.numberingNotice("conv", 1L, bridge));
        assertEquals(2, bridge.actions.size(), "no third read");
    }

    @Test
    void ordinaryEditsAndOtherDocumentsGetNoNumberingCheck() {
        Bridge bridge = new Bridge(BEFORE, BROKEN);
        PostWriteCheck c = new PostWriteCheck();
        c.beforeTool("doc_replace_at_anchor", 1L, bridge);
        c.afterTool("doc_replace_at_anchor", "{\"newText\":\"45\"}", true);
        assertNull(c.numberingNotice("conv", 1L, bridge), "one plain edit, never verified: no check");
        assertEquals(1, bridge.actions.size());

        Bridge other = new Bridge(Q26_BEFORE, Q26_DUPLICATE);
        PostWriteCheck d = new PostWriteCheck();
        d.beforeTool("doc_insert_at_cursor", 1L, other);
        d.afterTool("doc_insert_at_cursor", "{\"text\":\"第十三条 保险\"}", true);
        assertNull(d.numberingNotice("conv", 2L, other), "switched document: never report");
    }
}
