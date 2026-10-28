// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.tools;

import com.checkba.service.ai.OfficeBridgeService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class OfficeWordStructureTest {
    final OfficeBridgeService bridge = mock(OfficeBridgeService.class);
    final OfficeEditTools tools = new OfficeEditTools(bridge, new ObjectMapper(), null, null, null, null, null);

    @Test void nthPreservesOneBasedIndexAndRejectsInvalidInputBeforeDispatch() {
        assertTrue(tools.office_replace_nth_match("c", "text", "", 0).startsWith("Error:"));
        verifyNoInteractions(bridge);
        tools.office_replace_nth_match("c", "text", "", 2);
        verify(bridge).executeOfficeCommand("c", "replace_nth_match", Map.of("findText", "text", "replaceText", "", "matchIndex", 2));
    }
    @Test void auditReadsAllPagesAndRunsSharedMechanicalAudit() {
        when(bridge.executeOfficeCommand(eq("c"), eq("get_paragraphs"), anyMap())).thenReturn(
            "{\"paragraphs\":[{\"index\":0,\"text\":\"第一条 付款\"}],\"truncated\":true,\"nextStartParagraph\":1}",
            "{\"paragraphs\":[{\"index\":1,\"text\":\"第三条 期限\"}],\"truncated\":false}");
        when(bridge.executeOfficeCommand("c", "get_revisions", Map.of())).thenReturn("{\"revisions\":[]}");
        String report = tools.office_audit_structure("c");
        assertFalse(report.startsWith("Error:"), report);
        assertTrue(report.contains("第3条"), report);
        verify(bridge).executeOfficeCommand("c", "get_paragraphs", Map.of("startParagraph",1,"maxParagraphs",500));
    }
    @Test void auditRejectsIncompletePaginationInsteadOfReportingClean() {
        when(bridge.executeOfficeCommand(eq("c"), eq("get_paragraphs"), anyMap())).thenReturn(
            "{\"paragraphs\":[{\"index\":0,\"text\":\"first\"}],\"truncated\":true,\"nextStartParagraph\":0}");
        assertTrue(tools.office_audit_structure("c").startsWith("Error:"));
        verify(bridge, never()).executeOfficeCommand(eq("c"), eq("get_revisions"), anyMap());
    }
    @Test void profileRejectsUnknownScopeAndSuppliesResolvedSchema() {
        assertTrue(tools.office_apply_style_profile("c", "wrong").startsWith("Error:"));
        verifyNoInteractions(bridge);
        tools.office_apply_style_profile("c", "styles-only");
        verify(bridge).executeOfficeCommand(eq("c"), eq("apply_style_profile"), argThat(args ->
            args.get("scope").equals("styles-only") && ((Map<?,?>)args.get("profile")).get("schemaVersion").equals(1)));
    }
}
