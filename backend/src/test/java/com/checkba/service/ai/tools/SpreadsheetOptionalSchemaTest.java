// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.tools;

import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertFalse;

class SpreadsheetOptionalSchemaTest {
    @Test void optionalSpreadsheetParametersAreActuallyOptional() {
        for (var type : new Class<?>[]{DocumentEditTools.class, OfficeEditTools.class}) {
            for (var method : type.getDeclaredMethods()) {
                if (method.getAnnotation(Tool.class) == null ||
                    !(method.getName().startsWith("sheet_") || method.getName().startsWith("office_excel_"))) continue;
                for (var parameter : method.getParameters()) {
                    var p = parameter.getAnnotation(P.class);
                    if (p == null) continue;
                    String description = String.join(" ", p.value());
                    if (description.contains("可选") || description.contains("不传") || description.contains("默认") || description.contains("缺省") || description.contains("不改"))
                        assertFalse(p.required(), method.getName() + ":" + parameter.getName());
                }
            }
        }
    }
}
