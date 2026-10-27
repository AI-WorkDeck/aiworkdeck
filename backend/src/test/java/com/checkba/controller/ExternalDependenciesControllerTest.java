// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;

import com.checkba.model.entity.User;
import com.checkba.repository.UserRepository;
import com.checkba.service.AdminAccessService;
import com.checkba.service.LibreOfficePdfConverter;
import com.checkba.service.ai.tools.PythonTools;
import com.checkba.service.tmeet.TmeetCliService;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import java.util.Optional;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ExternalDependenciesControllerTest {
    @Test void deniedRequestsNeverLaunchPrograms() {
        var lo = mock(LibreOfficePdfConverter.class); var python = mock(PythonTools.class);
        var tmeet = mock(TmeetCliService.class); var users = mock(UserRepository.class);
        var admins = mock(AdminAccessService.class);
        var controller = new ExternalDependenciesController(lo, python, tmeet, users, admins);
        try (var auth = mockStatic(AuthController.class)) {
            assertEquals(403, controller.check(null).getStatusCode().value());
            auth.when(() -> AuthController.getUserIdFromSession("user")).thenReturn(7L);
            assertEquals(403, controller.check("user").getStatusCode().value(), "server mode is closed");
            ReflectionTestUtils.setField(controller, "localMode", true);
            when(users.findById(7L)).thenReturn(Optional.of(new User()));
            assertEquals(403, controller.check("user").getStatusCode().value(), "admin required");
            verifyNoInteractions(lo, python, tmeet);
        }
    }
    @Test void failureOfOneProgramDoesNotHideOthersAndEachRequestRechecks() {
        var lo = mock(LibreOfficePdfConverter.class); var python = mock(PythonTools.class);
        var tmeet = mock(TmeetCliService.class); var users = mock(UserRepository.class);
        var admins = mock(AdminAccessService.class); var user = new User();
        var controller = new ExternalDependenciesController(lo, python, tmeet, users, admins);
        ReflectionTestUtils.setField(controller, "localMode", true);
        when(users.findById(7L)).thenReturn(Optional.of(user)); when(admins.isAdmin(user)).thenReturn(true);
        when(lo.probe()).thenThrow(new IllegalArgumentException("private installation path"));
        when(python.refreshDockerStatus()).thenReturn("DAEMON_UNAVAILABLE", "AVAILABLE");
        when(tmeet.probeCliStatus()).thenReturn("RUNTIME_MISSING", "AVAILABLE");
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("user")).thenReturn(7L);
            var first = controller.check("user").getBody(); var second = controller.check("user").getBody();
            assertEquals(0, first.get("code"));
            assertTrue(first.toString().contains("DAEMON_UNAVAILABLE"));
            assertTrue(second.toString().contains("AVAILABLE"));
            assertFalse(first.toString().contains("private installation path"));
            verify(python, times(2)).refreshDockerStatus(); verify(tmeet, times(2)).probeCliStatus();
            assertTrue(first.toString().contains("RUNTIME_MISSING"));
        }
    }
}
