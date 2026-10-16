// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class InboxInlineContentStoreTest {
    @Test
    void expiryIsAbsoluteAndConversationRemovalIsScoped() {
        var time = new AtomicLong();
        var store = new InboxInlineContentStore(time::get);
        store.put("a", "conversation", Map.of("hash", "body"));
        store.put("b", "other", Map.of("hash", "other body"));
        time.set(InboxInlineContentStore.TTL_MILLIS - 1);
        assertEquals("body", store.get("a", "hash"));
        store.removeConversation("conversation");
        assertNull(store.get("a", "hash"));
        assertEquals("other body", store.get("b", "hash"));
        time.incrementAndGet();
        assertNull(store.get("b", "hash"), "reads must not extend absolute retention");
    }

    @Test
    void memoryHasBothEntryAndCharacterBounds() {
        var store = new InboxInlineContentStore();
        for (int i = 0; i <= InboxInlineContentStore.MAX_ENTRIES; i++) {
            store.put("row-" + i, "conversation", Map.of("hash", "body"));
        }
        assertNull(store.get("row-0", "hash"));
        assertEquals("body", store.get("row-128", "hash"));
        store.put("large", "conversation", Map.of("hash", "x".repeat(InboxInlineContentStore.MAX_CHARACTERS)));
        assertNull(store.get("row-128", "hash"));
        assertThrows(IllegalArgumentException.class, () -> store.put("too-large", "conversation",
                Map.of("hash", "x".repeat(InboxInlineContentStore.MAX_CHARACTERS + 1))));
    }
}
