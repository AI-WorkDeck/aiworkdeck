// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.tools;

import com.checkba.service.ai.ClientCapabilityService;
import com.checkba.service.ai.OfficeBridgeService;
import com.checkba.service.ai.PluginService;
import com.checkba.service.ai.SseEmitterService;
import com.checkba.service.ai.ToolRegistry;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;

/** Model schema → argument binding → SSE → client acknowledgement, including old clients. */
class OfficeRevisionReasonContractTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final List<JsonNode> payloads = new ArrayList<>();
    private final ToolContext context = new ToolContext(5L, "reason-conv", 7L, null);
    private ToolRegistry registry;
    private Object response = Map.of("changed", true);

    @BeforeEach
    void setUp() {
        SseEmitterService sse = mock(SseEmitterService.class);
        OfficeBridgeService bridge = new OfficeBridgeService(sse, mapper);
        doAnswer(invocation -> {
            JsonNode payload = mapper.readTree((String) invocation.getArgument(2));
            payloads.add(payload);
            bridge.completeOfficeAction(payload.path("requestId").asText(), true, response, null);
            return null;
        }).when(sse).send(eq("reason-conv"), eq("client_action"), any());
        OfficeEditTools tools = new OfficeEditTools(bridge, mapper, null, null, null, null, null);
        ClientCapabilityService capability = new ClientCapabilityService();
        capability.record("reason-conv", "office", "word");
        registry = new ToolRegistry(List.of(tools), new PluginService(), capability);
        registry.init();
    }

    @Test
    void optionalReasonsSurviveAllSixTextWriteToolsAndOldCalls() throws Exception {
        Map<String, String> arguments = Map.of(
                "office_replace_text", "{\"searchText\":\"原文\",\"replaceText\":\"新文\",\"replaceAll\":false}",
                "office_insert_text", "{\"text\":\"补充条款\"}",
                "office_table_set_cell", "{\"cell\":\"B2\",\"text\":\"金额\"}",
                "office_edit_header_footer", "{\"part\":\"header\",\"text\":\"合同\"}",
                "office_insert_footnote", "{\"anchorText\":\"术语\",\"text\":\"解释\"}",
                "office_insert_endnote", "{\"anchorText\":\"术语\",\"text\":\"解释\"}");
        for (var entry : arguments.entrySet()) {
            var spec = registry.getAllSpecifications("reason-conv").stream()
                    .filter(s -> s.name().equals(entry.getKey())).findFirst().orElseThrow();
            assertTrue(spec.parameters().properties().containsKey("reason"), entry.getKey());
            assertFalse(spec.parameters().required().contains("reason"), entry.getKey());
            var args = (com.fasterxml.jackson.databind.node.ObjectNode) mapper.readTree(entry.getValue());
            args.put("reason", "  统一术语并补充解释  ");
            var result = registry.execute(entry.getKey(), mapper.writeValueAsString(args), context);
            assertTrue(result.success(), result.output());
            var payload = payloads.get(payloads.size() - 1);
            assertEquals(entry.getKey().substring("office_".length()), payload.path("command").asText());
            assertEquals("统一术语并补充解释", payload.path("args").path("reason").asText());
            var data = mapper.readTree(result.output());
            assertTrue(data.path("changed").asBoolean());
            assertEquals("统一术语并补充解释", data.path("requestedReason").asText());

            result = registry.execute(entry.getKey(), entry.getValue(), context);
            assertTrue(result.success(), result.output());
            assertFalse(payloads.get(payloads.size() - 1).path("args").has("reason"));
            assertFalse(mapper.readTree(result.output()).has("requestedReason"));
        }
    }

    @Test
    void batchReasonsKeepOneBasedRequestIndexesWithoutClaimingSuccessfulRevisionMapping() throws Exception {
        response = Map.of("replaced", 1, "failed", List.of(Map.of("index", 2, "error", "未找到")));
        String edits = "[{\"searchText\":\"甲方\",\"replaceText\":\"买方\",\"reason\":\"统一主体名称\"},"
                + "{\"searchText\":\"乙方\",\"replaceText\":\"卖方\",\"reason\":\"统一相对方名称\"}]";
        var result = registry.execute("office_replace_batch", mapper.writeValueAsString(Map.of("editsJson", edits)), context);
        assertTrue(result.success(), result.output());
        var items = payloads.get(payloads.size() - 1).path("args").path("items");
        assertEquals("统一主体名称", items.get(0).path("reason").asText());
        assertEquals("统一相对方名称", items.get(1).path("reason").asText());
        var data = mapper.readTree(result.output());
        assertEquals(1, data.path("replaced").asInt());
        assertEquals(2, data.path("failed").get(0).path("index").asInt());
        assertEquals(2, data.path("requestedEditReasons").get(1).path("index").asInt());
        assertFalse(data.has("revisions"), "Request metadata must not fabricate native tracked changes");
    }

    @Test
    void nonStringBatchReasonIsRejectedBeforeDispatch() throws Exception {
        String edits = "[{\"searchText\":\"原文\",\"replaceText\":\"新文\",\"reason\":{\"text\":\"bad\"}}]";
        var result = registry.execute("office_replace_batch", mapper.writeValueAsString(Map.of("editsJson", edits)), context);
        assertFalse(result.success());
        assertTrue(result.output().contains("reason"));
        assertTrue(payloads.isEmpty());
    }
}
