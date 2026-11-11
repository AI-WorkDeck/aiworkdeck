// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.legal;

import com.checkba.service.ai.mcp.McpClientService;
import com.checkba.service.ai.mcp.McpResponseParser;
import com.checkba.service.platform.ExternalProviderResolver;
import com.checkba.service.platform.ExternalServiceProvider;
import com.checkba.service.platform.GatewayException;
import com.checkba.service.platform.PlatformGatewayClient;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.Map;

/**
 * 北大法宝检索的<b>双档分发唯一出口</b>（平台代采走网关 / 自备 Key 直连 MCP）。
 *
 * <h3>为什么必须收成一处</h3>
 * 法宝 token 是订阅主体的，<b>我们不会把它下发到每台用户机器</b>——打包态的桌面端
 * {@code PKULAW_TOKEN} 恒为空。谁绕过这里直接打 {@link McpClientService}，
 * 谁就在用户机器上发一个 {@code Authorization: Bearer }（空 token）出去，
 * 换回一句 {@code 401 900902 Missing Credentials}。
 * AI 对话那条（{@code LegalTools}）本来就走网关，依据窗格漏了——dev-board#395 的病灶。
 *
 * <p>平台档下官网持 token 打同一个 MCP 端点，把 JSON-RPC 响应正文原样带回来。
 * <b>解析仍用 {@link McpResponseParser}</b>：两档共用一个解析器，法宝改格式只会改一处。
 *
 * <p>网关失败以 {@link GatewayException} 原样抛出，<b>不在这里压成一句文案</b>——
 * 调用方（对话工具 / 依据窗格）对同一种失败要摆的话术不同，
 * kind 一旦丢掉就再也分不出「余额不足」和「服务未开放」。
 */
@Service
@RequiredArgsConstructor
public class PkulawChannel {

    /** 法宝那几个 MCP server 都配了 60 秒超时，网关这条要留出同样的余量。 */
    public static final int TIMEOUT_SECONDS = 60;

    /** 网关只代采法宝自家的 server；名字对不上的（自建 / 别家案例 MCP）用的是别人的凭证，照旧直连。 */
    private static final String PKULAW_SERVER_PREFIX = "pkulaw";

    private final McpClientService mcpClientService;
    private final ExternalProviderResolver externalProviderResolver;
    private final PlatformGatewayClient platformGatewayClient;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private com.checkba.service.ai.mcp.UserMcpConnectionService userMcp;

    /**
     * 打一次法宝工具。
     *
     * @param server mcp.servers 里的 server 名；只有法宝自家的 server 才会走网关
     * @return 与 {@link McpClientService#callTool} 同一约定：失败返回 "Error" 前缀的文本
     * @throws GatewayException 平台档下网关的分类失败（余额不足 / 未开放 / 不可达），带 kind
     */
    public String callTool(String server, String tool, Map<String, Object> args) {
        return call(server, tool, args, false);
    }

    /**
     * 依据窗格用：平台档回包带 structuredContent 时，按改名前的字段形状返回 JSON（{@link PkulawCompat#legacyFromRaw}），
     * 窗格的解析与空结果判定不用跟着法宝改；没有结构化数据（或不走网关）时与 {@link #callTool} 相同。
     */
    public String callToolForData(String server, String tool, Map<String, Object> args) {
        return call(server, tool, args, true);
    }

    private String call(String server, String tool, Map<String, Object> args, boolean legacyData) {
        boolean pkulaw = server != null && server.startsWith(PKULAW_SERVER_PREFIX);
        // 不走网关的两档：法宝 2026-11 把分服务端点上的工具全部改了名，但用户自连的端点（10-29 tools/list 快照）
        // 仍是旧名。先按原名打，上游说没有这个工具时再按现名重试一次（与官网网关同一张改名表）。
        if (pkulaw && userMcp != null && userMcp.hasOverride("pkulaw")) {
            try {
                return userMcp.callPreset("pkulaw", tool, args);
            } catch (com.checkba.service.ai.mcp.PluginMcpException e) {
                PkulawCompat.Call c = PkulawCompat.translate(tool, args);
                if (!"tool_unavailable".equals(e.code()) || c.tool().equals(tool)) throw e;
                return userMcp.callPreset("pkulaw", c.tool(), c.args());
            }
        }
        if (!viaPlatform(server)) {
            String out = mcpClientService.callTool(server, tool, args);
            if (!pkulaw || out == null || !out.startsWith("Error") || !out.contains("Unknown tool")) return out;
            PkulawCompat.Call c = PkulawCompat.translate(tool, args);
            return c.tool().equals(tool) ? out : mcpClientService.callTool(server, c.tool(), c.args());
        }
        // 网关的 op 是改名前的工具名，官网 adapters/pkulaw.ts 换成现名；MCP 端点写死在服务端，客户端点不了别处
        PlatformGatewayClient.Result result =
                platformGatewayClient.call("pkulaw", tool, Map.of("args", args), TIMEOUT_SECONDS);
        String raw = result.data().path("raw").asText("");
        if (legacyData) {
            String legacy = PkulawCompat.legacyFromRaw(tool, raw);
            if (legacy != null) return legacy;
        }
        String parsed = McpResponseParser.parse(raw);
        // 上游裸文本 "Unknown tool: x"（无 Error 前缀）补齐前缀，两档对失败的判据一致
        if (parsed != null && parsed.stripLeading().startsWith("Unknown tool")) {
            return "Error from MCP server: " + parsed;
        }
        return parsed;
    }

    /** 这个 server 这次走不走平台网关。 */
    public boolean viaPlatform(String server) {
        return !(userMcp != null && userMcp.hasOverride("pkulaw"))
                && server != null && server.startsWith(PKULAW_SERVER_PREFIX)
                && externalProviderResolver.resolve(ExternalServiceProvider.PKULAW)
                        == ExternalServiceProvider.PLATFORM;
    }
}
