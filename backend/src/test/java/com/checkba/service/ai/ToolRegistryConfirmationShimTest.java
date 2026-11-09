// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import com.checkba.service.ai.tools.AgentToolComponent;
import com.checkba.service.ai.tools.ToolMeta;
import com.checkba.service.ai.tools.ToolShim;
import dev.langchain4j.agent.tool.Tool;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** P2-1 × tool-system-v2 V4：destructive 新工具的 @ToolShim 旧名同样过确认闸，且永不投影 MCP。 */
class ToolRegistryConfirmationShimTest {

    static class FakeTools implements AgentToolComponent {
        @ToolMeta(displayName = "删除东西", access = ToolMeta.Access.DESTRUCTIVE)
        @Tool("delete a thing")
        public String fake_drop_thing(String id) { return "ok"; }

        @ToolShim(replacedBy = "fake_drop_thing")
        @ToolMeta(displayName = "旧名", offerToModel = false, access = ToolMeta.Access.WRITE)
        @Tool("old name of fake_drop_thing")
        public String fake_old_thing(String id) { return "ok"; }

        @ToolShim(replacedBy = "fake_read_thing")
        @ToolMeta(displayName = "旧读", offerToModel = false, access = ToolMeta.Access.READ)
        @Tool("old read")
        public String fake_old_read(String id) { return "ok"; }

        @ToolMeta(displayName = "读东西", access = ToolMeta.Access.READ)
        @Tool("read a thing")
        public String fake_read_thing(String id) { return "ok"; }
    }

    @Test
    void shimOfDestructiveToolIsGatedAndNeverProjected() {
        ToolRegistry registry = new ToolRegistry(List.of(new FakeTools()), new PluginService(), new ClientCapabilityService());
        registry.init();
        assertTrue(registry.requiresConfirmation("fake_drop_thing"));
        assertTrue(registry.requiresConfirmation("fake_old_thing"), "destructive 工具的兼容壳也必须过闸");
        assertFalse(registry.requiresConfirmation("fake_read_thing"));
        assertFalse(registry.requiresConfirmation("fake_old_read"));
        List<String> projected = registry.mcpCandidates().stream().map(c -> c.spec().name()).toList();
        assertTrue(projected.contains("fake_read_thing"), projected.toString());
        assertFalse(projected.contains("fake_old_thing") || projected.contains("fake_old_read")
                || projected.contains("fake_drop_thing"), projected.toString());
    }
}
