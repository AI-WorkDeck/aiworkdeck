// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.tools;

import com.checkba.service.ai.SseEmitterService;
import com.checkba.service.ai.skill.SkillAuthoringService;
import com.checkba.service.ai.skill.SkillDefinition;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class SkillAuthoringToolsTest {

    @org.junit.jupiter.api.BeforeEach
    void signIn() {
        com.checkba.service.ai.context.ProjectContextHolder.setUserId(1L);
    }

    @org.junit.jupiter.api.AfterEach
    void signOut() {
        com.checkba.service.ai.context.ProjectContextHolder.clear();
    }

    private static SkillAuthoringTools tool(SkillAuthoringService svc, SseEmitterService sse, boolean admin) {
        com.checkba.repository.UserRepository users = mock(com.checkba.repository.UserRepository.class);
        com.checkba.service.AdminAccessService access = mock(com.checkba.service.AdminAccessService.class);
        com.checkba.model.entity.User user = new com.checkba.model.entity.User();
        org.mockito.Mockito.when(users.findById(1L)).thenReturn(java.util.Optional.of(user));
        org.mockito.Mockito.when(access.isAdmin(user)).thenReturn(admin);
        return new SkillAuthoringTools(svc, sse, users, access);
    }

    @Test
    void splitTriggersHandlesAllSeparators() {
        assertEquals(List.of("a", "b", "c", "d", "e", "f", "g"),
                SkillAuthoringTools.splitTriggers(" a, b，c、d;e；f\n g ,,\n"));
        assertEquals(List.of(), SkillAuthoringTools.splitTriggers(null));
    }

    @Test
    void createSkillSendsClientActionCard() throws Exception {
        SkillAuthoringService svc = mock(SkillAuthoringService.class);
        SseEmitterService sse = mock(SseEmitterService.class);
        SkillDefinition def = new SkillDefinition();
        def.setId("sig-pages");
        def.setName("签字页");
        def.setDescription("d");
        def.setVersion("1.0.0");
        def.setTriggers(List.of("t1"));
        when(svc.create(any())).thenReturn(def);

        String result = tool(svc, sse, true).create_skill(
                "sig-pages", "签字页", "d", "t1", " in ", " r ", " o ", "ins", "conv-1");

        assertTrue(result.startsWith("Skill created"));
        ArgumentCaptor<Object> json = ArgumentCaptor.forClass(Object.class);
        verify(sse).send(eq("conv-1"), eq("client_action"), json.capture());
        JsonNode n = new ObjectMapper().readTree((String) json.getValue());
        assertEquals("skill_created", n.get("action").asText());
        assertEquals("sig-pages", n.at("/skill/id").asText());
        assertEquals("签字页", n.at("/skill/name").asText());
        assertEquals("r", n.at("/skill/rules").asText());
    }

    @Test
    void createSkillReturnsErrorOnValidationFailure() {
        SkillAuthoringService svc = mock(SkillAuthoringService.class);
        SseEmitterService sse = mock(SseEmitterService.class);
        when(svc.create(any())).thenThrow(new IllegalArgumentException("bad"));

        String result = tool(svc, sse, true).create_skill(
                "x", "n", "d", "t", null, null, null, null, "conv-1");

        assertTrue(result.startsWith("Error: "));
        verifyNoInteractions(sse);
    }

    @Test
    void nonAdminCannotCreateSkills() {
        SkillAuthoringService svc = mock(SkillAuthoringService.class);
        SseEmitterService sse = mock(SseEmitterService.class);
        String result = tool(svc, sse, false).create_skill("x-skill", "X", "d", "t", "", "", "", "", "conv-1");
        org.junit.jupiter.api.Assertions.assertTrue(result.startsWith("Error: "), result);
        org.mockito.Mockito.verifyNoInteractions(svc, sse);
    }

    @Test
    void noSignedInUserCannotCreateSkills() {
        com.checkba.service.ai.context.ProjectContextHolder.clear();
        SkillAuthoringService svc = mock(SkillAuthoringService.class);
        String result = tool(svc, mock(SseEmitterService.class), true).create_skill("x-skill", "X", "d", "t", "", "", "", "", "conv-1");
        org.junit.jupiter.api.Assertions.assertTrue(result.startsWith("Error: "), result);
        org.mockito.Mockito.verifyNoInteractions(svc);
    }
}
