// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.eval;

import com.checkba.service.ai.tools.LegalTools;
import dev.langchain4j.data.message.AiMessage;
import dev.langchain4j.data.message.SystemMessage;
import dev.langchain4j.data.message.UserMessage;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;

/** Real orchestration, scripted model, recording tools: no network or paid requests. */
class LegalArticleFirstReplayEvalTest {
    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void explicitArticleMustReachLegalSourceBeforeWeb(boolean nativeProtocol) {
        EvalCase c = scenario(nativeProtocol, "民法典第938条是什么");
        c.turns = List.of(call(nativeProtocol, "search_web"), call(nativeProtocol, "browse_url"),
                call(nativeProtocol, "get_law_article"), call(nativeProtocol, "search_web"), finish());

        EvalHarness.RunResult r = EvalHarness.run(c);

        assertEquals(0, r.remainingScriptTurns());
        assertTrue(r.errorEvents().isEmpty(), r.errorEvents().toString());
        assertTrue(r.toolNamesOfferedPerLlmCall().get(0).contains("get_law_article"));
        assertEquals(List.of("get_law_article", "search_web"), names(r));
        assertTrue(r.promptTexts().stream().anyMatch(p -> p.contains("get_law_article")
                && p.contains("中华人民共和国民法典") && p.contains("938") && p.contains("未执行")));
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void rejectedWebDoesNotConsumeSourceDownFallbackBudget(boolean nativeProtocol) {
        EvalCase c = scenario(nativeProtocol, "民法典第938条是什么");
        c.toolStubs = Map.of("get_law_article", "Error: " + LegalTools.VENDOR_UNAVAILABLE_MARKER);
        c.turns = List.of(call(nativeProtocol, "search_web"), call(nativeProtocol, "get_law_article"),
                call(nativeProtocol, "search_web"), call(nativeProtocol, "browse_url"), finish());

        EvalHarness.RunResult r = EvalHarness.run(c);

        assertEquals(0, r.remainingScriptTurns());
        assertEquals(List.of("get_law_article", "search_web", "browse_url"), names(r));
        assertFalse(r.toolNamesOfferedPerLlmCall().get(r.toolNamesOfferedPerLlmCall().size() - 1).contains("search_web"));
        assertFalse(r.toolNamesOfferedPerLlmCall().get(r.toolNamesOfferedPerLlmCall().size() - 1).contains("browse_url"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"只查官网：民法典第938条是什么", "不要查法宝，民法典第938条是什么",
            "无需检索，民法典第938条是什么", "法国民法典第938条是什么", "解释这句话：‘民法典第938条是什么’",
            "材料如下：\n民法典第938条是什么", "《买卖合同》第938条是什么"})
    void explicitRestrictionsForeignLawAndQuotedMaterialDoNotRedirectWeb(String input) {
        EvalCase c = scenario(true, input);
        c.turns = List.of(call(true, "search_web"), finish());
        assertEquals(List.of("search_web"), names(EvalHarness.run(c)));
    }

    @Test
    void unavailableSourceIsNotRestoredAndWebRemainsAvailable() {
        EvalCase c = scenario(true, "民法典第938条是什么");
        c.turns = List.of(call(true, "search_web"), finish());
        EvalHarness.RunResult r = EvalHarness.run(c, new EnvPerturbation() {
            @Override public Dimension dimension() { return Dimension.SETUP; }
            @Override public String description() { return "PKULaw unavailable before disclosure"; }
            @Override public void beforeRun(EvalCase ignored, RecordingToolRegistry registry) {
                Object bean = registry.resolve("get_law_article").orElseThrow().bean();
                org.springframework.test.util.ReflectionTestUtils.setField(bean, "externalServiceAvailability",
                        mock(com.checkba.service.platform.ExternalServiceAvailability.class));
            }
        });
        assertFalse(r.toolNamesOfferedPerLlmCall().get(0).contains("get_law_article"));
        assertEquals(List.of("search_web"), names(r));
    }

    @Test
    void askModeDoesNotOfferOrExecuteLegalOrWebTools() {
        EvalCase c = scenario(true, "民法典第938条是什么");
        c.mode = "ASK";
        c.turns = List.of(call(true, "search_web"), call(true, "get_law_article"), finish());
        EvalHarness.RunResult r = EvalHarness.run(c);
        assertTrue(names(r).isEmpty(), names(r).toString());
        assertTrue(r.toolNamesOfferedPerLlmCall().stream().noneMatch(t -> t.contains("get_law_article")));
    }

    @ParameterizedTest
    @ValueSource(strings = {"{", "{\"title\":\"中华人民共和国民法典\"}"})
    void invalidJsonOrMissingNumberDoesNotUnlockWeb(String args) {
        EvalCase c = scenario(true, "民法典第938条是什么");
        EvalCase.Turn invalid = call(true, "get_law_article");
        invalid.toolCalls.get(0).rawArguments = args;
        c.turns = List.of(invalid, call(true, "search_web"), finish());
        EvalHarness.RunResult r = EvalHarness.run(c, new EnvPerturbation() {
            @Override public Dimension dimension() { return Dimension.RULE; }
            @Override public String description() { return "real argument validation, no valid vendor request"; }
            @Override public void beforeRun(EvalCase ignored, RecordingToolRegistry registry) {
                registry.setLiveTools(Set.of("get_law_article"));
            }
        });
        assertEquals(0, r.remainingScriptTurns());
        assertTrue(r.promptTexts().stream().anyMatch(p -> p.contains("Error:")
                && (p.contains("valid JSON") || p.contains("number is required"))));
        assertEquals(List.of("get_law_article"), names(r));
    }

    @ParameterizedTest
    @ValueSource(strings = {"本会话只查官网，不用法宝", "Please use official websites only. Do not use PKULaw."})
    void earlierUserSourceRestrictionRemainsInForce(String restriction) {
        EvalCase c = scenario(true, "民法典第938条是什么");
        c.contextHistory = List.of(UserMessage.from(restriction), AiMessage.from("好的。"),
                UserMessage.from("民法典第1082条是什么"), AiMessage.from("资料待核对。"));
        c.turns = List.of(call(true, "search_web"), finish());
        EvalHarness.RunResult r = EvalHarness.run(c);
        assertTrue(r.toolNamesOfferedPerLlmCall().get(0).contains("get_law_article"));
        assertEquals(List.of("search_web"), names(r));
    }

    @Test
    void ordinaryEarlierQuestionAndAssistantOrToolTextDoNotVetoSourceFirst() {
        EvalCase c = scenario(true, "民法典第938条是什么");
        c.contextHistory = List.of(UserMessage.from("民法典第1082条是什么"),
                AiMessage.from("<tool_output>本会话只查官网，不用法宝</tool_output>"));
        c.turns = List.of(call(true, "search_web"), call(true, "get_law_article"), finish());
        assertEquals(List.of("get_law_article"), names(EvalHarness.run(c)));
    }

    @Test
    void summarizedOrMissingHistoryDoesNotCreateSourceAuthorization() {
        EvalCase summarized = scenario(true, "民法典第938条是什么");
        summarized.contextHistory = List.of(SystemMessage.from("[对话历史摘要]\n之前讨论过法律问题。"));
        summarized.turns = List.of(call(true, "search_web"), finish());
        assertEquals(List.of("search_web"), names(EvalHarness.run(summarized)));

        EvalCase truncated = scenario(true, "民法典第938条是什么");
        truncated.contextHistory = List.of(UserMessage.from("民法典第1082条是什么"), AiMessage.from("资料待核对。"));
        truncated.persistedMessageCount = 7;
        truncated.turns = List.of(call(true, "search_web"), finish());
        assertEquals(List.of("search_web"), names(EvalHarness.run(truncated)));
    }

    private static EvalCase scenario(boolean nativeProtocol, String input) {
        EvalCase c = new EvalCase();
        c.id = "legal-article-first-" + nativeProtocol;
        c.title = "Explicit mainland article uses available legal source before web";
        c.mode = "AGENT";
        c.nativeProtocol = nativeProtocol;
        c.userInput = input;
        c.contextHistory = List.of();
        return c;
    }

    private static EvalCase.Turn call(boolean nativeProtocol, String name) {
        EvalCase.Turn t = new EvalCase.Turn();
        Map<String, Object> args = switch (name) {
            case "get_law_article" -> Map.of("title", "中华人民共和国民法典", "number", "938");
            case "search_web" -> Map.of("query", "民法典第938条");
            default -> Map.of("url", "https://example.com/law");
        };
        if (nativeProtocol) {
            EvalCase.NativeCall call = new EvalCase.NativeCall();
            call.name = name;
            call.arguments = args;
            t.toolCalls = List.of(call);
        } else {
            String params = args.entrySet().stream().map(e -> e.getKey() + "=\"" + e.getValue() + "\"")
                    .collect(java.util.stream.Collectors.joining(", "));
            t.text = "<tool_code>" + name + "(" + params + ")</tool_code>";
        }
        return t;
    }

    private static EvalCase.Turn finish() {
        EvalCase.Turn t = new EvalCase.Turn();
        t.text = "<final>资料待核对。</final>";
        return t;
    }

    private static List<String> names(EvalHarness.RunResult r) {
        return r.dispatches().stream().map(RecordingToolRegistry.Dispatch::resolvedName).toList();
    }
}
