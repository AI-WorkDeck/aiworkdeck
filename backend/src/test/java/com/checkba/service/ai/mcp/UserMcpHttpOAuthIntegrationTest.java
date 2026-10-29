// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.mcp;

import com.checkba.service.*;
import com.checkba.service.account.AccountService;
import com.checkba.service.ai.tools.ToolContext;
import com.checkba.service.plugin.PluginCredentialStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import okhttp3.HttpUrl;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;
import java.net.InetSocketAddress;
import java.nio.file.Path;
import java.time.*;
import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class UserMcpHttpOAuthIntegrationTest {
    @TempDir Path dir;
    @Test void savedOAuthConnectionAuthorizesRefreshesDiscoversAndCallsThroughTheRealHttpTransport() throws Exception {
        ObjectMapper json = new ObjectMapper();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        String base = "http://127.0.0.1:" + server.getAddress().getPort(), resource = base + "/mcp";
        List<String> requests = new CopyOnWriteArrayList<>(), grants = new CopyOnWriteArrayList<>();
        server.createContext("/", exchange -> {
            try {
                String path = exchange.getRequestURI().getPath(); Object result;
                if (path.equals("/mcp") && exchange.getRequestMethod().equals("GET")) {
                    exchange.getResponseHeaders().set("WWW-Authenticate", "Bearer resource_metadata=\"" + base + "/resource\"");
                    exchange.sendResponseHeaders(401, -1); return;
                }
                if (path.equals("/resource")) result = Map.of("resource", resource, "authorization_servers", List.of(base));
                else if (path.equals("/.well-known/oauth-authorization-server")) result = Map.of("issuer", base,
                        "authorization_endpoint", base + "/authorize", "token_endpoint", base + "/token", "registration_endpoint", base + "/register",
                        "response_types_supported", List.of("code"), "code_challenge_methods_supported", List.of("S256"), "token_endpoint_auth_methods_supported", List.of("none"));
                else if (path.equals("/register")) result = Map.of("client_id", "synthetic-client", "token_endpoint_auth_method", "none");
                else if (path.equals("/token")) {
                    String form = new String(exchange.getRequestBody().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8); grants.add(form);
                    boolean refresh = form.contains("grant_type=refresh_token");
                    result = Map.of("access_token", refresh ? "refreshed-token" : "expired-token", "refresh_token", "synthetic-refresh", "token_type", "Bearer", "expires_in", refresh ? 3600 : 0);
                } else if (path.equals("/mcp")) {
                    if (exchange.getRequestMethod().equals("DELETE")) { exchange.sendResponseHeaders(204, -1); return; }
                    assertEquals("Bearer refreshed-token", exchange.getRequestHeaders().getFirst("Authorization"));
                    var body = json.readTree(exchange.getRequestBody()); String method = body.path("method").asText(); requests.add(method);
                    if (method.equals("notifications/initialized")) { exchange.sendResponseHeaders(202, -1); return; }
                    Object payload;
                    if (method.equals("initialize")) { exchange.getResponseHeaders().set("MCP-Session-Id", UUID.randomUUID().toString()); payload = Map.of("protocolVersion", "2025-11-25", "capabilities", Map.of("tools", Map.of())); }
                    else if (method.equals("tools/list")) payload = Map.of("tools", List.of(Map.of("name", "echo", "inputSchema", Map.of("type", "object"))));
                    else payload = Map.of("content", List.of(Map.of("type", "text", "text", "real OAuth transport result")));
                    result = Map.of("jsonrpc", "2.0", "id", body.path("id").asText(), "result", payload);
                } else { exchange.sendResponseHeaders(404, -1); return; }
                byte[] bytes = json.writeValueAsBytes(result); exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, bytes.length); exchange.getResponseBody().write(bytes);
            } finally { exchange.close(); }
        }); server.start();
        try {
            Map<String, String> store = new HashMap<>(); var settings = mock(SystemSettingService.class);
            when(settings.get(anyString(), nullable(String.class))).thenAnswer(i -> store.getOrDefault(i.getArgument(0), i.getArgument(1)));
            doAnswer(i -> { store.put(i.getArgument(0), i.getArgument(1)); return null; }).when(settings).set(anyString(), anyString());
            var credentials = new PluginCredentialStore(settings, dir.resolve("key").toString());
            var account = mock(AccountService.class); when(account.accountFingerprintOrNull()).thenReturn("synthetic-account");
            var members = mock(ProjectMemberService.class); when(members.hasWritePermission(7L, 8L)).thenReturn(true);
            var service = new UserMcpConnectionService(settings, credentials, account, members, new PluginMcpHttpClient(new PluginMcpEndpointPolicy(true)));
            var oauth = new UserMcpOAuthService(credentials, base + "/api/mcp/oauth/callback", new PluginMcpEndpointPolicy(true), Clock.systemUTC(), Duration.ofSeconds(3));
            ReflectionTestUtils.setField(oauth, "localMode", true); ReflectionTestUtils.setField(service, "oauth", oauth);
            String scope = (String) service.snapshot(8L).get("scopeToken");
            // Only this fixture's save validation admits loopback; production clients never do.
            String id;
            try (var policy = mockStatic(PluginMcpEndpointPolicy.class, CALLS_REAL_METHODS)) {
                policy.when(() -> PluginMcpEndpointPolicy.validateUrl(resource)).thenAnswer(i -> null);
                var input = json.readValue(json.writeValueAsString(Map.of("name", "Synthetic OAuth", "url", resource, "authType", "oauth2")), UserMcpConnectionService.Update.class);
                id = (String) service.save(8L, null, input, scope).get("id");
            }
            String authUrl = (String) service.authorize(8L, id, scope).get("authorizationUrl");
            HttpUrl url = HttpUrl.get(authUrl); assertEquals("S256", url.queryParameter("code_challenge_method")); assertEquals(resource, url.queryParameter("resource"));
            oauth.callback(url.queryParameter("state"), "synthetic-code", null, null);
            service.test(8L, id, scope); service.enable(8L, id, true, scope);
            String name = service.bindings(8L).get(0).specification().name();
            assertTrue(service.callAgent(name, Map.of("argumentsJson", "{}"), new ToolContext(7L, "chat", 8L, null, List.of(), Set.of(name))).contains("real OAuth transport result"));
            assertEquals(2, grants.size()); assertTrue(grants.get(0).contains("code_verifier=")); assertTrue(grants.get(1).contains("grant_type=refresh_token"));
            assertEquals(1, Collections.frequency(requests, "tools/call"));
            String snapshot = json.writeValueAsString(service.snapshot(8L));
            assertFalse(snapshot.contains("refreshed-token")); assertFalse(store.values().stream().anyMatch(v -> v.contains("synthetic-refresh")));
        } finally { server.stop(0); }
    }
}
