// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.dd;

import com.checkba.model.entity.DdNotification;
import com.checkba.repository.ProjectRepository;
import com.checkba.service.DdWorkflowService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class DdMessageCenterSourceTest {
    @Test void countsAllAuthorizedNotificationsBeforeApplyingVisibleLimit() {
        DdWorkflowService workflow=mock(DdWorkflowService.class);
        List<DdNotification> rows=new ArrayList<>();
        for (long id=1;id<=3;id++) {
            DdNotification n=new DdNotification();n.setId(id);n.setProjectId(42L);n.setRequestId(8L);
            n.setKind("NOTICE");n.setTitle("Synthetic");n.setCreatedAt(LocalDateTime.of(2026,10,22,12,0));
            n.setActionState(id<3?"pending":"none");if(id==2)n.setReadAt(n.getCreatedAt());rows.add(n);
        }
        when(workflow.accountInbox(7L)).thenReturn(rows);
        var source=new DdMessageCenterSource(workflow,mock(ProjectRepository.class));
        var snapshot=source.list(7L,1);
        assertEquals(1,snapshot.items().size());assertEquals(2,snapshot.unread());assertEquals(2,snapshot.pending());assertTrue(snapshot.hasMore());
        assertThrows(IllegalArgumentException.class,()->source.target(8L,"1"));
        assertThrows(IllegalArgumentException.class,()->source.markRead(8L,"1"));verify(workflow,never()).markRead(1L,8L);
    }
    @Test void jsonAddsProducerLocatedTimeWhileLegacyTimeNeverUsesDesktopZone() throws Exception {
        TimeZone original=TimeZone.getDefault();
        try {
            TimeZone.setDefault(TimeZone.getTimeZone("Asia/Shanghai"));
            DdNotification n=new DdNotification();n.setCreatedAt(LocalDateTime.of(2026,10,22,12,0));n.setReadAt(n.getCreatedAt());
            var mapper=new ObjectMapper().findAndRegisterModules();
            @SuppressWarnings("unchecked") Map<String,Object> row=mapper.readValue(mapper.writeValueAsBytes(n),Map.class);
            assertTrue(row.containsKey("createdAt"));assertEquals("2026-10-22T04:00:00Z",row.get("createdAtIso"));
            TimeZone.setDefault(TimeZone.getTimeZone("America/New_York"));
            assertEquals(Instant.parse("2026-10-22T04:00:00Z"),DdMessageCenterSupport.instant(row,"createdAt"));
            assertEquals(Instant.parse("2026-10-22T04:00:00Z"),DdMessageCenterSupport.instant(row,"readAt"));
            Map<String,Object> legacy=Map.of("createdAt","2026-10-22T12:00:00","readAt","2026-10-22T12:00:00");
            assertNull(DdMessageCenterSupport.instant(legacy,"createdAt"));assertNull(DdMessageCenterSupport.instant(legacy,"readAt"));
            assertTrue(DdMessageCenterSupport.read(legacy));
        } finally {TimeZone.setDefault(original);}
    }
}
