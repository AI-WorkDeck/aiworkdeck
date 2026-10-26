// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.eval;

import com.checkba.service.ai.tools.ToolContext;

import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BiFunction;

/**
 * Aligns with Google {@code EnvHarness} (Controlled Environment Perturbation):
 * models three orthogonal perturbation dimensions ({@link Dimension#SETUP}, {@link Dimension#RULE},
 * {@link Dimension#LINK}) to evaluate whether the agent harness relies on memorized trajectories
 * or genuine runtime self-healing ({@code HarnessDiagnosticService}).
 */
public interface EnvPerturbation {

    enum Dimension {
        /** Perturbs initial environment state, file/anchor IDs, or transient infrastructure readiness. */
        SETUP,
        /** Perturbs tool availability, disclosure policy, or parameter validation contracts. */
        RULE,
        /** Perturbs cross-step causal links (e.g. anchor drift after an intermediate write). */
        LINK
    }

    Dimension dimension();

    String description();

    /**
     * Mutates the EvalCase or RecordingToolRegistry before the turn starts.
     */
    default void beforeRun(EvalCase evalCase, RecordingToolRegistry registry) {
    }

    /**
     * Intercepts a tool execution during the run. Return non-null to override the stub output.
     */
    default String interceptTool(
            String resolvedToolName,
            String argsJson,
            ToolContext ctx,
            List<RecordingToolRegistry.Dispatch> historySoFar,
            Map<String, String> baseStubs) {
        return null;
    }

    /**
     * Setup Perturbation: Simulates transient failure on the first call to {@code targetTool}
     * (e.g., stale anchor or temporary resource state), succeeding on subsequent calls.
     */
    static EnvPerturbation setupTransientFailure(String targetTool, String firstFailureOutput, String recoveryOutput) {
        AtomicInteger calls = new AtomicInteger(0);
        return new EnvPerturbation() {
            @Override
            public Dimension dimension() {
                return Dimension.SETUP;
            }

            @Override
            public String description() {
                return "Setup perturbation on " + targetTool + ": first call fails, subsequent calls recover";
            }

            @Override
            public String interceptTool(
                    String resolvedToolName,
                    String argsJson,
                    ToolContext ctx,
                    List<RecordingToolRegistry.Dispatch> historySoFar,
                    Map<String, String> baseStubs) {
                if (!targetTool.equals(resolvedToolName)) {
                    return null;
                }
                int idx = calls.incrementAndGet();
                return idx == 1 ? firstFailureOutput : recoveryOutput;
            }
        };
    }

    /**
     * Rule Perturbation: Rejects calls to {@code targetTool} unless {@code argPredicate} holds
     * (e.g., requiring a re-probed anchor ID or specific parameter schema).
     */
    static EnvPerturbation ruleContractCheck(
            String targetTool,
            BiFunction<String, List<RecordingToolRegistry.Dispatch>, Boolean> contractPredicate,
            String violationErrorOutput,
            String compliantOutput) {
        return new EnvPerturbation() {
            @Override
            public Dimension dimension() {
                return Dimension.RULE;
            }

            @Override
            public String description() {
                return "Rule perturbation on " + targetTool + ": enforces runtime parameter/schema contract";
            }

            @Override
            public String interceptTool(
                    String resolvedToolName,
                    String argsJson,
                    ToolContext ctx,
                    List<RecordingToolRegistry.Dispatch> historySoFar,
                    Map<String, String> baseStubs) {
                if (!targetTool.equals(resolvedToolName)) {
                    return null;
                }
                boolean ok = contractPredicate.apply(argsJson == null ? "" : argsJson, historySoFar);
                return ok ? compliantOutput : violationErrorOutput;
            }
        };
    }

    /**
     * Link Perturbation: Simulates cross-step anchor drift — once a write tool matching {@code writeToolPrefix}
     * executes, the next call to {@code targetEditTool} using an old anchor fails with an anchor-not-found error
     * until {@code reProbeTool} is called to re-establish the link.
     */
    static EnvPerturbation linkAnchorDriftAfterWrite(
            String writeToolPrefix,
            String targetEditTool,
            String reProbeTool,
            String staleAnchorErrorOutput,
            String refreshedSuccessOutput) {
        return new EnvPerturbation() {
            @Override
            public Dimension dimension() {
                return Dimension.LINK;
            }

            @Override
            public String description() {
                return "Link perturbation: anchor drifts after " + writeToolPrefix
                        + " until re-probed via " + reProbeTool;
            }

            @Override
            public String interceptTool(
                    String resolvedToolName,
                    String argsJson,
                    ToolContext ctx,
                    List<RecordingToolRegistry.Dispatch> historySoFar,
                    Map<String, String> baseStubs) {
                if (!targetEditTool.equals(resolvedToolName)) {
                    return null;
                }
                // historySoFar includes the current dispatch at the end
                int priorLimit = Math.max(0, historySoFar.size() - 1);
                int lastWriteIdx = -1;
                int lastProbeIdx = -1;
                for (int i = 0; i < priorLimit; i++) {
                    String name = historySoFar.get(i).resolvedName();
                    if (name != null && name.startsWith(writeToolPrefix)) {
                        lastWriteIdx = i;
                    }
                    if (reProbeTool.equals(name)) {
                        lastProbeIdx = i;
                    }
                }
                if (lastWriteIdx >= 0 && lastProbeIdx < lastWriteIdx) {
                    return staleAnchorErrorOutput;
                }
                return refreshedSuccessOutput;
            }
        };
    }
}
