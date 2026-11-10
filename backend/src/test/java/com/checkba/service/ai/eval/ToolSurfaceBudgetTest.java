// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.eval;

import com.checkba.service.ai.ToolDisclosurePolicy;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 首轮（turn 1）下发量的回归基线（docs/plans/tool-surface-audit.md S0）。
 *
 * <p>确定性：用 {@link EvalHarness} 跑真实编排器 + 回放模型（不调任何真实模型），读第一次携带工具的
 * LLM 调用下发了多少工具、多少 o200k schema token。宿主态 × 提示类型 = 一张表，
 * 与 {@code ai-eval/tool-surface-baseline.csv} 对拍。
 *
 * <p>基线是<b>现状</b>（审计 §1.1），不是目标。后续瘦身 PR 把数字压下去之后，这里会因「比基线小太多」
 * 而红——这是有意的：PR 必须在同一个提交里更新基线 csv，让变化被评审看见；反之涨上去同样红。
 * 容差：工具数 ±{@value #TOOL_TOLERANCE}，token ±2%。
 */
class ToolSurfaceBudgetTest {

    private static final int TOOL_TOLERANCE = 1;
    private static final double TOKEN_TOLERANCE = 0.02;
    private static final String BASELINE = "ai-eval/tool-surface-baseline.csv";

    /** 中性：不命中任何关键词。 */
    private static final String NEUTRAL = "这份合同有什么风险？";
    /** 典型 C 句：table + spreadsheet + format + task。 */
    private static final String TYPICAL = "把这张表格的格式统一一下，再建一个下周三的提醒事项";
    /** 最坏：每个关键词类目各命中一个词（下面 {@link #worstCasePromptHitsEveryCategory} 守住）。 */
    // 刻意避开会命中内置 skill 触发词的词（时间轴 / 会议 / 证据 ...）：skill 一命中就把工具裁成白名单，
    // 「最坏」就量不到了。
    private static final String WORST = "pdf 比对 版本 流程图 ppt mcp 工商 插件 transcript python 表格 事项 修订 模板 依据 格式 重命名 法规 记住";

    private record Host(String key, String mode, String capability, String officeHost, String fileType) {
    }

    private static final List<Host> HOSTS = List.of(
            new Host("lowa-docx", "AGENT", null, null, "docx"),
            new Host("lowa-xlsx", "AGENT", null, null, "xlsx"),
            new Host("lowa-pptx", "AGENT", null, null, "pptx"),
            new Host("lowa-nofile", "AGENT", null, null, null),
            new Host("office-word", "AGENT", "office", "word", null),
            new Host("office-excel", "AGENT", "office", "excel", null),
            new Host("office-ppt", "AGENT", "office", "powerpoint", null),
            new Host("none", "AGENT", "none", null, null),
            new Host("ask", "ASK", null, null, null));

    private static final Map<String, String> PROMPTS = new LinkedHashMap<>();

    static {
        PROMPTS.put("neutral", NEUTRAL);
        PROMPTS.put("typical", TYPICAL);
        PROMPTS.put("worst", WORST);
    }

    private record Cell(int tools, int tokens, List<String> names) {
        Cell(int tools, int tokens) {
            this(tools, tokens, List.of());
        }
    }

    private static Cell measure(Host host, String prompt) {
        EvalCase c = new EvalCase();
        c.id = "surface-" + host.key();
        c.title = "tool surface " + host.key();
        c.mode = host.mode();
        c.clientCapability = host.capability();
        c.officeHost = host.officeHost();
        c.userInput = prompt;
        if (host.fileType() != null) {
            EvalCase.ActiveDocument doc = new EvalCase.ActiveDocument();
            doc.name = "合同." + host.fileType();
            doc.fileType = host.fileType();
            c.activeDocument = doc;
        }
        EvalCase.Turn turn = new EvalCase.Turn();
        turn.text = "<final>ok</final>";
        c.turns.add(turn);
        EvalHarness.RunResult r = EvalHarness.run(c);
        List<String> names = List.of();
        for (int i = 0; i < r.toolsOfferedPerLlmCall().size(); i++) {
            if (r.toolsOfferedPerLlmCall().get(i)) {
                names = r.toolNamesOfferedPerLlmCall().get(i).stream().sorted().toList();
                break;
            }
        }
        return new Cell(r.firstCallOfferedTools(), r.firstCallOfferedSchemaTokens(), names);
    }

    private static Map<String, Cell> loadBaseline() {
        Map<String, Cell> baseline = new LinkedHashMap<>();
        try (InputStream in = ToolSurfaceBudgetTest.class.getClassLoader().getResourceAsStream(BASELINE)) {
            assertTrue(in != null, "缺少基线文件 " + BASELINE);
            for (String line : new String(in.readAllBytes(), StandardCharsets.UTF_8).split("\n")) {
                String t = line.trim();
                if (t.isEmpty() || t.startsWith("#")) {
                    continue;
                }
                String[] f = t.split(",");
                baseline.put(f[0] + "/" + f[1], new Cell(Integer.parseInt(f[2]), Integer.parseInt(f[3])));
            }
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
        return baseline;
    }

    @Test
    @DisplayName("worst 提示确实命中全部关键词类目（否则「最坏」就不是最坏）")
    void worstCasePromptHitsEveryCategory() {
        ToolDisclosurePolicy policy = new ToolDisclosurePolicy(true, true);
        assertEquals(policy.keywordCategories(), policy.categoriesHintedBy(WORST));
        assertTrue(policy.categoriesHintedBy(NEUTRAL).isEmpty(), "中性提示不应命中任何类目");
    }

    @Test
    @DisplayName("首轮下发量对拍基线：宿主态 × 中性/典型/最坏（tool-surface-audit S0）")
    void firstTurnSurfaceMatchesBaseline() {
        Map<String, Cell> baseline = loadBaseline();
        List<String> failures = new ArrayList<>();
        StringBuilder table = new StringBuilder("\n[tool-surface] 首轮下发（工具数 / o200k token；括号内为基线）\n");
        table.append(String.format("%-14s", "host"));
        PROMPTS.keySet().forEach(p -> table.append(String.format("%-30s", p)));
        table.append('\n');
        for (Host host : HOSTS) {
            table.append(String.format("%-14s", host.key()));
            for (Map.Entry<String, String> p : PROMPTS.entrySet()) {
                Cell now = measure(host, p.getValue());
                String key = host.key() + "/" + p.getKey();
                Cell base = baseline.get(key);
                table.append(String.format("%-30s", now.tools() + " / " + now.tokens()
                        + (base == null ? " (无基线)" : " (" + base.tools() + " / " + base.tokens() + ")")));
                if (base == null) {
                    failures.add(key + " 没有基线行");
                    continue;
                }
                boolean toolsOk = Math.abs(now.tools() - base.tools()) <= TOOL_TOLERANCE;
                boolean tokensOk = Math.abs(now.tokens() - base.tokens()) <= base.tokens() * TOKEN_TOLERANCE;
                if (!toolsOk || !tokensOk) {
                    failures.add(key + "：实际 " + now.tools() + " 个 / " + now.tokens() + " token，基线 "
                            + base.tools() + " 个 / " + base.tokens() + " token\n    下发：" + now.names());
                }
            }
            table.append('\n');
        }
        System.out.println(table);
        assertTrue(failures.isEmpty(), "首轮工具面偏离基线 " + BASELINE
                + "。有意的变化（瘦身 / 新增工具）请在同一提交里更新该 csv；无意的就是回归：\n  "
                + String.join("\n  ", failures));
    }
}
