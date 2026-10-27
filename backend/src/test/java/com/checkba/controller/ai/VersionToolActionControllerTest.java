// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller.ai;

import com.checkba.controller.AuthController;
import com.checkba.service.ai.VersionToolActionService;
import org.junit.jupiter.api.Test;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class VersionToolActionControllerTest {
    @Test void identityComesOnlyFromAuthenticatedSession() {
        VersionToolActionService service = mock(VersionToolActionService.class);
        VersionToolActionController controller = new VersionToolActionController(service);
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("session")).thenReturn(7L);
            when(service.execute("ticket", "conv", 7L, "session")).thenReturn(Map.of("status", "succeeded"));
            when(service.state("ticket", "conv", 7L, null)).thenReturn(Map.of("status", "prepared"));
            assertEquals(0, controller.execute(new VersionToolActionController.ExecuteRequest("ticket", "conv"), "session").get("code"));
            controller.state("ticket", "conv", null, "session");
            verify(service).execute("ticket", "conv", 7L, "session");
            verify(service).state("ticket", "conv", 7L, null);
            assertEquals(2, VersionToolActionController.ExecuteRequest.class.getRecordComponents().length,
                    "Client cannot supply actor/project/operation/arguments to execute");
        }
    }
}
