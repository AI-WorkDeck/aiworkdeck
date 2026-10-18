// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.plugin;

import com.checkba.service.SystemSettingService;
import com.checkba.service.ai.PluginService;
import com.checkba.service.account.AccountService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Path;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class PluginConnectionServiceTest {
    @TempDir Path temp;
    final Map<String, String> database = new HashMap<>();
    PluginService plugins;
    AccountService account;
    PluginCredentialStore credentials;
    PluginService.PluginMetadata metadata;
    TestService service;
    Map<String, Object> declaration;

    @BeforeEach void setup() {
        SystemSettingService settings = mock(SystemSettingService.class);
        when(settings.get(anyString(), any())).thenAnswer(i -> database.getOrDefault(i.getArgument(0), i.getArgument(1)));
        doAnswer(i -> database.put(i.getArgument(0), i.getArgument(1))).when(settings).set(anyString(), anyString());
        credentials = new PluginCredentialStore(settings, temp.resolve("key").toString());
        plugins = mock(PluginService.class); account = mock(AccountService.class);
        metadata = new PluginService.PluginMetadata(); metadata.setId("demo"); metadata.setPermissions(List.of("network"));
        var contributes = new PluginService.Contributes(); metadata.setContributes(contributes);
        declaration = new LinkedHashMap<>(Map.of("id", "service", "label", "Demo", "baseUrl", "https://example.org",
                "auth", Map.of("type", "bearer"), "operations", Map.of("lookup", Map.of("path", "/v1/lookup", "method", "POST"))));
        contributes.setConnections(List.of(declaration));
        when(plugins.getPlugin("demo")).thenReturn(metadata); when(plugins.isEnabled("demo")).thenReturn(true);
        service = new TestService();
    }

    class TestService extends PluginConnectionService {
        Reply response = new Reply(200, Map.of("answer", "ok"));
        String lastUrl, lastBearer, lastBody;
        Runnable beforeReply = () -> {};
        TestService() { super(plugins, credentials, account, "http://localhost:9696/api/plugins/oauth/callback"); }
        @Override protected Reply exchange(String url, String method, String bearer, String body, boolean form) {
            lastUrl = url; lastBearer = bearer; lastBody = body;
            beforeReply.run(); return response;
        }
        void target(String url) { super.validateTarget(url); }
    }

    @Test void switchingAccountDuringCredentialResolutionDoesNotSendMixedContextRequest() {
        when(account.accountFingerprintOrNull()).thenReturn("account-b");
        service.connect("demo", 1L, "service", "synthetic-b-token");
        when(account.accountFingerprintOrNull()).thenReturn("account-a");
        service.connect("demo", 1L, "service", "synthetic-a-token");
        when(account.accountFingerprintOrNull()).thenReturn("account-a", "account-b");
        assertThrows(IllegalStateException.class, () -> service.request("demo", 1L, "service", "lookup", Map.of("data", "account-a-request")));
        assertNull(service.lastUrl, "No request may be sent with a different account's credential");
        assertNull(service.lastBearer);
    }

    @Test void encryptedPerUserCredentialsNeverAppearInStatus() {
        service.connect("demo", 1L, "service", "user-one-secret");
        service.connect("demo", 2L, "service", "user-two-secret");
        assertEquals("user-one-secret", service.bearerToken("demo", 1L, "service"));
        assertEquals("user-two-secret", service.bearerToken("demo", 2L, "service"));
        assertFalse(database.values().toString().contains("secret"));
        assertFalse(service.list("demo", 1L).toString().contains("secret"));
        service.disconnect("demo", 1L, "service");
        assertThrows(IllegalStateException.class, () -> service.bearerToken("demo", 1L, "service"));
        assertEquals("user-two-secret", service.bearerToken("demo", 2L, "service"));
    }

    @Test void accountSwitchCannotReuseConnection() {
        service.connect("demo", 1L, "service", "local-secret");
        when(account.accountFingerprintOrNull()).thenReturn("another-account");
        assertThrows(IllegalStateException.class, () -> service.bearerToken("demo", 1L, "service"));
    }

    @Test void changingServiceOriginRequiresReconnectionAndMcpCannotReuseAcrossOrigins() {
        service.connect("demo", 1L, "service", "private-token");
        assertEquals("private-token", service.bearerTokenForEndpoint("demo", 1L, "service", "https://example.org/mcp"));
        assertThrows(IllegalArgumentException.class, () -> service.bearerTokenForEndpoint("demo", 1L, "service", "https://other.example/mcp"));
        declaration.put("baseUrl", "https://other.example");
        assertThrows(IllegalStateException.class, () -> service.bearerToken("demo", 1L, "service"));
        assertEquals(false, service.list("demo", 1L).get(0).get("connected"));
        assertEquals(true, service.list("demo", 1L).get(0).get("needsReconnect"));
    }

    @Test void disconnectRevokesLiveMcpCredentialGuard() {
        service.connect("demo", 1L, "service", "token");
        var guard = service.guard("demo", 1L, "service");
        assertTrue(guard.getAsBoolean());
        service.disconnect("demo", 1L, "service");
        assertFalse(guard.getAsBoolean());
    }

    @Test void brokenCredentialStillExposesReconnectableDeclaration() {
        service.connect("demo", 1L, "service", "token");
        database.replaceAll((key, value) -> "broken");
        assertEquals(false, service.list("demo", 1L).get(0).get("connected"));
        assertEquals(true, service.list("demo", 1L).get(0).get("needsReconnect"));
        service.connect("demo", 1L, "service", "replacement");
        assertEquals("replacement", service.bearerToken("demo", 1L, "service"));
    }

    @Test void credentialCiphertextCannotMoveToAnotherScope() {
        credentials.put("one", "secret");
        database.put("plugin.credentials.two", database.get("plugin.credentials.one"));
        assertThrows(IllegalStateException.class, () -> credentials.get("two"));
    }

    @Test void operationsAreFixedAndLateResultsAreDiscarded() {
        service.connect("demo", 1L, "service", "token");
        assertEquals("ok", service.request("demo", 1L, "service", "lookup", Map.of("q", "hello")).get("answer"));
        assertEquals("https://example.org/v1/lookup", service.lastUrl); assertEquals("token", service.lastBearer);
        assertThrows(IllegalArgumentException.class, () -> service.request("demo", 1L, "service", "../admin", Map.of()));
        service.beforeReply = () -> service.disconnect("demo", 1L, "service");
        assertThrows(IllegalStateException.class, () -> service.request("demo", 1L, "service", "lookup", Map.of()));
    }

    @Test void oauthUsesOneUseStatePkceAndRefresh() {
        declaration.put("auth", Map.of("type", "oauth2", "authorizationUrl", "https://example.org/authorize",
                "tokenUrl", "https://example.org/token", "clientId", "public-client", "scopes", List.of("read")));
        String url = String.valueOf(service.authorize("demo", 1L, "service").get("authorizationUrl"));
        Map<String, String> query = query(URI.create(url).getRawQuery());
        assertEquals("S256", query.get("code_challenge_method"));
        assertFalse(url.contains("code_verifier"));
        service.response = new PluginConnectionService.Reply(200, Map.of("access_token", "access", "refresh_token", "refresh", "expires_in", 0));
        service.callback(query.get("state"), "code");
        String verifier = query(service.lastBody).get("code_verifier");
        assertNotNull(verifier); assertTrue(verifier.length() >= 43);
        assertThrows(IllegalArgumentException.class, () -> service.callback(query.get("state"), "code"));
        service.response = new PluginConnectionService.Reply(200, Map.of("access_token", "new-access", "expires_in", 3600));
        assertEquals("new-access", service.bearerToken("demo", 1L, "service"));
        assertEquals("refresh", query(service.lastBody).get("refresh_token"));
    }

    @Test void disconnectInvalidatesPendingAuthorization() {
        declaration.put("auth", Map.of("type", "oauth2", "authorizationUrl", "https://example.org/authorize",
                "tokenUrl", "https://example.org/token", "clientId", "client"));
        var auth = service.authorize("demo", 1L, "service");
        String state = query(URI.create(String.valueOf(auth.get("authorizationUrl"))).getRawQuery()).get("state");
        service.disconnect("demo", 1L, "service");
        assertThrows(IllegalArgumentException.class, () -> service.callback(state, "code"));
    }

    @Test void disabledAndUndeclaredPermissionsFailClosed() {
        when(plugins.isEnabled("demo")).thenReturn(false);
        assertThrows(IllegalArgumentException.class, () -> service.list("demo", 1L));
        when(plugins.isEnabled("demo")).thenReturn(true); metadata.setPermissions(List.of());
        assertThrows(IllegalArgumentException.class, () -> service.list("demo", 1L));
    }

    @Test void privateDestinationsAndUnfixedOperationPathsAreRejected() {
        assertThrows(IllegalArgumentException.class, () -> service.target("https://127.0.0.1/private"));
        assertThrows(IllegalArgumentException.class, () -> service.target("http://example.org"));
        assertThrows(IllegalArgumentException.class, () -> service.target("https://token@example.org"));
        declaration.put("operations", Map.of("escape", Map.of("path", "/%2e%2e/admin", "method", "GET")));
        assertThrows(IllegalArgumentException.class, () -> service.list("demo", 1L));
    }

    @Test void billingRequiresServerBooleanAndKeepsPaymentErrorsStructured() {
        declaration.put("auth", Map.of("type", "none"));
        declaration.put("billing", Map.of("statusOperation", "lookup", "checkoutUrl", "https://example.org/subscribe"));
        assertThrows(IllegalStateException.class, () -> service.billingStatus("demo", 1L, "service"));
        service.response = new PluginConnectionService.Reply(200, Map.of("active", true, "plan", "pro"));
        assertEquals(true, service.billingStatus("demo", 1L, "service").get("active"));
        service.response = new PluginConnectionService.Reply(402, Map.of());
        assertEquals("payment_required", assertThrows(IllegalStateException.class,
                () -> service.billingStatus("demo", 1L, "service")).getMessage());
    }

    private static Map<String, String> query(String query) {
        Map<String, String> values = new HashMap<>();
        for (String pair : query.split("&")) { String[] parts = pair.split("=", 2); values.put(parts[0], URLDecoder.decode(parts[1], StandardCharsets.UTF_8)); }
        return values;
    }
}
