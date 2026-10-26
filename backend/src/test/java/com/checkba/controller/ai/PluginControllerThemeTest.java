// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller.ai;

import com.checkba.controller.AuthController;
import com.checkba.model.entity.User;
import com.checkba.repository.UserRepository;
import com.checkba.service.AdminAccessService;
import com.checkba.service.ai.PluginContributionService;
import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;
import java.util.Map;
import java.util.Optional;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class PluginControllerThemeTest {
    @Test void onlyAdministratorsCanChangeTheSharedThemeSelection() {
        UserRepository users = mock(UserRepository.class);
        AdminAccessService admins = mock(AdminAccessService.class);
        PluginContributionService themes = mock(PluginContributionService.class);
        PluginController controller = new PluginController(null, null, null, users, admins,
                null, null, null, themes, null, null, null, null);
        User user = new User();
        when(users.findById(7L)).thenReturn(Optional.of(user));
        try (MockedStatic<AuthController> auth = mockStatic(AuthController.class)) {
            assertEquals(403, controller.selectContributedTheme(Map.of("ref", ""), null).getStatusCode().value());
            auth.when(() -> AuthController.getUserIdFromSession("member")).thenReturn(7L);
            assertEquals(403, controller.selectContributedTheme(Map.of("ref", ""), "member").getStatusCode().value());
            verifyNoInteractions(themes);
            when(admins.isAdmin(user)).thenReturn(true);
            when(themes.selectedThemeRef()).thenReturn("theme-inkwash-zen:inkwash-zen");
            var result = controller.selectContributedTheme(Map.of("ref", "theme-inkwash-zen:inkwash-zen"), "member");
            assertEquals(200, result.getStatusCode().value());
            assertEquals("theme-inkwash-zen:inkwash-zen", result.getBody().get("selected"));
            verify(themes).selectTheme("theme-inkwash-zen:inkwash-zen");
        }
    }
}
