// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import dev.langchain4j.agent.tool.ToolSpecification;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** 稳定前缀：已下发的工具保持首次顺序，新增的排序后追加在末尾，上一轮数组是这一轮的前缀。 */
class AgentOrchestratorStableToolOrderTest {

    private static List<ToolSpecification> specs(String... names) {
        return java.util.Arrays.stream(names).map(n -> ToolSpecification.builder().name(n).description(n).build()).toList();
    }

    private static List<String> names(List<ToolSpecification> l) {
        return l.stream().map(ToolSpecification::name).toList();
    }

    @Test
    void newToolsAreAppendedAndPreviousRoundIsAPrefix() {
        AgentOrchestrator.RunGuard guard = new AgentOrchestrator.RunGuard("c", "r", 0L);
        List<String> r1 = names(AgentOrchestrator.stableToolOrder(specs("zeta", "alpha", "list_tools"), guard));
        assertEquals(List.of("alpha", "list_tools", "zeta"), r1);
        // 第 2 轮：候选集输入顺序变了，还多了两个新工具
        List<String> r2 = names(AgentOrchestrator.stableToolOrder(specs("task_b", "zeta", "list_tools", "alpha", "task_a"), guard));
        assertEquals(List.of("alpha", "list_tools", "zeta", "task_a", "task_b"), r2);
        assertTrue(r2.subList(0, r1.size()).equals(r1));
    }

    @Test
    void removedToolKeepsRemainingOrderAndReturnsAtItsOldSlot() {
        AgentOrchestrator.RunGuard guard = new AgentOrchestrator.RunGuard("c", "r", 0L);
        AgentOrchestrator.stableToolOrder(specs("a", "b", "c"), guard);
        assertEquals(List.of("a", "c"), names(AgentOrchestrator.stableToolOrder(specs("c", "a"), guard)));
        assertEquals(List.of("a", "b", "c"), names(AgentOrchestrator.stableToolOrder(specs("c", "b", "a"), guard)));
    }
}
