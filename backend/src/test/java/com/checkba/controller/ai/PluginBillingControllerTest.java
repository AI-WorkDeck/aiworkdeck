// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller.ai;

import com.checkba.controller.AuthController;
import com.checkba.service.LangText;
import com.checkba.service.LicenseService;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.account.AccountService;
import com.checkba.service.account.MachineAccountGuard;
import com.checkba.service.ai.PluginService;
import com.checkba.service.entitlement.EntitlementService;
import com.checkba.service.plugin.PluginConnectionService;
import com.checkba.service.site.SiteProfileService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class PluginBillingControllerTest {
    @TempDir Path root;

    private PluginConnectionController controller(EntitlementService entitlements) {
        return controller(entitlements, mock(MachineAccountGuard.class));
    }

    private PluginConnectionController controller(EntitlementService entitlements, MachineAccountGuard guard) {
        var plugins = mock(PluginService.class);
        when(plugins.getPlugin("paid-demo")).thenReturn(new PluginService.PluginMetadata());
        when(plugins.isEnabled("paid-demo")).thenReturn(true);
        return new PluginConnectionController(mock(PluginConnectionService.class), plugins, entitlements,
                guard, mock(ProjectMemberService.class), SiteProfileService.pinnedTo("https://www.workdeck.ai"));
    }

    @Test void explicitStatusSeesPurchaseWithoutRestartingTheHost() {
        var account = mock(AccountService.class);
        when(account.isConnected()).thenReturn(true);
        when(account.accountFingerprintOrNull()).thenReturn("synthetic-owner");
        when(account.fetchEntitlements()).thenReturn(List.of());
        var entitlements = new EntitlementService(mock(LicenseService.class), account, root.toString());
        assertTrue(entitlements.refreshQuietly());
        when(account.fetchEntitlements()).thenReturn(List.of(Map.of("feature", "plugin:paid-demo")));
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("test")).thenReturn(1L);
            var data = (Map<?, ?>) controller(entitlements).billing("paid-demo", null, "test").get("data");
            assertEquals(true, data.get("active"), "A completed purchase must be visible on explicit status refresh");
        }
    }

    @Test void checkoutUsesTheCurrentSiteAndUiLanguage() {
        try (var auth = mockStatic(AuthController.class); var lang = mockStatic(LangText.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("test")).thenReturn(1L);
            lang.when(LangText::isEnglish).thenReturn(true);
            var data = (Map<?, ?>) controller(mock(EntitlementService.class)).checkout("paid-demo", null, "test").get("data");
            assertEquals("https://www.workdeck.ai/en/marketplace/plugins", data.get("url"));
        }
    }
    @Test void offlineRefreshKeepsOnlyThisAccountsCachedEntitlement() {
        var account = mock(AccountService.class);
        when(account.isConnected()).thenReturn(true);
        when(account.accountFingerprintOrNull()).thenReturn("synthetic-owner");
        when(account.fetchEntitlements()).thenReturn(List.of(Map.of("feature", "plugin:paid-demo")));
        var entitlements = new EntitlementService(mock(LicenseService.class), account, root.toString());
        assertTrue(entitlements.refreshQuietly());
        when(account.fetchEntitlements()).thenThrow(new IllegalStateException("offline"));
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("test")).thenReturn(1L);
            var api = controller(entitlements);
            var cached = (Map<?, ?>) api.billing("paid-demo", null, "test").get("data");
            assertEquals(true, cached.get("active"));
            assertEquals(false, cached.get("refreshed"));
            when(account.accountFingerprintOrNull()).thenReturn("another-owner");
            var switched = (Map<?, ?>) api.billing("paid-demo", null, "test").get("data");
            assertEquals(false, switched.get("active"));
            assertEquals(false, switched.get("refreshed"));
        }
    }

    @Test void machineScopeIsCheckedBeforeRefreshingAccountData() {
        var entitlements = mock(EntitlementService.class);
        var guard = mock(MachineAccountGuard.class);
        doThrow(new IllegalArgumentException("denied")).when(guard).requireMachineScope("test");
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("test")).thenReturn(1L);
            assertThrows(IllegalArgumentException.class, () -> controller(entitlements, guard).billing("paid-demo", null, "test"));
            verifyNoInteractions(entitlements);
        }
    }

    @Test void disconnectedAccountHasNoEntitlementAndDoesNotFetch() {
        var account = mock(AccountService.class);
        var entitlements = new EntitlementService(mock(LicenseService.class), account, root.toString());
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("test")).thenReturn(1L);
            var data = (Map<?, ?>) controller(entitlements).billing("paid-demo", null, "test").get("data");
            assertEquals(false, data.get("active"));
            assertEquals(false, data.get("refreshed"));
            verify(account, never()).fetchEntitlements();
        }
    }

}
