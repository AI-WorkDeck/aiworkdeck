// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.mcp;

import com.checkba.service.LangText;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.*;
import java.util.*;

/** Parse common desktop MCP formats without resolving variables, contacting servers or executing commands. */
final class UserMcpConfigImport {
    private static final ObjectMapper JSON = new ObjectMapper().enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
    record Entry(int index, String name, UserMcpConnectionService.Update update) {
        Map<String, Object> preview() {
            var out = new LinkedHashMap<String, Object>();
            out.put("index", index); out.put("name", name); out.put("transport", update.transport());
            out.put("authType", update.authType()); out.put("url", update.url()); out.put("command", update.command());
            out.put("args", update.args()); out.put("cwd", update.cwd());
            List<String> secrets = new ArrayList<>();
            if (update.token() != null) secrets.add("token");
            if (update.oauthClientSecret() != null) secrets.add("oauthClientSecret");
            update.env().keySet().forEach(key -> secrets.add("env." + key));
            update.headers().keySet().forEach(key -> secrets.add("headers." + key));
            out.put("secretFields", secrets);
            out.put("warnings", "stdio".equals(update.transport()) ? List.of(LangText.of(
                    "导入不会运行命令；测试时须确认允许此程序在本机运行。", "Import does not run commands. Testing requires approval to run this program locally.")) : List.of());
            return out;
        }
    }
    record Parsed(List<Entry> entries, List<Map<String, Object>> errors) {}
    static Parsed parse(String text) {
        if (text == null || text.length() > 512 * 1024 || text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 512 * 1024) throw invalid();
        JsonNode root;
        try { root = JSON.readTree(text); } catch (Exception e) { throw invalid(); }
        if (root == null || !root.isObject() || root.has("mcpServers") == root.has("servers")) throw invalid();
        JsonNode servers = root.has("mcpServers") ? root.get("mcpServers") : root.get("servers");
        if (!servers.isObject() || servers.isEmpty() || servers.size() > 32) throw invalid();
        List<Entry> entries = new ArrayList<>(); List<Map<String, Object>> errors = new ArrayList<>();
        int index = 0;
        var fields = servers.fields();
        while (fields.hasNext()) {
            var field = fields.next();
            try { entries.add(new Entry(index, field.getKey(), parseEntry(field.getKey(), field.getValue()))); }
            catch (PluginMcpException e) { errors.add(Map.of("index", index, "name", field.getKey(), "message", e.getMessage())); }
            index++;
        }
        return new Parsed(List.copyOf(entries), List.copyOf(errors));
    }
    private static UserMcpConnectionService.Update parseEntry(String name, JsonNode row) {
        if (!row.isObject() || name.isBlank() || name.length() > 100) throw invalid();
        // A literal variable reference must never be mistaken for a real secret or expanded from this machine.
        if (containsPlaceholder(row)) throw new PluginMcpException("import_unresolved_variable", 400,
                LangText.of("请先将配置中的变量占位符替换为实际值。", "Replace variable placeholders in the configuration with actual values first."));
        String type = string(row, "type", string(row, "transport", row.has("command") ? "stdio" : "streamable-http"));
        if ("http".equals(type)) type = "streamable-http";
        if (!Set.of("stdio", "streamable-http").contains(type)) throw new PluginMcpException("import_unsupported_transport", 400,
                LangText.of("仅支持 Streamable HTTP 和 stdio；旧版 SSE 请改用新版服务地址。", "Only Streamable HTTP and stdio are supported. Use the updated service endpoint for legacy SSE."));
        boolean local = "stdio".equals(type);
        if (local && (row.has("url") || row.has("headers")) || !local && (row.has("command") || row.has("env"))) throw invalid();
        Map<String, String> env = map(row, "env", false), headers = map(row, "headers", true);
        String token = string(row, "token", null), auth = string(row, "authType", token == null ? "none" : "bearer");
        if (headers.containsKey("authorization") && headers.get("authorization").regionMatches(true, 0, "Bearer ", 0, 7)) {
            if (token != null || !Set.of("none", "bearer").contains(auth)) throw invalid();
            token = headers.remove("authorization").substring(7); auth = "bearer";
        }
        if (local && (!"none".equals(auth) || token != null)) throw invalid();
        return new UserMcpConnectionService.Update(name, local ? "" : string(row, "url", null), type, token, auth,
                string(row, "command", ""), strings(row, "args"), env, string(row, "cwd", ""), integer(row, "timeoutSeconds"), headers,
                string(row, "oauthClientId", ""), string(row, "oauthClientSecret", null), strings(row, "oauthScopes"));
    }
    private static boolean containsPlaceholder(JsonNode node) {
        if (node.isTextual()) return node.textValue().contains("${") || node.textValue().contains("{{");
        for (JsonNode child : node) if (containsPlaceholder(child)) return true;
        return false;
    }
    private static String string(JsonNode row, String key, String fallback) {
        if (!row.has(key)) return fallback;
        if (!row.get(key).isTextual()) throw invalid();
        return row.get(key).textValue();
    }
    private static Integer integer(JsonNode row, String key) {
        if (!row.has(key)) return 60;
        if (!row.get(key).isIntegralNumber() || !row.get(key).canConvertToInt()) throw invalid();
        return row.get(key).intValue();
    }
    private static List<String> strings(JsonNode row, String key) {
        if (!row.has(key)) return List.of();
        JsonNode value = row.get(key);
        if (!value.isArray() || value.size() > 256) throw invalid();
        List<String> result = new ArrayList<>();
        for (JsonNode child : value) { if (!child.isTextual()) throw invalid(); result.add(child.textValue()); }
        return List.copyOf(result);
    }
    private static Map<String, String> map(JsonNode row, String key, boolean lowercase) {
        Map<String, String> result = new LinkedHashMap<>();
        if (!row.has(key)) return result;
        JsonNode value = row.get(key);
        if (!value.isObject() || value.size() > 64) throw invalid();
        var fields = value.fields();
        while (fields.hasNext()) {
            var entry = fields.next(); String name = lowercase ? entry.getKey().toLowerCase(Locale.ROOT) : entry.getKey();
            if (!entry.getValue().isTextual() || result.put(name, entry.getValue().textValue()) != null) throw invalid();
        }
        return result;
    }
    private static PluginMcpException invalid() {
        return new PluginMcpException("invalid_import", 400, LangText.of("配置 JSON 无效。请使用 mcpServers 或 servers 对象，并检查字段类型、重复键和大小限制。",
                "Invalid configuration JSON. Use a mcpServers or servers object and check field types, duplicate keys and size limits."));
    }
}
