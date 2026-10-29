// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.mcp;

import com.checkba.service.LangText;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.DeserializationFeature;
import okhttp3.*;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.Proxy;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.BooleanSupplier;

/** Isolated session per operation: no token/session sharing between users or plugin instances. */
@Component
public class PluginMcpHttpClient {
    static final int MAX_BYTES = 2 * 1024 * 1024;
    private static final Set<String> VERSIONS = Set.of("2025-11-25", "2025-06-18", "2025-03-26");
    private static final ObjectMapper JSON = new ObjectMapper().enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
    private final PluginMcpEndpointPolicy policy;
    private final OkHttpClient http;

    public PluginMcpHttpClient() { this(new PluginMcpEndpointPolicy()); }
    PluginMcpHttpClient(PluginMcpEndpointPolicy policy) {
        this.policy = policy;
        http = new OkHttpClient.Builder().dns(policy).proxy(Proxy.NO_PROXY)
                .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
                .connectTimeout(Duration.ofSeconds(10)).readTimeout(Duration.ofSeconds(15))
                .callTimeout(Duration.ofSeconds(45)).build();
    }

    public Map<String, Object> call(String url, String token, String name, Map<String, Object> schema,
                                    Map<String, Object> args, BooleanSupplier allowed) {
        policy.validate(url);
        if (token != null && (token.contains("\r") || token.contains("\n")))
            throw error("invalid_credential", "The MCP credential is invalid.");
        Session session = new Session(url, token, allowed);
        try {
            session.initialize();
            JsonNode tools;
            try { tools = session.discover(name); }
            catch (PluginMcpException e) {
                if (!"session_expired".equals(e.code())) throw e;
                session.id = null;
                session.initialize();
                tools = session.discover(name);
            }
            if (!JSON.valueToTree(schema).equals(tools.get("inputSchema")))
                throw error("schema_mismatch", "The remote tool schema differs from the reviewed plugin declaration.");
            JsonNode result = session.rpc("tools/call", Map.of("name", name, "arguments", args));
            if (!result.isObject() || !result.path("content").isArray())
                throw error("protocol_error", "The MCP tool returned an invalid result.");
            return JSON.convertValue(result, new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {});
        } finally { session.close(); }
    }

    /** Explicit discovery only; listing saved connections never makes an outbound request. */
    public List<Map<String, Object>> listTools(String url, String token, BooleanSupplier allowed) {
        policy.validate(url);
        if (token != null && (token.contains("\r") || token.contains("\n")))
            throw error("invalid_credential", LangText.of("MCP 凭据无效。", "The MCP credential is invalid."));
        Session session = new Session(url, token, allowed);
        try {
            session.initialize();
            List<Map<String, Object>> tools = new ArrayList<>();
            String cursor = null;
            Set<String> cursors = new HashSet<>();
            for (int page = 0; page < 16; page++) {
                JsonNode result = session.rpc("tools/list", cursor == null ? Map.of() : Map.of("cursor", cursor));
                JsonNode rows = result.path("tools");
                if (!rows.isArray() || tools.size() + rows.size() > 256)
                    throw error("protocol_error", LangText.of("MCP 工具清单无效或超过大小限制。", "Invalid or oversized MCP tool list."));
                for (JsonNode row : rows) tools.add(JSON.convertValue(row, new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {}));
                cursor = result.path("nextCursor").asText(null);
                if (cursor == null || cursor.isBlank()) return tools;
                if (!cursors.add(cursor)) throw error("protocol_error", LangText.of("MCP 工具清单返回了重复分页游标。", "MCP tools pagination repeated a cursor."));
            }
            throw error("protocol_error", LangText.of("MCP 工具清单页数超过限制。", "MCP tools pagination exceeded the limit."));
        } finally { session.close(); }
    }

    private final class Session {
        final String url, token;
        final BooleanSupplier allowed;
        String id, version;
        Session(String url, String token, BooleanSupplier allowed) { this.url = url; this.token = token; this.allowed = allowed; }
        void guard() {
            if (Thread.currentThread().isInterrupted() || !allowed.getAsBoolean())
                throw new PluginMcpException("cancelled", 409, "MCP call cancelled or plugin access changed.");
        }
        void initialize() {
            version = null;
            JsonNode result = rpc("initialize", Map.of("protocolVersion", "2025-11-25", "capabilities", Map.of(),
                    "clientInfo", Map.of("name", "AIWorkDeck", "version", "1.0")));
            version = result.path("protocolVersion").asText();
            if (!VERSIONS.contains(version) || !result.path("capabilities").path("tools").isObject())
                throw error("protocol_error", "The MCP server does not support a compatible tool protocol.");
            request(Map.of("jsonrpc", "2.0", "method", "notifications/initialized"), null);
        }
        JsonNode discover(String name) {
            String cursor = null;
            Set<String> cursors = new HashSet<>();
            for (int page = 0; page < 16; page++) {
                JsonNode result = rpc("tools/list", cursor == null ? Map.of() : Map.of("cursor", cursor));
                JsonNode tools = result.path("tools");
                if (!tools.isArray() || tools.size() > 256) throw error("protocol_error", "Invalid MCP tools list.");
                for (JsonNode tool : tools) if (name.equals(tool.path("name").asText())) return tool;
                cursor = result.path("nextCursor").asText(null);
                if (cursor == null || cursor.isBlank()) break;
                if (!cursors.add(cursor)) throw error("protocol_error", "MCP tools pagination repeated a cursor.");
            }
            throw error("tool_unavailable", "The declared MCP tool is unavailable on this server.");
        }
        JsonNode rpc(String method, Map<String, Object> params) {
            String requestId = UUID.randomUUID().toString();
            return request(Map.of("jsonrpc", "2.0", "id", requestId, "method", method, "params", params), requestId);
        }
        JsonNode request(Map<String, Object> payload, String requestId) {
            guard();
            try {
                Request.Builder b = headers().post(RequestBody.create(JSON.writeValueAsBytes(payload), MediaType.get("application/json")));
                Call call = http.newCall(b.build());
                // Cancellation and disable checks cover blocked reads too, without sending tokens to any other endpoint.
                CompletableFuture<JsonNode> pending = CompletableFuture.supplyAsync(() -> {
                    try (Response response = call.execute()) {
                        int status = response.code();
                        if (status == 404 && id != null) throw error("session_expired", "The MCP session expired; retry the operation.");
                        if (status == 401 || status == 403) throw new PluginMcpException("authentication_required", 403, "The MCP service requires a valid connection.");
                        if (status < 200 || status >= 300) throw error("remote_error", "The MCP service rejected the request (HTTP " + status + ").");
                        if ("initialize".equals(payload.get("method"))) {
                            String sid = response.header("MCP-Session-Id");
                            if (sid != null && !sid.matches("[\\x21-\\x7e]{1,256}")) throw error("protocol_error", "Invalid MCP session identifier.");
                            id = sid;
                        }
                        if (requestId == null) return JSON.nullNode();
                        if (response.body() == null) throw error("protocol_error", "Empty MCP response.");
                        String type = response.header("Content-Type", "");
                        if (type.startsWith("text/event-stream")) return readSse(response.body().source(), requestId);
                        if (!type.startsWith("application/json")) throw error("protocol_error", "Unsupported MCP response type.");
                        var source = response.body().source();
                        if (source.request(MAX_BYTES + 1L)) throw error("response_too_large", "MCP response exceeds the size limit.");
                        return envelope(JSON.readTree(source.readUtf8()), requestId);
                    } catch (IOException e) { throw error("transport_error", "MCP connection failed or timed out."); }
                });
                try {
                    while (true) {
                        guard();
                        try {
                            JsonNode result = pending.get(50, TimeUnit.MILLISECONDS);
                            guard();
                            return result;
                        }
                        catch (TimeoutException wait) { /* recheck caller access */ }
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new PluginMcpException("cancelled", 409, "MCP call interrupted.");
                } catch (ExecutionException e) {
                    if (e.getCause() instanceof PluginMcpException failure) throw failure;
                    throw error("protocol_error", "Invalid MCP response.");
                } finally { if (!pending.isDone()) { call.cancel(); pending.cancel(true); } }
            } catch (IOException e) { throw error("invalid_arguments", "MCP arguments could not be encoded."); }
        }
        Request.Builder headers() {
            Request.Builder builder = new Request.Builder().url(url).header("Accept", "application/json, text/event-stream");
            if (token != null && !token.isBlank()) builder.header("Authorization", "Bearer " + token);
            if (id != null) builder.header("MCP-Session-Id", id);
            if (version != null) builder.header("MCP-Protocol-Version", version);
            return builder;
        }
        void close() {
            if (id == null) return;
            // Best effort cleanup is bounded and never retries an operation with side effects.
            Call cleanup = http.newCall(headers().delete().build());
            cleanup.timeout().timeout(2, TimeUnit.SECONDS);
            try (Response ignored = cleanup.execute()) { /* 405 is allowed by MCP. */ }
            catch (IOException ignored) { /* local session is discarded regardless */ }
        }
    }

    private static JsonNode readSse(okio.BufferedSource source, String id) throws IOException {
        StringBuilder data = new StringBuilder();
        long bytes = 0;
        while (true) {
            String line = source.readUtf8LineStrict(MAX_BYTES);
            bytes += line.getBytes(java.nio.charset.StandardCharsets.UTF_8).length + 1;
            if (bytes > MAX_BYTES) throw error("response_too_large", "MCP response exceeds the size limit.");
            if (line.isEmpty()) {
                if (data.length() > 0) {
                    JsonNode frame = JSON.readTree(data.toString());
                    data.setLength(0);
                    if (frame.has("id") && id.equals(frame.path("id").asText())) return envelope(frame, id);
                }
            } else if (line.startsWith("data:")) {
                if (data.length() > 0) data.append('\n');
                data.append(line.substring(5).stripLeading());
            }
        }
    }
    private static JsonNode envelope(JsonNode node, String id) {
        if (node == null || !node.isObject() || !"2.0".equals(node.path("jsonrpc").asText()) || !id.equals(node.path("id").asText()))
            throw error("protocol_error", "Invalid MCP response envelope.");
        if (node.has("error")) throw error("remote_error", "The MCP server returned a protocol error.");
        if (!node.has("result")) throw error("protocol_error", "MCP response has no result.");
        return node.get("result");
    }
    private static PluginMcpException error(String code, String message) { return new PluginMcpException(code, 502, message); }
}
