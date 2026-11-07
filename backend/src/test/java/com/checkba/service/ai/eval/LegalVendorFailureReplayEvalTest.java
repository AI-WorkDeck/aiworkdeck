// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.eval;

import com.checkba.service.ai.tools.LegalTools;
import com.checkba.service.legal.PkulawChannel;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 回放「民法典第1082条」事故：法宝上游对 get_article 回 "Unknown tool"。
 * 接入 Harness（用空扰动器触发接线），断言：不展开 [mcp]、不出 ask_user 护栏、
 * 模型拿到的是「法源暂时不可用」说明，且其余法宝工具本轮不再下发。
 */
@DisplayName("法宝上游失败回放（Unknown tool）")
class LegalVendorFailureReplayEvalTest {

    @Test
    void vendorUnknownToolDoesNotTriggerMcpExpansionOrAskUserGuard() {
        PkulawChannel channel = mock(PkulawChannel.class);
        when(channel.callTool(any(), any(), any()))
                .thenReturn("Error from MCP server: Unknown tool: get_article");
        // 真实 LegalTools 的输出作为桩：验的是「上游错误 → 模型所见文本」这一整条
        String vendorOutput = new LegalTools(null, channel, null)
                .get_law_article("中华人民共和国民法典", "1082");

        EvalCase c = new EvalCase();
        c.id = "legal-vendor-unknown-tool";
        c.title = "get_article 上游 Unknown tool：给明确说明，不误触发 [mcp] 展开与 ask_user 护栏";
        c.mode = "AGENT";
        c.userInput = "民法典第1082条是什么";
        c.toolStubs = Map.of("get_law_article", vendorOutput);

        EvalCase.Turn t1 = new EvalCase.Turn();
        t1.text = "<tool_code>get_law_article(title=\"中华人民共和国民法典\", number=\"1082\")</tool_code>";
        EvalCase.Turn t2 = new EvalCase.Turn();
        t2.text = "<final>法宝暂时不可用，以下仅供线索（非权威来源，待核实）。</final>";
        c.turns = List.of(t1, t2);

        EvalHarness.RunResult r = EvalHarness.run(c, new EnvPerturbation() {
            @Override
            public Dimension dimension() {
                return Dimension.RULE;
            }

            @Override
            public String description() {
                return "wire harness only";
            }
        });

        assertEquals(0, r.remainingScriptTurns());
        assertTrue(r.errorEvents().isEmpty(), "" + r.errorEvents());
        assertEquals(List.of("get_law_article"),
                r.dispatches().stream().map(RecordingToolRegistry.Dispatch::resolvedName).toList());
        for (EvalHarness.SseEvent e : r.events("harness_adaptation")) {
            assertFalse(e.data().contains("EXPAND_TOOL_CATEGORY"), "不应展开类目：" + e.data());
            assertFalse(e.data().contains("CLARIFY_WITH_USER"), "不应出现 ask_user 护栏：" + e.data());
        }
        assertTrue(r.promptTexts().stream().noneMatch(p -> p.contains("展开工具类目 [mcp]")), "不应有 [mcp] 展开文案");
        assertTrue(r.promptTexts().stream().noneMatch(p -> p.contains("Harness 领域护栏")), "不应有护栏文案");
        assertTrue(r.promptTexts().stream().anyMatch(p -> p.contains("北大法宝法源暂时不可用")),
                "模型应收到法源不可用说明");
        // 其余法宝工具本轮下线
        List<String> round2 = r.toolNamesOfferedPerLlmCall().get(1);
        assertFalse(round2.contains("law_search"), round2.toString());
        assertFalse(round2.contains("get_law_article"), round2.toString());
    }
}
