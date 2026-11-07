// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller.ai;

import com.checkba.service.LocalIdentityService;
import com.checkba.service.mcpserver.LocalMcpServerSettings;
import com.checkba.service.mcpserver.LocalMcpServerTools;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;
import java.util.Map;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.hasSize;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class LocalMcpServerControllerTest {

    private static final String TOKEN = "awdm_good";

    private LocalMcpServerSettings settings;
    private LocalMcpServerTools tools;
    private LocalIdentityService identity;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        settings = mock(LocalMcpServerSettings.class);
        tools = mock(LocalMcpServerTools.class);
        identity = mock(LocalIdentityService.class);
        when(identity.isLocalMode()).thenReturn(true);
        when(identity.localUserId()).thenReturn(7L);
        when(settings.isEnabled()).thenReturn(true);
        when(settings.verify(TOKEN)).thenReturn(true);
        mvc = MockMvcBuilders.standaloneSetup(
                new LocalMcpServerController(settings, tools, identity, new ObjectMapper())).build();
    }

    private ResultActions rpc(String body) throws Exception {
        return mvc.perform(post("/mcp").header("Authorization", "Bearer " + TOKEN)
                .contentType(MediaType.APPLICATION_JSON).content(body));
    }

    @Test
    void disabledOrServerModeLooksLikeNoEndpoint() throws Exception {
        when(settings.isEnabled()).thenReturn(false);
        rpc("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}").andExpect(status().isNotFound());
        when(settings.isEnabled()).thenReturn(true);
        when(identity.isLocalMode()).thenReturn(false);
        rpc("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}").andExpect(status().isNotFound());
        mvc.perform(post("/api/mcp-server/enable")).andExpect(status().isNotFound());
        verify(settings, never()).enableAndIssueToken();
    }

    @Test
    void rejectsMissingOrWrongTokenAndBrowserOrigins() throws Exception {
        String ping = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}";
        mvc.perform(post("/mcp").contentType(MediaType.APPLICATION_JSON).content(ping))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string("WWW-Authenticate", containsString("Bearer")));
        mvc.perform(post("/mcp").header("Authorization", "Bearer awdm_bad")
                .contentType(MediaType.APPLICATION_JSON).content(ping)).andExpect(status().isUnauthorized());
        mvc.perform(post("/mcp").header("Authorization", "Bearer " + TOKEN).header("Origin", "http://evil.example")
                .contentType(MediaType.APPLICATION_JSON).content(ping)).andExpect(status().isForbidden());
    }

    @Test
    void initializeNegotiatesProtocolVersion() throws Exception {
        rpc("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-03-26\"}}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result.protocolVersion").value("2025-03-26"))
                .andExpect(jsonPath("$.result.serverInfo.name").value("aiworkdeck"))
                .andExpect(jsonPath("$.result.capabilities.tools").exists());
        rpc("{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"1999-01-01\"}}")
                .andExpect(jsonPath("$.result.protocolVersion").value("2025-06-18"));
        rpc("{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}").andExpect(status().isAccepted());
    }

    @Test
    void toolsListIsReadOnlyExceptProposeRevision() throws Exception {
        rpc("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}")
                .andExpect(jsonPath("$.result.tools", hasSize(LocalMcpServerTools.DEFINITIONS.size())))
                .andExpect(jsonPath("$.result.tools[?(@.name=='propose_revision')]", hasSize(1)))
                .andExpect(jsonPath("$.result.tools[?(@.name=='propose_revision')].annotations.readOnlyHint",
                        everyItem(org.hamcrest.Matchers.is(false))))
                .andExpect(jsonPath("$.result.tools[?(@.name!='propose_revision')].annotations.readOnlyHint",
                        everyItem(org.hamcrest.Matchers.is(true))))
                .andExpect(jsonPath("$.result.tools[*].annotations.destructiveHint", everyItem(org.hamcrest.Matchers.is(false))));
    }

    @Test
    void proposeRevisionCallPassesClientNameAndReportsInvalidAsToolError() throws Exception {
        when(tools.call(eq("propose_revision"), anyMap(), eq(7L), eq("claude-code/1.0")))
                .thenReturn(Map.of("proposalId", 5, "status", "PENDING"));
        mvc.perform(post("/mcp").header("Authorization", "Bearer " + TOKEN).header("User-Agent", "claude-code/1.0")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"jsonrpc\":\"2.0\",\"id\":8,\"method\":\"tools/call\",\"params\":{\"name\":\"propose_revision\",\"arguments\":{\"fileId\":1,\"baseVersion\":\"v\",\"edits\":[{\"find\":\"a\",\"replace\":\"b\"}]}}}"))
                .andExpect(jsonPath("$.result.isError").value(false))
                .andExpect(jsonPath("$.result.content[0].text", containsString("\"proposalId\":5")));

        when(tools.call(eq("propose_revision"), anyMap(), eq(7L), eq("claude-code/1.0")))
                .thenThrow(new LocalMcpServerTools.ToolError("find must not be empty"));
        mvc.perform(post("/mcp").header("Authorization", "Bearer " + TOKEN).header("User-Agent", "claude-code/1.0")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"tools/call\",\"params\":{\"name\":\"propose_revision\",\"arguments\":{\"fileId\":1,\"baseVersion\":\"v\",\"edits\":[{\"find\":\"\",\"replace\":\"b\"}]}}}"))
                .andExpect(jsonPath("$.result.isError").value(true))
                .andExpect(jsonPath("$.result.content[0].text").value("find must not be empty"));
    }

    @Test
    void toolsCallRunsAsLocalUserAndReportsToolErrorsInResult() throws Exception {
        when(tools.call(eq("list_projects"), anyMap(), eq(7L), any())).thenReturn(List.of(Map.of("projectId", 1)));
        rpc("{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"list_projects\",\"arguments\":{}}}")
                .andExpect(jsonPath("$.id").value(3))
                .andExpect(jsonPath("$.result.isError").value(false))
                .andExpect(jsonPath("$.result.content[0].text").value("[{\"projectId\":1}]"));

        when(tools.call(eq("read_file"), anyMap(), any(), any())).thenThrow(new LocalMcpServerTools.ToolError("File not found: 9"));
        rpc("{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"read_file\",\"arguments\":{\"fileId\":9}}}")
                .andExpect(jsonPath("$.result.isError").value(true))
                .andExpect(jsonPath("$.result.content[0].text").value("File not found: 9"));
    }

    @Test
    void protocolErrors() throws Exception {
        rpc("{not json").andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value(-32700));
        rpc("[{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}]").andExpect(jsonPath("$.error.code").value(-32600));
        rpc("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"resources/list\"}").andExpect(jsonPath("$.error.code").value(-32601));
        rpc("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{}}").andExpect(jsonPath("$.error.code").value(-32602));
        mvc.perform(get("/mcp").header("Authorization", "Bearer " + TOKEN)).andExpect(status().isMethodNotAllowed());
    }

    @Test
    void enableReturnsTokenOnce() throws Exception {
        when(settings.enableAndIssueToken()).thenReturn("awdm_new");
        mvc.perform(post("/api/mcp-server/enable"))
                .andExpect(jsonPath("$.token").value("awdm_new"))
                .andExpect(jsonPath("$.endpoint", containsString("/mcp")));
        when(settings.isEnabled()).thenReturn(true);
        mvc.perform(get("/api/mcp-server/status"))
                .andExpect(jsonPath("$.enabled").value(true))
                .andExpect(jsonPath("$.token").doesNotExist());
        mvc.perform(post("/api/mcp-server/disable")).andExpect(jsonPath("$.enabled").value(false));
        verify(settings).disable();
    }
}
