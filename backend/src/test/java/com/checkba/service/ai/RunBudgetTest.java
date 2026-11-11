// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RunBudgetTest {

    @Test
    void batchedCallsCountAsOneRound() {
        RunBudget budget = new RunBudget();
        for (int i = 0; i < 40; i++) budget.noteCall("doc_add_comment", true);
        assertEquals(RunBudget.Action.CONTINUE, budget.endRound(List.of("doc_add_comment")));
        assertEquals(1, budget.rounds());
    }

    @Test
    void softNudgeOnceThenHardStop() {
        RunBudget budget = new RunBudget();
        for (int round = 1; round < RunBudget.SOFT_NUDGE_ROUND; round++) {
            assertEquals(RunBudget.Action.CONTINUE, budget.endRound(List.of("doc_find_text")), "round " + round);
        }
        assertEquals(RunBudget.Action.ROUND_NUDGE, budget.endRound(List.of("doc_find_text")));
        for (int round = RunBudget.SOFT_NUDGE_ROUND + 1; round < RunBudget.HARD_STOP_ROUND; round++) {
            assertEquals(RunBudget.Action.CONTINUE, budget.endRound(List.of("doc_find_text")), "round " + round);
        }
        assertEquals(RunBudget.Action.ROUND_STOP, budget.endRound(List.of("doc_find_text")));
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
    void undoLoopNudgesAtThirdUndoAndStopsAtFifth() {
        RunBudget budget = new RunBudget();
        List<RunBudget.Action> afterUndo = new java.util.ArrayList<>();
        for (int i = 1; i <= RunBudget.UNDO_STOP_AT; i++) {
            budget.noteCall("doc_insert_at_cursor", true);
            assertEquals(RunBudget.Action.CONTINUE, budget.endRound(List.of("doc_insert_at_cursor")));
            budget.noteCall(i % 2 == 0 ? "doc_redo" : "doc_undo", true);
            afterUndo.add(budget.endRound(List.of("doc_undo")));
        }
        assertEquals(List.of(RunBudget.Action.CONTINUE, RunBudget.Action.CONTINUE, RunBudget.Action.UNDO_NUDGE,
                RunBudget.Action.CONTINUE, RunBudget.Action.UNDO_STOP), afterUndo);
    }

    @Test
    void stopNoticeReportsDoneAndPendingWork() {
        String notice = AgentOrchestrator.runBudgetStopNotice(RunBudget.Action.ROUND_STOP, 30,
                List.of("添加批注 ×12"), List.of("核对违约金条款"));
        assertTrue(notice.contains("30"));
        assertTrue(notice.contains("添加批注 ×12"));
        assertTrue(notice.contains("核对违约金条款"));
    }

    /** 系统提示里写的数字必须与代码里的常量一致（gap 分析：提示曾承诺一个代码里不存在的 30 步预算）。 */
    @Test
    void systemPromptStatesTheEnforcedNumbers() throws Exception {
        for (String file : List.of("prompts/system_prompt.md", "prompts/system_prompt.en.md")) {
            String prompt;
            try (var in = getClass().getClassLoader().getResourceAsStream(file)) {
                prompt = new String(in.readAllBytes(), StandardCharsets.UTF_8);
            }
            int at = prompt.indexOf("## Step Budget");
            String section = prompt.substring(at, prompt.indexOf("\n## ", at + 5));
            for (int n : new int[]{RunBudget.SOFT_NUDGE_ROUND, RunBudget.HARD_STOP_ROUND,
                    RunBudget.UNDO_NUDGE_AT, RunBudget.UNDO_STOP_AT}) {
                assertTrue(section.matches("(?s).*\\D" + n + "\\D.*"), file + " should state " + n + ":\n" + section);
            }
        }
    }
}
