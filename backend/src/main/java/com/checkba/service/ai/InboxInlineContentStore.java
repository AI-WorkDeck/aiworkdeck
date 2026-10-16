// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.LongSupplier;

/** Short-lived, per-input bodies: queued documents must not share the conversation's latest body. */
final class InboxInlineContentStore {
    static final long TTL_MILLIS = 30L * 60 * 1000;
    static final int MAX_CHARACTERS = 6_400_000;
    static final int MAX_ENTRIES = 128;
    private record Entry(String conversationId, Map<String, String> bodies, long expiresAt, int characters) {}
    private final Map<String, Entry> entries = new LinkedHashMap<>();
    private final LongSupplier clock;
    private int characters;

    InboxInlineContentStore() { this(System::currentTimeMillis); }
    InboxInlineContentStore(LongSupplier clock) { this.clock = clock; }

    synchronized void put(String id, String conversationId, Map<String, String> bodies) {
        purgeExpired();
        remove(id);
        if (bodies.isEmpty()) return;
        long count = bodies.values().stream().mapToLong(String::length).sum();
        if (count > MAX_CHARACTERS) throw new IllegalArgumentException("Inline document content exceeds the inbox memory limit");
        while (entries.size() >= MAX_ENTRIES || characters + count > MAX_CHARACTERS) {
            remove(entries.keySet().iterator().next());
        }
        entries.put(id, new Entry(conversationId, Map.copyOf(bodies), clock.getAsLong() + TTL_MILLIS, (int) count));
        characters += (int) count;
    }

    synchronized String get(String id, String hash) {
        purgeExpired();
        Entry entry = entries.get(id);
        return entry == null ? null : entry.bodies().get(hash);
    }

    synchronized void remove(String id) {
        Entry removed = entries.remove(id);
        if (removed != null) characters -= removed.characters();
    }

    synchronized void removeConversation(String conversationId) {
        entries.entrySet().removeIf(entry -> {
            if (!entry.getValue().conversationId().equals(conversationId)) return false;
            characters -= entry.getValue().characters();
            return true;
        });
    }

    synchronized void purgeExpired() {
        long now = clock.getAsLong();
        entries.entrySet().removeIf(entry -> {
            if (entry.getValue().expiresAt() > now) return false;
            characters -= entry.getValue().characters();
            return true;
        });
    }
}
