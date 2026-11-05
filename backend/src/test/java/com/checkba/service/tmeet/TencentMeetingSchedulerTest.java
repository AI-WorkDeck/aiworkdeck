// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.tmeet;

import com.checkba.model.entity.TencentMeetingSyncConfig;
import com.checkba.repository.TencentMeetingSyncConfigRepository;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class TencentMeetingSchedulerTest {

    @Test
    void interruptedRunningStatusIsResetSoSchedulerSyncsAgain() {
        TencentMeetingSyncConfigRepository repo = mock(TencentMeetingSyncConfigRepository.class);
        TencentMeetingService service = mock(TencentMeetingService.class);
        TencentMeetingSyncConfig cfg = new TencentMeetingSyncConfig();
        cfg.setUserId(9L);
        cfg.setAutoSync(true);
        cfg.setLastSyncStatus("RUNNING");
        when(repo.findAll()).thenReturn(List.of(cfg));
        when(repo.save(any(TencentMeetingSyncConfig.class))).thenAnswer(inv -> inv.getArgument(0));
        TencentMeetingScheduler scheduler = new TencentMeetingScheduler(repo, service);

        scheduler.runScheduledSync();
        verify(service, never()).syncMeetings(any(), any(), anyBoolean());

        scheduler.resetInterrupted();
        scheduler.runScheduledSync();

        verify(service).syncMeetings(9L, null, false);
    }
}
