// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.skill;

import com.checkba.service.AppLanguageService;
import com.checkba.service.ai.ClientCapabilityService;
import com.checkba.service.ai.PluginService;
import com.checkba.service.ai.tools.SkillTools;
import dev.langchain4j.agent.tool.ToolSpecification;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** Loads the shipped skill through the production registry; no model or external service is used. */
class LegalNewsReviewSkillTest {
    private static final String ID = "legal-news-review";

    private record Fixture(SkillRegistry registry, SkillRouter router) { }

    private Fixture fixture(boolean english) {
        SkillProperties properties = new SkillProperties();
        properties.setDir("skills");
        AppLanguageService language = mock(AppLanguageService.class);
        when(language.language()).thenReturn(english ? AppLanguageService.EN_US : AppLanguageService.ZH_CN);
        when(language.isEnglish()).thenReturn(english);
        SkillRegistry registry = new SkillRegistry(properties, null, new PluginService(), language);
        registry.init();
        return new Fixture(registry, new SkillRouter(registry, properties,
                mock(com.checkba.service.telemetry.TelemetryService.class), language));
    }

    @ParameterizedTest
    @CsvSource({"false,请审校法律资讯", "true,Please review this legal newsletter"})
    void automaticActivationInjectsTheActualLocalizedInstructions(boolean english, String request) {
        Fixture f = fixture(english);
        SkillDefinition skill = f.registry().getSkill(ID).orElseThrow();
        assertTrue(f.registry().isAvailable(skill));
        assertFalse(skill.isBuiltinWorkflow(), "A community skill must remain user-disableable");
        assertEquals(SkillDefinition.ToolPolicy.PASSTHROUGH, skill.getToolPolicy());
        assertFalse(skill.getDescription().isBlank());
        assertFalse(skill.getDescriptionEn().isBlank());
        assertFalse(skill.getPromptTemplate().isBlank());
        assertFalse(skill.getPromptTemplateEn().isBlank());
        assertNotEquals(skill.getPromptTemplate(), skill.getPromptTemplateEn());

        f.router().activateForTurn("news", "automatic", request, null);
        var active = f.router().activeSkills("automatic");
        assertEquals(1, active.size());
        assertEquals(ID, active.get(0).definition().getId());
        assertEquals(SkillRouter.SOURCE_AUTO, active.get(0).source());
        assertEquals(english ? skill.getNameEn() : skill.getName(), active.get(0).displayName());
        String injection = f.router().promptInjectionFor(active.get(0).definition());
        assertTrue(injection.contains(english ? skill.getPromptTemplateEn() : skill.getPromptTemplate()));
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void manualSelectionAndModelInvocationReachTheSameLocalizedPrompt(boolean english) {
        Fixture f = fixture(english);
        SkillDefinition skill = f.registry().getSkill(ID).orElseThrow();
        String template = english ? skill.getPromptTemplateEn() : skill.getPromptTemplate();
        String modelResult = new SkillTools(f.router()).use_skill(ID, "news");
        assertTrue(modelResult.startsWith("# Skill:"), modelResult);
        assertTrue(modelResult.contains(template));

        // Deliberately use no trigger: selecting the skill in the UI must suffice.
        f.router().activateForTurn("news", "manual", "Process the attached draft", null, List.of(ID));
        var active = f.router().activeSkills("manual");
        assertEquals(1, active.size());
        assertEquals(ID, active.get(0).definition().getId());
        assertEquals(SkillRouter.SOURCE_MANUAL, active.get(0).source());
        assertTrue(f.router().promptInjectionFor(active.get(0).definition()).contains(template));
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void disablingTheSkillClosesAutomaticManualAndModelEntryPoints(boolean english) {
        Fixture f = fixture(english);
        f.registry().setEnabled(ID, false);
        String request = english ? "Please review this legal newsletter" : "请审校法律资讯";
        assertTrue(f.router().match(request).isEmpty());
        f.router().activateForTurn("news", "disabled", request, null, List.of(ID));
        assertTrue(f.router().activeSkills("disabled").isEmpty());
        assertTrue(f.router().invocableSkill(ID).isEmpty());
        assertTrue(new SkillTools(f.router()).use_skill(ID, "news").startsWith("Error:"));

        f.registry().setEnabled(ID, true);
        assertEquals(ID, f.router().match(request).orElseThrow().getId());
    }

    @ParameterizedTest
    @CsvSource({
            "false,什么是法律资讯", "false,帮我查一下公司的法律问题", "false,今天有什么新闻",
            "true,What is a legal newsletter?", "true,Explain this legal issue", "true,Find today's news"
    })
    void ordinaryQuestionsDoNotActivatePublicationReview(boolean english, String request) {
        assertTrue(fixture(english).router().match(request).stream().noneMatch(s -> ID.equals(s.getId())));
    }

    @ParameterizedTest
    @ValueSource(strings = {"lowa", "office", "none"})
    void reviewPreservesResearchAndOnlyTheCurrentHostsEditingTools(String capability) {
        Fixture f = fixture(false);
        f.router().activateForTurn("news", "review", "请审校法律资讯", null);
        assertEquals(ID, f.router().activeSkill("review").orElseThrow().getId());
        ClientCapabilityService capabilities = new ClientCapabilityService();
        capabilities.record("news", capability, "word");
        List<String> research = List.of("extract_file_text", "search_web", "browse_url", "law_search",
                "search_project_content", "doc_list_project_files");
        List<ToolSpecification> candidates = java.util.stream.Stream.concat(research.stream(),
                java.util.stream.Stream.of("doc_get_document_text", "doc_find_replace", "office_get_text", "office_replace_text"))
                .filter(name -> capabilities.isToolVisible(name, "news"))
                .map(name -> ToolSpecification.builder().name(name).description(name).build()).toList();
        List<ToolSpecification> visible = f.router().visibleTools("review", candidates);
        assertEquals(candidates, visible, "The skill must preserve the host-filtered tool surface");
        Set<String> names = visible.stream().map(ToolSpecification::name).collect(Collectors.toSet());
        assertTrue(names.containsAll(research));
        assertEquals("lowa".equals(capability), names.contains("doc_get_document_text"));
        assertEquals("lowa".equals(capability), names.contains("doc_find_replace"));
        assertEquals("office".equals(capability), names.contains("office_get_text"));
        assertEquals("office".equals(capability), names.contains("office_replace_text"));
    }
}
