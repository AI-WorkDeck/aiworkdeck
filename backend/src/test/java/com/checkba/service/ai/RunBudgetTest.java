// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RunBudgetTest {

    @Test
    void batchedCallsCountAsOneRound() {
        RunBudget budget = new RunBudget();
        for (int i = 0; i < 40; i++) budget.noteCall("doc_add_comment");
        assertEquals(RunBudget.Action.CONTINUE, budget.endRound(List.of("doc_add_comment")));
        assertEquals(1, budget.rounds());
    }

    @Test
    void roundNudgeFiresOnceAndNothingEverStopsTheRun() {
        RunBudget budget = new RunBudget();
        List<Integer> nudgedAt = new ArrayList<>();
        for (int round = 1; round <= 500; round++) {
            RunBudget.Action action = budget.endRound(List.of("doc_find_text"));
            if (action == RunBudget.Action.ROUND_NUDGE) nudgedAt.add(round);
            else assertEquals(RunBudget.Action.CONTINUE, action, "round " + round);
        }
        assertEquals(List.of(RunBudget.SOFT_NUDGE_ROUND), nudgedAt);
    }

    @Test
    void officePassRoundsAreNotCounted() {
        RunBudget budget = new RunBudget();
        for (int i = 0; i < 200; i++) {
            assertEquals(RunBudget.Action.CONTINUE, budget.endRound(List.of("office_pass_step")));
        }
        assertEquals(0, budget.rounds());
    }

    @Test
    void undoLoopRemindsAtThirdAndSixthUndoAndNeverStops() {
        RunBudget budget = new RunBudget();
        List<Integer> remindedAtUndo = new ArrayList<>();
        for (int i = 1; i <= 7; i++) { // 14 rounds: stays below the round nudge
            budget.noteCall("doc_insert_at_cursor");
            assertEquals(RunBudget.Action.CONTINUE, budget.endRound(List.of("doc_insert_at_cursor")));
            budget.noteCall(i % 2 == 0 ? "doc_redo" : "doc_undo");
            RunBudget.Action action = budget.endRound(List.of("doc_undo"));
            if (action == RunBudget.Action.UNDO_NUDGE) remindedAtUndo.add(i);
            else assertEquals(RunBudget.Action.CONTINUE, action, "undo " + i);
        }
        assertEquals(RunBudget.UNDO_NUDGES_AT, remindedAtUndo);
    }

    @Test
    void severalUndosInOneBatchRemindOnce() {
        RunBudget budget = new RunBudget();
        for (int i = 0; i < 7; i++) budget.noteCall("doc_undo");
        assertEquals(RunBudget.Action.UNDO_NUDGE, budget.endRound(List.of("doc_undo")));
        assertEquals(RunBudget.Action.CONTINUE, budget.endRound(List.of("doc_undo")));
    }

    /**
     * 系统提示不得承诺系统不会做的事（gap 分析：提示曾承诺一个代码里不存在的 30 步暂停）。
     * 所有者决定只提醒不暂停，所以 Step Budget 段既不能写「暂停」，也不能写具体轮数上限。
     */
    @Test
    void systemPromptDoesNotPromiseAPause() throws Exception {
        for (String file : List.of("prompts/system_prompt.md", "prompts/system_prompt.en.md")) {
            String prompt;
            try (var in = getClass().getClassLoader().getResourceAsStream(file)) {
                prompt = new String(in.readAllBytes(), StandardCharsets.UTF_8);
            }
            int at = prompt.indexOf("## Step Budget");
            String section = prompt.substring(at, prompt.indexOf("\n## ", at + 5));
            assertFalse(section.contains("暂停") || section.toLowerCase().contains("pause"),
                    file + " must not promise a pause:\n" + section);
            assertFalse(section.contains("30"), file + " must not state the old 30-step cap:\n" + section);
            assertTrue(section.contains("提醒") || section.contains("remind"),
                    file + " should mention the reminder the system does give:\n" + section);
        }
    }
}
