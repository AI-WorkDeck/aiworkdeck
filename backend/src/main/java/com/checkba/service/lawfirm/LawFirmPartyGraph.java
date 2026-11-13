// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.lawfirm;

import com.checkba.service.LangText;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 主体关系图（内存快照，无 Spring 依赖）。节点是 {@code LawFirmParty}，边是 {@code LawFirmPartyRelation}。
 * <ul>
 *   <li>{@link #equityChain}：沿股权/控制边单向推导间接股东（向上）或子公司（向下），给出链路与穿透持股比例；</li>
 *   <li>{@link #reach}：利冲用的关联范围——无向遍历「同一集团/家庭」类关系，供应商、担保等商业关系只认直接一跳。</li>
 * </ul>
 * 两者都是 BFS + 已访问集合（有环也不会死循环），并封顶深度与节点数。
 */
public final class LawFirmPartyGraph {

    public static final Set<String> TYPES = Set.of(
            "SHAREHOLDER", "ACTUAL_CONTROLLER", "SUPPLIER", "GUARANTOR",
            "SPOUSE", "FAMILY", "CONCERTED_ACTOR", "AFFILIATE", "OTHER");
    /** 无方向关系：存储时 from/to 顺序无意义。 */
    public static final Set<String> SYMMETRIC = Set.of("SPOUSE", "FAMILY", "CONCERTED_ACTOR", "AFFILIATE", "OTHER");
    /** 股权/控制边：推导间接股东与子公司。 */
    static final Set<String> EQUITY = Set.of("SHAREHOLDER", "ACTUAL_CONTROLLER");
    /** 利冲关联范围可以连续穿过的边（同一集团或家庭）；其余只认直接一跳。 */
    static final Set<String> GROUP = Set.of("SHAREHOLDER", "ACTUAL_CONTROLLER", "SPOUSE", "FAMILY", "CONCERTED_ACTOR", "AFFILIATE");

    public static final int CONFLICT_DEPTH = 4;
    public static final int CHAIN_DEPTH = 6;
    static final int MAX_NODES = 500;

    public record Node(Long id, String name, String creditCode, boolean client, String clientNo, Long ownerUserId, String ownerName) {}

    public record Edge(Long id, Long from, Long to, String type, Integer shareBps, String note) {}

    /** 走过的一条边；forward = 从 from 走到 to。 */
    public record Step(Edge edge, boolean forward) {}

    public record Reach(Node node, List<Step> steps) {
        public int depth() {
            return steps.size();
        }
    }

    private final Map<Long, Node> nodes = new LinkedHashMap<>();
    private final Map<Long, List<Edge>> edgesByNode = new HashMap<>();

    public LawFirmPartyGraph(Collection<Node> nodes, Collection<Edge> edges) {
        for (Node n : nodes) this.nodes.put(n.id(), n);
        for (Edge e : edges) {
            if (!this.nodes.containsKey(e.from()) || !this.nodes.containsKey(e.to()) || e.from().equals(e.to())) continue;
            edgesByNode.computeIfAbsent(e.from(), k -> new ArrayList<>()).add(e);
            edgesByNode.computeIfAbsent(e.to(), k -> new ArrayList<>()).add(e);
        }
    }

    public static LawFirmPartyGraph empty() {
        return new LawFirmPartyGraph(List.of(), List.of());
    }

    public Node node(Long id) {
        return id == null ? null : nodes.get(id);
    }

    public Collection<Node> nodes() {
        return nodes.values();
    }

    public List<Edge> edgesOf(Long id) {
        return edgesByNode.getOrDefault(id, List.of());
    }

    /** 名称/信用代码命中的主体（规则与利冲引擎 {@link LawFirmConflictEngine#matchesParty} 相同）。 */
    public List<Node> match(String name, String creditCode) {
        if ((name == null || name.isBlank()) && (creditCode == null || creditCode.isBlank())) return List.of();
        List<Node> out = new ArrayList<>();
        for (Node n : nodes.values()) {
            if (LawFirmConflictEngine.matchesParty(name, creditCode, n.name(), n.creditCode())) out.add(n);
        }
        return out;
    }

    /**
     * 单向股权链：up=true 找间接股东/实际控制人（沿 to→from），up=false 找子公司及其下级（沿 from→to）。
     * 结果不含起点，按最短链路，每个主体只出现一次。
     */
    public List<Reach> equityChain(Long start, boolean up, int maxDepth) {
        return bfs(start, maxDepth, (edge, at) -> {
            if (!EQUITY.contains(edge.type())) return null;
            if (up && edge.to().equals(at)) return new Step(edge, false);
            if (!up && edge.from().equals(at)) return new Step(edge, true);
            return null;
        }, false);
    }

    /** 利冲关联范围（不含起点）：无向穿过 {@link #GROUP} 边；其他类型只在起点直接一跳。 */
    public List<Reach> reach(Long start, int maxDepth) {
        return bfs(start, maxDepth, (edge, at) -> new Step(edge, edge.from().equals(at)), true);
    }

    private interface StepRule {
        Step step(Edge edge, Long at);
    }

    private List<Reach> bfs(Long start, int maxDepth, StepRule rule, boolean groupOnlyBeyondFirstHop) {
        List<Reach> out = new ArrayList<>();
        if (start == null || !nodes.containsKey(start)) return out;
        Set<Long> seen = new HashSet<>();
        seen.add(start);
        Deque<Reach> queue = new ArrayDeque<>();
        queue.add(new Reach(nodes.get(start), List.of()));
        while (!queue.isEmpty() && seen.size() < MAX_NODES) {
            Reach cur = queue.poll();
            if (cur.depth() >= maxDepth) continue;
            // 经由商业关系（非 GROUP）到达的主体不再向外扩
            if (groupOnlyBeyondFirstHop && cur.depth() > 0
                    && !GROUP.contains(cur.steps().get(cur.depth() - 1).edge().type())) continue;
            Long at = cur.node().id();
            for (Edge e : edgesOf(at)) {
                if (groupOnlyBeyondFirstHop && cur.depth() > 0 && !GROUP.contains(e.type())) continue;
                Step step = rule.step(e, at);
                if (step == null) continue;
                Long next = e.from().equals(at) ? e.to() : e.from();
                if (!seen.add(next)) continue;
                List<Step> steps = new ArrayList<>(cur.steps());
                steps.add(step);
                Reach r = new Reach(nodes.get(next), List.copyOf(steps));
                out.add(r);
                queue.add(r);
            }
        }
        return out;
    }

    /** 沿 SHAREHOLDER 边相乘的穿透持股比例（万分比）；链上有控制关系或缺比例时为空。 */
    public static Integer effectiveBps(List<Step> steps) {
        double ratio = 1.0;
        for (Step s : steps) {
            if (!"SHAREHOLDER".equals(s.edge().type()) || s.edge().shareBps() == null) return null;
            ratio *= s.edge().shareBps() / 10000.0;
        }
        return (int) Math.round(ratio * 10000);
    }

    /**
     * 链路说明：每条边一句，按存储方向表述，用「；」连接。整条链都是逆向走的（例如向上找间接股东）
     * 就倒过来读，从最上层股东往下说，与股权结构图的读法一致。
     */
    public String describe(List<Step> steps) {
        List<Step> ordered = new ArrayList<>(steps);
        if (!ordered.isEmpty() && ordered.stream().noneMatch(Step::forward)) java.util.Collections.reverse(ordered);
        List<String> parts = new ArrayList<>();
        for (Step s : ordered) parts.add(describe(s.edge()));
        return String.join(LangText.of("；", "; "), parts);
    }

    public String describe(Edge e) {
        String a = nameOf(e.from());
        String b = nameOf(e.to());
        String pct = e.shareBps() == null ? null : formatPercent(e.shareBps());
        return switch (e.type()) {
            case "SHAREHOLDER" -> pct == null
                    ? LangText.of(a + "是" + b + "的股东", a + " is a shareholder of " + b)
                    : LangText.of(a + "持有" + b + " " + pct + " 股权", a + " holds " + pct + " of " + b);
            case "ACTUAL_CONTROLLER" -> LangText.of(a + "是" + b + "的实际控制人", a + " is the actual controller of " + b);
            case "SUPPLIER" -> LangText.of(a + "是" + b + "的供应商", a + " is a supplier of " + b);
            case "GUARANTOR" -> LangText.of(a + "为" + b + "提供担保", a + " guarantees " + b);
            case "SPOUSE" -> LangText.of(a + "与" + b + "是配偶", a + " and " + b + " are spouses");
            case "FAMILY" -> LangText.of(a + "与" + b + "是近亲属", a + " and " + b + " are close relatives");
            case "CONCERTED_ACTOR" -> LangText.of(a + "与" + b + "是一致行动人", a + " and " + b + " act in concert");
            case "AFFILIATE" -> LangText.of(a + "与" + b + "是关联企业", a + " and " + b + " are affiliates");
            default -> LangText.of(a + "与" + b + "存在关联", a + " and " + b + " are related")
                    + (e.note() == null || e.note().isBlank() ? "" : LangText.of("（" + e.note() + "）", " (" + e.note() + ")"));
        };
    }

    static String formatPercent(int bps) {
        String s = java.math.BigDecimal.valueOf(bps, 2).stripTrailingZeros().toPlainString();
        return s + "%";
    }

    private String nameOf(Long id) {
        Node n = nodes.get(id);
        return n == null ? "#" + id : n.name();
    }
}
