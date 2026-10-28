// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.tools;

import com.checkba.service.ai.EditorBridgeService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class SlideEditToolsPrecisionTest {
    @Test
    void missingReplacementIsNotDeletionAndPartialTargetsCannotDispatch() {
        EditorBridgeService bridge = mock(EditorBridgeService.class);
        SlideEditTools tools = new SlideEditTools(bridge);
        assertTrue(tools.slide_replace_text("100", null, null, false).startsWith("Error"));
        assertTrue(tools.slide_replace_text("100", "200", null, false, "body", "100").startsWith("Error"));
        assertTrue(tools.slide_replace_text("100", "200", 1, false, null, "100").startsWith("Error"));
        verifyNoInteractions(bridge);
    }

    @Test
    void exactTargetAndExplicitDeletionReachTheWorkerUnchanged() {
        EditorBridgeService bridge = mock(EditorBridgeService.class);
        when(bridge.executeEditorCommand(eq("slide_replace_text"), anyMap())).thenReturn("ok");
        SlideEditTools tools = new SlideEditTools(bridge);
        assertEquals("ok", tools.slide_replace_text("100", "", 2, false, "body", "100元"));
        @SuppressWarnings("unchecked") ArgumentCaptor<Map<String, Object>> args = ArgumentCaptor.forClass(Map.class);
        verify(bridge).executeEditorCommand(eq("slide_replace_text"), args.capture());
        assertEquals(Map.of("searchText", "100", "replaceText", "", "slideNumber", 2,
                "all", false, "shapeName", "body", "expectedText", "100元"), args.getValue());
    }

    @Test
    void backgroundDoesNotImplicitlySetLayoutOrMaster() {
        EditorBridgeService bridge = mock(EditorBridgeService.class);
        when(bridge.executeEditorCommand(eq("slide_set_layout"), anyMap())).thenReturn("ok");
        SlideEditTools tools = new SlideEditTools(bridge);
        assertEquals("ok", tools.slide_set_layout(1, null, null, "#123456"));
        @SuppressWarnings("unchecked") ArgumentCaptor<Map<String, Object>> args = ArgumentCaptor.forClass(Map.class);
        verify(bridge).executeEditorCommand(eq("slide_set_layout"), args.capture());
        assertEquals(Map.of("slideNumber", 1, "backgroundColor", "#123456"), args.getValue());
    }
    @Test
    void partialInsertionFailureKeepsMachineFieldsAndLocalizesItsMessage() {
        EditorBridgeService bridge = mock(EditorBridgeService.class);
        when(bridge.executeEditorCommand(eq("slide_add_page"), anyMap())).thenReturn(
                "{\"success\":false,\"error\":\"SLIDE_INSERT_PARTIAL\",\"created\":true,\"retryable\":false,\"slideNumber\":3}");
        var result = cn.hutool.json.JSONUtil.parseObj(new SlideEditTools(bridge).slide_add_page(null, null, null, null, null));
        assertEquals("SLIDE_INSERT_PARTIAL", result.getStr("errorCode"));
        assertNotEquals("SLIDE_INSERT_PARTIAL", result.getStr("error"));
        assertTrue(result.getBool("created"));
        assertFalse(result.getBool("retryable"));
        assertEquals(3, result.getInt("slideNumber"));
    }

    @Test
    void paragraphFormattingPreservesUnitsAndLegacyOverload() {
        EditorBridgeService bridge = mock(EditorBridgeService.class);
        when(bridge.executeEditorCommand(eq("slide_format_text"), anyMap())).thenReturn("ok");
        SlideEditTools tools = new SlideEditTools(bridge);
        assertEquals("ok", tools.slide_format_text(1, "body", "anchor", null, null, null, null,
                null, null, null, null, "exactly", 24.0, 6.0, 12.0, null, null,
                -10.0, null, 10.0, null, 0.0));
        @SuppressWarnings("unchecked") ArgumentCaptor<Map<String, Object>> args = ArgumentCaptor.forClass(Map.class);
        verify(bridge).executeEditorCommand(eq("slide_format_text"), args.capture());
        assertEquals(24.0, args.getValue().get("lineSpacingValue"));
        assertEquals(-10.0, args.getValue().get("firstLineIndentPt"));
        assertEquals("anchor", args.getValue().get("anchorText"));
        assertFalse(args.getValue().containsKey("fontSize"));
        assertEquals("ok", tools.slide_format_text(1, "body", null, null, 20.0, null, null,
                null, null, null, null));
    }

    @Test
    void unsupportedRightIndentCannotDispatchAnyFormatting() {
        EditorBridgeService bridge = mock(EditorBridgeService.class);
        SlideEditTools tools = new SlideEditTools(bridge);
        assertTrue(tools.slide_format_text(1, "body", null, null, 30.0, null, null,
                null, null, null, null, null, null, 6.0, 12.0, null, null,
                null, null, null, null, 4.0).startsWith("Error:"));
        verifyNoInteractions(bridge);
    }

    @Test
    void tableCellStyleRangeReachesWorkerAndLegacySignatureStillWorks() {
        EditorBridgeService bridge = mock(EditorBridgeService.class);
        when(bridge.executeEditorCommand(eq("slide_table_set_style"), anyMap())).thenReturn("ok");
        SlideEditTools tools = new SlideEditTools(bridge);
        assertEquals("ok", tools.slide_table_set_style(1, "table", null, null, null, null,
                0, null, null, null, "Arial", 18.0, true, "#ffffff", "#183247", "center"));
        @SuppressWarnings("unchecked") ArgumentCaptor<Map<String, Object>> args = ArgumentCaptor.forClass(Map.class);
        verify(bridge).executeEditorCommand(eq("slide_table_set_style"), args.capture());
        assertEquals(0, args.getValue().get("row"));
        assertEquals("#ffffff", args.getValue().get("color"));
        assertFalse(args.getValue().containsKey("endRow"));
        assertEquals("ok", tools.slide_table_set_style(1, "table", true, null, null, null));
    }

    @Test
    void documentedOptionalSlideArgumentsAreNotRequiredInToolSchemas() {
        for (var method : SlideEditTools.class.getDeclaredMethods()) {
            if (method.getAnnotation(dev.langchain4j.agent.tool.Tool.class) == null) continue;
            for (var parameter : method.getParameters()) {
                var annotation = parameter.getAnnotation(dev.langchain4j.agent.tool.P.class);
                if (annotation == null) continue;
                String description = String.join(" ", annotation.value());
                if (description.contains("可选") || description.contains("不传") || description.contains("默认"))
                    assertFalse(annotation.required(), method.getName() + ":" + parameter.getName());
            }
        }
    }

    @Test
    void rowHeightArrayIsValidatedAndForwarded() {
        EditorBridgeService bridge = mock(EditorBridgeService.class);
        when(bridge.executeEditorCommand(eq("slide_table_set_style"), anyMap())).thenReturn("ok");
        SlideEditTools tools = new SlideEditTools(bridge);
        assertTrue(tools.slide_table_set_style(1, "table", null, null, null, null,
                null, null, null, null, null, null, null, null, null, null, "[0]").startsWith("Error:"));
        verifyNoInteractions(bridge);
        assertEquals("ok", tools.slide_table_set_style(1, "table", null, null, null, null,
                null, null, null, null, null, null, null, null, null, null, "[24,36]"));
        @SuppressWarnings("unchecked") ArgumentCaptor<Map<String, Object>> args = ArgumentCaptor.forClass(Map.class);
        verify(bridge).executeEditorCommand(eq("slide_table_set_style"), args.capture());
        assertEquals(java.util.List.of(24.0, 36.0), args.getValue().get("rowHeightsPt"));
    }

}
