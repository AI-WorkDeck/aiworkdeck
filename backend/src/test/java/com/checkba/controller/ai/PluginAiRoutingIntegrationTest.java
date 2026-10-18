// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller.ai;

import com.checkba.config.AiModelProperties;
import com.checkba.controller.AuthController;
import com.checkba.repository.UserRepository;
import com.checkba.service.*;
import com.checkba.service.ai.*;
import com.checkba.service.plugin.PluginHostFactory;
import com.checkba.service.telemetry.TelemetryService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/** Controller -> real model factory -> real OpenAI-compatible HTTP, with separate synthetic
 * shared and BYOK servers. Account provisioning/credits and session identity are test doubles. */
class PluginAiRoutingIntegrationTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    @TempDir Path directory;
    final Map<String, String> settingsData = new HashMap<>();
    final List<String> sharedRequests = new CopyOnWriteArrayList<>(), ownRequests = new CopyOnWriteArrayList<>();
    final List<String> models = new CopyOnWriteArrayList<>();
    HttpServer shared, own;
    PlatformAiChannel channel;
    PlatformCreditsGate credits;
    PlatformUsageAccountant accountant;
    TokenUsageService usage;
    PluginService plugins;
    MockMvc mvc;
    volatile int sharedStatus = 200, ownStatus = 200;

    @BeforeEach void setup() throws Exception {
        shared = server(sharedRequests, true); own = server(ownRequests, false);
        var settings = mock(SystemSettingService.class);
        when(settings.get(anyString(), nullable(String.class))).thenAnswer(i -> settingsData.getOrDefault(i.getArgument(0), i.getArgument(1)));
        settingsData.put("ai.activeProvider", "AWD_CLOUD");
        settingsData.put(ChatModelFactory.SETTING_OPENROUTER_API_KEY, "synthetic-own-key");
        settingsData.put(ChatModelFactory.SETTING_OPENROUTER_BASE_URL, url(own));
        Path plugin = directory.resolve("ai-demo"); Files.createDirectories(plugin);
        Files.writeString(plugin.resolve("manifest.json"), "{\"id\":\"ai-demo\",\"name\":\"AI QA\",\"version\":\"1.0.0\",\"permissions\":[\"ai\"]}");
        plugins = new PluginService(settings, directory.toString()); plugins.init();
        var properties = new AiModelProperties();
        properties.getOpenRouter().setBaseUrl(url(shared));
        properties.getOpenRouter().setTimeout(Duration.ofSeconds(2));
        var resolver = new AuxModelResolver(settings, "qwen/qwen3.7-flash");
        channel = mock(PlatformAiChannel.class); credits = mock(PlatformCreditsGate.class);
        accountant = mock(PlatformUsageAccountant.class); usage = mock(TokenUsageService.class);
        when(channel.apiKey()).thenAnswer(i -> {
            assertNotNull(PlatformAiUserScope.current(), "Controller must set account scope before resolving shared credentials");
            return "synthetic-shared-" + PlatformAiUserScope.current();
        });
        when(channel.keyFingerprint()).thenAnswer(i -> "fixture-fingerprint-" + PlatformAiUserScope.current());
        var factory = new ChatModelFactory(properties, settings, channel, credits, accountant, resolver, mock(TelemetryService.class));
        var members = mock(ProjectMemberService.class); when(members.hasWritePermission(7L, 8L)).thenReturn(true); when(members.hasWritePermission(7L, 9L)).thenReturn(true);
        var controller = new PluginController(plugins, mock(PluginMarketService.class), mock(PluginRevocationService.class),
                mock(UserRepository.class), mock(AdminAccessService.class), mock(TelemetryService.class), mock(ToolRegistry.class), members,
                mock(PluginContributionService.class), mock(PluginHostFactory.class), factory, resolver, usage);
        mvc = MockMvcBuilders.standaloneSetup(controller).build();
    }
    HttpServer server(List<String> requests, boolean platform) throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/chat/completions", e -> {
            try {
                requests.add(String.valueOf(e.getRequestHeaders().getFirst("Authorization")));
                models.add(JSON.readTree(e.getRequestBody()).path("model").asText());
                int status = platform ? sharedStatus : ownStatus;
                String body = status == 200 ? "{\"id\":\"synthetic\",\"object\":\"chat.completion\",\"created\":1,\"model\":\"qwen/qwen3.7-flash\",\"choices\":[{\"index\":0,\"message\":{\"role\":\"assistant\",\"content\":\"fixture answer\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":2,\"completion_tokens\":3,\"total_tokens\":5}}"
                        : "{\"error\":{\"message\":\"synthetic provider failure\",\"type\":\"authentication_error\"}}";
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                e.getResponseHeaders().set("Content-Type", "application/json"); e.sendResponseHeaders(status, bytes.length); e.getResponseBody().write(bytes);
            } finally { e.close(); }
        }); server.start(); return server;
    }
    String url(HttpServer server) { return "http://127.0.0.1:" + server.getAddress().getPort() + "/v1"; }
    @AfterEach void cleanup() { shared.stop(0); own.stop(0); }
    Map<String, Object> request(long user) throws Exception {
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("synthetic-session")).thenReturn(user);
            var response = mvc.perform(post("/api/plugins/ai-demo/ai/complete").header("X-Session-Id", "synthetic-session")
                    .contentType("application/json").content("{\"projectId\":7,\"prompt\":\"synthetic request\",\"system\":\"test only\"}")).andReturn().getResponse();
            assertEquals(200, response.getStatus());
            assertNull(PlatformAiUserScope.current(), "Account scope must be restored after success and failure");
            return JSON.readValue(response.getContentAsString(), Map.class);
        }
    }
    @Test void sharedRouteUsesSessionAccountAndIgnoresByokEndpoint() throws Exception {
        assertEquals("fixture answer", request(8L).get("text")); assertEquals(0, request(9L).get("code"));
        assertEquals(List.of("Bearer synthetic-shared-8", "Bearer synthetic-shared-9"), sharedRequests); assertTrue(ownRequests.isEmpty());
        assertEquals(List.of("qwen/qwen3.7-flash", "qwen/qwen3.7-flash"), models);
        verify(credits).ensureCredits(8L); verify(credits).ensureCredits(9L);
        verify(accountant).ensureBaselineAsync(8L); verify(accountant).ensureBaselineAsync(9L);
        verify(usage).recordUsage(eq(7L), eq(8L), eq("qwen/qwen3.7-flash"), any(), isNull());
    }
    @Test void byokRouteNeverResolvesOrDebitsSharedAccount() throws Exception {
        settingsData.put("ai.activeProvider", "OPENROUTER");
        assertEquals("fixture answer", request(8L).get("text"));
        assertEquals(List.of("Bearer synthetic-own-key"), ownRequests); assertTrue(sharedRequests.isEmpty());
        verifyNoInteractions(channel, credits, accountant);
    }
    @Test void missingSharedCredentialDoesNotFallBackToWorkingByok() throws Exception {
        doThrow(new IllegalStateException("synthetic account disconnected")).when(channel).apiKey();
        assertEquals("ai_failed", request(8L).get("errorCode")); assertTrue(sharedRequests.isEmpty()); assertTrue(ownRequests.isEmpty());
    }
    @Test void failedSharedBalanceCheckPreventsBothRoutes() throws Exception {
        doThrow(new IllegalStateException("synthetic no credit")).when(credits).ensureCredits(8L);
        assertEquals("ai_failed", request(8L).get("errorCode")); assertTrue(sharedRequests.isEmpty()); assertTrue(ownRequests.isEmpty());
        verifyNoInteractions(channel);
    }
    @Test void sharedHttpFailureDoesNotTryByok() throws Exception {
        sharedStatus = 401; assertEquals("ai_failed", request(8L).get("errorCode"));
        assertFalse(sharedRequests.isEmpty()); assertTrue(ownRequests.isEmpty());
    }
    @Test void byokHttpFailureDoesNotTryShared() throws Exception {
        settingsData.put("ai.activeProvider", "OPENROUTER"); ownStatus = 401;
        assertEquals("ai_failed", request(8L).get("errorCode")); assertFalse(ownRequests.isEmpty()); assertTrue(sharedRequests.isEmpty());
        verifyNoInteractions(channel, credits, accountant);
    }
}
