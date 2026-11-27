// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version.cloud;

import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;

import static org.junit.jupiter.api.Assertions.*;

/** C26 (lane C): collaboration event times carry their offset, so every desktop dates them in its own zone. */
class CollabEventTimeZoneTest {
    @Test
    void eventTimesAreSentWithTheServerOffset() {
        LocalDateTime serverClock = LocalDateTime.of(2026, 11, 26, 17, 19, 5);
        String sent = CollabEventController.zoned(serverClock);
        OffsetDateTime parsed = OffsetDateTime.parse(sent);
        assertEquals(serverClock.atZone(ZoneId.systemDefault()).toInstant(), parsed.toInstant(), "same instant, zone made explicit");
        assertTrue(sent.endsWith("Z") || sent.matches(".*[+-]\\d{2}:\\d{2}$"), "an offset is always present: " + sent);
        // A Beijing desktop reading a UTC server's 17:19 now sees 01:19 on the 27th
        var beijing = OffsetDateTime.parse(CollabEventController.zoned(serverClock))
                .atZoneSameInstant(ZoneId.of("Asia/Shanghai"));
        assertEquals(serverClock.atZone(ZoneId.systemDefault()).toInstant(), beijing.toInstant());
        assertNull(CollabEventController.zoned(null));
    }
}
