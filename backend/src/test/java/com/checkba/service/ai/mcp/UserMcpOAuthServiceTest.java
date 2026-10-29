// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.mcp;

import com.checkba.service.SystemSettingService;
import com.checkba.service.plugin.PluginCredentialStore;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import okhttp3.HttpUrl;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.web.context.WebServerInitializedEvent;
import org.springframework.boot.web.server.WebServer;
import org.springframework.boot.web.servlet.context.ServletWebServerApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class UserMcpOAuthServiceTest {
    static final ObjectMapper JSON = new ObjectMapper();
    static final String KEY = "mcp.user-account.connection.oauth";
    static final UserMcpOAuthService.Config AUTO = new UserMcpOAuthService.Config("", "", List.of());
    @TempDir Path dir;
    HttpServer server;
    ExecutorService workers;
    String base, resource, issuer;
    UserMcpOAuthService service;
    PluginCredentialStore credentials;
    final Map<String, String> stored = new ConcurrentHashMap<>();
    final Map<String, AtomicInteger> counts = new ConcurrentHashMap<>();
    final List<Map<String, String>> tokenForms = new CopyOnWriteArrayList<>();
    final List<String> authorizations = new CopyOnWriteArrayList<>();
    final AtomicLong millis = new AtomicLong(1_800_000_000_000L);
    final AtomicBoolean current = new AtomicBoolean(true);
    volatile String challenge, metadataResource, metadataIssuer;
    volatile boolean challengeEnabled = true, resourcePathMissing, issuerOAuthMissing, issuerOidcMissing, tokenInvalid, tokenRedirect;
    volatile boolean supportsPkce = true, supportsIssuer = true;
    volatile String endpointOverride, tokenAuthMethods, rawResourceMetadata;
    volatile int metadataDelayMillis;
    volatile int tokenStatus = 200, discoveryStatus = 200, revocationStatus = 200;
    volatile CountDownLatch tokenEntered, releaseToken;
    volatile String lastRegister;

    @BeforeEach void setup() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        workers = Executors.newCachedThreadPool(); server.setExecutor(workers);
        base = "http://127.0.0.1:" + server.getAddress().getPort(); resource = base + "/mcp"; issuer = base + "/tenant";
        metadataResource = resource; metadataIssuer = issuer;
        challenge = "Bearer resource_metadata=\"" + base + "/advertised-resource\", scope=\"read\"";
        server.createContext("/", this::respond); server.start();
        SystemSettingService settings = mock(SystemSettingService.class);
        when(settings.get(anyString(), nullable(String.class))).thenAnswer(i -> stored.getOrDefault(i.getArgument(0), i.getArgument(1)));
        doAnswer(i -> { stored.put(i.getArgument(0), i.getArgument(1)); return null; }).when(settings).set(anyString(), anyString());
        credentials = new PluginCredentialStore(settings, dir.resolve("key").toString());
        Clock clock = new Clock() {
            @Override public ZoneId getZone() { return ZoneOffset.UTC; }
            @Override public Clock withZone(ZoneId zone) { return this; }
            @Override public Instant instant() { return Instant.ofEpochMilli(millis.get()); }
        };
        service = new UserMcpOAuthService(credentials, base + "/api/mcp/oauth/callback", new PluginMcpEndpointPolicy(true), clock, Duration.ofSeconds(2));
        ReflectionTestUtils.setField(service, "localMode", true);
    }
    @AfterEach void close() { if (releaseToken != null) releaseToken.countDown(); server.stop(0); workers.shutdownNow(); }
    void respond(HttpExchange exchange) throws IOException {
        String path = exchange.getRequestURI().getPath(); counts.computeIfAbsent(path, ignored -> new AtomicInteger()).incrementAndGet();
        try {
            if (path.equals("/mcp")) {
                if (challengeEnabled) exchange.getResponseHeaders().add("WWW-Authenticate", challenge);
                send(exchange, 401, Map.of()); return;
            }
            if (metadataDelayMillis > 0 && (path.contains("well-known") || path.equals("/advertised-resource")))
                try { Thread.sleep(metadataDelayMillis); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
            if (path.equals("/advertised-resource") || path.startsWith("/.well-known/oauth-protected-resource")) {
                if (rawResourceMetadata != null) {
                    byte[] data = rawResourceMetadata.getBytes(StandardCharsets.UTF_8);
                    exchange.getResponseHeaders().set("Content-Type", "application/json");
                    exchange.sendResponseHeaders(200, data.length); exchange.getResponseBody().write(data); return;
                }
                if (resourcePathMissing && path.endsWith("/mcp")) { send(exchange, 404, Map.of()); return; }
                if (discoveryStatus == 302) { exchange.getResponseHeaders().add("Location", base + "/stolen"); send(exchange, 302, Map.of()); return; }
                send(exchange, discoveryStatus, Map.of("resource", metadataResource, "authorization_servers", List.of(issuer), "scopes_supported", List.of("read", "write"))); return;
            }
            if (path.startsWith("/.well-known/oauth-authorization-server") || path.contains("openid-configuration")) {
                if (path.startsWith("/.well-known/oauth-authorization-server") && issuerOAuthMissing
                        || path.startsWith("/.well-known/openid-configuration") && issuerOidcMissing) { send(exchange, 404, Map.of()); return; }
                Map<String, Object> body = new LinkedHashMap<>();
                body.put("issuer", metadataIssuer); body.put("authorization_endpoint", base + "/authorize?tenant=one");
                body.put("token_endpoint", endpointOverride == null ? base + "/token" : endpointOverride);
                body.put("registration_endpoint", base + "/register"); body.put("revocation_endpoint", base + "/revoke");
                body.put("code_challenge_methods_supported", supportsPkce ? List.of("S256") : List.of("plain"));
                body.put("response_types_supported", List.of("code"));
                body.put("token_endpoint_auth_methods_supported", tokenAuthMethods == null ? List.of("none", "client_secret_basic", "client_secret_post") : List.of(tokenAuthMethods));
                body.put("authorization_response_iss_parameter_supported", supportsIssuer);
                send(exchange, 200, body); return;
            }
            if (path.equals("/register")) {
                lastRegister = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                send(exchange, 201, Map.of("client_id", "fixture-client", "client_secret", "fixture-dcr-secret", "token_endpoint_auth_method", "client_secret_post")); return;
            }
            if (path.equals("/token") || path.equals("/revoke")) {
                Map<String, String> form = form(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
                tokenForms.add(form); authorizations.add(exchange.getRequestHeaders().getFirst("Authorization") == null ? "" : exchange.getRequestHeaders().getFirst("Authorization"));
                if (path.equals("/revoke")) { send(exchange, revocationStatus, Map.of("error", "SECRET-REMOTE-ERROR")); return; }
                if (tokenEntered != null) tokenEntered.countDown();
                if (releaseToken != null) try { releaseToken.await(5, TimeUnit.SECONDS); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
                if (tokenRedirect) { exchange.getResponseHeaders().add("Location", base + "/stolen"); send(exchange, 302, Map.of()); return; }
                if (tokenStatus != 200) { send(exchange, tokenStatus, Map.of("error_description", "SECRET-REMOTE-ERROR")); return; }
                boolean refresh = "refresh_token".equals(form.get("grant_type"));
                send(exchange, 200, Map.of("access_token", refresh ? "refreshed-access" : "initial-access", "refresh_token", refresh ? "rotated-refresh" : "initial-refresh",
                        "token_type", tokenInvalid ? "MAC" : "Bearer", "expires_in", 120, "scope", "read")); return;
            }
            send(exchange, 404, Map.of());
        } finally { exchange.close(); }
    }
    static void send(HttpExchange exchange, int status, Object value) throws IOException {
        byte[] data = JSON.writeValueAsBytes(value); exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, data.length); exchange.getResponseBody().write(data);
    }
    static Map<String, String> form(String value) {
        Map<String, String> out = new LinkedHashMap<>();
        for (String piece : value.split("&")) { String[] kv = piece.split("=", 2); if (kv.length == 2) out.put(URLDecoder.decode(kv[0], StandardCharsets.UTF_8), URLDecoder.decode(kv[1], StandardCharsets.UTF_8)); }
        return out;
    }
    int count(String path) { return counts.getOrDefault(path, new AtomicInteger()).get(); }
    Map<String, Object> authorize() { return service.authorize(KEY, resource, AUTO, current::get); }
    HttpUrl url(Map<String, Object> started) { return HttpUrl.get((String) started.get("authorizationUrl")); }
    void complete(Map<String, Object> started) { service.callback(url(started).queryParameter("state"), "fixture-code", null, issuer); }
    Map<String, Object> status() { return service.status(KEY, resource, AUTO, current::get); }
    void connected() { complete(authorize()); }

    @Test void actualHttpDiscoveryDcrPkceSingleUseStateAndEncryptedTokens() throws Exception {
        assertEquals(false, status().get("connected")); assertEquals(0, counts.size());
        Map<String, Object> started = authorize(); HttpUrl auth = url(started);
        assertEquals(issuer, started.get("issuer")); assertEquals(List.of("read"), started.get("scopes"));
        assertEquals("S256", auth.queryParameter("code_challenge_method")); assertEquals(resource, auth.queryParameter("resource"));
        assertEquals(base + "/api/mcp/oauth/callback", auth.queryParameter("redirect_uri")); assertEquals("one", auth.queryParameter("tenant"));
        assertTrue(lastRegister.contains("authorization_code")); assertFalse(started.toString().contains("fixture-dcr-secret"));
        assertEquals(true, status().get("pending")); assertEquals(false, status().get("connected"));
        complete(started);
        Map<String, String> exchanged = tokenForms.get(0);
        String computed = Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(exchanged.get("code_verifier").getBytes(StandardCharsets.US_ASCII)));
        assertEquals(auth.queryParameter("code_challenge"), computed); assertEquals(resource, exchanged.get("resource"));
        assertEquals("fixture-dcr-secret", exchanged.get("client_secret"));
        assertEquals("initial-access", service.accessToken(KEY, resource, AUTO, current::get));
        assertTrue((boolean) status().get("connected")); assertFalse(status().toString().contains("initial-access"));
        assertTrue(stored.values().stream().noneMatch(s -> s.contains("initial-access") || s.contains("initial-refresh") || s.contains("fixture-dcr-secret")));
        int requests = counts.values().stream().mapToInt(AtomicInteger::get).sum(); status();
        assertEquals(requests, counts.values().stream().mapToInt(AtomicInteger::get).sum());
        assertEquals("oauth_state_expired", assertThrows(PluginMcpException.class, () -> complete(started)).code());
        assertEquals(1, count("/token"));
        authorize(); assertEquals(1, count("/register"));
    }
    @Test void wellKnownResourceAndOidcPathsAreTriedInSpecifiedOrder() {
        challengeEnabled = false; issuerOAuthMissing = true; issuerOidcMissing = true;
        Map<String, Object> started = authorize();
        assertEquals(List.of("read", "write"), started.get("scopes"));
        assertEquals(1, count("/.well-known/oauth-protected-resource/mcp"));
        assertEquals(1, count("/.well-known/oauth-authorization-server/tenant"));
        assertEquals(1, count("/.well-known/openid-configuration/tenant"));
        assertEquals(1, count("/tenant/.well-known/openid-configuration"));
        complete(started);
    }
    @Test void rootMetadataFallbackBindsTheResourceIndicatorToThatOrigin() {
        challengeEnabled = false; resourcePathMissing = true; metadataResource = base;
        Map<String, Object> started = authorize(); assertEquals(base, url(started).queryParameter("resource"));
        complete(started); assertEquals(base, tokenForms.get(0).get("resource"));
        assertEquals(1, count("/.well-known/oauth-protected-resource"));
    }
    @Test void challengeMetadataCannotReplaceTheRequestedEndpointWithItsOrigin() {
        challenge = "Bearer resource_metadata=\"" + base + "/.well-known/oauth-protected-resource\"";
        metadataResource = base;
        assertEquals("oauth_invalid_metadata", assertThrows(PluginMcpException.class, this::authorize).code());
        assertEquals(0, count("/register")); assertEquals(0, count("/.well-known/oauth-authorization-server/tenant"));
    }
    @Test void preRegisteredClientWithSecretUsesBasicAndExplicitScopesWithoutDcr() {
        UserMcpOAuthService.Config config = new UserMcpOAuthService.Config("manual id", "secret:with spaces", List.of("write"));
        Map<String, Object> started = service.authorize(KEY, resource, config, current::get);
        assertEquals(List.of("write"), started.get("scopes")); assertEquals(0, count("/register")); complete(started);
        assertEquals("Basic " + Base64.getEncoder().encodeToString("manual+id:secret%3Awith+spaces".getBytes(StandardCharsets.UTF_8)), authorizations.get(0));
        assertFalse(tokenForms.get(0).containsKey("client_secret")); assertFalse(config.toString().contains("secret:with spaces"));
        assertEquals("initial-access", service.accessToken(KEY, resource, config, current::get));
    }
    @Test void publicPreRegisteredClientAndNoIssuerExtensionRemainUsable() {
        supportsIssuer = false;
        var config = new UserMcpOAuthService.Config("public-id", "", List.of());
        Map<String, Object> started = service.authorize(KEY, resource, config, current::get);
        service.callback(url(started).queryParameter("state"), "code", null, null);
        assertEquals("public-id", tokenForms.get(0).get("client_id")); assertEquals("", authorizations.get(0));
    }
    @Test void missingPkceOrIssuerResourceMismatchRejectsBeforeRegistration() {
        supportsPkce = false; assertEquals("oauth_pkce_required", assertThrows(PluginMcpException.class, this::authorize).code());
        supportsPkce = true; metadataIssuer = base + "/wrong"; assertThrows(PluginMcpException.class, this::authorize);
        metadataIssuer = issuer; metadataResource = base + "/wrong"; assertThrows(PluginMcpException.class, this::authorize);
        assertEquals(0, count("/register")); assertEquals(0, count("/token"));
    }
    @Test void expiredDeniedMissingAndWrongIssuerConsumeStateWithoutExchangingCodes() {
        Map<String, Object> started = authorize(); millis.addAndGet(600_001);
        Map<String, Object> expired = started; assertThrows(PluginMcpException.class, () -> complete(expired));
        started = authorize(); String state = url(started).queryParameter("state");
        assertThrows(PluginMcpException.class, () -> service.callback(state, null, "SECRET-REMOTE-ERROR", issuer));
        assertThrows(PluginMcpException.class, () -> service.callback(state, "code", null, issuer));
        String missingIssuer = url(authorize()).queryParameter("state");
        assertThrows(PluginMcpException.class, () -> service.callback(missingIssuer, "code", null, null));
        String wrongIssuer = url(authorize()).queryParameter("state");
        assertThrows(PluginMcpException.class, () -> service.callback(wrongIssuer, "code", null, base + "/attacker"));
        assertEquals(0, count("/token"));
    }
    @Test void accountConnectionChangeAndNamespaceNeverReuseCredentials() {
        Map<String, Object> started = authorize(); current.set(false);
        assertEquals("cancelled", assertThrows(PluginMcpException.class, () -> complete(started)).code()); assertEquals(0, count("/token"));
        current.set(true); connected();
        assertThrows(PluginMcpException.class, () -> service.accessToken("mcp.other.connection.oauth", resource, AUTO, () -> true));
        assertThrows(PluginMcpException.class, () -> service.accessToken(KEY, base + "/other", AUTO, () -> true));
        assertThrows(PluginMcpException.class, () -> service.accessToken(KEY, resource, new UserMcpOAuthService.Config("other", "", List.of()), () -> true));
        assertEquals(1, count("/token"));
        Map<String, Object> pending = authorize(); service.invalidate(KEY); assertThrows(PluginMcpException.class, () -> complete(pending));
    }
    @Test void concurrentRefreshIsSerializedAndRotatesRefreshToken() throws Exception {
        connected(); millis.addAndGet(100_000);
        List<Future<String>> results = new ArrayList<>();
        for (int i = 0; i < 8; i++) results.add(workers.submit(() -> service.accessToken(KEY, resource, AUTO, current::get)));
        for (Future<String> result : results) assertEquals("refreshed-access", result.get(5, TimeUnit.SECONDS));
        assertEquals(2, count("/token")); assertEquals("initial-refresh", tokenForms.get(1).get("refresh_token"));
        millis.addAndGet(100_000); service.accessToken(KEY, resource, AUTO, current::get);
        assertEquals("rotated-refresh", tokenForms.get(2).get("refresh_token"));
        assertEquals(resource, tokenForms.get(2).get("resource"));
    }
    @Test void waitingRefreshCanBeCancelledWhileFirstRequestIsStillBlocked() throws Exception {
        connected(); millis.addAndGet(100_000); tokenEntered = new CountDownLatch(1); releaseToken = new CountDownLatch(1);
        Future<String> first = workers.submit(() -> service.accessToken(KEY, resource, AUTO, () -> true));
        assertTrue(tokenEntered.await(3, TimeUnit.SECONDS));
        AtomicBoolean secondCurrent = new AtomicBoolean(true);
        CountDownLatch secondStarted = new CountDownLatch(1);
        Future<String> second = workers.submit(() -> {
            secondStarted.countDown(); return service.accessToken(KEY, resource, AUTO, secondCurrent::get);
        });
        assertTrue(secondStarted.await(1, TimeUnit.SECONDS)); Thread.sleep(100);
        secondCurrent.set(false);
        ExecutionException cancelled = assertThrows(ExecutionException.class, () -> second.get(700, TimeUnit.MILLISECONDS));
        assertEquals("cancelled", ((PluginMcpException) cancelled.getCause()).code());
        assertFalse(first.isDone()); assertEquals(2, count("/token"));
        releaseToken.countDown(); assertEquals("refreshed-access", first.get(3, TimeUnit.SECONDS));
    }
    @Test void providerRefreshFailureMarksReconnectWithoutRetryOrExposingError() {
        connected(); millis.addAndGet(100_000); tokenStatus = 400;
        PluginMcpException failure = assertThrows(PluginMcpException.class, () -> service.accessToken(KEY, resource, AUTO, current::get));
        assertFalse(failure.getMessage().contains("SECRET-REMOTE-ERROR")); assertEquals(true, status().get("needsReconnect"));
        assertThrows(PluginMcpException.class, () -> service.accessToken(KEY, resource, AUTO, current::get)); assertEquals(2, count("/token"));
    }
    @Test void rejectedDcrClientCanBeRegisteredAgainOnExplicitReconnect() {
        Map<String, Object> started = authorize(); tokenStatus = 401;
        assertThrows(PluginMcpException.class, () -> complete(started));
        assertEquals(true, status().get("needsReconnect"));
        tokenStatus = 200; connected();
        assertEquals(2, count("/register")); assertEquals(true, status().get("connected"));
    }
    @Test void downstreamUnauthorizedMarksReconnectWithoutAnyAutomaticReplay() {
        connected(); service.needsReconnect(KEY);
        assertTrue((boolean) status().get("needsReconnect")); assertFalse((boolean) status().get("connected"));
        assertThrows(PluginMcpException.class, () -> service.accessToken(KEY, resource, AUTO, current::get)); assertEquals(1, count("/token"));
    }
    @Test void disconnectCancelsInflightRefreshAndClearsBeforeBestEffortRevoke() throws Exception {
        connected(); millis.addAndGet(100_000); tokenEntered = new CountDownLatch(1); releaseToken = new CountDownLatch(1);
        Future<String> refresh = workers.submit(() -> service.accessToken(KEY, resource, AUTO, current::get));
        assertTrue(tokenEntered.await(3, TimeUnit.SECONDS)); revocationStatus = 500;
        service.disconnect(KEY); releaseToken.countDown();
        assertThrows(ExecutionException.class, () -> refresh.get(3, TimeUnit.SECONDS));
        assertEquals("", credentials.get(KEY)); assertEquals(false, status().get("connected"));
        for (int i = 0; i < 100 && count("/revoke") < 2; i++) Thread.sleep(20);
        assertEquals(2, count("/revoke"));
        assertTrue(tokenForms.stream().anyMatch(f -> "refresh_token".equals(f.get("token_type_hint"))));
    }
    @Test void revocationWaitsForCommitAndRollbackNeverRevokes() throws Exception {
        connected();
        TransactionSynchronizationManager.initSynchronization();
        try {
            service.disconnect(KEY);
            assertEquals("", credentials.get(KEY));
            assertEquals(0, count("/revoke"));
            var synchronizations = TransactionSynchronizationManager.getSynchronizations();
            assertEquals(1, synchronizations.size());
            synchronizations.forEach(s -> s.afterCompletion(1));
        } finally { TransactionSynchronizationManager.clearSynchronization(); }
        assertEquals(0, count("/revoke"));
        connected();
        TransactionSynchronizationManager.initSynchronization();
        try {
            service.disconnect(KEY); assertEquals(0, count("/revoke"));
            TransactionSynchronizationManager.getSynchronizations().forEach(s -> s.afterCommit());
        } finally { TransactionSynchronizationManager.clearSynchronization(); }
        for (int i = 0; i < 100 && count("/revoke") < 2; i++) Thread.sleep(20);
        assertEquals(2, count("/revoke"));
    }
    @Test void newerAuthorizationCannotBeRemovedByOldCallbackOrRevocation() {
        Map<String, Object> old = authorize();
        Map<String, Object> newer = authorize();
        assertThrows(PluginMcpException.class, () -> complete(old));
        complete(newer); assertEquals(true, status().get("connected"));
        assertEquals(1, count("/token"));
        service.invalidate(KEY);
        assertEquals("initial-access", service.accessToken(KEY, resource, AUTO, () -> true));
    }
    @Test void changedAccountCancelsBlockedCallbackAndDiscardsLateResult() throws Exception {
        Map<String, Object> started = authorize(); tokenEntered = new CountDownLatch(1); releaseToken = new CountDownLatch(1);
        Future<?> callback = workers.submit(() -> complete(started)); assertTrue(tokenEntered.await(3, TimeUnit.SECONDS));
        current.set(false);
        assertThrows(ExecutionException.class, () -> callback.get(1, TimeUnit.SECONDS));
        releaseToken.countDown(); current.set(true);
        assertFalse((boolean) status().get("connected")); assertFalse(credentials.get(KEY).contains("initial-access"));
    }
    @Test void redirectsAreRejectedAtMetadataAndTokenWithoutContactingTarget() {
        discoveryStatus = 302; assertEquals("oauth_redirect_rejected", assertThrows(PluginMcpException.class, this::authorize).code());
        discoveryStatus = 200; Map<String, Object> started = authorize(); tokenRedirect = true;
        assertEquals("oauth_redirect_rejected", assertThrows(PluginMcpException.class, () -> complete(started)).code());
        assertEquals(0, count("/stolen"));
    }
    @Test void timeoutAndInvalidTokenTypeHaveSafeBoundedFailures() {
        Map<String, Object> started = authorize(); releaseToken = new CountDownLatch(1);
        assertEquals("oauth_transport_error", assertThrows(PluginMcpException.class, () -> complete(started)).code()); releaseToken.countDown(); releaseToken = null;
        Map<String, Object> next = authorize(); tokenInvalid = true;
        assertEquals("oauth_invalid_metadata", assertThrows(PluginMcpException.class, () -> complete(next)).code());
        assertFalse((boolean) status().get("connected"));
    }
    @Test void discoverySequenceHasOneDeadlineAndUserConsentGetsANewExchangeDeadline() {
        service = new UserMcpOAuthService(credentials, base + "/api/mcp/oauth/callback", new PluginMcpEndpointPolicy(true),
                Clock.systemUTC(), Duration.ofSeconds(2), Duration.ofMillis(300));
        ReflectionTestUtils.setField(service, "localMode", true);
        metadataDelayMillis = 180;
        long start = System.nanoTime();
        assertEquals("oauth_transport_error", assertThrows(PluginMcpException.class, this::authorize).code());
        assertTrue(Duration.ofNanos(System.nanoTime() - start).toMillis() < 1500);
        assertEquals(0, count("/register"));
        metadataDelayMillis = 0;
        Map<String, Object> started = authorize();
        try { Thread.sleep(350); } catch (InterruptedException e) { throw new AssertionError(e); }
        complete(started); assertEquals(true, status().get("connected"));
    }
    @Test void malformedDuplicateAndOversizedMetadataNeverStartsRegistration() {
        for (String raw : List.of("[]", "null", "{bad json", "{\"resource\":\"one\",\"resource\":\"two\"}",
                "{\"data\":\"" + "x".repeat(65536) + "\"}")) {
            rawResourceMetadata = raw;
            PluginMcpException failure = assertThrows(PluginMcpException.class, this::authorize);
            assertFalse(failure.getMessage().contains(raw));
        }
        assertEquals(0, count("/register")); assertEquals(0, count("/token"));
    }
    @Test void oldDeferredRevocationCannotStartAfterNewAuthorization() throws Exception {
        connected();
        TransactionSynchronizationManager.initSynchronization();
        List<org.springframework.transaction.support.TransactionSynchronization> callbacks;
        try { service.disconnect(KEY); callbacks = TransactionSynchronizationManager.getSynchronizations(); }
        finally { TransactionSynchronizationManager.clearSynchronization(); }
        connected(); callbacks.forEach(s -> s.afterCommit());
        Thread.sleep(100);
        assertEquals(0, count("/revoke")); assertEquals("initial-access", service.accessToken(KEY, resource, AUTO, current::get));
    }
    @Test void productionBoundaryRejectsHttpPrivateLiteralAndPrivateDns() {
        UserMcpOAuthService production = new UserMcpOAuthService(credentials, "https://example.com/api/mcp/oauth/callback");
        for (String url : List.of(resource, "https://127.0.0.1/mcp", "https://[::1]/mcp", "https://198.18.0.1/mcp", "https://user:password@example.com/mcp", "https://example.com/mcp#fragment"))
            assertThrows(PluginMcpException.class, () -> production.authorize(KEY, url, AUTO, () -> true));
        assertThrows(PluginMcpException.class, () -> ReflectionTestUtils.invokeMethod(production, "endpoint", "https://localhost/token", true));
        assertEquals(0, counts.size());
    }
    @Test void advertisedPrivateEndpointAndUntrustedCallbackAreRejected() {
        endpointOverride = "http://10.0.0.1/token"; assertThrows(PluginMcpException.class, this::authorize); assertEquals(0, count("/register"));
        endpointOverride = null; ReflectionTestUtils.setField(service, "localMode", false);
        assertEquals("oauth_callback_required", assertThrows(PluginMcpException.class, this::authorize).code());
    }
    @Test void desktopCallbackFollowsActualPortAndServerRequiresExplicitHttps() {
        ServletWebServerApplicationContext context = new ServletWebServerApplicationContext();
        context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("fixture", Map.of("security.local-mode", true)));
        WebServer web = mock(WebServer.class); when(web.getPort()).thenReturn(38471);
        service.onWebServerInitialized(new WebServerInitializedEvent(web) {
            @Override public ServletWebServerApplicationContext getApplicationContext() { return context; }
        });
        Map<String, Object> started = authorize(); assertEquals("http://127.0.0.1:38471/api/mcp/oauth/callback", url(started).queryParameter("redirect_uri"));
        context.close();
        var missing = new UserMcpOAuthService(credentials, "");
        assertEquals("oauth_callback_required", assertThrows(PluginMcpException.class, () -> missing.authorize(KEY, "https://example.com/mcp", AUTO, () -> true)).code());
    }
}
