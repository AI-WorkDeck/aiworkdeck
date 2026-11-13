// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.activity;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.checkba.model.entity.UserActivityLog;
import com.checkba.repository.UserActivityLogRepository;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class WorklogSummaryServiceTest {
    static UserActivityLog row(String type, String target, long ms, LocalDateTime at) {
        UserActivityLog l = new UserActivityLog();
        l.setActionType(type);
        l.setTargetName(target);
        l.setDuration(ms);
        l.setTimestamp(at);
        return l;
    }

    @Test
    @SuppressWarnings("unchecked")
    void aggregatesOnlyTheCallersRecordsByMonthCategoryAndFile() {
        UserActivityLogRepository repo = mock(UserActivityLogRepository.class);
        when(repo.findTop20000ByUserIdAndProjectIdOrderByTimestampAsc(7L, 3L)).thenReturn(List.of(
                row("FILE_EDIT", "合同.docx", 3_600_000, LocalDateTime.of(2026, 9, 2, 10, 0)),
                row("FILE_EDIT", "合同.docx", 1_800_000, LocalDateTime.of(2026, 10, 5, 10, 0)),
                row("WEB_BROWSE", "法规检索", 900_000, LocalDateTime.of(2026, 10, 6, 10, 0)),
                row("FILE_EDIT", "空", 0, LocalDateTime.of(2026, 10, 7, 10, 0))));
        Map<String, Object> s = new WorklogSummaryService(repo).summarize(7L, 3L);
        verify(repo).findTop20000ByUserIdAndProjectIdOrderByTimestampAsc(7L, 3L);
        assertEquals(1.75, s.get("totalHours"));
        assertEquals("2026-09-02", s.get("from"));
        assertEquals("2026-10-06", s.get("to"));
        assertEquals(List.of(Map.of("month", "2026-09", "hours", 1.0), Map.of("month", "2026-10", "hours", 0.75)), s.get("byMonth"));
        List<Map<String, Object>> files = (List<Map<String, Object>>) s.get("topFiles");
        assertEquals("合同.docx", files.get(0).get("name"));
        assertEquals(1.5, files.get(0).get("hours"));
        assertFalse(s.toString().contains("sourceAddress"));
    }
}
