// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller;

import com.checkba.model.entity.Project;
import com.checkba.service.LocalProjectService;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.ProjectService;
import com.checkba.storage.ProjectStorageResolver;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.MockedStatic;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.*;

/** Plugins reuse the same typed scratch workspace even if ordinary projects exist. */
@ExtendWith(MockitoExtension.class)
class ProjectControllerAddinDefaultTest {
    @Mock private ProjectService projectService;
    @Mock private ProjectMemberService projectMemberService;
    @Mock private LocalProjectService localProjectService;
    @Mock private ProjectStorageResolver storageResolver;
    @InjectMocks private ProjectController controller;

    @Test void returnsSameDefaultAndNeverCreatesOrRenamesOrdinaryProjects() {
        try (MockedStatic<AuthController> auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("sess")).thenReturn(7L);
            Project scratch = new Project(); scratch.setId(42L); scratch.setName("Scratch"); scratch.setProjectType(Project.SCRATCH);
            when(projectService.ensureScratchProject(7L)).thenReturn(
                    new ProjectService.ScratchResult(scratch, true), new ProjectService.ScratchResult(scratch, false));
            Map<String,Object> first = controller.ensureAddinDefaultProject("sess");
            Map<String,Object> second = controller.ensureAddinDefaultProject("sess");
            assertEquals(true, first.get("created")); assertEquals(false, second.get("created"));
            assertEquals(first.get("project"), second.get("project"));
            assertEquals(Map.of("id",42L,"name","Scratch","projectType",Project.SCRATCH,"isDefault",true), first.get("project"));
            verify(projectService, times(2)).ensureScratchProject(7L);
            verifyNoMoreInteractions(projectService);
        }
    }

    @Test void requiresValidSession() {
        try (MockedStatic<AuthController> auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession(null)).thenReturn(null);
            assertThrows(IllegalArgumentException.class, () -> controller.ensureAddinDefaultProject(null));
            verifyNoInteractions(projectService);
        }
    }
}
