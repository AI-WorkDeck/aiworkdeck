// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import com.checkba.service.ai.tools.LegalTools;
import com.checkba.service.legal.PkulawChannel;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class LawSourceDownPolicyTest {

    private static final String DOWN = "Error: " + LegalTools.VENDOR_UNAVAILABLE_MARKER + " 北大法宝法源暂时不可用";

    @Test
    void webLookupsAreUnlimitedUntilTheSourceGoesDown() {
        LawSourceDownPolicy p = new LawSourceDownPolicy();
        for (int i = 0; i < 5; i++) {
            assertNull(p.admit("search_web"));
            assertNull(p.lookupNotice("search_web"));
        }
        p.noteResult("{\"ok\":true}");
        assertFalse(p.isDown());
        assertNull(p.finalAnswerReminder("民法典第1082条规定……"));
    }

    @Test
    void afterSourceDownOnlyTwoWebLookupsRunThenEveryFurtherOneIsRefused() {
        LawSourceDownPolicy p = new LawSourceDownPolicy();
        p.noteResult(DOWN);
        assertTrue(p.isDown());
        assertNull(p.admit("search_web"));
        assertTrue(p.lookupNotice("search_web").contains("1/2"));
        assertFalse(p.lookupsExhausted());
        assertNull(p.admit("browse_url"));
        assertTrue(p.lookupNotice("browse_url").contains("2/2"));
        assertTrue(p.lookupsExhausted());
        String refused = p.admit("search_web");
        assertNotNull(refused);
        assertTrue(refused.contains("已用满 2 次") && refused.contains("未核实"), refused);
        assertNotNull(p.admit("browse_url"));
        // 其他工具不受影响
        assertNull(p.admit("extract_file_text"));
        assertNull(p.lookupNotice("extract_file_text"));
    }

    @Test
    void finalReminderFiresOnceForUnmarkedOrSelfVerifiedStatuteText() {
        LawSourceDownPolicy p = new LawSourceDownPolicy();
        p.noteResult(DOWN);
        assertNotNull(p.finalAnswerReminder("《民法典》第1082条规定：女方在怀孕期间，男方不得提出离婚。"));
        assertNull(p.finalAnswerReminder("《民法典》第1082条规定：……"), "每轮最多一次");

        LawSourceDownPolicy claims = new LawSourceDownPolicy();
        claims.noteResult(DOWN);
        String r = claims.finalAnswerReminder("第一千零八十二条……（非权威来源，待核实）。以上条文均已核实。");
        assertNotNull(r, "带标注但又自称已核实，仍要提醒");
        assertTrue(r.contains("已核实"), r);

        LawSourceDownPolicy en = new LawSourceDownPolicy();
        en.noteResult(DOWN);
        assertNotNull(en.finalAnswerReminder("Article 1082 provides that the husband may not file for divorce..."));
    }

    @Test
    void noReminderWhenMarkedOrWhenNoStatuteIsCited() {
        LawSourceDownPolicy p = new LawSourceDownPolicy();
        p.noteResult(DOWN);
        assertNull(p.finalAnswerReminder("第1082条的内容来自网页，未核实，请以官方原文为准。"));
        assertNull(p.finalAnswerReminder("Article 1082 (unverified: PKULaw was unavailable)."));
        assertNull(p.finalAnswerReminder("法宝暂时不可用，暂时无法给出条文内容。"));
        // 否定式「不得声称已核实」不是自称已核实；「无法从权威来源取得」本身就是未核实标注（t09/s12 实测误触发）
        assertNull(p.finalAnswerReminder("无法从权威来源获取民法典第1082条原文，按规定不得声称已核实。"));
        // 上面几次都没触发，置位还在：真正需要时仍能提醒一次
        assertNotNull(p.finalAnswerReminder("第1082条规定男方不得提出离婚。"));
    }

    @Test
    void vendorUnavailableToolTextStatesTheSameBudgetAsTheServerEnforces() {
        PkulawChannel channel = mock(PkulawChannel.class);
        when(channel.callTool(any(), any(), any())).thenReturn("Error from MCP server: Unknown tool: get_article");
        String out = new LegalTools(null, channel, null).get_law_article("中华人民共和国民法典", "1082");
        assertTrue(LegalTools.isVendorUnavailable(out), out);
        assertTrue(out.contains("共 " + LawSourceDownPolicy.MAX_WEB_LOOKUPS_AFTER_DOWN + " 次")
                || out.contains("at most " + LawSourceDownPolicy.MAX_WEB_LOOKUPS_AFTER_DOWN + " more times"), out);
        assertTrue(out.contains("未核实") || out.contains("unverified"), out);
    }
}
