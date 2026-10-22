// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service;

import com.checkba.repository.CloudConnectionRepository;
import com.checkba.service.account.AccountService;
import com.checkba.service.plugin.PluginCredentialStore;
import com.checkba.version.OfficialCloudService;
import com.checkba.model.entity.CloudConnection;
import okhttp3.RequestBody;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class DdClientConnectionServiceTest {
    final PluginCredentialStore credentials = mock(PluginCredentialStore.class);
    final AccountService account = mock(AccountService.class);
    final CloudConnectionRepository clouds = mock(CloudConnectionRepository.class);
    final OfficialCloudService official = mock(OfficialCloudService.class);
    final Map<String, String> encryptedStore = new HashMap<>();
    final List<String> sent = new ArrayList<>();
    DdClientConnectionService service;
    String detail = "{\"request\":{\"projectId\":42},\"items\":[{\"id\":7}]}";
    String authResponse = "{\"code\":0,\"data\":{\"sessionId\":\"secret-session\",\"projectId\":42,\"projectName\":\"Example\"}}";
    String projectResponse = "{\"id\":42,\"name\":\"Project name\"}";
    Runnable beforeSend = () -> {};
    @BeforeEach void setup() {
        when(account.accountFingerprintOrNull()).thenReturn("account-a");
        when(official.officialBaseUrl()).thenReturn("https://case.example.test");
        when(credentials.get(anyString())).thenAnswer(i -> encryptedStore.getOrDefault(i.getArgument(0), ""));
        doAnswer(i -> { encryptedStore.put(i.getArgument(0), i.getArgument(1)); return null; }).when(credentials).put(anyString(), anyString());
        service = new DdClientConnectionService(credentials, account, clouds, official) {
            @Override protected Reply send(String base, String session, String method, String path, RequestBody body) {
                sent.add(method + " " + base + path);
                beforeSend.run();
                String response = path.equals("/api/auth/client-login")
                    ? authResponse
                    : path.equals("/api/projects/42") ? projectResponse
                    : path.startsWith("/api/dd/requests/") ? detail
                    : path.startsWith("/api/dd/notifications?") ? "[{\"id\":12}]" : "[]";
                return new Reply(200, "application/json", null, response.getBytes(StandardCharsets.UTF_8));
            }
        };
    }
    String connect() { return service.connect(1L, "CODE", null).get("id").toString(); }
    @Test void listsOnlyOwnerAndNeverReturnsSession() {
        connect();
        assertEquals(1, service.list(1L).size());
        assertFalse(service.list(1L).toString().contains("secret-session"));
        assertTrue(service.list(2L).isEmpty());
        when(account.accountFingerprintOrNull()).thenReturn("account-b");
        assertTrue(service.list(1L).isEmpty());
    }
    @Test void otherLocalUserCannotUseConnectionOrCloudOrigin() {
        String id = connect(); sent.clear();
        assertThrows(ResponseStatusException.class, () -> service.proxy(2L, id, "GET", "/projects", null, null));
        CloudConnection cloud = new CloudConnection(); cloud.setUserId(2L); cloud.setServerUrl("https://other.test");
        when(clouds.findById(3L)).thenReturn(Optional.of(cloud));
        assertThrows(ResponseStatusException.class, () -> service.connect(1L, "CODE", 3L));
        assertTrue(sent.isEmpty());
    }
    @Test void proxyCannotEscapeWhitelistOrBoundProject() {
        String id = connect(); sent.clear();
        for (String path : List.of("/../auth/me", "/items/7/status", "/projects/43", "/files/3/download"))
            assertThrows(ResponseStatusException.class, () -> service.proxy(1L, id, "GET", path, 8L, null));
        assertTrue(sent.isEmpty());
        detail = "{\"request\":{\"projectId\":43},\"items\":[{\"id\":7}]}";
        assertThrows(ResponseStatusException.class, () -> service.proxy(1L, id, "POST", "/items/7/appeal", 8L, null));
        assertTrue(sent.stream().noneMatch(s -> s.startsWith("POST")));
    }
    @Test void itemMustExistInBoundRequestBeforeUpload() {
        String id = connect(); sent.clear();
        assertThrows(ResponseStatusException.class, () -> service.proxy(1L, id, "POST", "/items/9/submissions", 8L, null));
        assertThrows(ResponseStatusException.class, () -> service.proxy(1L, id, "POST", "/items/7/submissions", null, null));
        service.proxy(1L, id, "POST", "/items/7/submissions", 8L, null);
        assertEquals(1, sent.stream().filter(s -> s.startsWith("POST")).count());
    }
    @Test void accountSwitchDuringRedemptionCannotSaveInvitationForNewOwner() {
        beforeSend = () -> when(account.accountFingerprintOrNull()).thenReturn("account-b");
        assertThrows(ResponseStatusException.class, this::connect);
        assertTrue(encryptedStore.isEmpty());
    }
    @Test void revokedLocalConnectionAndOtherNotificationAreDenied() {
        String id = connect();
        assertThrows(ResponseStatusException.class, () -> service.proxy(1L, id, "POST", "/notifications/99/read", null, null));
        service.proxy(1L, id, "POST", "/notifications/12/read", null, null);
        service.disconnect(1L, id);
        assertThrows(ResponseStatusException.class, () -> service.proxy(1L, id, "GET", "/projects", null, null));
    }
    @Test void legacyInvitationResponseLooksUpProjectNameFromRawOrWrappedProject() {
        authResponse = "{\"code\":0,\"data\":{\"sessionId\":\"secret-session\",\"projectId\":42}}";
        assertEquals("Project name", service.connect(1L, "CODE", null).get("name"));
        projectResponse = "{\"code\":0,\"data\":{\"id\":42,\"name\":\"Wrapped project\"}}";
        assertEquals("Wrapped project", service.connect(1L, "CODE", null).get("name"));
    }
    @Test void disconnectDuringDetailsReadCannotReturnData() {
        String id = connect();
        beforeSend = () -> service.disconnect(1L, id);
        assertThrows(ResponseStatusException.class, () -> service.proxy(1L, id, "GET", "/requests/8", null, null));
    }
    @Test void identitySwitchDuringRemoteReadCannotReturnData() {
        String id = connect();
        beforeSend = () -> when(account.accountFingerprintOrNull()).thenReturn("account-b");
        assertThrows(ResponseStatusException.class, () -> service.proxy(1L, id, "GET", "/projects", null, null));
    }
}
