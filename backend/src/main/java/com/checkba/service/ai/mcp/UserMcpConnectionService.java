// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.mcp;

import com.checkba.service.LangText;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.SystemSettingService;
import com.checkba.service.account.AccountService;
import com.checkba.service.ai.PlatformAiUserScope;
import com.checkba.service.ai.context.ProjectContextHolder;
import com.checkba.service.ai.tools.ToolContext;
import com.checkba.service.plugin.PluginCredentialStore;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.langchain4j.agent.tool.ToolSpecification;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.function.BooleanSupplier;

/** Standalone user-owned MCP connections. No plugin enablement and no platform data billing. */
@Service
public class UserMcpConnectionService {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final java.util.concurrent.atomic.AtomicLong REVISIONS = new java.util.concurrent.atomic.AtomicLong(System.currentTimeMillis());
    private final SystemSettingService settings;
    private final PluginCredentialStore credentials;
    private final AccountService account;
    private final ProjectMemberService members;
    private final PluginMcpHttpClient client;

    public UserMcpConnectionService(SystemSettingService settings, PluginCredentialStore credentials,
            AccountService account, ProjectMemberService members, PluginMcpHttpClient client) {
        this.settings = settings; this.credentials = credentials; this.account = account;
        this.members = members; this.client = client;
    }
    public record Preset(String id, String name, String url, String documentationUrl, boolean supportsOfficial) {}
    public List<Preset> presets() {
        return List.of(
            new Preset("qichacha", LangText.of("企查查", "Qichacha"), "https://agent.qcc.com/mcp/company/stream", "https://agent.qcc.com/guide", true),
            new Preset("pkulaw", LangText.of("北大法宝", "PKULaw"), "https://apim-gateway.pkulaw.com/mcp-law-agg/mcp", "https://mcp.pkulaw.com/docs", true),
            new Preset("yuandian", LangText.of("元典", "Yuandian"), "https://open.chineselaw.com/mcp/law/stream", "https://open.chineselaw.com/llms-full.txt", false),
            new Preset("tavily", "Tavily", "https://mcp.tavily.com/mcp/", "https://github.com/tavily-ai/tavily-mcp", false),
            new Preset("github", "GitHub", "https://api.githubcopilot.com/mcp/", "https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/set-up-the-github-mcp-server", false));
    }
    public record RemoteTool(String name, String description, Map<String, Object> inputSchema) {}
    public record Connection(String id, String presetId, String name, String url, String transport,
            boolean enabled, boolean configured, boolean tested, long revision, List<RemoteTool> tools) {}
    public record Binding(Connection connection, RemoteTool tool, ToolSpecification specification) {}
    public record Update(String name, String url, String transport, String token) {}

    private Optional<Preset> preset(String id) { return presets().stream().filter(p -> p.id().equals(id)).findFirst(); }
    private Connection defaults(Preset p) {
        return new Connection(p.id(), p.id(), p.name(), p.url(), "streamable-http", false, false, false, 0, List.of());
    }
    public synchronized Map<String, Object> snapshot(Long userId) {
        String scope = scope(userId);
        return Map.of("code", 0, "scopeToken", scope, "connections", listScope(scope), "presets", presets());
    }
    public synchronized List<Map<String, Object>> list(Long userId) { return listScope(scope(userId)); }
    private List<Map<String, Object>> listScope(String scope) {
        Map<String, Connection> rows = load(scope);
        List<Map<String, Object>> out = new ArrayList<>();
        for (Preset p : presets()) out.add(view(rows.getOrDefault(p.id(), defaults(p))));
        rows.values().stream().filter(c -> c.presetId() == null).map(this::view).forEach(out::add);
        return out;
    }
    private Map<String, Object> view(Connection c) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", c.id()); row.put("presetId", c.presetId()); row.put("name", c.name());
        row.put("url", c.url()); row.put("transport", c.transport()); row.put("enabled", c.enabled());
        row.put("configured", c.configured()); row.put("tested", c.tested()); row.put("revision", c.revision()); row.put("tools", c.tools());
        boolean official = preset(c.id()).map(Preset::supportsOfficial).orElse(false);
        row.put("supportsOfficial", official);
        row.put("source", c.enabled() ? "custom" : official ? "official" : "disabled");
        row.put("billingMode", c.enabled() || !official ? "provider" : "platform");
        return row;
    }
    @org.springframework.transaction.annotation.Transactional
    public synchronized Map<String, Object> save(Long userId, String id, Update input) { return save(userId, id, input, scope(userId)); }
    @org.springframework.transaction.annotation.Transactional
    public synchronized Map<String, Object> save(Long userId, String id, Update input, String expectedScope) {
        String scope = checkedScope(userId, expectedScope);
        Map<String, Connection> rows = load(scope);
        boolean creating = id == null;
        if (creating) {
            if (rows.size() >= 32) throw fail("limit_exceeded", "最多配置 32 个 MCP 连接。", "At most 32 MCP connections are supported.");
            id = "custom-" + UUID.randomUUID();
        }
        Connection previous = rows.get(id);
        if (previous == null) previous = preset(id).map(this::defaults).orElse(null);
        if (previous == null && !creating) throw missing();
        String name = input.name() == null && previous != null ? previous.name() : input.name();
        String url = input.url() == null && previous != null ? previous.url() : input.url();
        String transport = input.transport() == null ? "streamable-http" : input.transport();
        if (name == null || name.isBlank() || name.length() > 100 || !"streamable-http".equals(transport))
            throw fail("invalid_configuration", "请填写名称；当前仅支持 HTTP MCP。", "Provide a name. Only HTTP MCP is supported.");
        PluginMcpEndpointPolicy.validateUrl(url);
        if (input.token() != null && (input.token().isBlank() || input.token().length() > 8192 || input.token().contains("\r") || input.token().contains("\n")))
            throw fail("invalid_credential", "请输入有效的 Bearer 密钥。", "Provide a valid Bearer token.");
        boolean changed = previous == null || !url.equals(previous.url()) || input.token() != null;
        // Endpoint changes must not silently forward the old endpoint's credential to a new host.
        boolean keepToken = previous != null && url.equals(previous.url()) && previous.configured();
        if (input.token() != null) credentials.put(secretKey(scope, id), input.token().trim());
        else if (!keepToken) credentials.remove(secretKey(scope, id));
        Connection next = new Connection(id, preset(id).map(Preset::id).orElse(null), name.trim(), url, transport,
                previous != null && previous.enabled(), input.token() != null || keepToken,
                !changed && previous.tested(), REVISIONS.incrementAndGet(),
                changed ? List.of() : previous.tools());
        rows.put(id, next); persist(scope, rows);
        return view(next);
    }
    @org.springframework.transaction.annotation.Transactional
    public synchronized void delete(Long userId, String id) { delete(userId, id, scope(userId)); }
    @org.springframework.transaction.annotation.Transactional
    public synchronized void delete(Long userId, String id, String expectedScope) {
        String scope = checkedScope(userId, expectedScope);
        Map<String, Connection> rows = load(scope);
        rows.remove(id); persist(scope, rows); credentials.remove(secretKey(scope, id));
    }
    public synchronized Map<String, Object> enable(Long userId, String id, boolean enabled) { return enable(userId, id, enabled, scope(userId)); }
    public synchronized Map<String, Object> enable(Long userId, String id, boolean enabled, String expectedScope) {
        String scope = checkedScope(userId, expectedScope);
        Map<String, Connection> rows = load(scope);
        Connection c = require(rows, id);
        if (enabled && !c.tested()) throw fail("test_required", "请先测试连接并读取工具清单。", "Test the connection and load its tools first.");
        Connection next = new Connection(c.id(), c.presetId(), c.name(), c.url(), c.transport(), enabled, c.configured(), c.tested(), REVISIONS.incrementAndGet(), c.tools());
        rows.put(id, next); persist(scope, rows); return view(next);
    }
    public Map<String, Object> test(Long userId, String id) { return test(userId, id, scope(userId)); }
    public Map<String, Object> test(Long userId, String id, String expectedScope) {
        String scope = checkedScope(userId, expectedScope);
        Connection captured;
        String token;
        synchronized (this) { captured = require(load(scope), id); token = token(scope, captured); }
        List<Map<String, Object>> discovered = client.listTools(captured.url(), token, guard(userId, scope, captured, false));
        List<RemoteTool> tools = validateTools(discovered);
        synchronized (this) {
            checkCurrent(userId, scope, captured, false);
            Map<String, Connection> rows = load(scope);
            Connection next = new Connection(captured.id(), captured.presetId(), captured.name(), captured.url(), captured.transport(),
                    captured.enabled(), captured.configured(), true, REVISIONS.incrementAndGet(), tools);
            rows.put(id, next); persist(scope, rows); return view(next);
        }
    }
    private List<RemoteTool> validateTools(List<Map<String, Object>> rows) {
        if (json(rows).length() > 256 * 1024 || rows.size() > 256) throw fail("invalid_tools", "工具清单超过限制。", "The tool list exceeds the limit.");
        List<RemoteTool> result = new ArrayList<>(); Set<String> names = new HashSet<>();
        for (Map<String, Object> row : rows) {
            String name = Objects.toString(row.get("name"), "");
            String description = Objects.toString(row.get("description"), name);
            if (!name.matches("[A-Za-z0-9_.-]{1,128}") || !names.add(name) || description.length() > 4000 || !(row.get("inputSchema") instanceof Map))
                throw fail("invalid_tools", "MCP 工具定义无效。", "The MCP tool definition is invalid.");
            @SuppressWarnings("unchecked") Map<String, Object> schema = (Map<String, Object>) row.get("inputSchema");
            UserMcpSchema.check(schema);
            result.add(new RemoteTool(name, description, schema));
        }
        return List.copyOf(result);
    }
    public List<Binding> bindings() { return bindings(currentUser()); }
    public synchronized List<Binding> bindings(Long userId) {
        if (userId == null) return List.of();
        List<Binding> out = new ArrayList<>();
        for (Connection c : load(scope(userId)).values()) if (c.enabled() && c.tested()) {
            for (RemoteTool tool : c.tools()) out.add(new Binding(c, tool, ToolSpecification.builder()
                    .name(agentName(c.id() + ":" + c.revision(), tool.name())).description(tool.description())
                    .parameters(UserMcpSchema.parameters(tool.inputSchema())).build()));
        }
        return out;
    }
    public Binding find(String name, Long userId) { return bindings(userId).stream().filter(b -> b.specification().name().equals(name)).findFirst().orElse(null); }
    public String callAgent(String name, Map<String, Object> args, ToolContext ctx) {
        if (ctx == null || ctx.userId() == null || ctx.projectId() == null || !members.hasWritePermission(ctx.projectId(), ctx.userId()))
            throw fail("permission_denied", "没有此项目的写权限。", "No write permission for this project.");
        // Never trust remote readOnlyHint. The orchestrator excludes MCP from ASK;
        // this gate also rejects forged XML calls outside the actually offered set.
        if (ctx.offeredTools() == null || !ctx.offeredTools().contains(name))
            throw fail("permission_denied", "此工具不在本轮允许的工具清单内。", "This tool is not permitted in the current turn.");
        Binding binding = find(name, ctx.userId());
        if (binding == null) throw missing();
        Map<String, Object> result = call(ctx.userId(), binding.connection(), binding.tool(), UserMcpSchema.arguments(args),
                () -> !ctx.isCancelled() && members.hasWritePermission(ctx.projectId(), ctx.userId()));
        return resultText(result);
    }
    public synchronized boolean hasOverride(String presetId) {
        Long user = currentUser();
        if (user == null) return false;
        Connection c = load(scope(user)).get(presetId);
        return c != null && c.enabled();
    }
    /** Legacy legal/enterprise tools use the same enabled user connection; no paid fallback on errors. */
    public String callPreset(String presetId, String toolName, Map<String, Object> args) {
        Long user = currentUser(); String scope = scope(user);
        Connection c;
        synchronized (this) { c = require(load(scope), presetId); }
        if (!c.enabled()) throw missing();
        List<RemoteTool> matches = c.tools().stream().filter(t -> t.name().equals(toolName) || t.name().endsWith("." + toolName)).toList();
        if (matches.size() != 1) throw fail("tool_unavailable", "自配 MCP 没有此工具，请检查服务地址与工具清单。未改用官方收费通道。", "This tool is unavailable on the configured MCP. Check its endpoint and tool list. The paid official channel was not used.");
        RemoteTool tool = matches.get(0);
        return resultText(call(user, c, tool, args, () -> true));
    }
    public String callCompany(String searchKey) {
        Long user = currentUser(); Connection c;
        synchronized (this) { c = require(load(scope(user)), "qichacha"); }
        RemoteTool tool = c.tools().stream().filter(t -> t.name().equals("get_company_registration_info")).findFirst().orElseThrow(() ->
                fail("tool_unavailable", "此自配企查查服务没有工商信息工具，未使用官方收费通道。", "This Qichacha connection has no registration tool. The paid official channel was not used."));
        // QCC's public catalog documents searchKey for the company server:
        // https://agent.qcc.com/data (verified against tools/list, 2026-10-29).
        return resultText(call(user, c, tool, Map.of("searchKey", searchKey), () -> true));
    }

    private Map<String, Object> call(Long user, Connection c, RemoteTool tool, Map<String, Object> args, BooleanSupplier allowed) {
        String scope = scope(user); String token;
        synchronized (this) { checkCurrent(user, scope, c, true); token = token(scope, c); }
        if (args == null) args = Map.of();
        if (json(args).getBytes(StandardCharsets.UTF_8).length > 128 * 1024) throw fail("invalid_arguments", "MCP 参数超过限制。", "MCP arguments exceed the limit.");
        UserMcpSchema.validate(tool.inputSchema(), args);
        BooleanSupplier current = guard(user, scope, c, true);
        Map<String, Object> result = client.call(c.url(), token, tool.name(), tool.inputSchema(), args,
                () -> allowed.getAsBoolean() && current.getAsBoolean());
        if (!allowed.getAsBoolean() || !current.getAsBoolean())
            throw fail("connection_changed", "连接已改变，已丢弃过期结果。", "The connection changed; the stale result was discarded.");
        return result;
    }
    private String resultText(Map<String, Object> result) {
        return McpResponseParser.parse(json(Map.of("result", result)));
    }
    private BooleanSupplier guard(Long user, String scope, Connection c, boolean enabled) {
        return () -> { try { synchronized (this) { checkCurrent(user, scope, c, enabled); } return true; } catch (RuntimeException e) { return false; } };
    }
    private void checkCurrent(Long user, String scope, Connection c, boolean enabled) {
        Connection live = load(scope).get(c.id());
        if (!scope.equals(scope(user)) || live == null || live.revision() != c.revision() || enabled && !live.enabled())
            throw fail("connection_changed", "连接已改变，请重试。", "The connection changed. Please retry.");
    }
    private String token(String scope, Connection c) { return c.configured() ? credentials.get(secretKey(scope, c.id())) : ""; }
    private Connection require(Map<String, Connection> rows, String id) { Connection c = rows.get(id); if (c == null) throw missing(); return c; }
    private String checkedScope(Long user, String expectedScope) {
        String captured = scope(user);
        if (!captured.equals(expectedScope)) throw new PluginMcpException("account_changed", 409,
                LangText.of("账户已切换，请刷新 MCP 配置后重试。", "The account changed. Refresh MCP settings and retry."));
        return captured;
    }
    private String scope(Long user) {
        if (user == null) throw new PluginMcpException("not_authenticated", 401, LangText.of("请先登录。", "Sign in first."));
        return digest(user + ":" + Objects.toString(account.accountFingerprintOrNull(), "local"));
    }
    private String secretKey(String scope, String id) { return "mcp." + scope + "." + id; }
    private Map<String, Connection> load(String scope) {
        try { return JSON.readValue(settings.get("mcp.user." + scope, "{}"), new TypeReference<LinkedHashMap<String, Connection>>() {}); }
        catch (Exception e) { throw fail("configuration_unavailable", "无法读取 MCP 配置。", "MCP configuration is unavailable."); }
    }
    private void persist(String scope, Map<String, Connection> rows) { settings.set("mcp.user." + scope, json(rows)); }
    private static String json(Object value) { try { return JSON.writeValueAsString(value); } catch (Exception e) { throw new IllegalArgumentException("Invalid MCP data"); } }
    private static String digest(String text) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8))).substring(0, 24); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
    public static String agentName(String id, String tool) { return "user_mcp_" + digest(id + ":" + tool) + "_" + tool.replaceAll("[^A-Za-z0-9_]", "_").substring(0, Math.min(24, tool.length())); }
    public static Long currentUser() {
        Long user = PlatformAiUserScope.current();
        return user == null ? ProjectContextHolder.getUserId() : user;
    }
    private static PluginMcpException missing() { return new PluginMcpException("not_found", 404, LangText.of("MCP 连接或工具不可用。", "MCP connection or tool is unavailable.")); }
    private static PluginMcpException fail(String code, String zh, String en) { return new PluginMcpException(code, 400, LangText.of(zh, en)); }
}
