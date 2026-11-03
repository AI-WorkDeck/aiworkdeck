// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;
import com.checkba.repository.MobileAssistantDesktopCopyRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import java.time.Instant;

/** Clear expired content while retaining the identity/hash needed to reconcile a delayed desktop ACK. */
@Service
@RequiredArgsConstructor
public class MobileAssistantDesktopCopyCleanup {
    private final MobileAssistantDesktopCopyRepository repository;
    private final MobileAssistantDesktopCopyService copies;
    @Scheduled(initialDelay=60000,fixedDelay=60000)
    public void expire() {
        for(var row:repository.findTop100ByStatusAndExpiresAtBeforeOrderByIdAsc("QUEUED",Instant.now())) {
            copies.get(row.getUserId(),row.getRequestId());
        }
    }
}
