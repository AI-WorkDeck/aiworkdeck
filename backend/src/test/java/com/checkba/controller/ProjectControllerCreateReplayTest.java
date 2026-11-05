// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller;

import com.checkba.model.dto.ProjectCreateRequest;
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
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** 桌面端 shareToCloud 超时重试带同一 clientRequestId：云端返回已建项目，不再建第二个。 */
@ExtendWith(MockitoExtension.class)
class ProjectControllerCreateReplayTest {
    @Mock private ProjectService projectService;
    @Mock private ProjectMemberService projectMemberService;
    @Mock private LocalProjectService localProjectService;
    @Mock private ProjectStorageResolver storageResolver;
    @InjectMocks private ProjectController controller;

    @Test void sameClientRequestIdReturnsTheAlreadyCreatedProject() {
        try (MockedStatic<AuthController> auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("sess")).thenReturn(7L);
            ProjectCreateRequest request = new ProjectCreateRequest();
            request.setProjectType("BLANK"); request.setName("案卷"); request.setClientRequestId("req-1");
            Project existing = new Project(); existing.setId(55L);
            when(projectService.findCreatedByRequestId(request, 7L)).thenReturn(Optional.of(existing));
            assertSame(existing, controller.createProject(request, "sess"));
            verify(projectService, never()).createProject(any(), any());
        }
    }

    @Test void createProjectStaysTransactional() throws Exception {
        assertNotNull(ProjectService.class.getMethod("createProject", ProjectCreateRequest.class, Long.class)
                .getAnnotation(Transactional.class), "建项目必须仍在事务里，幂等查询不能把注解挤走");
    }
}
