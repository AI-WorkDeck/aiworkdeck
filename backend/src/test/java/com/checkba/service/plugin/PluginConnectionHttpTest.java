// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.plugin;

import com.checkba.controller.AuthController;
import com.checkba.controller.ai.PluginConnectionController;
import com.checkba.model.entity.SystemSetting;
import com.checkba.repository.SystemSettingRepository;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.SystemSettingService;
import com.checkba.service.account.AccountService;
import com.checkba.service.account.MachineAccountGuard;
import com.checkba.service.ai.PluginService;
import com.checkba.service.entitlement.EntitlementService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.MockedStatic;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Actual loopback HTTP + real controller/service/AES store; repository and identity are synthetic. */
class PluginConnectionHttpTest {
    @TempDir Path temp;
    final ObjectMapper json = new ObjectMapper();
    final Map<String, SystemSetting> database = new ConcurrentHashMap<>();
    final Map<String, Object> declaration = new LinkedHashMap<>();
    final List<Map<String, String>> tokenRequests = new CopyOnWriteArrayList<>();
    final List<String> authHeaders = new CopyOnWriteArrayList<>();
    final AtomicInteger operationCount = new AtomicInteger();
    HttpServer provider; ExecutorService executor; PluginConnectionService service;
    PluginCredentialStore credentials; PluginService plugins; AccountService account;
    PluginService.PluginMetadata metadata; MockMvc mvc; MockedStatic<AuthController> identity;
    volatile int operationStatus = 200; volatile Map<String, Object> operationReply = Map.of("answer", "synthetic");
    volatile int tokenStatus = 200; volatile Map<String, Object> tokenReply = Map.of("access_token", "synthetic-access", "refresh_token", "synthetic-refresh", "expires_in", 3600);
    volatile String challenge;
    volatile CountDownLatch refreshEntered, releaseRefresh, operationEntered, releaseOperation;

    @BeforeEach void setup() throws Exception {
        var repository = mock(SystemSettingRepository.class);
        when(repository.findByKey(anyString())).thenAnswer(i -> Optional.ofNullable(database.get(i.getArgument(0))));
        when(repository.save(any(SystemSetting.class))).thenAnswer(i -> { SystemSetting s = i.getArgument(0); database.put(s.getKey(), s); return s; });
        credentials = new PluginCredentialStore(new SystemSettingService(repository), temp.resolve("credentials.key").toString());
        plugins = mock(PluginService.class); account = mock(AccountService.class);
        metadata = new PluginService.PluginMetadata(); metadata.setId("fixture"); metadata.setPermissions(List.of("network"));
        var contributes = new PluginService.Contributes(); metadata.setContributes(contributes);
        declaration.putAll(Map.of("id", "service", "baseUrl", "https://service.example.invalid", "auth", Map.of("type", "bearer"),
                "operations", Map.of("lookup", Map.of("path", "/lookup", "method", "POST"), "status", Map.of("path", "/status", "method", "GET")),
                "billing", Map.of("statusOperation", "status", "checkoutUrl", "https://service.example.invalid/checkout")));
        contributes.setConnections(List.of(declaration));
        when(plugins.getPlugin("fixture")).thenReturn(metadata); when(plugins.isEnabled("fixture")).thenReturn(true);
        provider = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0); executor = Executors.newCachedThreadPool(); provider.setExecutor(executor);
        provider.createContext("/", exchange -> {
            try {
                int status; Map<String, Object> body;
                if (exchange.getRequestURI().getPath().equals("/oauth/token")) {
                    var args = query(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)); tokenRequests.add(args);
                    if ("refresh_token".equals(args.get("grant_type")) && refreshEntered != null) { refreshEntered.countDown(); releaseRefresh.await(5, TimeUnit.SECONDS); }
                    if (args.get("grant_type").equals("authorization_code")) {
                        String computed = Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(args.get("code_verifier").getBytes(StandardCharsets.US_ASCII)));
                        if (!computed.equals(challenge) || !"synthetic-code".equals(args.get("code"))) { status = 400; body = Map.of("error", "invalid_grant"); }
                        else { status = tokenStatus; body = tokenReply; }
                    } else { status = tokenStatus; body = tokenReply; }
                } else {
                    operationCount.incrementAndGet(); authHeaders.add(String.valueOf(exchange.getRequestHeaders().getFirst("Authorization")));
                    if (operationEntered != null) { operationEntered.countDown(); releaseOperation.await(5, TimeUnit.SECONDS); }
                    status = operationStatus; body = operationReply;
                }
                byte[] bytes = json.writeValueAsBytes(body); exchange.getResponseHeaders().add("Content-Type", "application/json");
                if (status == 302) exchange.getResponseHeaders().add("Location", "http://127.0.0.1:" + provider.getAddress().getPort() + "/forbidden-redirect");
                exchange.sendResponseHeaders(status, bytes.length); exchange.getResponseBody().write(bytes);
            } catch (Exception e) { throw new RuntimeException(e); } finally { exchange.close(); }
        }); provider.start();
        service = new PluginConnectionService(plugins, credentials, account, "http://127.0.0.1:19751/api/plugins/oauth/callback");
        org.springframework.test.util.ReflectionTestUtils.setField(service, "localMode", true);
        PluginConnectionTestTransport.install(service, URI.create("http://127.0.0.1:" + provider.getAddress().getPort()));
        mvc = MockMvcBuilders.standaloneSetup(new PluginConnectionController(service, plugins, mock(EntitlementService.class), mock(MachineAccountGuard.class), mock(ProjectMemberService.class), mock(com.checkba.service.site.SiteProfileService.class))).build();
        identity = mockStatic(AuthController.class); identity.when(() -> AuthController.getUserIdFromSession("one")).thenReturn(1L); identity.when(() -> AuthController.getUserIdFromSession("two")).thenReturn(2L);
    }
    @AfterEach void cleanup() { if (identity != null) identity.close(); if (provider != null) provider.stop(0); if (executor != null) executor.shutdownNow(); }
    String auth() {
        declaration.put("auth", Map.of("type", "oauth2", "authorizationUrl", "https://service.example.invalid/oauth/authorize", "tokenUrl", "https://service.example.invalid/oauth/token", "clientId", "synthetic-client", "scopes", List.of("read")));
        var q = query(URI.create((String) service.authorize("fixture", 1L, "service").get("authorizationUrl")).getRawQuery()); challenge = q.get("code_challenge"); assertEquals("S256", q.get("code_challenge_method")); return q.get("state");
    }
    void connect() throws Exception {
        mvc.perform(post("/api/plugins/fixture/connections/service/connect").header("X-Session-Id", "one").contentType("application/json").content("{\"token\":\"synthetic-bearer-secret\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));
    }
    @Test void realControllerHttpAndEncryptedStoreKeepUsersAndSubscriptionResultsSeparate() throws Exception {
        connect(); operationReply = Map.of("active", true, "plan", "fixture-pro", "private", "not-exposed");
        mvc.perform(get("/api/plugins/fixture/billing").param("connectionId", "service").header("X-Session-Id", "one"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.active").value(true)).andExpect(jsonPath("$.data.provider").value("developer")).andExpect(jsonPath("$.data.private").doesNotExist());
        assertEquals("Bearer synthetic-bearer-secret", authHeaders.get(0));
        assertTrue(database.values().stream().noneMatch(s -> s.getValue().contains("synthetic-bearer-secret")));
        assertEquals(32, Files.size(temp.resolve("credentials.key")));
        mvc.perform(get("/api/plugins/fixture/billing").param("connectionId", "service").header("X-Session-Id", "two"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.errorCode").value("connection_required"));
        assertEquals(1, operationCount.get());
        mvc.perform(get("/api/plugins/fixture/billing/checkout").param("connectionId", "service").header("X-Session-Id", "one"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.url").value("https://service.example.invalid/checkout"));
        assertEquals(1, operationCount.get(), "Opening checkout only returns the declared link; it never charges");
    }
    @Test void pkceExchangeRefreshReplayAndDeniedCallbackUseRealHttp() throws Exception {
        String state = auth(); tokenReply = Map.of("access_token", "old-access", "refresh_token", "synthetic-refresh", "expires_in", 0);
        mvc.perform(get("/api/plugins/oauth/callback").param("state", state).param("code", "synthetic-code"))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"));
        tokenReply = Map.of("access_token", "new-access", "expires_in", 3600);
        assertEquals("new-access", service.bearerToken("fixture", 1L, "service"));
        assertEquals("refresh_token", tokenRequests.get(1).get("grant_type")); assertEquals("synthetic-refresh", tokenRequests.get(1).get("refresh_token"));
        mvc.perform(get("/api/plugins/oauth/callback").param("state", state).param("code", "synthetic-code")).andExpect(status().isBadRequest());
        assertEquals(2, tokenRequests.size());
        state = auth(); mvc.perform(get("/api/plugins/oauth/callback").param("state", state).param("error", "access_denied")).andExpect(status().isBadRequest());
        assertThrows(IllegalArgumentException.class, () -> service.callback("unknown-state", "synthetic-code"));
        String nextState = auth(); tokenReply = Map.of("access_token", "reconnected", "expires_in", 3600); service.callback(nextState, "synthetic-code");
        assertEquals("reconnected", service.bearerToken("fixture", 1L, "service"));
    }
    @Test void unauthorizedBearerResponseChangesConnectionStatusToReconnect() throws Exception {
        connect(); operationStatus = 401; operationReply = Map.of("error", "synthetic-bearer-secret");
        mvc.perform(post("/api/plugins/fixture/connections/service/request").header("X-Session-Id", "one").contentType("application/json").content("{\"operation\":\"lookup\"}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.errorCode").value("connection_required"));
        assertEquals(false, service.list("fixture", 1L).get(0).get("connected"));
        assertEquals(true, service.list("fixture", 1L).get(0).get("needsReconnect"));
    }
    @Test void expiredOAuthWithoutRefreshDoesNotAdvertiseConnected() {
        String state = auth(); tokenReply = Map.of("access_token", "expired-access", "expires_in", 0); service.callback(state, "synthetic-code");
        assertEquals(false, service.list("fixture", 1L).get(0).get("connected"));
        assertEquals(true, service.list("fixture", 1L).get(0).get("needsReconnect"));
    }
    @Test void serviceCannotEchoHostHeldCredentialsIntoPluginResponse() throws Exception {
        connect(); operationReply = Map.of("nested", List.of(Map.of("result", "echo: synthetic-bearer-secret")));
        assertThrows(IllegalStateException.class, () -> service.request("fixture", 1L, "service", "lookup", Map.of()));
    }
    @Test void paymentAndRedirectFailuresStayStructuredWithoutFollowingLocation() throws Exception {
        connect(); operationStatus = 402;
        mvc.perform(get("/api/plugins/fixture/billing").param("connectionId", "service").header("X-Session-Id", "one"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.errorCode").value("payment_required"));
        operationStatus = 302; assertThrows(IllegalStateException.class, () -> service.request("fixture", 1L, "service", "lookup", Map.of()));
        assertEquals(2, operationCount.get());
    }
    @Test void actualListenerPortBecomesLocalCallbackAndServerModeRequiresExplicitHttps() {
        var context = mock(org.springframework.boot.web.context.WebServerApplicationContext.class);
        var server = mock(org.springframework.boot.web.server.WebServer.class);
        var event = mock(org.springframework.boot.web.context.WebServerInitializedEvent.class);
        when(event.getApplicationContext()).thenReturn(context); when(event.getWebServer()).thenReturn(server);
        when(server.getPort()).thenReturn(19751); when(context.getEnvironment()).thenReturn(new org.springframework.mock.env.MockEnvironment().withProperty("security.local-mode", "true"));
        org.springframework.test.util.ReflectionTestUtils.setField(service, "redirectUri", "");
        service.onWebServerInitialized(event);
        String state = auth();
        assertNotNull(state);
        String uri = (String) org.springframework.test.util.ReflectionTestUtils.getField(service, "redirectUri");
        assertEquals("http://127.0.0.1:19751/api/plugins/oauth/callback", uri);
        service.callback(state, "synthetic-code"); assertEquals(uri, tokenRequests.get(0).get("redirect_uri"));
        org.springframework.test.util.ReflectionTestUtils.setField(service, "localMode", false);
        assertThrows(IllegalStateException.class, () -> service.authorize("fixture", 1L, "service"));
        org.springframework.test.util.ReflectionTestUtils.setField(service, "redirectUri", "https://team.example.invalid/api/plugins/oauth/callback");
        assertNotNull(service.authorize("fixture", 1L, "service").get("authorizationUrl"));
    }
    @Test void expiredAuthorizationCannotExchangeAndCanRestart() {
        String state = auth(); java.time.Instant expired = java.time.Instant.now().plusSeconds(601);
        try (var time = mockStatic(java.time.Instant.class, CALLS_REAL_METHODS)) {
            time.when(java.time.Instant::now).thenReturn(expired);
            assertThrows(IllegalArgumentException.class, () -> service.callback(state, "synthetic-code"));
        }
        assertEquals(0, tokenRequests.size()); String next = auth(); service.callback(next, "synthetic-code");
        assertEquals("synthetic-access", service.bearerToken("fixture", 1L, "service"));
    }
    @Test void invalidRefreshBecomesReconnectableWithoutRetryLoop() {
        String state = auth(); tokenReply = Map.of("access_token", "old-access", "refresh_token", "synthetic-refresh", "expires_in", 0); service.callback(state, "synthetic-code");
        tokenStatus = 400; tokenReply = Map.of("error", "invalid_grant");
        assertEquals("connection_required", assertThrows(IllegalStateException.class, () -> service.bearerToken("fixture", 1L, "service")).getMessage());
        assertEquals(false, service.list("fixture", 1L).get(0).get("connected"));
        assertThrows(IllegalStateException.class, () -> service.bearerToken("fixture", 1L, "service"));
        assertEquals(2, tokenRequests.size(), "Invalid refresh must not be retried on each operation");
    }
    @Test void disconnectCancelsAnInFlightRefreshAndNoLateCredentialReturns() throws Exception {
        String state = auth(); tokenReply = Map.of("access_token", "old-access", "refresh_token", "synthetic-refresh", "expires_in", 0); service.callback(state, "synthetic-code");
        tokenReply = Map.of("access_token", "late-refreshed-access", "expires_in", 3600);
        refreshEntered = new CountDownLatch(1); releaseRefresh = new CountDownLatch(1);
        Future<?> request = executor.submit(() -> service.request("fixture", 1L, "service", "lookup", Map.of()));
        assertTrue(refreshEntered.await(2, TimeUnit.SECONDS));
        try {
            Future<?> disconnect = executor.submit(() -> service.disconnect("fixture", 1L, "service"));
            disconnect.get(1, TimeUnit.SECONDS);
            assertThrows(ExecutionException.class, () -> request.get(1, TimeUnit.SECONDS));
            assertEquals(false, service.list("fixture", 1L).get(0).get("connected"));
            assertEquals(0, operationCount.get());
        } finally { releaseRefresh.countDown(); }
    }
    @Test void olderDisconnectCannotEraseNewerOAuthAuthorization() throws Exception {
        auth();
        InvalidationPause pause = pauseNextInvalidation();
        Future<?> older = executor.submit(() -> service.disconnect("fixture", 1L, "service"));
        assertTrue(pause.entered.await(2, TimeUnit.SECONDS));
        var newerThread = new java.util.concurrent.atomic.AtomicReference<Thread>();
        Future<String> newer = executor.submit(() -> { newerThread.set(Thread.currentThread()); return auth(); });
        try { awaitNewerProgressOrLifecycleLock(newerThread, pause, newer::isDone); }
        finally { pause.release.countDown(); }
        older.get(2, TimeUnit.SECONDS);
        String state = newer.get(2, TimeUnit.SECONDS);
        service.callback(state, "synthetic-code");
        assertEquals("synthetic-access", service.bearerToken("fixture", 1L, "service"));
    }

    @Test void olderDisconnectCannotCancelNewerCredentialsHttpCall() throws Exception {
        connect();
        InvalidationPause pause = pauseNextInvalidation();
        Future<?> older = executor.submit(() -> service.disconnect("fixture", 1L, "service"));
        assertTrue(pause.entered.await(2, TimeUnit.SECONDS));
        operationEntered = new CountDownLatch(1); releaseOperation = new CountDownLatch(1);
        var newerThread = new java.util.concurrent.atomic.AtomicReference<Thread>();
        Future<?> newer = executor.submit(() -> {
            newerThread.set(Thread.currentThread());
            service.connect("fixture", 1L, "service", "synthetic-newer-token");
            return service.request("fixture", 1L, "service", "lookup", Map.of());
        });
        try { awaitNewerProgressOrLifecycleLock(newerThread, pause, () -> operationEntered.getCount() == 0); }
        finally { pause.release.countDown(); }
        try {
            older.get(2, TimeUnit.SECONDS);
            assertTrue(operationEntered.await(2, TimeUnit.SECONDS));
            releaseOperation.countDown();
            assertEquals(Map.of("answer", "synthetic"), newer.get(2, TimeUnit.SECONDS));
            assertEquals(List.of("Bearer synthetic-newer-token"), authHeaders);
        } finally { releaseOperation.countDown(); }
    }

    /** Stop an old invalidation immediately after its generation increment. On the old code,
     * the newer operation finishes/registers HTTP before release; with atomic lifecycle handling,
     * it blocks on the old thread's short monitor. Both schedules are observed, never guessed by sleep. */
    private InvalidationPause pauseNextInvalidation() {
        var pause = new InvalidationPause();
        @SuppressWarnings("unchecked") var existing = (Map<String, Long>) org.springframework.test.util.ReflectionTestUtils.getField(service, "generations");
        pause.putAll(existing);
        org.springframework.test.util.ReflectionTestUtils.setField(service, "generations", pause);
        return pause;
    }
    private static final class InvalidationPause extends ConcurrentHashMap<String, Long> {
        final CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        final java.util.concurrent.atomic.AtomicBoolean first = new java.util.concurrent.atomic.AtomicBoolean(true);
        volatile long owner;
        @Override public Long merge(String key, Long value, java.util.function.BiFunction<? super Long, ? super Long, ? extends Long> fn) {
            Long result = super.merge(key, value, fn);
            if (first.getAndSet(false)) {
                owner = Thread.currentThread().getId(); entered.countDown();
                try { if (!release.await(5, TimeUnit.SECONDS)) throw new AssertionError("Invalidation fixture was not released"); }
                catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new AssertionError(e); }
            }
            return result;
        }
    }
    private static void awaitNewerProgressOrLifecycleLock(java.util.concurrent.atomic.AtomicReference<Thread> thread,
            InvalidationPause pause, java.util.function.BooleanSupplier progressed) throws Exception {
        var threads = java.lang.management.ManagementFactory.getThreadMXBean();
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
        while (System.nanoTime() < deadline) {
            if (progressed.getAsBoolean()) return;
            Thread current = thread.get();
            var info = current == null ? null : threads.getThreadInfo(current.getId());
            if (info != null && info.getThreadState() == Thread.State.BLOCKED && info.getLockOwnerId() == pause.owner) return;
            Thread.sleep(1);
        }
        fail("New operation neither progressed nor blocked on the old invalidation's monitor");
    }
    @Test void concurrentOperationsRefreshOnceAndBothUseTheNewToken() throws Exception {
        String state = auth(); tokenReply = Map.of("access_token", "old-access", "refresh_token", "synthetic-refresh", "expires_in", 0); service.callback(state, "synthetic-code");
        tokenReply = Map.of("access_token", "refreshed-access", "expires_in", 3600);
        refreshEntered = new CountDownLatch(1); releaseRefresh = new CountDownLatch(1);
        Future<?> first = executor.submit(() -> service.request("fixture", 1L, "service", "lookup", Map.of()));
        assertTrue(refreshEntered.await(2, TimeUnit.SECONDS));
        Future<?> second = executor.submit(() -> service.request("fixture", 1L, "service", "lookup", Map.of()));
        releaseRefresh.countDown(); first.get(2, TimeUnit.SECONDS); second.get(2, TimeUnit.SECONDS);
        assertEquals(2, tokenRequests.size(), "One authorization and one refresh exchange");
        assertEquals(List.of("Bearer refreshed-access", "Bearer refreshed-access"), authHeaders);
    }
    @Test void accountSwitchDuringRefreshDiscardsNewCredentialAndOperation() throws Exception {
        String state = auth(); tokenReply = Map.of("access_token", "old-access", "refresh_token", "synthetic-refresh", "expires_in", 0); service.callback(state, "synthetic-code");
        tokenReply = Map.of("access_token", "late-refreshed-access", "expires_in", 3600);
        refreshEntered = new CountDownLatch(1); releaseRefresh = new CountDownLatch(1);
        Future<?> request = executor.submit(() -> service.request("fixture", 1L, "service", "lookup", Map.of()));
        assertTrue(refreshEntered.await(2, TimeUnit.SECONDS));
        when(account.accountFingerprintOrNull()).thenReturn("different-account"); releaseRefresh.countDown();
        assertThrows(ExecutionException.class, () -> request.get(2, TimeUnit.SECONDS));
        assertEquals(false, service.list("fixture", 1L).get(0).get("connected"));
        assertEquals(0, operationCount.get());
        assertTrue(credentials.get("1.local.fixture.service").contains("old-access"));
        assertEquals("", credentials.get("1.different-account.fixture.service"));
    }
    @Test void pluginDisableDuringHttpDiscardsReplyAndPreventsNextRequest() throws Exception {
        connect(); operationEntered = new CountDownLatch(1); releaseOperation = new CountDownLatch(1);
        Future<?> request = executor.submit(() -> service.request("fixture", 1L, "service", "lookup", Map.of()));
        assertTrue(operationEntered.await(2, TimeUnit.SECONDS));
        when(plugins.isEnabled("fixture")).thenReturn(false); releaseOperation.countDown();
        assertThrows(ExecutionException.class, () -> request.get(2, TimeUnit.SECONDS));
        assertThrows(IllegalArgumentException.class, () -> service.request("fixture", 1L, "service", "lookup", Map.of()));
        assertEquals(1, operationCount.get());
    }
    @Test void subscriptionStatusDistinguishesInactiveFromMalformedProviderData() throws Exception {
        connect(); operationReply = Map.of("active", false, "plan", "free");
        assertEquals(Map.of("active", false, "plan", "free", "provider", "developer"), service.billingStatus("fixture", 1L, "service"));
        operationReply = Map.of("active", "false");
        assertThrows(IllegalStateException.class, () -> service.billingStatus("fixture", 1L, "service"));
    }
    static Map<String, String> query(String raw) {
        Map<String, String> result = new HashMap<>(); for (String pair : raw.split("&")) { String[] p = pair.split("=", 2); result.put(URLDecoder.decode(p[0], StandardCharsets.UTF_8), URLDecoder.decode(p[1], StandardCharsets.UTF_8)); } return result;
    }
}
