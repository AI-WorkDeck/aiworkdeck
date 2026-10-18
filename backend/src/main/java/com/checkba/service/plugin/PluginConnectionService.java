// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.plugin;

import com.checkba.service.ai.PluginService;
import com.checkba.service.account.AccountService;
import com.checkba.service.ai.mcp.PluginMcpEndpointPolicy;
import okhttp3.*;
import java.net.Proxy;
import java.time.Duration;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/** Declarative BYO services: host-held credentials, fixed operations and OAuth public-client PKCE. */
@Service
public class PluginConnectionService {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() {};
    private final PluginService plugins;
    private final PluginCredentialStore credentials;
    private final AccountService account;
    private final String redirectUri;
    private final Map<String, Pending> pending = new ConcurrentHashMap<>();
    private final Map<String, Long> generations = new ConcurrentHashMap<>();
    private final Map<String, Object> locks = new ConcurrentHashMap<>();
    private final OkHttpClient http = new OkHttpClient.Builder().dns(new PluginMcpEndpointPolicy())
            .proxy(Proxy.NO_PROXY).followRedirects(false).followSslRedirects(false)
            .connectTimeout(Duration.ofSeconds(10)).readTimeout(Duration.ofSeconds(30)).callTimeout(Duration.ofSeconds(45)).build();
    private final SecureRandom random = new SecureRandom();

    public PluginConnectionService(PluginService plugins, PluginCredentialStore credentials, AccountService account,
            @Value("${ai.plugins.oauth-redirect-uri:http://localhost:9696/api/plugins/oauth/callback}") String redirectUri) {
        this.plugins = plugins;
        this.credentials = credentials;
        this.account = account;
        this.redirectUri = redirectUri;
    }

    public record Operation(String path, String method) {}
    public record Connection(String id, String label, String baseUrl, String authType, String authorizationUrl,
            String tokenUrl, String clientId, List<String> scopes, Map<String, Operation> operations,
            String statusOperation, String checkoutUrl) {}
    private record Pending(String pluginId, Long userId, Connection connection, String scope,
            String verifier, long generation, Instant expiresAt) {}
    public record Reply(int status, Map<String, Object> body) {}

    public List<Map<String, Object>> list(String pluginId, Long userId) {
        return declarations(pluginId).stream().map(c -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", c.id()); row.put("label", c.label()); row.put("authType", c.authType());
            boolean connected = "none".equals(c.authType());
            boolean reconnect = false;
            if (!connected) try {
                String stored = credentials.get(scope(pluginId, userId, c.id()));
                connected = !stored.isEmpty() && identity(c).equals(parse(stored).get("connection_identity"));
                reconnect = !stored.isEmpty() && !connected;
            } catch (IllegalStateException e) { reconnect = true; }
            row.put("connected", connected);
            row.put("needsReconnect", reconnect);
            row.put("operations", c.operations().keySet());
            row.put("billing", c.statusOperation() != null);
            return row;
        }).toList();
    }

    /** Called only by the trusted host settings form. No API returns the supplied token to the iframe. */
    public void connect(String pluginId, Long userId, String connectionId, String token) {
        Connection c = declaration(pluginId, connectionId);
        if (!"bearer".equals(c.authType())) throw new IllegalArgumentException("This connection does not accept a token");
        if (token == null || token.isBlank() || token.length() > 8192 || token.contains("\r") || token.contains("\n")) {
            throw new IllegalArgumentException("Invalid service token");
        }
        String scope = scope(pluginId, userId, connectionId);
        synchronized (lock(scope)) {
            invalidate(scope);
            credentials.put(scope, json(Map.of("access_token", token.trim(), "connection_identity", identity(c))));
        }
    }

    public void disconnect(String pluginId, Long userId, String connectionId) {
        declaration(pluginId, connectionId);
        String scope = scope(pluginId, userId, connectionId);
        synchronized (lock(scope)) { invalidate(scope); credentials.remove(scope); }
    }

    private void invalidate(String scope) {
        generations.merge(scope, 1L, Long::sum);
        pending.entrySet().removeIf(e -> e.getValue().scope().equals(scope));
    }

    public Map<String, Object> authorize(String pluginId, Long userId, String connectionId) {
        Connection c = declaration(pluginId, connectionId);
        if (!"oauth2".equals(c.authType())) throw new IllegalArgumentException("This connection does not use OAuth");
        pending.entrySet().removeIf(e -> e.getValue().expiresAt().isBefore(Instant.now()));
        if (pending.size() >= 100) throw new IllegalStateException("Too many pending connections");
        String scope = scope(pluginId, userId, connectionId);
        synchronized (lock(scope)) {
        invalidate(scope);
        String state = randomToken();
        String verifier = randomToken();
        pending.put(state, new Pending(pluginId, userId, c, scope, verifier, generation(scope), Instant.now().plusSeconds(600)));
        String challenge;
        try { challenge = Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256")
                .digest(verifier.getBytes(StandardCharsets.US_ASCII))); }
        catch (Exception e) { throw new IllegalStateException(e); }
        String query = form(Map.of("response_type", "code", "client_id", c.clientId(), "redirect_uri", redirectUri,
                "scope", String.join(" ", c.scopes()), "state", state, "code_challenge", challenge, "code_challenge_method", "S256"));
        return Map.of("authorizationUrl", c.authorizationUrl() + (c.authorizationUrl().contains("?") ? "&" : "?") + query,
                "expiresIn", 600);
        }
    }

    /** Anonymous browser callback, authenticated by one-use random state bound to the initiating local user. */
    public void callback(String state, String code) {
        Pending p = state == null ? null : pending.remove(state);
        if (p == null || p.expiresAt().isBefore(Instant.now()) || code == null || code.isBlank() || code.length() > 4096) {
            throw new IllegalArgumentException("Authorization expired; start again from the plugin settings");
        }
        assertCurrent(p.pluginId(), p.userId(), p.connection(), p.scope(), p.generation());
        Reply reply = exchange(p.connection().tokenUrl(), "POST", "", form(Map.of("grant_type", "authorization_code",
                "code", code, "client_id", p.connection().clientId(), "redirect_uri", redirectUri,
                "code_verifier", p.verifier())), true);
        requireSuccess(reply);
        Map<String, Object> token = tokenRecord(reply.body());
        synchronized (lock(p.scope())) {
            assertCurrent(p.pluginId(), p.userId(), p.connection(), p.scope(), p.generation());
            token.put("connection_identity", identity(p.connection()));
            credentials.put(p.scope(), json(token));
        }
    }

    public String bearerToken(String pluginId, Long userId, String connectionId) {
        Connection c = declaration(pluginId, connectionId);
        if ("none".equals(c.authType())) return "";
        String scope = scope(pluginId, userId, connectionId);
        synchronized (lock(scope)) {
        long generation = generation(scope);
        String raw = credentials.get(scope);
        if (raw.isEmpty()) throw new IllegalStateException("connection_required");
        Map<String, Object> record = parse(raw);
        if (!identity(c).equals(record.get("connection_identity"))) throw new IllegalStateException("connection_required");
        if (record.get("expires_at") instanceof Number n && n.longValue() <= Instant.now().getEpochSecond() + 30) {
            String refresh = string(record, "refresh_token", "");
            if (refresh.isBlank() || !"oauth2".equals(c.authType())) throw new IllegalStateException("connection_required");
            Reply reply = exchange(c.tokenUrl(), "POST", "", form(Map.of("grant_type", "refresh_token",
                    "refresh_token", refresh, "client_id", c.clientId())), true);
            requireSuccess(reply);
            Map<String, Object> next = tokenRecord(reply.body());
            next.putIfAbsent("refresh_token", refresh);
            next.put("connection_identity", identity(c));
            assertCurrent(pluginId, userId, c, scope, generation);
            credentials.put(scope, json(next));
            record = next;
        }
        return string(record, "access_token", "");
        }
    }

    public Map<String, Object> request(String pluginId, Long userId, String connectionId,
            String operation, Map<String, Object> params) {
        Connection c = declaration(pluginId, connectionId);
        Operation op = c.operations().get(operation);
        if (op == null) throw new IllegalArgumentException("Undeclared service operation");
        String scope = scope(pluginId, userId, connectionId);
        long generation = generation(scope);
        Map<String, Object> args = params == null ? Map.of() : params;
        if (json(args).length() > 65536) throw new IllegalArgumentException("Service request exceeds 64 KB");
        String url = c.baseUrl() + op.path();
        String body = "GET".equals(op.method()) ? "" : json(args);
        if ("GET".equals(op.method()) && !args.isEmpty()) url += "?" + form(args);
        Reply reply = exchange(url, op.method(), bearerToken(pluginId, userId, connectionId), body, false);
        assertCurrent(pluginId, userId, c, scope, generation);
        requireSuccess(reply);
        return reply.body();
    }

    public Map<String, Object> billingStatus(String pluginId, Long userId, String connectionId) {
        Connection c = declaration(pluginId, connectionId);
        if (c.statusOperation() == null) throw new IllegalArgumentException("This service has no billing status operation");
        Map<String, Object> result = request(pluginId, userId, connectionId, c.statusOperation(), Map.of());
        if (!(result.get("active") instanceof Boolean)) throw new IllegalStateException("Invalid subscription status response");
        return Map.of("active", result.get("active"), "plan", string(result, "plan", ""), "provider", "developer");
    }

    public String checkout(String pluginId, String connectionId) {
        Connection c = declaration(pluginId, connectionId);
        if (c.checkoutUrl() == null) throw new IllegalArgumentException("This service has no checkout link");
        return c.checkoutUrl();
    }

    private void assertCurrent(String pluginId, Long userId, Connection c, String scope, long generation) {
        if (!c.equals(declaration(pluginId, c.id())) || !scope.equals(scope(pluginId, userId, c.id()))
                || generation != generation(scope)) throw new IllegalStateException("Connection changed; response discarded");
    }
    private long generation(String scope) { return generations.getOrDefault(scope, 0L); }
    private String scope(String pluginId, Long userId, String connectionId) {
        if (userId == null) throw new IllegalArgumentException("A local user is required");
        String fingerprint = account.accountFingerprintOrNull();
        return userId + "." + (fingerprint == null ? "local" : fingerprint) + "." + pluginId + "." + connectionId;
    }

    private Connection declaration(String pluginId, String id) {
        return declarations(pluginId).stream().filter(c -> c.id().equals(id)).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Unknown plugin connection"));
    }
    public List<Connection> declarations(String pluginId) {
        PluginService.PluginMetadata plugin = plugins.getPlugin(pluginId);
        if (plugin == null || !plugins.isEnabled(pluginId) || plugins.revokedReason(pluginId) != null) throw new IllegalArgumentException("Plugin is not enabled");
        if (!com.checkba.service.ai.PluginDevTrustService.isServiceTrusted(plugins, pluginId)) throw new IllegalArgumentException("Approve development plugin services in plugin settings first");
        if (plugin.getPermissions() == null || !plugin.getPermissions().contains("network")) {
            throw new IllegalArgumentException("Plugin requires the network permission");
        }
        return parseDeclarations(plugin);
    }

    public static List<Connection> parseDeclarations(PluginService.PluginMetadata plugin) {
        if (plugin.getContributes() == null || plugin.getContributes().getConnections() == null) return List.of();
        List<Map<String, Object>> entries = plugin.getContributes().getConnections();
        if (entries.size() > 10) throw new IllegalArgumentException("Too many plugin connections");
        List<Connection> result = new ArrayList<>();
        Set<String> ids = new HashSet<>();
        for (Map<String, Object> raw : entries) {
            String id = string(raw, "id", "");
            if (!id.matches("[a-z][a-z0-9-]{0,49}") || !ids.add(id)) throw new IllegalArgumentException("Invalid connection id");
            String base = endpoint(string(raw, "baseUrl", ""));
            URI baseUri = URI.create(base);
            if (!baseUri.getPath().isEmpty() && !baseUri.getPath().equals("/")) throw new IllegalArgumentException("Service baseUrl must be an origin");
            if (baseUri.getQuery() != null) throw new IllegalArgumentException("Service baseUrl must be an origin");
            base = base.replaceAll("/+$", "");
            Map<String, Object> auth = object(raw.get("auth"));
            String type = string(auth, "type", "none");
            if (!Set.of("none", "bearer", "oauth2").contains(type)) throw new IllegalArgumentException("Unknown connection authentication");
            String authorization = null, token = null, clientId = null;
            List<String> scopes = new ArrayList<>();
            if ("oauth2".equals(type)) {
                authorization = endpoint(string(auth, "authorizationUrl", ""));
                token = endpoint(string(auth, "tokenUrl", ""));
                clientId = string(auth, "clientId", "");
                if (clientId.isBlank() || clientId.length() > 512) throw new IllegalArgumentException("OAuth clientId is required");
                if (auth.get("scopes") instanceof List<?> values) for (Object v : values) {
                    if (!(v instanceof String s) || s.isBlank() || s.contains(" ") || s.length() > 200) throw new IllegalArgumentException("Invalid OAuth scope");
                    scopes.add(s);
                }
            }
            Map<String, Operation> operations = new LinkedHashMap<>();
            for (var entry : object(raw.get("operations")).entrySet()) {
                Map<String, Object> op = object(entry.getValue());
                String path = string(op, "path", "");
                String method = string(op, "method", "GET");
                if (!entry.getKey().matches("[a-zA-Z][a-zA-Z0-9._-]{0,63}") || !path.matches("/[a-zA-Z0-9/_-]*")
                        || path.contains("//") || !Set.of("GET", "POST").contains(method)) throw new IllegalArgumentException("Invalid service operation");
                operations.put(entry.getKey(), new Operation(path, method));
            }
            if (operations.size() > 30) throw new IllegalArgumentException("Too many service operations");
            Map<String, Object> billing = object(raw.get("billing"));
            String status = billing.isEmpty() ? null : string(billing, "statusOperation", "");
            String checkout = billing.isEmpty() ? null : endpoint(string(billing, "checkoutUrl", ""));
            if (status != null && !operations.containsKey(status)) throw new IllegalArgumentException("Billing status operation is undeclared");
            result.add(new Connection(id, string(raw, "label", id), base, type, authorization, token, clientId,
                    List.copyOf(scopes), Map.copyOf(operations), status, checkout));
        }
        return result;
    }

    private static String endpoint(String value) {
        URI uri;
        try { uri = URI.create(value); } catch (Exception e) { throw new IllegalArgumentException("Invalid service URL"); }
        if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getRawUserInfo() != null
                || uri.getRawFragment() != null) throw new IllegalArgumentException("Service URLs must use HTTPS without credentials or fragments");
        return value;
    }
    protected void validateTarget(String url) {
        endpoint(url);
        URI uri = URI.create(url);
        try { PluginMcpEndpointPolicy.validateUrl(new URI(uri.getScheme(), uri.getRawAuthority(), uri.getRawPath(), null, null).toString()); }
        catch (Exception e) { throw new IllegalArgumentException("Service destination is not a public HTTPS endpoint"); }
    }

    /** DNS is checked at connection time. Redirects and JVM proxies cannot bypass the destination boundary. */
    protected Reply exchange(String url, String method, String bearer, String body, boolean form) {
        validateTarget(url);
        try {
            Request.Builder builder = new Request.Builder().url(url).header("Accept", "application/json");
            if (!bearer.isBlank()) builder.header("Authorization", "Bearer " + bearer);
            if ("GET".equals(method)) builder.get();
            else builder.post(RequestBody.create(body.getBytes(StandardCharsets.UTF_8), MediaType.get(
                    form ? "application/x-www-form-urlencoded" : "application/json")));
            try (Response response = http.newCall(builder.build()).execute()) {
                if (!response.isSuccessful()) return new Reply(response.code(), Map.of());
                if (response.body() == null) return new Reply(response.code(), Map.of());
                byte[] bytes = response.body().byteStream().readNBytes(2 * 1024 * 1024 + 1);
                if (bytes.length > 2 * 1024 * 1024) throw new IllegalStateException("Service response exceeds 2 MB");
                return new Reply(response.code(), bytes.length == 0 ? Map.of() : JSON.readValue(bytes, MAP));
            }
        } catch (Exception e) { throw new IllegalStateException("Service request failed", e); }
    }

    public String bearerTokenForEndpoint(String pluginId, Long userId, String connectionId, String endpoint) {
        Connection c = declaration(pluginId, connectionId);
        URI url = URI.create(endpoint);
        if (!(url.getScheme() + "://" + url.getRawAuthority()).equals(c.baseUrl())) {
            throw new IllegalArgumentException("Connection credentials cannot be used for another service origin");
        }
        return bearerToken(pluginId, userId, connectionId);
    }
    public java.util.function.BooleanSupplier guard(String pluginId, Long userId, String connectionId) {
        String capturedScope = scope(pluginId, userId, connectionId);
        long revision = generation(capturedScope);
        Connection connection = declaration(pluginId, connectionId);
        return () -> {
            try { assertCurrent(pluginId, userId, connection, capturedScope, revision); return true; }
            catch (RuntimeException e) { return false; }
        };
    }
    private Object lock(String scope) { return locks.computeIfAbsent(scope, ignored -> new Object()); }
    private static String identity(Connection c) {
        try {
            String material = json(Arrays.asList(c.baseUrl(), c.authType(), c.authorizationUrl(), c.tokenUrl(), c.clientId(), c.scopes()));
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(material.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) { throw new IllegalStateException(e); }
    }

    private static void requireSuccess(Reply reply) {
        if (reply.status() == 401 || reply.status() == 403) throw new IllegalStateException("connection_required");
        if (reply.status() == 402) throw new IllegalStateException("payment_required");
        if (reply.status() < 200 || reply.status() >= 300) throw new IllegalStateException("Service returned HTTP " + reply.status());
    }
    private static Map<String, Object> tokenRecord(Map<String, Object> body) {
        String token = string(body, "access_token", "");
        if (token.isBlank() || token.length() > 8192 || token.contains("\r") || token.contains("\n")
                || !"Bearer".equalsIgnoreCase(string(body, "token_type", "Bearer"))) throw new IllegalStateException("Invalid OAuth token response");
        Map<String, Object> result = new LinkedHashMap<>(); result.put("access_token", token);
        String refresh = string(body, "refresh_token", "");
        if (!refresh.isBlank() && refresh.length() <= 8192) result.put("refresh_token", refresh);
        if (body.get("expires_in") instanceof Number n) result.put("expires_at", Instant.now().getEpochSecond() + Math.max(0, Math.min(n.longValue(), 31536000)));
        return result;
    }
    private String randomToken() { byte[] bytes = new byte[32]; random.nextBytes(bytes); return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); }
    private static String form(Map<String, ?> values) {
        return values.entrySet().stream().map(e -> encode(e.getKey()) + "=" + encode(String.valueOf(e.getValue()))).collect(java.util.stream.Collectors.joining("&"));
    }
    private static String encode(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8); }
    private static String string(Map<String, Object> values, String key, String fallback) { Object value = values.get(key); return value instanceof String s ? s : fallback; }
    @SuppressWarnings("unchecked") private static Map<String, Object> object(Object value) { return value instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of(); }
    private static String json(Object value) { try { return JSON.writeValueAsString(value); } catch (Exception e) { throw new IllegalArgumentException("Invalid JSON"); } }
    private static Map<String, Object> parse(String value) { try { return JSON.readValue(value, MAP); } catch (Exception e) { throw new IllegalStateException("Invalid stored connection"); } }
}
