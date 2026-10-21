// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;

import com.checkba.model.entity.Project;
import com.checkba.repository.ProjectRepository;
import com.checkba.service.LocalProjectFileChangeService;
import com.checkba.service.ProjectFileAccessService;
import com.checkba.service.ProjectMemberService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class LocalProjectFileChangeControllerTest {
    private ProjectRepository projects;
    private ProjectMemberService members;
    private ProjectFileAccessService access;
    private LocalProjectFileChangeService changes;
    private MockMvc mvc;
    private MockedStatic<AuthController> auth;

    @BeforeEach
    void setup() {
        projects = mock(ProjectRepository.class);
        members = mock(ProjectMemberService.class);
        access = mock(ProjectFileAccessService.class);
        changes = new LocalProjectFileChangeService(projects, members, access);
        mvc = MockMvcBuilders.standaloneSetup(new LocalProjectFileChangeController(changes, true)).build();
        auth = mockStatic(AuthController.class);
        auth.when(() -> AuthController.getUserIdFromSession(null)).thenReturn(null);
        auth.when(() -> AuthController.getUserIdFromSession("local-session")).thenReturn(9L);
        for (long id : new long[]{1L, 2L}) {
            Project project = new Project();
            project.setLocalRoot("/synthetic/project-" + id);
            when(projects.findById(id)).thenReturn(Optional.of(project));
            when(members.hasReadPermission(id, 9L)).thenReturn(true);
        }
    }

    @AfterEach
    void cleanup() {
        changes.shutdown();
        auth.close();
    }

    private MvcResult connect(long id) throws Exception {
        return mvc.perform(get("/api/projects/" + id + "/files/changes").header("X-Session-Id", "local-session"))
                .andExpect(status().isOk()).andExpect(request().asyncStarted()).andReturn();
    }

    @Test
    void readyAndChangesAreProjectScopedWithNoFilePathsAndPingDoesNotLookLikeAChange() throws Exception {
        var one = connect(1);
        var anotherWindow = connect(1);
        var two = connect(2);
        assertThat(one.getResponse().getContentAsString()).isEqualTo("event:ready\ndata:{\"projectId\":1}\n\n");
        changes.filesChanged(1L);
        for (var result : new MvcResult[]{one, anotherWindow}) {
            assertThat(result.getResponse().getContentAsString()).contains("event:files_changed\ndata:{\"projectId\":1}\n\n");
        }
        assertThat(two.getResponse().getContentAsString()).doesNotContain("files_changed");
        changes.ping();
        assertThat(two.getResponse().getContentAsString()).endsWith("event:ping\ndata:{\"projectId\":2}\n\n");
    }

    @Test
    void authenticationMembershipClientAndLocalRootAreRequired() throws Exception {
        mvc.perform(get("/api/projects/1/files/changes")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/projects/3/files/changes").header("X-Session-Id", "local-session"))
                .andExpect(status().isForbidden());
        when(access.isClient(1L, 9L)).thenReturn(true);
        mvc.perform(get("/api/projects/1/files/changes").header("X-Session-Id", "local-session"))
                .andExpect(status().isForbidden());
        when(projects.findById(2L)).thenReturn(Optional.of(new Project()));
        mvc.perform(get("/api/projects/2/files/changes").header("X-Session-Id", "local-session"))
                .andExpect(status().isForbidden());
    }

    @Test
    void cloudDeploymentDoesNotExposeStream() throws Exception {
        var cloud = MockMvcBuilders.standaloneSetup(new LocalProjectFileChangeController(changes, false)).build();
        cloud.perform(get("/api/projects/1/files/changes").header("X-Session-Id", "local-session"))
                .andExpect(status().isNotFound());
    }

    @Test
    void revokedMembershipClosesStreamBeforeSendingAnyMoreSignals() throws Exception {
        var one = connect(1);
        String ready = one.getResponse().getContentAsString();
        when(members.hasReadPermission(1L, 9L)).thenReturn(false);
        changes.filesChanged(1L);
        assertThat(one.getResponse().getContentAsString()).isEqualTo(ready);
        assertThat(one.getAsyncResult(1000)).isNull();
        when(members.hasReadPermission(1L, 9L)).thenReturn(true);
        changes.filesChanged(1L);
        assertThat(one.getResponse().getContentAsString()).isEqualTo(ready);
    }
}
