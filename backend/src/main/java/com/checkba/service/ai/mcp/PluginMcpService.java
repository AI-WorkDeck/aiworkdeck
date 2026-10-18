// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.mcp;

import com.checkba.service.ProjectMemberService;
import com.checkba.service.SystemSettingService;
import com.checkba.service.ai.PluginService;
import com.checkba.service.ai.tools.ToolContext;
import dev.langchain4j.agent.tool.ToolSpecification;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** One authority for UI and Agent calls, with server-side identity and live plugin/ACL gates. */
@Service
public class PluginMcpService {
    private final PluginService plugins;
    private final ProjectMemberService members;
    private final SystemSettingService settings;
    private final PluginMcpHttpClient client;
    private PluginMcpCredentialResolver credentials;
    private final ObjectMapper json = new ObjectMapper();
    public PluginMcpService(PluginService plugins, ProjectMemberService members, SystemSettingService settings, PluginMcpHttpClient client) {
        this.plugins = plugins; this.members = members; this.settings = settings; this.client = client;
        credentials = this::legacyCredential;
    }
    @Autowired(required = false)
    public void setCredentialResolver(PluginMcpCredentialResolver resolver) { credentials = resolver; }

    public record Binding(String pluginId, PluginService.McpServerDecl server, PluginService.McpToolDecl tool, ToolSpecification specification) {}
    public List<Binding> bindings() {
        List<Binding> all = new ArrayList<>();
        for (var plugin : plugins.getPlugins()) {
            if (!active(plugin.getId())) continue;
            try {
                for (var server : declarations(plugin)) for (var tool : server.getTools()) {
                    all.add(new Binding(plugin.getId(), server, tool, ToolSpecification.builder()
                            .name(agentName(plugin.getId(), server.getId(), tool.getName()))
                            .description(tool.getDescription()).parameters(PluginMcpSchema.object(tool.getInputSchema())).build()));
                }
            } catch (PluginMcpException invalid) { /* malformed contributions are not offered to the model */ }
        }
        return all;
    }
    public Binding find(String agentName) { return bindings().stream().filter(b -> b.specification().name().equals(agentName)).findFirst().orElse(null); }
    public List<Map<String, Object>> servers(String pluginId, Long userId, Long projectId) {
        PluginService.PluginMetadata plugin = authorize(pluginId, userId, projectId);
        List<Map<String, Object>> out = new ArrayList<>();
        for (var server : declarations(plugin)) {
            List<Map<String, Object>> tools = server.getTools().stream().map(t -> Map.<String, Object>of(
                    "name", t.getName(), "agentToolName", agentName(pluginId, server.getId(), t.getName()),
                    "description", t.getDescription(), "inputSchema", t.getInputSchema())).toList();
            boolean configured;
            try {
                String token = resolveToken(pluginId, userId, server);
                configured = server.getConnectionId() != null || server.getCredentialKey() == null || !token.isBlank();
            }
            catch (RuntimeException unavailable) { configured = false; }
            out.add(Map.of("id", server.getId(), "transport", server.getTransport(), "configured", configured,
                    "credentialScope", server.getConnectionId() != null ? "user" : server.getCredentialKey() != null ? "installation" : "none", "tools", tools));
        }
        return out;
    }
    public Map<String, Object> call(String pluginId, String serverId, String name, Map<String, Object> arguments, ToolContext ctx) {
        Long userId = ctx == null ? null : ctx.userId(), projectId = ctx == null ? null : ctx.projectId();
        var plugin = authorize(pluginId, userId, projectId);
        var server = declarations(plugin).stream().filter(s -> s.getId().equals(serverId)).findFirst()
                .orElseThrow(() -> failure("not_found", 404, "MCP server is not declared by this plugin."));
        var tool = server.getTools().stream().filter(t -> t.getName().equals(name)).findFirst()
                .orElseThrow(() -> failure("not_found", 404, "MCP tool is not declared by this plugin."));
        if (arguments == null) arguments = Map.of();
        try { if (json.writeValueAsBytes(arguments).length > 128 * 1024) throw failure("invalid_arguments", 400, "MCP arguments exceed the size limit."); }
        catch (java.io.IOException e) { throw failure("invalid_arguments", 400, "Invalid MCP arguments."); }
        PluginMcpSchema.validateArguments(tool.getInputSchema(), arguments);
        var credentialCurrent = credentials.guard(pluginId, userId, server.getConnectionId());
        String token = resolveToken(pluginId, userId, server);
        if (server.getConnectionId() == null && server.getCredentialKey() != null && token.isBlank()) throw failure("authentication_required", 403, "Configure this plugin's MCP connection first.");
        return client.call(server.getUrl(), token, name, tool.getInputSchema(), arguments,
                () -> !ctx.isCancelled() && credentialCurrent.getAsBoolean() && plugins.getPlugin(pluginId) == plugin && active(pluginId)
                        && members.hasWritePermission(projectId, userId));
    }
    public String callAgent(String name, Map<String, Object> arguments, ToolContext ctx) {
        Binding b = find(name);
        if (b == null) throw failure("not_found", 404, "MCP tool is unavailable.");
        var result = call(b.pluginId(), b.server().getId(), b.tool().getName(), arguments, ctx);
        try { return (Boolean.TRUE.equals(result.get("isError")) ? "Error: " : "") + json.writeValueAsString(result); }
        catch (java.io.IOException e) { throw failure("protocol_error", 502, "Invalid MCP result."); }
    }
    private PluginService.PluginMetadata authorize(String pluginId, Long userId, Long projectId) {
        if (userId == null) throw failure("not_authenticated", 401, "Sign in first.");
        if (!active(pluginId)) throw failure("not_found", 404, "Plugin MCP access is unavailable.");
        if (projectId == null || !members.hasWritePermission(projectId, userId)) throw failure("permission_denied", 403, "No write permission for this project.");
        return plugins.getPlugin(pluginId);
    }
    private boolean active(String pluginId) {
        var p = plugins.getPlugin(pluginId);
        return p != null && plugins.isEnabled(pluginId) && plugins.revokedReason(pluginId) == null
                && com.checkba.service.ai.PluginDevTrustService.isServiceTrusted(plugins, pluginId) && p.getPermissions() != null && p.getPermissions().contains("network");
    }
    public static List<PluginService.McpServerDecl> declarations(PluginService.PluginMetadata plugin) {
        var declared = plugin.getContributes() == null ? null : plugin.getContributes().getMcpServers();
        if (declared == null) return List.of();
        if (declared.size() > 8) throw badDeclaration();
        Set<String> ids = new HashSet<>();
        for (var s : declared) {
            if (s == null || s.getId() == null || !s.getId().matches("[a-z0-9][a-z0-9-]{0,39}") || !ids.add(s.getId())
                    || !"streamable-http".equals(s.getTransport()) || s.getTools() == null || s.getTools().isEmpty() || s.getTools().size() > 64) throw badDeclaration();
            PluginMcpEndpointPolicy.validateUrl(s.getUrl());
            if (s.getConnectionId() != null && !s.getConnectionId().matches("[a-z0-9][a-z0-9-]{0,49}")) throw badDeclaration();
            if (s.getCredentialKey() != null && !ownSecret(plugin, s.getCredentialKey())) throw badDeclaration();
            Set<String> names = new HashSet<>();
            for (var t : s.getTools()) {
                if (t == null || t.getName() == null || !t.getName().matches("[A-Za-z0-9_.-]{1,128}") || !names.add(t.getName())
                        || t.getDescription() == null || t.getDescription().isBlank() || t.getDescription().length() > 2000) throw badDeclaration();
                PluginMcpSchema.object(t.getInputSchema());
            }
        }
        return declared;
    }
    private static boolean ownSecret(PluginService.PluginMetadata p, String key) {
        return key.matches("[A-Za-z][A-Za-z0-9_-]{0,63}") && p.getSettings() != null
                && p.getSettings().stream().anyMatch(s -> s != null && key.equals(s.getKey()) && Boolean.TRUE.equals(s.getSecret())
                        && (s.getScope() == null || "installation".equals(s.getScope())));
    }
    private String resolveToken(String id, Long user, PluginService.McpServerDecl s) {
        try {
            String token = credentials.resolveForEndpoint(id, user, s.getConnectionId(), s.getCredentialKey(), s.getUrl());
            return token == null ? "" : token;
        } catch (PluginMcpException error) {
            throw error;
        } catch (IllegalStateException error) {
            if (Set.of("connection_required", "Invalid stored connection", "Plugin credential unavailable; reconnect this service")
                    .contains(String.valueOf(error.getMessage()))) {
                throw failure("authentication_required", 403, "Reconnect this plugin service in plugin settings.");
            }
            throw failure("credential_unavailable", 502, "The plugin credential service is unavailable. Try again later.");
        }
    }
    private String legacyCredential(String id, Long user, String connection, String key) {
        if (connection != null) throw failure("authentication_required", 403, "Connect this plugin account first.");
        if (key == null) return "";
        if (!ownSecret(plugins.getPlugin(id), key)) throw badDeclaration();
        return settings.get("plugin." + id + "." + key, "");
    }
    public static String agentName(String plugin, String server, String tool) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest((plugin + "\0" + server + "\0" + tool).getBytes(StandardCharsets.UTF_8));
            String suffix = tool.replaceAll("[^A-Za-z0-9_]", "_");
            return "mcp_" + HexFormat.of().formatHex(hash).substring(0, 24) + "_" + suffix.substring(0, Math.min(32, suffix.length()));
        } catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    private static PluginMcpException badDeclaration() { return failure("invalid_manifest", 400, "Invalid MCP declaration or credential reference."); }
    private static PluginMcpException failure(String code, int status, String message) { return new PluginMcpException(code, status, message); }
}
