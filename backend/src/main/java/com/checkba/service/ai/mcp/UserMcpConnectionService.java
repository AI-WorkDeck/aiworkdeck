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
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private UserMcpStdioClient stdio;
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private UserMcpOAuthService oauth;

    public record Preset(String id, String name, String url, String documentationUrl, boolean supportsOfficial, String authType) {
        Preset(String id, String name, String url, String documentationUrl, boolean official) {
            this(id, name, url, documentationUrl, official, "bearer");
        }
    }
    public List<Preset> presets() {
        return List.of(
            new Preset("qichacha", LangText.of("企查查", "Qichacha"), "https://agent.qcc.com/mcp/company/stream", "https://agent.qcc.com/guide", true),
            new Preset("pkulaw", LangText.of("北大法宝", "PKULaw"), "https://apim-gateway.pkulaw.com/mcp-law-agg/mcp", "https://mcp.pkulaw.com/docs", true),
            new Preset("yuandian", LangText.of("元典", "Yuandian"), "https://open.chineselaw.com/mcp/law/stream", "https://open.chineselaw.com/llms-full.txt", false),
            new Preset("tavily", "Tavily", "https://mcp.tavily.com/mcp/", "https://github.com/tavily-ai/tavily-mcp", false),
            new Preset("github", "GitHub", "https://api.githubcopilot.com/mcp/", "https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/set-up-the-github-mcp-server", false),
            new Preset("notion", "Notion", "https://mcp.notion.com/mcp", "https://developers.notion.com/docs/get-started-with-mcp", false, "oauth2"));
    }
    public record RemoteTool(String name, String description, Map<String, Object> inputSchema) {}
    public record Options(String authType, String command, List<String> args, String cwd, Integer timeoutSeconds,
            String oauthClientId, List<String> oauthScopes, boolean localApproved) {}
    public record Connection(String id, String presetId, String name, String url, String transport,
            boolean enabled, boolean configured, boolean tested, long revision, List<RemoteTool> tools, Options options) {}
    public record Binding(Connection connection, RemoteTool tool, ToolSpecification specification) {}
    public record Update(String name, String url, String transport, String token, String authType,
            String command, List<String> args, Map<String, String> env, String cwd, Integer timeoutSeconds,
            Map<String, String> headers, String oauthClientId, String oauthClientSecret, List<String> oauthScopes) {
        public Update(String name, String url, String transport, String token) {
            this(name, url, transport, token, null, null, null, null, null, null, null, null, null, null);
        }
        @Override public String toString() { return "Update[redacted]"; }
    }
    private record Secrets(String token, Map<String, String> env, Map<String, String> headers, String oauthClientSecret) {
        @Override public String toString() { return "Secrets[redacted]"; }
    }
    private Options options(Connection c) {
        return c.options() == null ? new Options(preset(c.id()).map(Preset::authType).orElse(c.configured() ? "bearer" : "none"),
                "", List.of(), "", 60, "", List.of(), false) : c.options();
    }

    private Optional<Preset> preset(String id) { return presets().stream().filter(p -> p.id().equals(id)).findFirst(); }
    private Connection defaults(Preset p) {
        return new Connection(p.id(), p.id(), p.name(), p.url(), "streamable-http", false, false, false, 0, List.of(), new Options(p.authType(), "", List.of(), "", 60, "", List.of(), false));
    }
    public synchronized Map<String, Object> snapshot(Long userId) {
        String scope = scope(userId);
        return Map.of("code", 0, "scopeToken", scope, "connections", listScope(scope), "presets", presets(), "stdioAvailable", stdio != null && stdio.available());
    }
    public synchronized List<Map<String, Object>> list(Long userId) { return listScope(scope(userId)); }
    private List<Map<String, Object>> listScope(String scope) {
        Map<String, Connection> rows = load(scope);
        List<Map<String, Object>> out = new ArrayList<>();
        for (Preset p : presets()) out.add(view(scope, rows.getOrDefault(p.id(), defaults(p))));
        rows.values().stream().filter(c -> c.presetId() == null).map(c -> view(scope, c)).forEach(out::add);
        return out;
    }
    private Map<String, Object> view(String scope, Connection c) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", c.id()); row.put("presetId", c.presetId()); row.put("name", c.name());
        row.put("url", c.url()); row.put("transport", c.transport()); row.put("enabled", c.enabled());
        row.put("configured", c.configured()); row.put("tested", c.tested()); row.put("revision", c.revision()); row.put("tools", c.tools());
        boolean official = preset(c.id()).map(Preset::supportsOfficial).orElse(false);
        row.put("supportsOfficial", official);
        row.put("source", c.enabled() ? "custom" : official ? "official" : "disabled");
        row.put("billingMode", c.enabled() || !official ? "provider" : "platform");
        Options o = options(c); Secrets secret = secrets(scope, c);
        row.put("authType", o.authType()); row.put("command", o.command()); row.put("args", o.args());
        row.put("cwd", o.cwd()); row.put("timeoutSeconds", o.timeoutSeconds()); row.put("localApproved", o.localApproved());
        row.put("environmentKeys", secret.env().keySet()); row.put("headerNames", secret.headers().keySet());
        row.put("oauthClientId", o.oauthClientId()); row.put("oauthScopes", o.oauthScopes());
        row.put("oauthStatus", oauth != null && c.revision() > 0 && "oauth2".equals(o.authType())
                ? oauth.status(oauthKey(scope, c), c.url(), oauthConfig(c, secret), guardView(scope, c)) : Map.of("connected", false, "pending", false, "needsReconnect", false));
        return row;
    }
    // Status is local-only; do not trigger discovery or token refresh while listing settings.
    private BooleanSupplier guardView(String scope, Connection c) {
        return () -> { synchronized (this) { Connection live = load(scope).get(c.id()); return live != null && live.revision() == c.revision(); } };
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
        Connection next = prepare(scope, id, previous, input);
        Secrets nextSecrets = prepareSecrets(scope, previous, next, input);
        credentials.put(secretKey(scope, id) + ".settings", json(nextSecrets));
        credentials.remove(secretKey(scope, id));
        rows.put(id, next); persist(scope, rows);
        if (oauth != null && previous != null) {
            if (!Objects.equals(previous.url(), next.url()) || !Objects.equals(options(previous).authType(), options(next).authType())
                    || !Objects.equals(options(previous).oauthClientId(), options(next).oauthClientId()) || input.oauthClientSecret() != null
                    || !Objects.equals(options(previous).oauthScopes(), options(next).oauthScopes())) oauth.disconnect(oauthKey(scope, previous));
            else oauth.invalidate(oauthKey(scope, previous));
        }
        return view(scope, next);
    }
    private Connection prepare(String scope, String id, Connection previous, Update in) {
        Options old = previous == null ? new Options("none", "", List.of(), "", 60, "", List.of(), false) : options(previous);
        String name = pick(in.name(), previous == null ? null : previous.name());
        String transport = pick(in.transport(), previous == null ? "streamable-http" : previous.transport());
        if (name == null || name.isBlank() || name.length() > 100 || !Set.of("streamable-http", "stdio").contains(transport))
            throw fail("invalid_configuration", "请填写有效名称和连接方式。", "Provide a valid name and transport.");
        boolean local = "stdio".equals(transport);
        String url = local ? "" : pick(in.url(), previous == null ? null : previous.url());
        if (!local) {
            if (url == null || url.length() > 8192) throw fail("invalid_endpoint", "服务地址无效或过长。", "The service URL is invalid or too long.");
            PluginMcpEndpointPolicy.validateUrl(url);
        }
        String auth = local ? "none" : pick(in.authType(), in.token() != null ? "bearer" : old.authType());
        if (!Set.of("none", "bearer", "oauth2").contains(auth)) throw fail("invalid_configuration", "不支持此授权方式。", "Unsupported authorization type.");
        Options o = new Options(auth, local ? pick(in.command(), old.command()) : "", local ? pick(in.args(), old.args()) : List.of(),
                local ? pick(in.cwd(), old.cwd()) : "", pick(in.timeoutSeconds(), old.timeoutSeconds()),
                "oauth2".equals(auth) ? pick(in.oauthClientId(), old.oauthClientId()) : "",
                "oauth2".equals(auth) ? pick(in.oauthScopes(), old.oauthScopes()) : List.of(), false);
        if (o.oauthClientId().length() > 2048 || o.oauthScopes().size() > 32 || o.oauthScopes().stream().anyMatch(v -> v == null || !v.matches("[\\x21\\x23-\\x5b\\x5d-\\x7e]{1,256}")))
            throw fail("invalid_configuration", "OAuth 客户端或权限范围无效。", "Invalid OAuth client or scopes.");
        Connection draft = new Connection(id, preset(id).map(Preset::id).orElse(null), name.trim(), url, transport,
                previous != null && previous.enabled(), false, false, REVISIONS.incrementAndGet(), List.of(), o);
        Secrets secret = prepareSecrets(scope, previous, draft, in);
        if (local) UserMcpStdioClient.validate(stdioConfig(draft, secret));
        if ("oauth2".equals(auth)) oauthConfig(draft, secret);
        boolean same = previous != null && previous.url().equals(url) && previous.transport().equals(transport)
                && old.authType().equals(auth) && old.command().equals(o.command()) && old.args().equals(o.args()) && old.cwd().equals(o.cwd())
                && Objects.equals(old.timeoutSeconds(), o.timeoutSeconds()) && old.oauthClientId().equals(o.oauthClientId())
                && old.oauthScopes().equals(o.oauthScopes()) && secrets(scope, previous).equals(secret);
        Options approved = new Options(o.authType(), o.command(), o.args(), o.cwd(), o.timeoutSeconds(), o.oauthClientId(), o.oauthScopes(), same && old.localApproved());
        return new Connection(id, draft.presetId(), draft.name(), url, transport, draft.enabled(),
                !secret.token().isEmpty() || !secret.env().isEmpty() || !secret.headers().isEmpty() || !secret.oauthClientSecret().isEmpty(),
                same && previous.tested(), draft.revision(), same ? previous.tools() : List.of(), approved);
    }
    private Secrets prepareSecrets(String scope, Connection previous, Connection next, Update in) {
        boolean sameEndpoint = previous != null && previous.url().equals(next.url()) && previous.transport().equals(next.transport());
        Secrets old = sameEndpoint ? secrets(scope, previous) : new Secrets("", Map.of(), Map.of(), "");
        String token = "bearer".equals(options(next).authType()) ? pick(in.token(), old.token()) : "";
        String clientSecret = "oauth2".equals(options(next).authType()) ? pick(in.oauthClientSecret(), previous != null
                && options(previous).oauthClientId().equals(options(next).oauthClientId()) ? old.oauthClientSecret() : "") : "";
        for (String value : List.of(token, clientSecret)) if (value.length() > 8192 || value.codePoints().anyMatch(c -> c < 32 || c == 127))
            throw fail("invalid_credential", "凭据格式无效。", "Invalid credential format.");
        if (in.token() != null && in.token().isBlank()) throw fail("invalid_credential", "请输入有效的 Bearer 密钥。", "Provide a valid Bearer token.");
        Map<String, String> env = "stdio".equals(next.transport()) ? merge(old.env(), in.env(), false) : Map.of();
        Map<String, String> headers = "stdio".equals(next.transport()) ? Map.of() : merge(old.headers(), in.headers(), true);
        PluginMcpHttpClient.validateHeaders(headers);
        if (!"none".equals(options(next).authType()) && headers.containsKey("authorization"))
            throw fail("invalid_configuration", "Authorization 请求头与所选授权方式重复。", "The Authorization header conflicts with the selected authorization type.");
        return new Secrets(token, env, headers, clientSecret);
    }
    private static <T> T pick(T value, T fallback) { return value == null ? fallback : value; }
    private Map<String, String> merge(Map<String, String> old, Map<String, String> patch, boolean headers) {
        Map<String, String> result = new LinkedHashMap<>(old);
        if (patch != null) {
            Set<String> seen = new HashSet<>();
            patch.forEach((key, value) -> {
                if (key == null) throw fail("invalid_configuration", "配置键名无效。", "Invalid configuration key.");
                String normalized = headers ? key.toLowerCase(Locale.ROOT) : key;
                if (!seen.add(normalized)) throw fail("invalid_configuration", "配置键名重复。", "Duplicate configuration key.");
                if (value == null) result.remove(normalized); else result.put(normalized, value);
            });
        }
        return Collections.unmodifiableMap(result);
    }
    @org.springframework.transaction.annotation.Transactional
    public synchronized void delete(Long userId, String id) { delete(userId, id, scope(userId)); }
    @org.springframework.transaction.annotation.Transactional
    public synchronized void delete(Long userId, String id, String expectedScope) {
        String scope = checkedScope(userId, expectedScope);
        Map<String, Connection> rows = load(scope);
        rows.remove(id); persist(scope, rows); credentials.remove(secretKey(scope, id)); credentials.remove(secretKey(scope, id) + ".settings");
        if (oauth != null) oauth.disconnect(secretKey(scope, id) + ".oauth");
    }
    public synchronized Map<String, Object> enable(Long userId, String id, boolean enabled) { return enable(userId, id, enabled, scope(userId)); }
    public synchronized Map<String, Object> enable(Long userId, String id, boolean enabled, String expectedScope) {
        String scope = checkedScope(userId, expectedScope);
        Map<String, Connection> rows = load(scope);
        Connection c = require(rows, id);
        if (enabled && !c.tested()) throw fail("test_required", "请先测试连接并读取工具清单。", "Test the connection and load its tools first.");
        if (enabled && "stdio".equals(c.transport())) requireLocal(c);
        Connection next = new Connection(c.id(), c.presetId(), c.name(), c.url(), c.transport(), enabled, c.configured(), c.tested(), REVISIONS.incrementAndGet(), c.tools(), options(c));
        rows.put(id, next); persist(scope, rows);
        if (!enabled && oauth != null) oauth.invalidate(oauthKey(scope, c));
        return view(scope, next);
    }
    public Map<String, Object> test(Long userId, String id) { return test(userId, id, scope(userId)); }
    public Map<String, Object> test(Long userId, String id, String expectedScope) { return test(userId, id, expectedScope, false, null); }
    public Map<String, Object> test(Long userId, String id, String expectedScope, boolean allowLocalExecution, Long expectedRevision) {
        String scope = checkedScope(userId, expectedScope);
        Connection captured; Secrets secret;
        synchronized (this) {
            captured = require(load(scope), id);
            if ("stdio".equals(captured.transport()) && allowLocalExecution) {
                if (stdio == null || !stdio.available()) throw fail("stdio_unavailable", "本地服务仅可在桌面端运行。", "Local services can run only in the desktop app.");
                if (expectedRevision == null || expectedRevision != captured.revision()) throw fail("connection_changed", "配置已改变，请重新检查并确认本地命令。", "The configuration changed. Review and confirm the local command again.");
            }
            if ("stdio".equals(captured.transport()) && allowLocalExecution && !options(captured).localApproved()) {
                Options o = options(captured);
                captured = new Connection(captured.id(), captured.presetId(), captured.name(), captured.url(), captured.transport(), captured.enabled(), captured.configured(), false,
                        REVISIONS.incrementAndGet(), List.of(), new Options(o.authType(), o.command(), o.args(), o.cwd(), o.timeoutSeconds(), o.oauthClientId(), o.oauthScopes(), true));
                Map<String, Connection> rows = load(scope); rows.put(id, captured); persist(scope, rows);
            }
            secret = secrets(scope, captured);
        }
        BooleanSupplier current = guard(userId, scope, captured, false);
        List<Map<String, Object>> discovered;
        if ("stdio".equals(captured.transport())) {
            requireLocal(captured); discovered = stdio.listTools(stdioConfig(captured, secret), current);
        } else {
            String token = accessToken(scope, captured, secret, current);
            try { discovered = secret.headers().isEmpty() ? client.listTools(captured.url(), token, current)
                    : client.listTools(captured.url(), token, secret.headers(), current); }
            catch (PluginMcpException e) { authenticationFailure(scope, captured, current, e); throw e; }
        }
        List<RemoteTool> tools = validateTools(discovered);
        synchronized (this) {
            checkCurrent(userId, scope, captured, false);
            Map<String, Connection> rows = load(scope);
            Connection next = new Connection(captured.id(), captured.presetId(), captured.name(), captured.url(), captured.transport(),
                    captured.enabled(), captured.configured(), true, REVISIONS.incrementAndGet(), tools, options(captured));
            rows.put(id, next); persist(scope, rows); return view(scope, next);
        }
    }
    public Map<String, Object> authorize(Long userId, String id, String expectedScope) {
        String scope = checkedScope(userId, expectedScope); Connection c; Secrets secret;
        synchronized (this) { c = require(load(scope), id); secret = secrets(scope, c); }
        if (oauth == null || !"oauth2".equals(options(c).authType())) throw fail("invalid_configuration", "请先保存 OAuth 连接配置。", "Save an OAuth connection first.");
        return oauth.authorize(oauthKey(scope, c), c.url(), oauthConfig(c, secret), guard(userId, scope, c, false));
    }
    public synchronized void disconnectOAuth(Long userId, String id, String expectedScope) {
        String scope = checkedScope(userId, expectedScope); Map<String, Connection> rows = load(scope); Connection c = require(rows, id);
        if (oauth != null) oauth.disconnect(oauthKey(scope, c));
        rows.put(id, new Connection(c.id(), c.presetId(), c.name(), c.url(), c.transport(), c.enabled(), c.configured(), false, REVISIONS.incrementAndGet(), List.of(), options(c)));
        persist(scope, rows);
    }
    private void requireLocal(Connection c) {
        if (stdio == null || !stdio.available()) throw fail("stdio_unavailable", "本地服务仅可在桌面端运行。", "Local services can run only in the desktop app.");
        if (!options(c).localApproved()) throw fail("local_approval_required", "请先确认并测试此本地命令。", "Confirm and test this local command first.");
    }
    private UserMcpStdioClient.Config stdioConfig(Connection c, Secrets s) {
        Options o = options(c); return new UserMcpStdioClient.Config(o.command(), o.args(), s.env(), o.cwd(), o.timeoutSeconds());
    }
    private UserMcpOAuthService.Config oauthConfig(Connection c, Secrets s) {
        return new UserMcpOAuthService.Config(options(c).oauthClientId(), s.oauthClientSecret(), options(c).oauthScopes());
    }
    private String oauthKey(String scope, Connection c) { return secretKey(scope, c.id()) + ".oauth"; }
    private String accessToken(String scope, Connection c, Secrets s, BooleanSupplier current) {
        if (!"oauth2".equals(options(c).authType())) return s.token();
        if (oauth == null) throw fail("authentication_required", "请重新授权此服务。", "Authorize this service again.");
        return oauth.accessToken(oauthKey(scope, c), c.url(), oauthConfig(c, s), current);
    }
    private void authenticationFailure(String scope, Connection c, BooleanSupplier current, PluginMcpException e) {
        if (oauth != null && current.getAsBoolean() && "oauth2".equals(options(c).authType()) && "authentication_required".equals(e.code())) oauth.needsReconnect(oauthKey(scope, c));
    }
    public synchronized Map<String, Object> previewImport(Long userId, String text, String expectedScope) {
        String scope = checkedScope(userId, expectedScope);
        UserMcpConfigImport.Parsed parsed = UserMcpConfigImport.parse(text);
        List<Map<String, Object>> entries = new ArrayList<>(), errors = new ArrayList<>(parsed.errors());
        for (var entry : parsed.entries()) {
            try { prepare(scope, "preview", null, entry.update()); entries.add(entry.preview()); }
            catch (PluginMcpException e) { errors.add(Map.of("index", entry.index(), "name", entry.name(), "message", e.getMessage())); }
        }
        return Map.of("code", 0, "entries", entries, "errors", errors);
    }
    @org.springframework.transaction.annotation.Transactional
    public synchronized Map<String, Object> importConnections(Long userId, String text, List<Integer> selected, String expectedScope) {
        String scope = checkedScope(userId, expectedScope);
        UserMcpConfigImport.Parsed parsed = UserMcpConfigImport.parse(text);
        if (selected == null || selected.isEmpty() || selected.size() > 32 || new HashSet<>(selected).size() != selected.size())
            throw fail("invalid_import", "请选择有效的配置项。", "Select valid configuration entries.");
        Map<Integer, UserMcpConfigImport.Entry> entries = new HashMap<>(); parsed.entries().forEach(e -> entries.put(e.index(), e));
        Map<String, Connection> rows = load(scope);
        if (rows.size() + selected.size() > 32) throw fail("limit_exceeded", "最多配置 32 个 MCP 连接。", "At most 32 MCP connections are supported.");
        Map<Connection, Secrets> prepared = new LinkedHashMap<>();
        for (Integer index : selected) {
            var entry = entries.get(index);
            if (entry == null) throw fail("invalid_import", "所选配置项无效，请重新预览。", "A selected entry is invalid. Preview the import again.");
            Connection c = prepare(scope, "custom-" + UUID.randomUUID(), null, entry.update());
            prepared.put(c, prepareSecrets(scope, null, c, entry.update()));
        }
        // Validate every selected entry before writing any; the transaction also covers encrypted secrets.
        prepared.forEach((c, secret) -> { credentials.put(secretKey(scope, c.id()) + ".settings", json(secret)); rows.put(c.id(), c); });
        persist(scope, rows);
        return Map.of("code", 0, "connections", prepared.keySet().stream().map(c -> view(scope, c)).toList());
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
        String scope = scope(user); Secrets secret;
        synchronized (this) { checkCurrent(user, scope, c, true); secret = secrets(scope, c); }
        if (args == null) args = Map.of();
        if (json(args).getBytes(StandardCharsets.UTF_8).length > 128 * 1024) throw fail("invalid_arguments", "MCP 参数超过限制。", "MCP arguments exceed the limit.");
        UserMcpSchema.validate(tool.inputSchema(), args);
        BooleanSupplier current = guard(user, scope, c, true);
        BooleanSupplier permitted = () -> allowed.getAsBoolean() && current.getAsBoolean();
        Map<String, Object> result;
        if ("stdio".equals(c.transport())) {
            requireLocal(c); result = stdio.call(stdioConfig(c, secret), tool.name(), tool.inputSchema(), args, permitted);
        } else {
            String token = accessToken(scope, c, secret, permitted);
            try { result = secret.headers().isEmpty() ? client.call(c.url(), token, tool.name(), tool.inputSchema(), args, permitted)
                    : client.call(c.url(), token, secret.headers(), tool.name(), tool.inputSchema(), args, permitted); }
            catch (PluginMcpException e) { authenticationFailure(scope, c, permitted, e); throw e; }
        }
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
    private Secrets secrets(String scope, Connection c) {
        String stored = credentials.get(secretKey(scope, c.id()) + ".settings");
        if (stored != null && !stored.isBlank()) {
            try { return JSON.readValue(stored, Secrets.class); }
            catch (Exception e) { throw fail("configuration_unavailable", "无法读取加密配置。", "Encrypted configuration is unavailable."); }
        }
        return new Secrets(c.configured() ? Objects.toString(credentials.get(secretKey(scope, c.id())), "") : "", Map.of(), Map.of(), "");
    }
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
