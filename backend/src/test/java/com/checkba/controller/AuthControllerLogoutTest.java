// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller;

import com.checkba.config.GlobalExceptionHandler;
import com.checkba.model.entity.DeviceToken;
import com.checkba.repository.DeviceTokenRepository;
import com.checkba.service.DeviceTokenService;
import com.checkba.service.UserService;
import com.checkba.service.UserSessionService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * POST /api/auth/logout with an awdt_ device token (what the Office/WPS add-in sends) must revoke
 * that token; before, only the session table was touched and the token kept working.
 */
class AuthControllerLogoutTest {

    private final Map<Long, DeviceToken> rows = new HashMap<>();
    private Object previousDeviceTokens;
    private Object previousLocalIdentity;
    private DeviceTokenService tokens;
    private UserSessionService sessions;
    private AuthController controller;

    private static Field staticField(String name) throws Exception {
        Field f = AuthController.class.getDeclaredField(name);
        f.setAccessible(true);
        return f;
    }

    @BeforeEach
    void setUp() throws Exception {
        previousDeviceTokens = staticField("staticDeviceTokenService").get(null);
        previousLocalIdentity = staticField("staticLocalIdentityService").get(null);
        staticField("staticLocalIdentityService").set(null, null); // server mode

        DeviceTokenRepository repo = mock(DeviceTokenRepository.class);
        when(repo.save(any())).thenAnswer(inv -> {
            DeviceToken t = inv.getArgument(0);
            if (t.getId() == null) t.setId((long) rows.size() + 1);
            rows.put(t.getId(), t);
            return t;
        });
        when(repo.findByTokenHash(anyString())).thenAnswer(inv -> rows.values().stream()
                .filter(t -> t.getTokenHash().equals(inv.getArgument(0))).findFirst());
        when(repo.findById(anyLong())).thenAnswer(inv -> Optional.ofNullable(rows.get((Long) inv.getArgument(0))));
        doAnswer(inv -> rows.remove(((DeviceToken) inv.getArgument(0)).getId())).when(repo).delete(any());
        tokens = new DeviceTokenService(repo); // registers itself as the static resolver

        UserService users = mock(UserService.class);
        sessions = mock(UserSessionService.class);
        controller = new AuthController(users, null, mock(com.checkba.service.AdminAccessService.class), tokens,
                null, null, null, null, null, sessions, false, null,
                mock(com.checkba.service.account.AccountDeletionService.class), null);
    }

    @AfterEach
    void restore() throws Exception {
        staticField("staticDeviceTokenService").set(null, previousDeviceTokens);
        staticField("staticLocalIdentityService").set(null, previousLocalIdentity);
    }

    @Test
    void logoutRevokesTheDeviceTokenItWasCalledWith() {
        String pane = tokens.issue(42L, "Word").plaintext();
        String otherDevice = tokens.issue(42L, "Excel").plaintext();
        assertEquals(42L, AuthController.getUserIdFromSession(pane));

        assertEquals(0, controller.logout(pane).get("code"));

        assertEquals(null, AuthController.getUserIdFromSession(pane));
        assertEquals(GlobalExceptionHandler.CODE_UNAUTHENTICATED, controller.getCurrentUser(pane).get("code"));
        // Only the token in the request is revoked; the user's other devices stay signed in.
        assertEquals(42L, AuthController.getUserIdFromSession(otherDevice));
    }

    @Test
    void logoutWithUnknownOrRevokedDeviceTokenStillSucceeds() {
        assertEquals(0, controller.logout("awdt_not-a-real-token").get("code"));
        String pane = tokens.issue(42L, "Word").plaintext();
        controller.logout(pane);
        assertEquals(0, controller.logout(pane).get("code"));
    }

    @Test
    void sessionLogoutStillRevokesSessionAndLeavesDeviceTokensAlone() {
        String pane = tokens.issue(42L, "Word").plaintext();

        assertEquals(0, controller.logout("plain-session-id").get("code"));
        assertEquals(0, controller.logout(null).get("code"));

        verify(sessions).revoke("plain-session-id");
        assertEquals(42L, AuthController.getUserIdFromSession(pane));
    }
}
