// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/**
 * 插件工具的授权基线：Agent 能用的每个插件工具，用户批准过的「安全定义」是什么，现在的定义是否越过了它。
 *
 * <p>安全定义只含决定 Agent 能做什么的字段：access（含 handler 绑定的宿主服务操作本身的档位）、
 * confirm、是否投影到对外 MCP（按生效值算）、handler、inputSchema；插件 contributes.mcpServers
 * 里的远程 MCP 工具另按「服务器地址/凭证引用 + inputSchema」记。说明、关键词、名称等文案不算。
 *
 * <p>升级（需要用户重新批准，批准前该工具对 Agent、插件面板直调、对外 MCP 一律不可用）：
 * <ul>
 *   <li>access 升档：read → write/destructive、write → destructive（未声明 access 的老条目按 write 档）；</li>
 *   <li>confirm 放松：always → auto/never、auto → never；</li>
 *   <li>对外 MCP 投影从关到开（非 read 工具降成 read 时随 read 缺省打开投影的除外）；远程 MCP 工具换了服务器地址或凭证引用；</li>
 *   <li>非 read 工具的 handler 或 inputSchema 变了（远程 MCP 工具没有档位，按非 read 算）；</li>
 *   <li>新出现的非 read 工具、新出现的远程 MCP 工具（改名 = 旧名消失 + 新名出现，同样要批）。</li>
 * </ul>
 * 降档、只改文案、read 工具改 handler/schema、新增 read 工具都不打扰用户，基线直接跟到新定义；
 * 消失的工具从基线里删掉，之后再出现按新工具算。
 */
public final class PluginToolApprovals {
    private PluginToolApprovals() {}

    /** system_setting 键前缀；刻意不在 {@code plugin.<id>.} 命名空间下——那里插件自己能写。 */
    public static final String KEY_PREFIX = "ai.plugins.tool-approvals.";

    public static final String KIND_TOOL = "tool";
    public static final String KIND_REMOTE_MCP = "mcp";

    /** 一个工具的安全定义。schema 存摘要，handler 存规范化串。 */
    public record Definition(String kind, String access, String confirm, boolean mcp, String handler, String schema) {}

    /**
     * 一处待批准的升级。{@code name} 是 Agent 调用时用的名字（远程 MCP 工具是宿主生成的 mcp_ 名），
     * {@code label} 是给人看的名字；{@code reasons} 取值 new/access/confirm/mcp/handler/schema。
     */
    public record Change(String key, String name, String label, List<String> reasons, Definition before, Definition after) {}

    /** 某插件当前的安全定义（键 → 定义）与对应的清单对象（键 → PluginToolInfo/McpToolDecl，按引用比对用）。 */
    public record Snapshot(Map<String, Definition> definitions, Map<String, Object> objects, Map<String, String[]> names) {}

    public static Snapshot snapshot(PluginService.PluginMetadata meta) {
        Map<String, Definition> defs = new LinkedHashMap<>();
        Map<String, Object> objects = new LinkedHashMap<>();
        Map<String, String[]> names = new LinkedHashMap<>();
        if (meta.getTools() != null) {
            for (PluginService.PluginToolInfo tool : meta.getTools()) {
                if (tool == null || tool.getName() == null) continue;
                String key = KIND_TOOL + ":" + tool.getName();
                if (defs.containsKey(key)) continue;
                defs.put(key, describe(tool));
                objects.put(key, tool);
                names.put(key, new String[]{tool.getName(), tool.getName()});
            }
        }
        var servers = meta.getContributes() == null ? null : meta.getContributes().getMcpServers();
        if (servers != null) {
            for (PluginService.McpServerDecl server : servers) {
                if (server == null || server.getId() == null || server.getTools() == null) continue;
                for (PluginService.McpToolDecl tool : server.getTools()) {
                    if (tool == null || tool.getName() == null) continue;
                    String key = KIND_REMOTE_MCP + ":" + server.getId() + "/" + tool.getName();
                    if (defs.containsKey(key)) continue;
                    defs.put(key, new Definition(KIND_REMOTE_MCP, null, null, true,
                            server.getUrl() + "|" + server.getConnectionId() + "|" + server.getCredentialKey(),
                            digest(canonical(tool.getInputSchema()))));
                    objects.put(key, tool);
                    names.put(key, new String[]{
                            com.checkba.service.ai.mcp.PluginMcpService.agentName(meta.getId(), server.getId(), tool.getName()),
                            server.getId() + "/" + tool.getName()});
                }
            }
        }
        return new Snapshot(defs, objects, names);
    }

    static Definition describe(PluginService.PluginToolInfo tool) {
        String access = effectiveAccess(tool);
        String confirm = tool.getConfirm() == null ? "auto" : tool.getConfirm();
        boolean needsConfirm = "destructive".equals(access) || "always".equals(confirm);
        boolean agent = !Boolean.FALSE.equals(tool.getAgent());
        // 与 ToolRegistry.mcpCandidates 同口径：只有 handler=service 的声明式工具会被投影
        boolean mcp = "service".equals(tool.handlerType()) && agent && !needsConfirm
                && ("read".equals(access) ? !Boolean.FALSE.equals(tool.getMcp())
                    : "write".equals(access) && Boolean.TRUE.equals(tool.getMcp()));
        var h = tool.getHandler();
        String handler = h == null ? "jar"
                : tool.handlerType() + "|" + h.getService() + "|" + h.getOperation() + "|" + h.getConnectionId() + "|" + h.getViewId();
        return new Definition(KIND_TOOL, access, confirm, mcp, handler, digest(canonical(tool.getInputSchema())));
    }

    /** 声明的 access 与 handler 绑定的宿主服务操作档位取高者；未声明按 write 档（"unknown"）。 */
    private static String effectiveAccess(PluginService.PluginToolInfo tool) {
        String declared = tool.getAccess() == null ? "unknown" : tool.getAccess();
        var h = tool.getHandler();
        if (h != null && "service".equals(tool.handlerType())) {
            String op = com.checkba.service.plugin.HostServiceRegistry.spec(h.getService(), h.getOperation())
                    .map(com.checkba.service.plugin.HostServiceRegistry.Spec::access).orElse(null);
            if (op != null && rank(op) > rank(declared)) return op;
        }
        return declared;
    }

    static int rank(String access) {
        if ("read".equals(access)) return 0;
        if ("destructive".equals(access)) return 2;
        return 1; // write 与未声明/未知
    }

    private static int confirmRank(String confirm) {
        if ("always".equals(confirm)) return 2;
        if ("never".equals(confirm)) return 0;
        return 1;
    }

    /** before → after 是否升级；返回原因列表，空 = 不需要用户批准。before 为 null 表示新出现的工具。 */
    public static List<String> escalation(Definition before, Definition after) {
        List<String> reasons = new ArrayList<>();
        boolean remote = KIND_REMOTE_MCP.equals(after.kind());
        boolean nonRead = remote || rank(after.access()) > 0;
        if (before == null || !Objects.equals(before.kind(), after.kind())) {
            if (nonRead) reasons.add("new");
            return reasons;
        }
        if (remote) {
            if (!Objects.equals(before.handler(), after.handler())) reasons.add("mcp");
            if (!Objects.equals(before.schema(), after.schema())) reasons.add("schema");
            return reasons;
        }
        if (rank(after.access()) > rank(before.access())) reasons.add("access");
        if (confirmRank(after.confirm()) < confirmRank(before.confirm())) reasons.add("confirm");
        // 投影从关到开要批；例外：从非 read 降成 read 时 read 缺省投影，与新增 read 工具同口径不打扰
        if (after.mcp() && !before.mcp() && (nonRead || rank(before.access()) == 0)) reasons.add("mcp");
        if (nonRead && !Objects.equals(before.handler(), after.handler())) reasons.add("handler");
        if (nonRead && !Objects.equals(before.schema(), after.schema())) reasons.add("schema");
        return reasons;
    }

    /** 整个插件当前安全定义的摘要：批准请求必须带上它，插件在用户看提示期间又变了就拒绝。 */
    public static String token(Map<String, Definition> definitions) {
        StringBuilder sb = new StringBuilder();
        new TreeMap<>(definitions).forEach((k, d) -> sb.append(k).append('=').append(d).append('\n'));
        return digest(sb.toString());
    }

    static String toJson(Map<String, Definition> definitions) {
        cn.hutool.json.JSONObject tools = new cn.hutool.json.JSONObject(new LinkedHashMap<>());
        definitions.forEach((k, d) -> {
            cn.hutool.json.JSONObject o = new cn.hutool.json.JSONObject(new LinkedHashMap<>());
            o.set("kind", d.kind()).set("access", d.access()).set("confirm", d.confirm()).set("mcp", d.mcp())
                    .set("handler", d.handler()).set("schema", d.schema());
            tools.set(k, o);
        });
        return new cn.hutool.json.JSONObject(new LinkedHashMap<>()).set("v", 1).set("tools", tools).toString();
    }

    /** 解析存储的基线；格式不对抛异常（调用方按「没有基线」处理，即全部非 read 工具待批准）。 */
    static Map<String, Definition> fromJson(String json) {
        var tools = cn.hutool.json.JSONUtil.parseObj(json).getJSONObject("tools");
        Map<String, Definition> out = new LinkedHashMap<>();
        if (tools == null) throw new IllegalArgumentException("missing tools");
        for (String key : tools.keySet()) {
            var o = tools.getJSONObject(key);
            out.put(key, new Definition(o.getStr("kind"), o.getStr("access"), o.getStr("confirm"),
                    Boolean.TRUE.equals(o.getBool("mcp")), o.getStr("handler"), o.getStr("schema")));
        }
        return out;
    }

    /** 键有序、值带类型的规范化串：同一份 schema 无论字段顺序都得到同一摘要。 */
    static String canonical(Object value) {
        StringBuilder sb = new StringBuilder();
        canonical(value, sb);
        return sb.toString();
    }

    private static void canonical(Object value, StringBuilder sb) {
        if (value == null || value instanceof cn.hutool.json.JSONNull) {
            sb.append("null");
        } else if (value instanceof Map<?, ?> map) {
            TreeMap<String, Object> sorted = new TreeMap<>();
            map.forEach((k, v) -> sorted.put(String.valueOf(k), v));
            sb.append('{');
            sorted.forEach((k, v) -> { sb.append(cn.hutool.json.JSONUtil.quote(k)).append(':'); canonical(v, sb); sb.append(','); });
            sb.append('}');
        } else if (value instanceof Collection<?> list) {
            sb.append('[');
            for (Object v : list) { canonical(v, sb); sb.append(','); }
            sb.append(']');
        } else if (value instanceof CharSequence s) {
            sb.append(cn.hutool.json.JSONUtil.quote(s.toString()));
        } else {
            sb.append(value);
        }
    }

    private static String digest(String text) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }
}
