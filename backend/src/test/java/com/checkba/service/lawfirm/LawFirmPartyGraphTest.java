// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.lawfirm;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.*;

class LawFirmPartyGraphTest {

    private static LawFirmPartyGraph.Node node(long id, String name, boolean client) {
        return new LawFirmPartyGraph.Node(id, name, null, client, client ? "KH-" + id : null, null, null);
    }

    private static LawFirmPartyGraph.Edge edge(long id, long from, long to, String type, Integer bps) {
        return new LawFirmPartyGraph.Edge(id, from, to, type, bps, null);
    }

    private static Map<String, Integer> depthByName(List<LawFirmPartyGraph.Reach> reach) {
        return reach.stream().collect(Collectors.toMap(r -> r.node().name(), LawFirmPartyGraph.Reach::depth));
    }

    @Test
    @DisplayName("多层股权链：向上推导间接股东并相乘持股比例，向下推导子公司及孙公司")
    void derivesIndirectChain() {
        // 张三 -60%-> 甲控股 -50%-> 乙公司 -100%-> 丙公司；丁 是 乙公司 的实际控制人
        LawFirmPartyGraph g = new LawFirmPartyGraph(
                List.of(node(1, "张三", false), node(2, "甲控股", false), node(3, "乙公司", true), node(4, "丙公司", false), node(5, "丁", false)),
                List.of(edge(1, 1, 2, "SHAREHOLDER", 6000), edge(2, 2, 3, "SHAREHOLDER", 5000),
                        edge(3, 3, 4, "SHAREHOLDER", 10000), edge(4, 5, 3, "ACTUAL_CONTROLLER", null)));

        List<LawFirmPartyGraph.Reach> up = g.equityChain(3L, true, LawFirmPartyGraph.CHAIN_DEPTH);
        assertEquals(Map.of("甲控股", 1, "丁", 1, "张三", 2), depthByName(up));
        LawFirmPartyGraph.Reach zhang = up.stream().filter(r -> r.node().name().equals("张三")).findFirst().orElseThrow();
        assertEquals(3000, LawFirmPartyGraph.effectiveBps(zhang.steps()), "60% × 50% = 30%");
        assertEquals("张三持有甲控股 60% 股权；甲控股持有乙公司 50% 股权", g.describe(zhang.steps()));
        LawFirmPartyGraph.Reach ding = up.stream().filter(r -> r.node().name().equals("丁")).findFirst().orElseThrow();
        assertNull(LawFirmPartyGraph.effectiveBps(ding.steps()), "控制关系没有持股比例");

        assertEquals(Map.of("丙公司", 1), depthByName(g.equityChain(3L, false, LawFirmPartyGraph.CHAIN_DEPTH)));
        assertEquals(Map.of("甲控股", 1, "乙公司", 2, "丙公司", 3), depthByName(g.equityChain(1L, false, LawFirmPartyGraph.CHAIN_DEPTH)));
        assertEquals(Map.of("甲控股", 1), depthByName(g.equityChain(1L, false, 1)), "深度封顶");
    }

    @Test
    @DisplayName("交叉持股成环：遍历终止，每个主体只出现一次")
    void cyclesTerminate() {
        LawFirmPartyGraph g = new LawFirmPartyGraph(
                List.of(node(1, "A", true), node(2, "B", false), node(3, "C", false)),
                List.of(edge(1, 1, 2, "SHAREHOLDER", 3000), edge(2, 2, 3, "SHAREHOLDER", 3000),
                        edge(3, 3, 1, "SHAREHOLDER", 3000), edge(4, 2, 1, "SHAREHOLDER", 1000)));
        assertEquals(Map.of("B", 1, "C", 1), depthByName(g.equityChain(1L, true, 50)));
        assertEquals(Map.of("B", 1, "C", 2), depthByName(g.equityChain(1L, false, 50)));
        assertEquals(Map.of("B", 1, "C", 1), depthByName(g.reach(1L, 50)));
    }

    @Test
    @DisplayName("大环与长链：节点封顶，不会无限展开")
    void largeGraphIsCapped() {
        List<LawFirmPartyGraph.Node> nodes = new ArrayList<>();
        List<LawFirmPartyGraph.Edge> edges = new ArrayList<>();
        for (long i = 1; i <= 2000; i++) {
            nodes.add(node(i, "N" + i, false));
            edges.add(edge(i, i, i == 2000 ? 1 : i + 1, "SHAREHOLDER", 5000));
        }
        LawFirmPartyGraph g = new LawFirmPartyGraph(nodes, edges);
        assertTrue(g.equityChain(1L, false, 10_000).size() < LawFirmPartyGraph.MAX_NODES);
    }

    @Test
    @DisplayName("利冲关联范围：集团/家庭关系可连续穿过；供应商、担保只认直接一跳，不再往外扩")
    void conflictReachRules() {
        // 王五 配偶 赵六；赵六 实际控制 客户甲；客户甲 的供应商 是 供应商乙；供应商乙 的股东 是 丙
        LawFirmPartyGraph g = new LawFirmPartyGraph(
                List.of(node(1, "王五", false), node(2, "赵六", false), node(3, "客户甲", true), node(4, "供应商乙", false), node(5, "丙", false)),
                List.of(edge(1, 1, 2, "SPOUSE", null), edge(2, 2, 3, "ACTUAL_CONTROLLER", null),
                        edge(3, 4, 3, "SUPPLIER", null), edge(4, 5, 4, "SHAREHOLDER", 10000)));
        Map<String, Integer> fromWang = depthByName(g.reach(1L, LawFirmPartyGraph.CONFLICT_DEPTH));
        assertEquals(Map.of("赵六", 1, "客户甲", 2), fromWang, "经配偶、实际控制人连到客户；不越过供应商关系");
        assertEquals(1, depthByName(g.reach(4L, LawFirmPartyGraph.CONFLICT_DEPTH)).get("客户甲"), "供应商与客户是直接一跳");
        assertFalse(depthByName(g.reach(5L, LawFirmPartyGraph.CONFLICT_DEPTH)).containsKey("客户甲"),
                "供应商的股东不经供应商关系连到客户");
        assertEquals(1, g.match("王五", null).size());
        assertTrue(g.match("", "").isEmpty());
    }
}
