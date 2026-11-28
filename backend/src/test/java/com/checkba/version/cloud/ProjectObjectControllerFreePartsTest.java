// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version.cloud;

import com.checkba.version.ProjectRepoService;
import com.checkba.version.WorkSessionService;
import com.checkba.version.objects.LocalVersionObjectStore.ObjectRef;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.InputStream;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** W review must-fix 1: parts 2..n of a free object are free even when only part 1 carried the header. */
class ProjectObjectControllerFreePartsTest {
    @Test
    @SuppressWarnings("unchecked")
    void laterPartsWithoutTheHeaderStillTakeTheFreePath() throws Exception {
        GitAccessService access = mock(GitAccessService.class);
        ProjectRepoService repos = mock(ProjectRepoService.class);
        when(repos.isInitialized(7L)).thenReturn(true);
        ProjectObjectTransferService transfers = mock(ProjectObjectTransferService.class);
        ProjectObjectPlanService plans = mock(ProjectObjectPlanService.class);
        var controller = new ProjectObjectController(access, repos, mock(WorkSessionService.class), transfers);
        ReflectionTestUtils.setField(controller, "plans", plans);
        long size = 3L * ProjectObjectTransferService.PART_BYTES - 5;
        ObjectRef object = new ObjectRef("a".repeat(64), size);
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getContentLengthLong()).thenReturn((long) ProjectObjectTransferService.PART_BYTES);

        var captor = ArgumentCaptor.forClass(Runnable.class);
        when(plans.isFreePlan(7L, object)).thenReturn(true); // part 0 reserved it
        controller.put(7L, object.sha256(), 1, size, "b".repeat(64), null, request);
        verify(transfers).putPart(eq(7L), eq(object), eq(1), anyString(), any(), any(), captor.capture());
        assertNotNull(captor.getValue(), "free reservation path, not the paid capacity check");

        reset(transfers);
        when(plans.isFreePlan(7L, object)).thenReturn(false); // a paid object stays paid
        controller.put(7L, object.sha256(), 1, size, "b".repeat(64), null, request);
        verify(transfers).putPart(eq(7L), eq(object), eq(1), anyString(), any(), any(), isNull());
    }
}
