// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.eval;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Aligns with Google {@code EnvHarness} (Controlled Environment Perturbation) + {@code Harness²}:
 * tests the orchestrator under Setup, Rule, and Link perturbations to verify that runtime self-healing
 * ({@code harness_adaptation}) and contrastive evolution ({@code harness_evolution}) work end-to-end.
 */
class EnvHarnessPerturbationEvalTest {

    @Test
    void linkPerturbationAnchorDriftRecoversWithoutPersistingRuntimeMechanics() {
        EvalCase c = new EvalCase();
        c.id = "envharness-link-anchor-drift";
        c.title = "Link Perturbation: Edit after prior write encounters anchor drift, probes via doc_find_text, and recovers without long-term evolution";
        c.mode = "AGENT";
        c.userInput = "在合同第一条插入定义后，把违约金比例替换为 15%";
        EvalCase.ActiveDocument doc = new EvalCase.ActiveDocument();
        doc.id = "42";
        doc.name = "服务合同.docx";
        doc.fileType = "docx";
        c.activeDocument = doc;
        c.toolStubs = Map.of(
                "doc_insert_at_cursor", "{\"success\":true,\"inserted\":true}",
                "doc_find_text", "{\"matches\":[{\"anchorId\":\"p8_fresh\",\"text\":\"违约金比例为 10%\"}]}");

        EvalCase.Turn turn1 = new EvalCase.Turn();
        EvalCase.NativeCall call1 = new EvalCase.NativeCall();
        call1.name = "doc_insert_at_cursor";
        call1.arguments = Map.of("text", "本合同所称服务指技术顾问服务。");
        turn1.toolCalls = List.of(call1);

        EvalCase.Turn turn2 = new EvalCase.Turn();
        EvalCase.NativeCall call2 = new EvalCase.NativeCall();
        call2.name = "doc_replace_at_anchor";
        call2.arguments = Map.of("anchorId", "p8_stale", "newText", "违约金比例为 15%");
        turn2.toolCalls = List.of(call2);

        EvalCase.Turn turn3 = new EvalCase.Turn();
        EvalCase.NativeCall call3 = new EvalCase.NativeCall();
        call3.name = "doc_find_text";
        call3.arguments = Map.of("query", "违约金比例");
        turn3.toolCalls = List.of(call3);

        EvalCase.Turn turn4 = new EvalCase.Turn();
        EvalCase.NativeCall call4 = new EvalCase.NativeCall();
        call4.name = "doc_replace_at_anchor";
        call4.arguments = Map.of("anchorId", "p8_fresh", "newText", "违约金比例为 15%");
        turn4.toolCalls = List.of(call4);

        EvalCase.Turn turn5 = new EvalCase.Turn();
        turn5.text = "<final>已完成第一条定义插入，并在重定位锚点后将违约金比例修改为 15%。</final>";

        c.turns = List.of(turn1, turn2, turn3, turn4, turn5);

        EnvPerturbation linkPerturbation = EnvPerturbation.linkAnchorDriftAfterWrite(
                "doc_insert",
                "doc_replace_at_anchor",
                "doc_find_text",
                "{\"error\":\"Anchor not found: p8_stale\"}",
                "{\"success\":true,\"replaced\":1}");

        EvalHarness.RunResult result = EvalHarness.run(c, linkPerturbation);

        assertEquals(0, result.remainingScriptTurns());
        assertFalse(result.events("harness_adaptation").isEmpty(),
                "Expected harness_adaptation SSE event when anchor drift occurs");
        assertTrue(result.events("harness_adaptation").get(0).data().contains("ANCHOR_PROBE_RECOVERY"));

        assertEquals(List.of("doc_insert_at_cursor", "doc_replace_at_anchor", "doc_find_text", "doc_replace_at_anchor"),
                result.dispatches().stream().map(RecordingToolRegistry.Dispatch::resolvedName).toList());
        assertTrue(result.dispatches().get(1).argsJson().contains("p8_stale"));
        assertTrue(result.dispatches().get(3).argsJson().contains("p8_fresh"));
        assertTrue(result.lastAssistantMessage().orElseThrow().contains("\"replaced\":1"),
                "The recovery must include the successful replacement tool result");
        assertTrue(result.errorEvents().isEmpty());
        assertTrue(result.events("bubble_end").stream().anyMatch(event -> event.data().contains("\"status\":\"finished\"")));
        assertTrue(result.events("harness_evolution").isEmpty(),
                "Anchor probing is a per-turn runtime mechanism, not a rule to persist in user memory");
    }

    @Test
    void rulePerturbationUndisclosedCategoryExpandsAutomaticallyNextRound() {
        EvalCase c = new EvalCase();
        c.id = "envharness-rule-category-expand";
        c.title = "Rule Perturbation: Calling an undisclosed tool triggers automatic category expansion for the next round";
        c.mode = "AGENT";
        c.progressiveDisclosure = true;
        c.userInput = "请在第一行下面再加一行";
        EvalCase.ActiveDocument doc = new EvalCase.ActiveDocument();
        doc.id = "42";
        doc.name = "报价单.docx";
        doc.fileType = "docx";
        c.activeDocument = doc;
        c.toolStubs = Map.of(
                "doc_table_add_row", "{\"success\":true}");

        EvalCase.Turn turn1 = new EvalCase.Turn();
        EvalCase.NativeCall call1 = new EvalCase.NativeCall();
        call1.name = "doc_table_add_row";
        call1.arguments = Map.of("tableIndex", 0, "afterRow", 0);
        turn1.toolCalls = List.of(call1);

        EvalCase.Turn turn2 = new EvalCase.Turn();
        EvalCase.NativeCall call2 = new EvalCase.NativeCall();
        call2.name = "doc_table_add_row";
        call2.arguments = Map.of("tableIndex", 0, "afterRow", 1);
        turn2.toolCalls = List.of(call2);

        EvalCase.Turn turn3 = new EvalCase.Turn();
        turn3.text = "<final>已在第一行下方新增一行。</final>";

        c.turns = List.of(turn1, turn2, turn3);

        EnvPerturbation setupPerturbation = EnvPerturbation.setupTransientFailure(
                "doc_table_add_row",
                "Error: Tool not found in current disclosed surface: doc_table_add_row",
                "{\"success\":true}");

        EvalHarness.RunResult result = EvalHarness.run(c, setupPerturbation);

        assertEquals(0, result.remainingScriptTurns());
        assertFalse(result.events("harness_adaptation").isEmpty());
        assertTrue(result.events("harness_adaptation").get(0).data().contains("EXPAND_TOOL_CATEGORY"));
        assertTrue(result.toolNamesOfferedPerLlmCall().get(1).contains("doc_table_add_row"),
                "Expected doc_table_add_row to be offered in round 2 after EXPAND_TOOL_CATEGORY self-healing");
    }
}
