// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.mcp;

import com.checkba.service.LangText;
import com.checkba.service.plugin.PluginCredentialStore;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.context.WebServerInitializedEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.io.IOException;
import java.net.Proxy;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.BooleanSupplier;

/** User-owned HTTP MCP OAuth. Saving a connection never invokes this service's authorization flow. */
@Service
public class UserMcpOAuthService {
    private static final String CALLBACK = "/api/mcp/oauth/callback";
    private static final int MAX_BYTES = 64 * 1024;
    private static final ObjectMapper JSON = new ObjectMapper().enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION);
    private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() {};
    private final PluginCredentialStore credentials;
    private final PluginMcpEndpointPolicy policy;
    private final OkHttpClient http;
    private final Clock clock;
    private final long operationTimeoutNanos;
    private final SecureRandom random = new SecureRandom();
    private volatile String redirectUri;
    private volatile boolean localMode;
    private final Object lifecycle = new Object();
    private final Map<String, Long> generations = new HashMap<>();
    private final Map<String, Set<Call>> calls = new HashMap<>();
    private final Map<String, Pending> pending = new HashMap<>();
    private final Map<String, ReentrantLock> refreshLocks = new ConcurrentHashMap<>();

    public record Config(String clientId, String clientSecret, List<String> scopes) {
        public Config {
            clientId = clientId == null ? "" : clientId.trim();
            clientSecret = clientSecret == null ? "" : clientSecret;
            if (scopes != null && scopes.stream().anyMatch(Objects::isNull)) throw configuration();
            scopes = scopes == null ? List.of() : List.copyOf(scopes);
            if (clientId.length() > 2048 || clientSecret.length() > 8192 || scopes.size() > 64
                    || unsafe(clientId) || unsafe(clientSecret)
                    || (!clientSecret.isEmpty() && clientId.isEmpty())) throw configuration();
            for (String scope : scopes) if (!scope.matches("[\\x21\\x23-\\x5b\\x5d-\\x7e]{1,256}")) throw configuration();
        }
        @Override public String toString() { return "Config[clientId=" + clientId + ", scopes=" + scopes + "]"; }
    }
    private record Operation(String key, long generation, BooleanSupplier current, long deadlineNanos) {}
    private record Pending(Operation operation, String verifier, String redirect, long expiresAt,
                           Map<String, Object> registration, boolean requiresIssuer) {}
    private record Reply(int status, Map<String, Object> body, List<Challenge> challenges) {}
    private record Discovery(String resource, String issuer, Map<String, Object> metadata, List<String> scopes) {}

    @Autowired
    public UserMcpOAuthService(PluginCredentialStore credentials,
            @Value("${ai.mcp.oauth-redirect-uri:}") String redirectUri) {
        this(credentials, redirectUri, new PluginMcpEndpointPolicy(), Clock.systemUTC(), Duration.ofSeconds(30));
    }
    // Only package-local HTTP fixtures may change the transport policy or clock.
    UserMcpOAuthService(PluginCredentialStore credentials, String redirectUri, PluginMcpEndpointPolicy policy,
                        Clock clock, Duration timeout) {
        this(credentials, redirectUri, policy, clock, timeout, Duration.ofSeconds(60));
    }
    UserMcpOAuthService(PluginCredentialStore credentials, String redirectUri, PluginMcpEndpointPolicy policy,
                        Clock clock, Duration timeout, Duration operationTimeout) {
        this.credentials = credentials; this.redirectUri = redirectUri == null ? "" : redirectUri;
        this.policy = policy; this.clock = clock; this.operationTimeoutNanos = operationTimeout.toNanos();
        http = new OkHttpClient.Builder().dns(policy).proxy(Proxy.NO_PROXY)
                .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
                .connectTimeout(Duration.ofSeconds(10)).readTimeout(timeout).callTimeout(timeout).build();
    }
    @EventListener
    public void onWebServerInitialized(WebServerInitializedEvent event) {
        if (event.getApplicationContext().getServerNamespace() != null) return;
        localMode = event.getApplicationContext().getEnvironment().getProperty("security.local-mode", Boolean.class, false);
        // Desktop callback always uses the actual bound port, including fallback ports.
        if (localMode) redirectUri = "http://127.0.0.1:" + event.getWebServer().getPort() + CALLBACK;
    }

    public Map<String, Object> authorize(String key, String resourceUrl, Config config, BooleanSupplier current) {
        policy.validate(resourceUrl);
        if (!current.getAsBoolean()) throw cancelled();
        Operation op = begin(key, current);
        String redirect = callbackUri(op);
        ReentrantLock lock = acquire(op);
        try {
            guard(op);
            Discovery discovered = discover(op, resourceUrl, config.scopes());
            Map<String, Object> registration = register(op, resourceUrl, config, redirect, discovered);
            String state = randomToken(), verifier = randomToken();
            HttpUrl.Builder url = HttpUrl.get(text(discovered.metadata(), "authorization_endpoint")).newBuilder();
            for (String name : List.of("response_type", "client_id", "redirect_uri", "scope", "state", "code_challenge",
                    "code_challenge_method", "resource")) url.removeAllQueryParameters(name);
            url.addQueryParameter("response_type", "code").addQueryParameter("client_id", text(registration, "client_id"))
                    .addQueryParameter("redirect_uri", redirect).addQueryParameter("state", state)
                    .addQueryParameter("code_challenge", digest(verifier)).addQueryParameter("code_challenge_method", "S256")
                    .addQueryParameter("resource", discovered.resource());
            if (!discovered.scopes().isEmpty()) url.addQueryParameter("scope", String.join(" ", discovered.scopes()));
            guard(op);
            synchronized (lifecycle) {
                generationGuard(op);
                pending.entrySet().removeIf(e -> e.getValue().expiresAt() <= clock.millis());
                if (pending.size() >= 100) throw failure("oauth_pending_limit", 429,
                        "等待授权的连接过多，请稍后重试。", "Too many pending authorizations. Try again later.");
                credentials.put(key, json(registration));
                pending.put(state, new Pending(op, verifier, redirect, clock.millis() + 600_000, registration,
                        Boolean.TRUE.equals(discovered.metadata().get("authorization_response_iss_parameter_supported"))));
            }
            guard(op);
            return Map.of("authorizationUrl", url.build().toString(), "expiresIn", 600,
                    "issuer", discovered.issuer(), "scopes", discovered.scopes());
        } finally { lock.unlock(); }
    }

    /** State is one-use even on denial or malformed callbacks. No remote error text reaches the browser. */
    public void callback(String state, String code, String error, String issuer) {
        Pending p;
        synchronized (lifecycle) { p = state == null || state.length() > 256 ? null : pending.remove(state); }
        if (p == null || p.expiresAt() <= clock.millis()) throw expiredAuthorization();
        Operation op = withDeadline(p.operation().key(), p.operation().generation(), p.operation().current());
        guard(op);
        String expectedIssuer = text(p.registration(), "issuer");
        if ((p.requiresIssuer() && (issuer == null || issuer.isBlank()))
                || issuer != null && !expectedIssuer.equals(issuer)) throw metadata();
        if (error != null || code == null || code.isBlank() || code.length() > 8192 || unsafe(code))
            throw failure("oauth_denied", 400, "授权未完成，请从 MCP 设置重试。", "Authorization was not completed. Retry from MCP settings.");
        Map<String, String> form = new LinkedHashMap<>();
        form.put("grant_type", "authorization_code"); form.put("code", code);
        form.put("redirect_uri", p.redirect()); form.put("code_verifier", p.verifier());
        try {
            Map<String, Object> next = tokens(tokenRequest(op, p.registration(), form), p.registration(), "");
            save(op, next);
        } catch (PluginMcpException e) {
            if ("oauth_needs_reconnect".equals(e.code())) markReconnect(op);
            throw e;
        }
    }

    /** Resolve before an MCP operation. Never replay the MCP operation after a 401 or refresh. */
    public String accessToken(String key, String resourceUrl, Config config, BooleanSupplier current) {
        Operation op = operation(key, current);
        ReentrantLock lock = acquire(op);
        try {
            guard(op);
            Map<String, Object> stored = read(key);
            if (!identity(resourceUrl, config).equals(text(stored, "identity")) || Boolean.TRUE.equals(stored.get("invalid"))
                    || text(stored, "access_token").isEmpty()) throw reconnect();
            if (expired(stored)) {
                String refresh = text(stored, "refresh_token");
                if (refresh.isEmpty()) { markReconnect(op); throw reconnect(); }
                try {
                    Map<String, Object> next = tokens(tokenRequest(op, stored,
                            new LinkedHashMap<>(Map.of("grant_type", "refresh_token", "refresh_token", refresh))), stored, refresh);
                    save(op, next); stored = next;
                } catch (PluginMcpException e) {
                    if (!"cancelled".equals(e.code())) markReconnect(op);
                    throw e;
                }
            }
            guard(op);
            return text(stored, "access_token");
        } finally { lock.unlock(); }
    }

    /** Local-only status: no discovery, registration or refresh while listing settings. */
    public Map<String, Object> status(String key, String resourceUrl, Config config, BooleanSupplier current) {
        Operation op = operation(key, current); guard(op);
        Map<String, Object> stored;
        try { stored = read(key); }
        catch (PluginMcpException e) { return Map.of("connected", false, "pending", false, "needsReconnect", true, "issuer", "", "scopes", List.of()); }
        boolean bound = identity(resourceUrl, config).equals(text(stored, "identity"));
        boolean connected = bound && !Boolean.TRUE.equals(stored.get("invalid")) && !text(stored, "access_token").isEmpty()
                && (!expired(stored) || !text(stored, "refresh_token").isEmpty());
        boolean waiting;
        synchronized (lifecycle) {
            generationGuard(op);
            waiting = pending.values().stream().anyMatch(p -> p.operation().key().equals(key)
                    && p.operation().generation() == op.generation() && p.expiresAt() > clock.millis());
        }
        guard(op);
        return Map.of("connected", connected, "pending", waiting, "needsReconnect", !stored.isEmpty() && !connected && !waiting,
                "issuer", bound ? text(stored, "issuer") : "", "scopes", bound ? strings(stored, "scopes", false) : List.of());
    }

    /** Invalidate pending/in-flight work before saving, disabling, deleting or changing accounts. */
    public void invalidate(String key) { cancel(key); }
    public void needsReconnect(String key) {
        long generation = cancel(key);
        synchronized (lifecycle) {
            if (generation != generations.getOrDefault(key, 0L)) return;
            Map<String, Object> stored = read(key);
            if (!stored.isEmpty()) { stored.put("invalid", true); credentials.put(key, json(stored)); }
        }
    }
    /** Clear locally before bounded best-effort revocation, even if the provider is offline. */
    public void disconnect(String key) {
        long generation = cancel(key);
        Map<String, Object> stored;
        synchronized (lifecycle) {
            if (generation != generations.getOrDefault(key, 0L)) return;
            try { stored = read(key); } catch (PluginMcpException ignored) { stored = Map.of(); }
            credentials.remove(key);
        }
        String endpoint = text(stored, "revocation_endpoint");
        if (endpoint.isEmpty()) return;
        Map<String, Object> revoked = stored;
        Runnable revoke = () -> CompletableFuture.runAsync(() -> revoke(key, generation, endpoint, revoked));
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCommit() { revoke.run(); }
            });
        } else revoke.run();
    }
    private void revoke(String key, long generation, String endpoint, Map<String, Object> stored) {
        Operation op = withDeadline(key, generation, () -> true);
        for (String kind : List.of("refresh_token", "access_token")) {
            String token = text(stored, kind);
            if (token.isEmpty()) continue;
            try {
                Request request = authenticatedForm(endpoint, stored, new LinkedHashMap<>(Map.of("token", token, "token_type_hint", kind)));
                exchange(op, request, false, Duration.ofSeconds(2));
            } catch (RuntimeException ignored) { /* Local disconnect has already completed. */ }
        }
    }

    private Discovery discover(Operation op, String resourceUrl, List<String> configuredScopes) {
        Reply probe = exchange(op, new Request.Builder().url(resourceUrl).header("Accept", "application/json, text/event-stream")
                .header("MCP-Protocol-Version", "2025-11-25").get().build(), false, null);
        String metadataUrl = "", challengeScope = "";
        if (probe.status() == 401) for (Challenge challenge : probe.challenges()) {
            if (!"Bearer".equalsIgnoreCase(challenge.scheme())) continue;
            String location = challenge.authParams().get("resource_metadata");
            if (location != null && !location.isBlank()) { metadataUrl = location; challengeScope = challenge.authParams().getOrDefault("scope", ""); break; }
            if (challengeScope.isEmpty()) challengeScope = challenge.authParams().getOrDefault("scope", "");
        }
        Map<String, Object> resource;
        String resourceIndicator = resourceUrl;
        if (!metadataUrl.isEmpty()) resource = metadataAt(op, metadataUrl, false);
        else {
            resource = metadataAt(op, wellKnown(resourceUrl, "oauth-protected-resource"), true);
            if (resource == null) {
                resourceIndicator = origin(resourceUrl);
                resource = metadataAt(op, resourceIndicator + "/.well-known/oauth-protected-resource", false);
            }
        }
        // RFC 9728 section 3.3: challenge metadata binds to the requested endpoint; a constructed root fallback binds to the origin.
        if (!resourceIndicator.equals(text(resource, "resource"))) throw metadata();
        List<String> servers = strings(resource, "authorization_servers", true);
        if (servers.isEmpty()) throw metadata();
        String issuer = servers.get(0);
        endpoint(op, issuer, false);
        Map<String, Object> authorization = null;
        LinkedHashSet<String> locations = new LinkedHashSet<>(List.of(wellKnown(issuer, "oauth-authorization-server"),
                wellKnown(issuer, "openid-configuration"), issuer.replaceAll("/$", "") + "/.well-known/openid-configuration"));
        for (String location : locations) { authorization = metadataAt(op, location, true); if (authorization != null) break; }
        if (authorization == null || !issuer.equals(text(authorization, "issuer"))) throw metadata();
        if (!strings(authorization, "code_challenge_methods_supported", true).contains("S256"))
            throw failure("oauth_pkce_required", 400, "此授权服务未声明支持安全的 PKCE S256。", "This authorization server does not advertise PKCE S256 support.");
        if (!strings(authorization, "response_types_supported", true).contains("code")) throw metadata();
        if (authorization.containsKey("protected_resources") && !strings(authorization, "protected_resources", true).contains(resourceIndicator)) throw metadata();
        endpoint(op, text(authorization, "authorization_endpoint"), true);
        endpoint(op, text(authorization, "token_endpoint"), true);
        for (String name : List.of("registration_endpoint", "revocation_endpoint"))
            if (!text(authorization, name).isEmpty()) endpoint(op, text(authorization, name), true);
        List<String> scopes = configuredScopes.isEmpty()
                ? challengeScope.isBlank() ? strings(resource, "scopes_supported", false) : List.of(challengeScope.trim().split(" +"))
                : configuredScopes;
        scopes = new Config("", "", scopes).scopes();
        return new Discovery(resourceIndicator, issuer, authorization, scopes);
    }

    private Map<String, Object> register(Operation op, String resourceUrl, Config config, String redirect, Discovery discovery) {
        Map<String, Object> stored = new LinkedHashMap<>();
        stored.put("identity", identity(resourceUrl, config)); stored.put("resource", discovery.resource());
        stored.put("issuer", discovery.issuer()); stored.put("token_endpoint", text(discovery.metadata(), "token_endpoint"));
        stored.put("revocation_endpoint", text(discovery.metadata(), "revocation_endpoint")); stored.put("scopes", discovery.scopes());
        String clientId = config.clientId(), secret = config.clientSecret();
        String method = authMethod(discovery.metadata(), secret);
        if (clientId.isEmpty()) {
            String registrationEndpoint = text(discovery.metadata(), "registration_endpoint");
            if (registrationEndpoint.isEmpty()) throw failure("oauth_client_required", 400,
                    "此服务需要预先注册的 OAuth 客户端 ID，请在高级设置中填写。", "This service needs a pre-registered OAuth client ID. Enter it in advanced settings.");
            Map<String, Object> previous = read(op.key());
            if (!Boolean.TRUE.equals(previous.get("invalid")) && identity(resourceUrl, config).equals(text(previous, "identity"))
                    && discovery.issuer().equals(text(previous, "issuer"))
                    && redirect.equals(text(previous, "redirect_uri")) && !text(previous, "client_id").isEmpty()) {
                clientId = text(previous, "client_id"); secret = text(previous, "client_secret");
                method = text(previous, "auth_method");
            } else {
                Request request = new Request.Builder().url(registrationEndpoint).post(RequestBody.create(json(Map.of(
                        "client_name", "AI WorkDeck", "redirect_uris", List.of(redirect), "grant_types", List.of("authorization_code", "refresh_token"),
                        "response_types", List.of("code"), "token_endpoint_auth_method", "none")), MediaType.get("application/json"))).build();
                Reply reply = exchange(op, request, true, null); requireSuccess(reply);
                clientId = text(reply.body(), "client_id"); secret = text(reply.body(), "client_secret");
                method = text(reply.body(), "token_endpoint_auth_method");
                if (method.isEmpty()) method = secret.isEmpty() ? "none" : "client_secret_basic";
                new Config(clientId, secret, discovery.scopes());
                if (clientId.isEmpty() || !Set.of("none", "client_secret_basic", "client_secret_post").contains(method)
                        || !"none".equals(method) && secret.isEmpty()) throw metadata();
                if (reply.body().containsKey("redirect_uris") && !strings(reply.body(), "redirect_uris", true).contains(redirect)) throw metadata();
            }
        }
        stored.put("client_id", clientId); stored.put("client_secret", secret); stored.put("auth_method", method);
        stored.put("redirect_uri", redirect);
        return stored;
    }

    private String authMethod(Map<String, Object> metadata, String secret) {
        List<String> methods = metadata.containsKey("token_endpoint_auth_methods_supported")
                ? strings(metadata, "token_endpoint_auth_methods_supported", true) : List.of("client_secret_basic");
        for (String method : secret.isEmpty() ? List.of("none") : List.of("client_secret_basic", "client_secret_post"))
            if (methods.contains(method)) return method;
        throw failure("oauth_client_auth_unsupported", 400, "此服务的客户端认证方式不受支持，请检查 OAuth 客户端配置。", "This client authentication method is unsupported. Check the OAuth client configuration.");
    }
    private Map<String, Object> tokenRequest(Operation op, Map<String, Object> registration, Map<String, String> form) {
        form.put("resource", text(registration, "resource"));
        Reply reply = exchange(op, authenticatedForm(text(registration, "token_endpoint"), registration, form), true, null);
        if (reply.status() == 400 || reply.status() == 401 || reply.status() == 403) throw reconnect();
        requireSuccess(reply); return reply.body();
    }
    private Request authenticatedForm(String endpoint, Map<String, Object> registration, Map<String, String> values) {
        String method = text(registration, "auth_method"), id = text(registration, "client_id"), secret = text(registration, "client_secret");
        Request.Builder request = new Request.Builder().url(endpoint);
        if ("client_secret_basic".equals(method)) request.header("Authorization", Credentials.basic(encode(id), encode(secret), StandardCharsets.UTF_8));
        else {
            values.put("client_id", id);
            if ("client_secret_post".equals(method)) values.put("client_secret", secret);
        }
        FormBody.Builder form = new FormBody.Builder(); values.forEach(form::add);
        return request.post(form.build()).build();
    }
    private Map<String, Object> tokens(Map<String, Object> body, Map<String, Object> registration, String oldRefresh) {
        String access = text(body, "access_token"), refresh = text(body, "refresh_token");
        if (access.isBlank() || access.length() > 16384 || !access.matches("[\\x21-\\x7e]+") || refresh.length() > 16384 || unsafe(refresh)
                || !"Bearer".equalsIgnoreCase(text(body, "token_type"))) throw metadata();
        Map<String, Object> next = new LinkedHashMap<>(registration);
        next.remove("invalid"); next.remove("expires_at");
        next.put("access_token", access); next.put("refresh_token", refresh.isEmpty() ? oldRefresh : refresh);
        if (body.containsKey("expires_in")) {
            Object raw = body.get("expires_in");
            if (!(raw instanceof Number n) || n.doubleValue() != n.longValue() || n.longValue() < 0 || n.longValue() > 315_360_000L) throw metadata();
            next.put("expires_at", clock.millis() + n.longValue() * 1000);
        }
        if (body.containsKey("scope")) {
            String scope = text(body, "scope");
            next.put("scopes", new Config("", "", scope.isBlank() ? List.of() : List.of(scope.split(" +"))).scopes());
        }
        return next;
    }
    private Map<String, Object> metadataAt(Operation op, String url, boolean optional) {
        endpoint(op, url, true);
        Reply reply = exchange(op, new Request.Builder().url(url).get().build(), true, null);
        if (optional && (reply.status() == 404 || reply.status() == 405)) return null;
        requireSuccess(reply); return reply.body();
    }

    private Reply exchange(Operation op, Request request, boolean jsonBody, Duration timeout) {
        endpoint(op, request.url().toString(), true); guard(op);
        Call call = http.newCall(request.newBuilder().header("Accept", request.header("Accept") == null ? "application/json" : request.header("Accept"))
                .header("Cache-Control", "no-store").build());
        if (timeout != null) call.timeout().timeout(timeout.toMillis(), TimeUnit.MILLISECONDS);
        synchronized (lifecycle) { generationGuard(op); calls.computeIfAbsent(op.key(), ignored -> new HashSet<>()).add(call); }
        CompletableFuture<Reply> work = CompletableFuture.supplyAsync(() -> {
            try (Response response = call.execute()) {
                if (response.isRedirect()) throw failure("oauth_redirect_rejected", 400,
                        "授权服务返回了不允许的重定向，请检查服务地址。", "The authorization service returned a disallowed redirect. Check the service URL.");
                Map<String, Object> body = Map.of();
                if (jsonBody && response.isSuccessful()) {
                    if (response.body() == null || !response.header("Content-Type", "").toLowerCase(Locale.ROOT).startsWith("application/json")) throw metadata();
                    var source = response.body().source();
                    if (source.request(MAX_BYTES + 1L)) throw metadata();
                    body = JSON.readValue(source.readUtf8(), MAP);
                    if (body == null) throw metadata();
                }
                return new Reply(response.code(), body, response.challenges());
            } catch (JsonProcessingException e) { throw metadata(); }
            catch (IOException e) { throw failure("oauth_transport_error", 502,
                    "授权连接失败或超时，请检查网络后重新授权。", "The authorization connection failed or timed out. Check the network and authorize again."); }
        });
        try {
            while (true) {
                guard(op);
                try { Reply reply = work.get(50, TimeUnit.MILLISECONDS); guard(op); return reply; }
                catch (TimeoutException ignored) { /* Recheck account/revision while a provider is blocked. */ }
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt(); throw cancelled();
        } catch (ExecutionException e) {
            if (e.getCause() instanceof PluginMcpException failure) throw failure;
            throw metadata();
        } finally {
            if (!work.isDone()) { call.cancel(); work.cancel(true); }
            synchronized (lifecycle) { Set<Call> active = calls.get(op.key()); if (active != null) { active.remove(call); if (active.isEmpty()) calls.remove(op.key()); } }
        }
    }

    private void endpoint(Operation op, String url, boolean allowQuery) {
        // DNS resolution can block before OkHttp's timeout begins. Keep it inside the same operation budget.
        CompletableFuture<Void> validation = CompletableFuture.runAsync(() -> endpoint(url, allowQuery));
        try {
            while (true) {
                guard(op);
                try { validation.get(50, TimeUnit.MILLISECONDS); guard(op); return; }
                catch (TimeoutException ignored) { /* Check account/revision and the overall deadline. */ }
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt(); throw cancelled();
        } catch (ExecutionException e) {
            if (e.getCause() instanceof PluginMcpException failure) throw failure;
            throw metadata();
        } finally { if (!validation.isDone()) validation.cancel(true); }
    }
    private void endpoint(String url, boolean allowQuery) {
        try {
            if (url.length() > 8192) throw metadata();
            URI uri = URI.create(url);
            HttpUrl.get(url); // Reject malformed ports/URLs before constructing any outgoing request.
            String base = allowQuery && uri.getRawQuery() != null ? url.substring(0, url.indexOf('?')) : url;
            if (uri.getFragment() != null) throw metadata();
            policy.validate(base);
            // Authorization URLs are opened by a browser, so validate their DNS even without an HTTP fetch.
            policy.lookup(uri.getHost());
        } catch (Exception e) { throw failure("oauth_invalid_endpoint", 400,
                "OAuth 仅支持无内网地址或重定向的公网 HTTPS 服务。", "OAuth requires public HTTPS service endpoints without private addresses or redirects."); }
    }
    private String callbackUri(Operation op) {
        try {
            URI uri = URI.create(redirectUri);
            boolean loopback = localMode && "http".equals(uri.getScheme()) && "127.0.0.1".equals(uri.getHost()) && uri.getPort() > 0;
            if ((!loopback && !"https".equals(uri.getScheme())) || uri.getHost() == null || uri.getUserInfo() != null
                    || uri.getQuery() != null || uri.getFragment() != null || !CALLBACK.equals(uri.getPath())) throw configuration();
            if (!loopback) endpoint(op, redirectUri, false);
            return redirectUri;
        } catch (RuntimeException e) {
            if (e instanceof PluginMcpException failure && Set.of("cancelled", "oauth_transport_error").contains(failure.code())) throw failure;
            throw failure("oauth_callback_required", 400,
                "服务器须配置可信的 HTTPS MCP OAuth 回调地址。", "Configure a trusted HTTPS MCP OAuth callback URL for this server."); }
    }
    private Operation begin(String key, BooleanSupplier current) { return withDeadline(key, cancel(key), current); }
    private Operation operation(String key, BooleanSupplier current) {
        synchronized (lifecycle) { return withDeadline(key, generations.getOrDefault(key, 0L), current); }
    }
    private Operation withDeadline(String key, long generation, BooleanSupplier current) {
        return new Operation(key, generation, current, System.nanoTime() + operationTimeoutNanos);
    }
    private long cancel(String key) {
        Set<Call> active; long generation;
        synchronized (lifecycle) {
            generation = generations.merge(key, 1L, Long::sum);
            pending.entrySet().removeIf(e -> e.getValue().operation().key().equals(key)); active = calls.remove(key);
        }
        if (active != null) active.forEach(Call::cancel);
        return generation;
    }
    private ReentrantLock acquire(Operation op) {
        ReentrantLock lock = refreshLocks.computeIfAbsent(op.key(), ignored -> new ReentrantLock());
        try {
            while (true) {
                guard(op);
                if (lock.tryLock(50, TimeUnit.MILLISECONDS)) {
                    try { guard(op); return lock; }
                    catch (RuntimeException e) { lock.unlock(); throw e; }
                }
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt(); throw cancelled();
        }
    }
    private void guard(Operation op) {
        // The caller's guard can take its own connection lock; never invoke it under lifecycle.
        if (Thread.currentThread().isInterrupted() || !op.current().getAsBoolean()) throw cancelled();
        if (System.nanoTime() >= op.deadlineNanos()) throw failure("oauth_transport_error", 504,
                "授权操作超时，请检查网络后重试。", "The authorization operation timed out. Check the network and retry.");
        synchronized (lifecycle) { generationGuard(op); }
    }
    private void generationGuard(Operation op) { if (op.generation() != generations.getOrDefault(op.key(), 0L)) throw cancelled(); }
    private void save(Operation op, Map<String, Object> value) {
        guard(op);
        synchronized (lifecycle) { generationGuard(op); credentials.put(op.key(), json(value)); }
        try { guard(op); } catch (PluginMcpException e) {
            synchronized (lifecycle) {
                if (op.generation() == generations.getOrDefault(op.key(), 0L)) credentials.remove(op.key());
            }
            throw e;
        }
    }
    private void markReconnect(Operation op) {
        guard(op);
        synchronized (lifecycle) {
            generationGuard(op); Map<String, Object> value = read(op.key());
            if (!value.isEmpty()) { value.put("invalid", true); credentials.put(op.key(), json(value)); }
        }
    }
    private Map<String, Object> read(String key) {
        try { String raw = credentials.get(key); return raw.isEmpty() ? new LinkedHashMap<>() : JSON.readValue(raw, MAP); }
        catch (Exception e) { throw reconnect(); }
    }
    private boolean expired(Map<String, Object> token) {
        return token.get("expires_at") instanceof Number n && n.longValue() <= clock.millis() + 30_000;
    }
    private static String wellKnown(String issuer, String suffix) {
        URI uri = URI.create(issuer); String path = uri.getRawPath();
        return origin(issuer) + "/.well-known/" + suffix + (path == null || path.equals("/") ? "" : path);
    }
    private static String origin(String url) { URI uri = URI.create(url); return uri.getScheme() + "://" + uri.getRawAuthority(); }
    private static String text(Map<String, Object> value, String key) { return value.get(key) instanceof String s ? s : ""; }
    private static List<String> strings(Map<String, Object> value, String key, boolean required) {
        Object raw = value.get(key);
        if (raw == null && !required) return List.of();
        if (!(raw instanceof List<?> list) || list.size() > 64) throw metadata();
        List<String> out = new ArrayList<>();
        for (Object item : list) {
            if (!(item instanceof String s) || s.isBlank() || s.length() > 8192 || unsafe(s)) throw metadata();
            out.add(s);
        }
        return List.copyOf(out);
    }
    private static String identity(String url, Config config) { return digest(json(List.of(url, config.clientId(), config.clientSecret(), config.scopes()))); }
    private String randomToken() { byte[] bytes = new byte[32]; random.nextBytes(bytes); return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); }
    private static String digest(String value) {
        try { return Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
    private static String encode(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8); }
    private static String json(Object value) {
        try { return JSON.writeValueAsString(value); } catch (Exception e) { throw metadata(); }
    }
    private static boolean unsafe(String value) { return value.chars().anyMatch(c -> c < 32 || c == 127); }
    private static void requireSuccess(Reply reply) {
        if (reply.status() < 200 || reply.status() >= 300) throw failure("oauth_provider_error", 502,
                "授权服务拒绝了请求，请检查配置后重试。", "The authorization service rejected the request. Check the configuration and retry.");
    }
    private static PluginMcpException configuration() { return failure("oauth_invalid_configuration", 400, "OAuth 客户端配置无效。", "Invalid OAuth client configuration."); }
    private static PluginMcpException metadata() { return failure("oauth_invalid_metadata", 400, "授权服务返回的元数据或凭据不符合协议要求。", "The authorization service returned invalid metadata or credentials."); }
    private static PluginMcpException reconnect() { return failure("oauth_needs_reconnect", 401, "OAuth 凭据无效或已过期，请重新授权此连接。", "OAuth credentials are invalid or expired. Authorize this connection again."); }
    private static PluginMcpException expiredAuthorization() { return failure("oauth_state_expired", 400, "授权已失效或已使用，请从 MCP 设置重新开始。", "This authorization expired or was already used. Start again from MCP settings."); }
    private static PluginMcpException cancelled() { return failure("cancelled", 409, "账户或连接已改变，本次授权操作已停止。", "The account or connection changed; this authorization stopped."); }
    private static PluginMcpException failure(String code, int status, String zh, String en) { return new PluginMcpException(code, status, LangText.of(zh, en)); }
}
