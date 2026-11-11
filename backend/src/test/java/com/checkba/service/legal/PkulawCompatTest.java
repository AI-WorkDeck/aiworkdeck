// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.legal;

import com.checkba.service.ai.mcp.McpClientService;
import com.checkba.service.platform.ExternalProviderResolver;
import com.checkba.service.platform.ExternalServiceProvider;
import com.checkba.service.platform.PlatformGatewayClient;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * 夹具是 2026-11-11 经官网网关实测的法宝原始回包（src/test/resources/pkulaw/2026-11，长列表已截短）。
 * 断言的是依据窗格与前端 insightDetail 认的旧字段，二者都靠这层换算才能继续吃法宝的新回包。
 */
class PkulawCompatTest {

    private static final ObjectMapper OM = new ObjectMapper();

    private static String raw(String name) throws Exception {
        try (var in = PkulawCompatTest.class.getResourceAsStream("/pkulaw/2026-11/" + name + ".raw")) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    private static JsonNode legacy(String op, String fixture) throws Exception {
        String out = PkulawCompat.legacyFromRaw(op, raw(fixture));
        assertNotNull(out, op);
        return OM.readTree(out);
    }

    @Test
    @DisplayName("get_article：旧形状带 article/content/文号/施行日期/链接；条号前缀不重复")
    void getArticle() throws Exception {
        JsonNode n = legacy("get_article", "get_article");
        assertEquals("中华人民共和国民法典", n.path("title").asText());
        assertEquals("第一千零八十二条", n.path("article").asText());
        assertTrue(n.path("content").asText().startsWith("女方在怀孕期间"), n.toString());
        assertEquals("中华人民共和国主席令第45号", n.path("DocumentNO").asText());
        assertEquals("2021-01-01", n.path("ImplementDate").asText());
        assertEquals("现行有效", n.path("timeliness").asText());
        assertTrue(n.path("url").asText().endsWith("#tiao_1082"));
    }

    @Test
    @DisplayName("get_article 查无此条：上游当成功回，换算成 article/content/text 全空（窗格判 NOT_FOUND）")
    void getArticleNotFound() throws Exception {
        JsonNode n = legacy("get_article", "get_article_notfound");
        assertTrue(n.has("article"));
        assertEquals("", n.path("article").asText() + n.path("content").asText() + n.path("text").asText());
    }

    @Test
    @DisplayName("search_article：10 条分开的 content 不再被拼成坏 JSON，旧形状 {articles:[…]} 每条都在")
    void searchArticle() throws Exception {
        JsonNode n = legacy("search_article", "search_article");
        assertEquals(2, n.path("articles").size());
        JsonNode first = n.path("articles").get(0);
        assertEquals("中华人民共和国民法典", first.path("title").asText());
        assertEquals("中华人民共和国主席令第45号", first.path("DocumentNO").asText());
        assertTrue(first.path("url").asText().startsWith("https://www.pkulaw.com/"), first.toString());
    }

    @Test
    @DisplayName("get_law_list：items → 旧 Data 数组")
    void getLawList() throws Exception {
        JsonNode n = legacy("get_law_list", "get_law_list");
        assertTrue(n.path("Data").isArray() && n.path("Data").size() > 0);
        assertEquals("中华人民共和国民法典", n.path("Data").get(0).path("title").asText());
    }

    @Test
    @DisplayName("search_case：权威 + 普通两组合成一个数组，本院认为/裁判结果落到 reason/result")
    void searchCase() throws Exception {
        JsonNode n = legacy("search_case", "search_case");
        assertTrue(n.isArray());
        assertEquals(4, n.size());
        JsonNode ordinary = n.get(2);
        assertFalse(ordinary.path("case_number").asText().isEmpty(), ordinary.toString());
        assertFalse(ordinary.path("courthouse_name").asText().isEmpty());
        assertTrue(ordinary.path("reason").asText().startsWith("本院认为"), ordinary.toString());
    }

    @Test
    @DisplayName("anhao_recognition：单个对象 → 旧数组形状，带 caseFlag/court/title/url")
    void anhao() throws Exception {
        JsonNode n = legacy("anhao_recognition", "anhao_recognition");
        assertTrue(n.isArray());
        assertEquals("(2021)京01民终1234号", n.get(0).path("caseFlag").asText());
        assertEquals("北京市第一中级人民法院", n.get(0).path("court").asText());
        assertFalse(n.get(0).path("title").asText().isEmpty());
    }

    @Test
    @DisplayName("adjust_provisions：articles → 旧数组 title/article_number/original_text/url/implement_date")
    void citation() throws Exception {
        JsonNode n = legacy("adjust_provisions", "adjust_provisions");
        assertTrue(n.isArray() && n.size() > 0);
        JsonNode a = n.get(0);
        assertEquals("1082", a.path("article_number").asText());
        assertTrue(a.path("original_text").asText().contains("男方不得提出离婚"));
        assertEquals("2021-01-01", a.path("implement_date").asText());
        assertTrue(a.path("url").asText().endsWith("#tiao_1082"));
    }

    @Test
    @DisplayName("SSE 帧（law_recognition 实际就是 event:/data: 形态）也能取到 structuredContent")
    void lawRecognitionSse() throws Exception {
        JsonNode n = legacy("law_recognition", "law_recognition");
        assertEquals("中华人民共和国民法典", n.get(0).path("title").asText());
    }

    @Test
    @DisplayName("isError / 没有 structuredContent / 不认得的 op → null，调用方退回可读文本")
    void fallsBackToText() {
        assertNull(PkulawCompat.legacyFromRaw("get_article",
                "{\"jsonrpc\":\"2.0\",\"result\":{\"isError\":true,\"structuredContent\":{\"law_title\":\"x\"},\"content\":[]}}"));
        assertNull(PkulawCompat.legacyFromRaw("get_article", "{\"jsonrpc\":\"2.0\",\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"hi\"}]}}"));
        assertNull(PkulawCompat.legacyFromRaw("get_linked_content", "{\"result\":{\"structuredContent\":{}}}"));
        assertNull(PkulawCompat.legacyFromRaw("get_article", "not json"));
    }

    @Test
    @DisplayName("translate：与官网网关同一张改名表（自备 Key / 自建连接两档用）")
    void translate() {
        assertEquals(new PkulawCompat.Call("get_law_article", Map.of("law_title", "民法典", "article_number", "1082")),
                PkulawCompat.translate("get_article", Map.of("title", "民法典", "number", "1082")));
        assertEquals(new PkulawCompat.Call("search_law_articles", Map.of("query_text", "离婚")),
                PkulawCompat.translate("search_article", Map.of("text", "离婚")));
        assertEquals("search_laws_by_keyword", PkulawCompat.translate("get_law_list", Map.of("title", "公司法")).tool());
        assertEquals(new PkulawCompat.Call("search_law_articles_by_keyword", Map.of("fulltext", "出资")),
                PkulawCompat.translate("get_law_list", Map.of("fulltext", "出资")));
        assertEquals("recognize_case_numbers", PkulawCompat.translate("anhao_recognition", Map.of("text", "x")).tool());
        PkulawCompat.Call c = PkulawCompat.translate("adjust_provisions",
                Map.of("userlaw", List.of(Map.of("title", "民法典", "article_number", "1082"))));
        assertEquals("verify_law_citations", c.tool());
        assertEquals(List.of(Map.of("law_title", "民法典", "article_number", "1082")), c.args().get("user_law"));
        assertEquals(new PkulawCompat.Call("get_linked_content", Map.of("message", "m")),
                PkulawCompat.translate("get_linked_content", Map.of("message", "m")));
    }

    @Test
    @DisplayName("PkulawChannel：平台档 callToolForData 给旧形状，callTool（给模型）仍是可读文本")
    void channelPlatformRoute() throws Exception {
        McpClientService mcp = mock(McpClientService.class);
        ExternalProviderResolver resolver = mock(ExternalProviderResolver.class);
        PlatformGatewayClient gateway = mock(PlatformGatewayClient.class);
        when(resolver.resolve(ExternalServiceProvider.PKULAW)).thenReturn(ExternalServiceProvider.PLATFORM);
        var data = OM.createObjectNode();
        data.put("raw", raw("get_article"));
        when(gateway.call(eq("pkulaw"), eq("get_article"), anyMap(), anyInt()))
                .thenReturn(new PlatformGatewayClient.Result(data, 1, 1, "call"));
        PkulawChannel channel = new PkulawChannel(mcp, resolver, gateway);
        Map<String, Object> args = Map.of("title", "中华人民共和国民法典", "number", "1082");

        assertEquals("第一千零八十二条", OM.readTree(channel.callToolForData("pkulaw-semantic", "get_article", args)).path("article").asText());
        assertTrue(channel.callTool("pkulaw-semantic", "get_article", args).startsWith("《中华人民共和国民法典》第一千零八十二条"));
        verifyNoInteractions(mcp);
    }

    @Test
    @DisplayName("PkulawChannel：自备 Key 直连先按原名打；上游 Unknown tool 才按现名重试；非法宝 server 不改名")
    void channelDirectRouteFallsBackToNewNames() {
        McpClientService mcp = mock(McpClientService.class);
        ExternalProviderResolver resolver = mock(ExternalProviderResolver.class);
        when(resolver.resolve(ExternalServiceProvider.PKULAW)).thenReturn(ExternalServiceProvider.BYOK);
        PkulawChannel channel = new PkulawChannel(mcp, resolver, mock(PlatformGatewayClient.class));
        Map<String, Object> old = Map.of("title", "民法典", "number", "1082");
        Map<String, Object> renamed = Map.of("law_title", "民法典", "article_number", "1082");

        when(mcp.callTool("pkulaw-semantic", "get_article", old)).thenReturn("旧名仍可用");
        assertEquals("旧名仍可用", channel.callTool("pkulaw-semantic", "get_article", old));
        verify(mcp, never()).callTool("pkulaw-semantic", "get_law_article", renamed);

        when(mcp.callTool("pkulaw-semantic", "get_article", old)).thenReturn("Error from MCP server: Unknown tool: get_article");
        when(mcp.callTool("pkulaw-semantic", "get_law_article", renamed)).thenReturn("现名结果");
        assertEquals("现名结果", channel.callTool("pkulaw-semantic", "get_article", old));

        when(mcp.callTool("some-judgment-mcp", "get_article", Map.of("title", "x"))).thenReturn("Error: Unknown tool");
        assertEquals("Error: Unknown tool", channel.callTool("some-judgment-mcp", "get_article", Map.of("title", "x")));
        verify(mcp, never()).callTool(eq("some-judgment-mcp"), eq("get_law_article"), anyMap());
    }

    @Test
    @DisplayName("PkulawChannel：自建 MCP 连接没有旧名工具（tool_unavailable）时按现名重试；其它失败原样抛")
    void channelUserMcpFallsBackOnToolUnavailable() {
        var userMcp = mock(com.checkba.service.ai.mcp.UserMcpConnectionService.class);
        when(userMcp.hasOverride("pkulaw")).thenReturn(true);
        PkulawChannel channel = new PkulawChannel(mock(McpClientService.class), mock(ExternalProviderResolver.class), mock(PlatformGatewayClient.class));
        org.springframework.test.util.ReflectionTestUtils.setField(channel, "userMcp", userMcp);
        Map<String, Object> old = Map.of("text", "离婚");
        var missing = new com.checkba.service.ai.mcp.PluginMcpException("tool_unavailable", 400, "no tool");
        when(userMcp.callPreset("pkulaw", "search_article", old)).thenThrow(missing);
        when(userMcp.callPreset("pkulaw", "search_law_articles", Map.of("query_text", "离婚"))).thenReturn("现名结果");
        assertEquals("现名结果", channel.callTool("pkulaw-semantic", "search_article", old));

        when(userMcp.callPreset("pkulaw", "search_case", Map.of("text", "x")))
                .thenThrow(new com.checkba.service.ai.mcp.PluginMcpException("remote_error", 502, "down"));
        assertThrows(com.checkba.service.ai.mcp.PluginMcpException.class, () -> channel.callTool("pkulaw-case-semantic", "search_case", Map.of("text", "x")));
        verify(userMcp, never()).callPreset(eq("pkulaw"), eq("search_cases"), anyMap());
    }
}
