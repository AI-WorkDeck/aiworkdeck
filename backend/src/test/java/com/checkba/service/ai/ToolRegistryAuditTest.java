// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import com.checkba.service.UserActivityLogService;
import com.checkba.service.ai.tools.AgentToolComponent;
import com.checkba.service.ai.tools.ToolContext;
import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class ToolRegistryAuditTest {

    static class AuditTools implements AgentToolComponent {
        @Tool("read something")
        public String get_secret(@P("v") String v) { return "OUTPUT-SECRET-" + v; }

        @Tool("boom")
        public String list_boom(@P("v") String v) { throw new IllegalStateException("kaboom"); }

        @Tool("discovery")
        public String list_tools(@P("v") String v) { return "x"; }
    }

    private ToolRegistry registry;
    private UserActivityLogService logs;

    @BeforeEach
    void setUp() {
        registry = new ToolRegistry(List.of(new AuditTools()), new PluginService(), new ClientCapabilityService());
        registry.init();
        logs = mock(UserActivityLogService.class);
        ReflectionTestUtils.setField(registry, "activityLogService", logs);
        registry.auditExecutor = Runnable::run;
    }

    private String capture(String expectedName) {
        ArgumentCaptor<String> meta = ArgumentCaptor.forClass(String.class);
        verify(logs).logActivity(eq(7L), eq("ai_tool"), isNull(), eq(expectedName), anyLong(), meta.capture(), eq(5L));
        return meta.getValue();
    }

    @Test
    void agentAndMcpSourcesEachLogOnce() {
        registry.execute("get_secret", "{\"v\":\"CLIENT-NAME\"}", new ToolContext(5L, "conv-1", 7L, null));
        String agent = capture("get_secret");
        assertTrue(agent.contains("\"source\":\"agent\""), agent);
        assertTrue(agent.contains("\"ok\":true"), agent);
        assertTrue(agent.matches(".*\"argsDigest\":\"[0-9a-f]{64}\".*"), agent);
        assertFalse(agent.contains("CLIENT-NAME"));
        assertFalse(agent.contains("OUTPUT-SECRET"));

        reset(logs);
        registry.execute("get_secret", "{\"v\":\"x\"}", new ToolContext(5L, "mcp:claude", 7L, null));
        assertTrue(capture("get_secret").contains("\"source\":\"mcp\""));

        reset(logs);
        registry.execute("get_secret", "{\"v\":\"x\"}", new ToolContext(5L, null, 7L, null), "plugin-ui");
        assertTrue(capture("get_secret").contains("\"source\":\"plugin-ui\""));
    }

    @Test
    void failureLoggedAsNotOk() {
        registry.execute("list_boom", "{\"v\":\"x\"}", new ToolContext(5L, "conv-1", 7L, null));
        String meta = capture("list_boom");
        assertTrue(meta.contains("\"ok\":false"), meta);
        assertFalse(meta.contains("kaboom"));
    }

    @Test
    void loggingFailureDoesNotBreakTool() {
        doThrow(new RuntimeException("db down")).when(logs).logActivity(any(), any(), any(), any(), any(), any(), any());
        var r = registry.execute("get_secret", "{\"v\":\"x\"}", new ToolContext(5L, "conv-1", 7L, null));
        assertEquals("OUTPUT-SECRET-x", r.output());
    }

    @Test
    void discoveryToolsAreNotLogged() {
        registry.execute("list_tools", "{\"v\":\"x\"}", new ToolContext(5L, "conv-1", 7L, null));
        verifyNoInteractions(logs);
    }
}
