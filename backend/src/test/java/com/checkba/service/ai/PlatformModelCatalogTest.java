// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import com.checkba.service.account.AccountException;
import com.checkba.service.account.AccountTransport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/** 问题记录 8：登录后首问报「模型目录暂时不可用」——首拉失败要重试、换 key、兜底旧快照。 */
class PlatformModelCatalogTest {
    private static final String BASE = "https://openrouter.ai/api/v1";
    private static final String OK = "{\"data\":[{\"id\":\"anthropic/claude-sonnet-5\",\"architecture\":{\"input_modalities\":[\"text\"],\"output_modalities\":[\"text\"]},\"supported_parameters\":[\"tools\"],\"pricing\":{\"prompt\":\"0.000003\",\"completion\":\"0.000015\"}}]}";

    private PlatformAiChannel channel;
    private final Deque<AccountTransport.Reply> replies = new ArrayDeque<>();
    private final List<String> calls = new ArrayList<>();
    private PlatformModelCatalog catalog;
    private long now = 1_000_000L;

    @BeforeEach
    void setUp() {
        channel = mock(PlatformAiChannel.class);
        when(channel.connection()).thenReturn(new PlatformAiKeyService.Resolved("sk-or-a", "fp-a", null));
        AccountTransport transport = (method, url, key, body) -> {
            calls.add(key);
            return replies.isEmpty() ? new AccountTransport.Reply(200, OK) : replies.poll();
        };
        catalog = new PlatformModelCatalog(channel, transport, BASE);
        catalog.retryDelayMs = 0;
        catalog.clock = () -> now;
    }

    @Test
    void transientFailureIsRetriedOnce() {
        replies.add(new AccountTransport.Reply(AccountTransport.Reply.NETWORK_FAILURE, null));
        assertEquals("anthropic/claude-sonnet-5", catalog.current().defaultModel());
        assertEquals(2, calls.size());
    }

    @Test
    void persistentFailureGivesUpAfterOneRetry() {
        replies.add(new AccountTransport.Reply(502, "bad gateway"));
        replies.add(new AccountTransport.Reply(503, "unavailable"));
        assertThrows(AccountException.class, catalog::current);
        assertEquals(2, calls.size());
    }

    @Test
    void rejectedKeyIsReportedAndCatalogueRefetchedWithFreshKey() {
        replies.add(new AccountTransport.Reply(401, "{\"error\":\"invalid key\"}"));
        when(channel.connection()).thenReturn(
                new PlatformAiKeyService.Resolved("sk-or-a", "fp-a", null),
                new PlatformAiKeyService.Resolved("sk-or-b", "fp-b", null));
        assertEquals("anthropic/claude-sonnet-5", catalog.current().defaultModel());
        verify(channel).onKeyRejected(any(), eq("fp-a"));
        assertEquals(List.of("sk-or-a", "sk-or-b"), calls);
    }

    @Test
    void expiredSnapshotIsServedWhenRefreshFails() {
        PlatformModelCatalog.Catalog first = catalog.current();
        now += 120_000;
        replies.add(new AccountTransport.Reply(500, "boom"));
        replies.add(new AccountTransport.Reply(500, "boom"));
        assertSame(first, catalog.current());
        assertEquals(3, calls.size());
    }
}
