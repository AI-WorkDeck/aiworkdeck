// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.tools;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class SheetInsertPositionTest {

    @Test
    void afterShiftsTheInsertionPointByOneRowOrColumn() {
        assertEquals("D", DocumentEditTools.nextRowOrColumn("C"));
        assertEquals("D", DocumentEditTools.nextRowOrColumn(" c "));
        assertEquals("AA", DocumentEditTools.nextRowOrColumn("Z"));
        assertEquals("BA", DocumentEditTools.nextRowOrColumn("AZ"));
        assertEquals("6", DocumentEditTools.nextRowOrColumn("5"));
        assertNull(DocumentEditTools.nextRowOrColumn("C3"));
        assertNull(DocumentEditTools.nextRowOrColumn("0"));
    }
}
