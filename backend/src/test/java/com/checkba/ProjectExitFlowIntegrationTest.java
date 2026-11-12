// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba;

import com.checkba.service.ai.tools.WebTools;
import com.checkba.version.ProjectRepoService;
import com.checkba.version.WorkSessionService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:project-exit-flow;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1"
})
@AutoConfigureMockMvc
@ActiveProfiles("desktop")
class ProjectExitFlowIntegrationTest {
    @TempDir
    static Path temp;

    @DynamicPropertySource
    static void storage(DynamicPropertyRegistry registry) {
        registry.add("storage.local.root-path", () -> temp.resolve("data").toAbsolutePath().toString());
    }

    private static String previousHome;

    @org.junit.jupiter.api.BeforeAll
    static void isolateHome() {
        previousHome = System.getProperty("user.home");
        System.setProperty("user.home", temp.resolve("home").toAbsolutePath().toString());
    }

    @org.junit.jupiter.api.AfterAll
    static void restoreHome() {
        if (previousHome != null) System.setProperty("user.home", previousHome);
    }

    @Autowired private MockMvc mvc;
    @Autowired private ObjectMapper om;
    @Autowired private WorkSessionService sessions;
    @Autowired private ProjectRepoService repos;
    @Autowired private com.checkba.repository.ProjectRepository projectRepository;

    @MockBean private WebTools webTools;

    private JsonNode request(String method, String path, Map<String, Object> body) throws Exception {
        var builder = method.equals("POST") ? post(path) : get(path);
        if (body != null) builder.contentType(APPLICATION_JSON).content(om.writeValueAsString(body));
        var response = mvc.perform(builder).andExpect(status().isOk()).andReturn();
        return om.readTree(response.getResponse().getContentAsByteArray());
    }

    @Test
    void changedScopeAndInterruptedInitializationCompleteThroughRealHttpFlow() throws Exception {
        Path changedRoot = temp.resolve("changed").toAbsolutePath();
        JsonNode opened = request("POST", "/api/projects/open-local", Map.of(
                "localRoot", changedRoot.toString(), "createFolder", true, "name", "Changed synthetic project"));
        long changedId = opened.path("data").path("projectId").asLong();
        assertTrue(changedId > 0);

        JsonNode current = request("GET", "/api/auth/me", null);
        long userId = current.path("data").path("id").asLong();
        assertTrue(userId > 0, current.toString());

        JsonNode untouched = request("POST", "/api/projects", Map.of(
                "projectType", "BLANK", "name", "Untouched synthetic project"));
        long untouchedId = untouched.path("id").asLong();
        assertTrue(untouchedId > 0);
        var untouchedProject = projectRepository.findById(untouchedId).orElseThrow();
        untouchedProject.setUpdatedAt(java.time.LocalDateTime.now().minusDays(1));
        projectRepository.save(untouchedProject);

        sessions.runLocked(changedId, () -> {
            repos.deleteRepository(changedId);
            repos.initEmptyForReceive(changedId);
        });
        sessions.onChangeSignal(changedId, userId, "QA");
        Files.writeString(changedRoot.resolve("note.txt"), "current content");

        JsonNode scope = request("GET", "/api/projects/exit-projects", null);
        java.util.List<Long> scopedIds = om.convertValue(scope.path("projectIds"),
                new com.fasterxml.jackson.core.type.TypeReference<>() {});
        assertTrue(scopedIds.contains(changedId), scope.toString());
        assertFalse(scopedIds.contains(untouchedId), scope.toString());

        JsonNode before = request("GET", "/api/projects/" + changedId + "/version/exit-status", null).path("data");
        assertEquals(1, before.path("changedCount").asInt(), before.toString());
        String requestId = before.path("receiptEpoch").asText() + ":" + UUID.randomUUID();
        JsonNode submitted = request("POST", "/api/projects/" + changedId + "/version/session/end",
                Map.of("title", "First recovered submission", "requestId", requestId)).path("data");
        assertEquals("SUCCEEDED", submitted.path("receiptState").asText(), submitted.toString());

        JsonNode after = request("GET", "/api/projects/" + changedId + "/version/exit-status", null).path("data");
        assertEquals(0, after.path("changedCount").asInt(), after.toString());
        String head = repos.resolveRef(changedId, "HEAD");
        assertNotNull(head);
        assertEquals("current content", new String(repos.readBlobAtCommit(changedId, head, "note.txt")));
        assertEquals("current content", Files.readString(changedRoot.resolve("note.txt")));
    }
}
