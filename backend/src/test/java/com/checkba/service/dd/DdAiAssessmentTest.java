// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.dd;

import com.fasterxml.jackson.databind.*;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class DdAiAssessmentTest {
    final ObjectMapper json = new ObjectMapper();
    JsonNode result(long fileId, String quote) {
        return json.valueToTree(Map.of("verdict", "PASSED", "summary", "满足本项收件要求", "checks",
                List.of("材料类型", "主体版本", "内容完整性").stream().map(requirement -> Map.of(
                        "requirement", requirement, "status", "PASS", "reason", "原文可核对", "fileId", fileId, "quote", quote)).toList()));
    }
    @Test void passesOnlyGroundedChecksCoveringEveryFile() {
        assertEquals("PASSED", DdAiService.validateReview(result(11, "示例公司"), Map.of(11L, "材料：示例公司"), json).path("verdict").asText());
        assertEquals("MANUAL_REQUIRED", DdAiService.validateReview(result(11, "示例公司"), Map.of(11L, "材料：示例公司", 12L, "另一个附件"), json).path("verdict").asText());
    }
    @Test void fabricatedQuoteAndForeignFileCannotPass() {
        assertEquals("MANUAL_REQUIRED", DdAiService.validateReview(result(11, "正确"), Map.of(11L, "真实内容"), json).path("verdict").asText());
        assertEquals("MANUAL_REQUIRED", DdAiService.validateReview(result(99, "示例公司"), Map.of(11L, "示例公司"), json).path("verdict").asText());
    }
    @Test void absentOrMalformedAssessmentFailsVisibly() {
        assertThrows(DdProcessingException.class, () -> DdAiService.validateReview(json.createObjectNode(), Map.of(), json));
        assertThrows(DdProcessingException.class, () -> DdAiService.validateReview(null, Map.of(), json));
    }
    @Test void unreadableResultNeverBecomesAnApproval() {
        JsonNode manual = json.valueToTree(Map.of("verdict", "MANUAL_REQUIRED", "summary", "第二页无法识别，请补传", "checks", List.of()));
        assertEquals(manual, DdAiService.validateReview(manual, Map.of(), json));
    }
    @Test void failedVerdictNeedsMeaningfulChecksAndCannotInventEvidence() {
        var failure = json.createObjectNode().put("verdict", "FAILED").put("summary", "材料不符合要求");
        failure.putArray("checks");
        assertEquals("MANUAL_REQUIRED", DdAiService.validateReview(failure, Map.of(11L, "原文"), json).path("verdict").asText());
        failure.withArray("checks").addObject().put("status", "FAIL").put("requirement", "页码完整").put("reason", "第2页缺失");
        assertEquals("FAILED", DdAiService.validateReview(failure, Map.of(11L, "原文"), json).path("verdict").asText());
        failure.withArray("checks").get(0).withObject("").put("fileId", 999).put("quote", "虚构文字");
        assertEquals("MANUAL_REQUIRED", DdAiService.validateReview(failure, Map.of(11L, "原文"), json).path("verdict").asText());
    }
}
