// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import com.checkba.service.ai.harness.VerificationHarness;
import com.checkba.service.ai.subagent.SubAgentResult;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** W6：收尾核验「有依据」必须引用核验员实际读过的底稿，服务端校验。 */
class OpinionVerifierGroundingTest {

    private static final List<OpinionCompletionCheck.ManifestEntry> MANIFEST = List.of(
            new OpinionCompletionCheck.ManifestEntry(55, "01-公司基本情况/验资报告.docx"),
            new OpinionCompletionCheck.ManifestEntry(58, "02-重大合同/银团贷款合同.docx"));

    private static SubAgentResult verifier(String text, List<String> tools, List<Long> read) {
        return SubAgentResult.success("sub", text, tools, 2).withFilesRead(read);
    }

    private static VerificationHarness.VerificationReport report(SubAgentResult r) {
        return new VerificationHarness().buildReport("legal-opinion-review", null, 1L, "意见书.docx", r);
    }

    @Test
    @DisplayName("引用了实际读过的底稿（按 ID 或文件名）：有依据保留")
    void supportedCitingAReadSourceStays() {
        String text = "1. 【段 12】净资产折股 5.2867:1\n- 来源：验资报告.docx（55）引文「按 5.2867:1 折股」\n- 整句判定：有依据\n"
                + "2. 【段 20】银团贷款 3.5 亿\n- 来源：fileId=58「贷款总额人民币叁亿伍仟万元」\n- 整句判定：有依据";
        SubAgentResult r = verifier(text, List.of("extract_file_text"), List.of(55L, 58L));
        assertSame(r, OpinionCompletionCheck.validateVerifierResult(r, MANIFEST));
        assertEquals(2, report(r).supportedCount());
    }

    @Test
    @DisplayName("回归：调一次工具后编「有依据」——引用没读过的文件、只引当前稿段号的，一律改判待核实")
    void supportedCitingUnreadOrDraftOnlyIsDowngraded() {
        String text = "1. 【段 20】银团贷款 3.5 亿\n- 来源：fileId=58「贷款总额」\n- 整句判定：有依据\n"
                + "2. 【段 31】未决诉讼已披露完毕\n- 来源：当前稿第 31 段\n- 整句判定：有依据";
        SubAgentResult r = verifier(text, List.of("doc_list_project_files"), List.of());
        SubAgentResult checked = OpinionCompletionCheck.validateVerifierResult(r, MANIFEST);
        assertTrue(checked.success());
        assertFalse(checked.result().contains("整句判定：有依据"), checked.result());
        assertTrue(checked.result().contains("所引来源未经核验员实际读取"), checked.result());
        VerificationHarness.VerificationReport rep = report(checked);
        assertEquals(0, rep.supportedCount(), "编出来的有依据不能计入");
        assertEquals(2, rep.unverifiedCount());
    }

    @Test
    @DisplayName("回归：一次工具都没调——核验失败，卡片 UNVERIFIED")
    void consultedNothingFails() {
        SubAgentResult r = verifier("1. 委托人为[委托人名称]\n- 整句判定：待核实", List.of(), List.of());
        SubAgentResult checked = OpinionCompletionCheck.validateVerifierResult(r, MANIFEST);
        assertFalse(checked.success());
        assertEquals(VerificationHarness.STATUS_UNVERIFIED, report(checked).status());
    }

    @Test
    @DisplayName("读过 A 却拿 B 当依据：只降那一条")
    void onlyTheUngroundedPropositionIsDowngraded() {
        String text = "1. 折股比例\n- 来源：验资报告.docx「5.2867:1」\n- 整句判定：有依据\n"
                + "2. 贷款金额\n- 来源：银团贷款合同.docx「3.5 亿」\n- 整句判定：有依据";
        SubAgentResult checked = OpinionCompletionCheck.validateVerifierResult(
                verifier(text, List.of("extract_file_text"), List.of(55L)), MANIFEST);
        VerificationHarness.VerificationReport rep = report(checked);
        assertEquals(1, rep.supportedCount());
        assertEquals(1, rep.unverifiedCount());
    }
}
