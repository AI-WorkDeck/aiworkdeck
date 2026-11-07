// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.tools;

import com.checkba.service.legal.PkulawChannel;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** 法宝上游报错（Unknown tool 等）要换成明确的「法源暂时不可用」说明，而参数校验错误仍原样回给模型。 */
class LegalToolsVendorFailureTest {

    private static LegalTools toolsReturning(String upstream) {
        PkulawChannel channel = mock(PkulawChannel.class);
        when(channel.callTool(any(), any(), any())).thenReturn(upstream);
        return new LegalTools(null, channel, null);
    }

    @Test
    void upstreamUnknownToolBecomesVendorUnavailableMessage() {
        String out = toolsReturning("Error from MCP server: Unknown tool: get_article")
                .get_law_article("中华人民共和国民法典", "1082");

        assertTrue(out.startsWith("Error"), "必须判为失败：" + out);
        assertTrue(LegalTools.isVendorUnavailable(out), out);
        assertTrue(out.contains("Unknown tool: get_article"), "原因原文要保留：" + out);
        assertTrue(out.contains("flk.npc.gov.cn"), out);
        assertTrue(out.contains("待核实"), out);
    }

    @Test
    void validationErrorAndSuccessPassThroughUnchanged() {
        String validation = "Error from MCP server: 1 validation error for call[search_article] text Missing";
        assertEquals(validation, toolsReturning(validation).law_search("x"));
        assertEquals("第一千零八十二条 ...", toolsReturning("第一千零八十二条 ...").law_search("x"));
        assertFalse(LegalTools.isVendorUnavailable("第一千零八十二条 ..."));
    }

    @Test
    void pkulawToolsAreExposedForRunLevelDisable() {
        assertTrue(LegalTools.pkulawToolNames().containsAll(
                java.util.Set.of("law_search", "get_law_article", "case_search")));
    }
}
