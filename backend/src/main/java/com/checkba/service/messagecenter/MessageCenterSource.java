// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.messagecenter;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/** Projection of an existing authoritative workflow. Reading never completes its business action. */
public interface MessageCenterSource {
    String id();
    default boolean localOnly() { return false; }
    Snapshot list(Long userId, int limit);
    void markRead(Long userId, String itemId);
    Map<String, Object> target(Long userId, String itemId);
    default List<Map<String,Object>> conversations(Long userId) { return List.of(); }
    default ConversationSnapshot conversationSnapshot(Long userId) {
        return new ConversationSnapshot(conversations(userId), List.of());
    }
    default Object im(Long userId, String action, Map<String,Object> params) {
        throw new IllegalArgumentException(com.checkba.service.LangText.of("此来源不提供项目沟通", "This source does not provide Project IM"));
    }
    record Entry(String id, String sourceId, String sourceName, String kind, String title, String body,
                 Long projectId, String projectKey, String projectName, Instant createdAt, Instant readAt,
                 String actionState, Map<String, Object> target, boolean read) {
        public Entry(String id, String sourceId, String sourceName, String kind, String title, String body,
                     Long projectId, String projectKey, String projectName, Instant createdAt, Instant readAt,
                     String actionState, Map<String,Object> target) {
            this(id,sourceId,sourceName,kind,title,body,projectId,projectKey,projectName,createdAt,readAt,actionState,target,readAt!=null);
        }
    }
    record Snapshot(List<Entry> items, long unread, long pending, List<String> unavailableSources, boolean hasMore) {
        public Snapshot(List<Entry> items,long unread,long pending) { this(items,unread,pending,List.of(),false); }
    }
    record ConversationSnapshot(List<Map<String,Object>> items,List<String> unavailableSources) {}
}
