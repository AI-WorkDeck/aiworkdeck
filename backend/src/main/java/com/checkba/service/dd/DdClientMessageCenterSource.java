// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.dd;

import com.checkba.service.DdClientConnectionService;
import com.checkba.service.messagecenter.MessageCenterSource;
import org.springframework.stereotype.Component;
import java.util.*;

/** Local connection identifiers remain local; remote numeric identities are never merged by name. */
@Component
@lombok.RequiredArgsConstructor
public class DdClientMessageCenterSource implements MessageCenterSource {
    private final DdClientConnectionService connections;
    public String id() { return "dd-client"; }
    public boolean localOnly() { return true; }
    public Snapshot list(Long userId, int limit) {
        List<Entry> entries = new ArrayList<>();
        List<String> unavailable = new ArrayList<>();
        boolean hasMore = false;
        for (Map<String,Object> connection : connections.list(userId)) {
            String connectionId = String.valueOf(connection.get("id"));
            try {
                List<Map<String,Object>> notifications = connections.notifications(userId, connectionId);
                List<Entry> connectionEntries = new ArrayList<>();
                for (Map<String,Object> n : notifications) {
                    connectionEntries.add(new Entry(connectionId + ":" + n.get("id"), id(), com.checkba.service.LangText.of("受邀项目 · 客户尽调", "Invited Project · Due Diligence"),
                        Objects.toString(n.get("kind"), "NOTICE"), Objects.toString(n.get("title"), com.checkba.service.LangText.of("尽调通知", "Due Diligence Notice")), "",
                        number(connection.get("projectId")), "dd-client:" + connectionId, String.valueOf(connection.get("name")),
                        DdMessageCenterSupport.instant(n, "createdAt"), DdMessageCenterSupport.instant(n, "readAt"),
                        Objects.toString(n.get("actionState"), "none"), target(connection, n), DdMessageCenterSupport.read(n)));
                }
                entries.addAll(connectionEntries);
                hasMore |= notifications.size() >= 100;
            } catch (RuntimeException e) { unavailable.add(connectionId); }
        }
        entries.sort(Comparator.comparing(Entry::createdAt, Comparator.nullsLast(Comparator.reverseOrder())));
        return new Snapshot(entries.stream().limit(limit).toList(), entries.stream().filter(e -> !e.read()).count(),
                entries.stream().filter(e -> "pending".equals(e.actionState())).count(), unavailable, hasMore || entries.size() > limit);
    }
    public void markRead(Long userId, String itemId) {
        String[] parts = parts(itemId);
        DdClientConnectionService.Reply reply = connections.proxy(userId, parts[0], "POST", "/notifications/" + parts[1] + "/read", null, DdClientConnectionService.jsonBody(Map.of()));
        DdMessageCenterSupport.requireReadReceipt(reply.status(), reply.body(), parts[1]);
    }
    public Map<String,Object> target(Long userId, String itemId) {
        String[] parts = parts(itemId);
        Map<String,Object> connection = connections.list(userId).stream().filter(c -> parts[0].equals(c.get("id"))).findFirst()
                .orElseThrow(() -> new IllegalArgumentException(com.checkba.service.LangText.of("受邀项目连接已失效", "Invited project connection has expired")));
        Map<String,Object> n = connections.notifications(userId, parts[0]).stream().filter(row -> parts[1].equals(String.valueOf(row.get("id")))).findFirst()
                .orElseThrow(() -> new IllegalArgumentException(com.checkba.service.LangText.of("通知不存在或已失去项目权限", "Notification not found or project access lost")));
        connections.proxy(userId, parts[0], "GET", "/requests/" + number(n.get("requestId")), null, null);
        return target(connection, n);
    }
    public List<Map<String,Object>> conversations(Long userId) {
        return conversationSnapshot(userId).items();
    }
    public ConversationSnapshot conversationSnapshot(Long userId) {
        List<Map<String,Object>> rows = new ArrayList<>();
        List<String> unavailable = new ArrayList<>();
        for (Map<String,Object> connection : connections.list(userId)) {
            String id = String.valueOf(connection.get("id"));
            try {
                @SuppressWarnings("unchecked") Map<String,Object> group = (Map<String,Object>)connections.im(userId, id, "projectGroup", Map.of());
                Map<String,Object> view = new LinkedHashMap<>(group); view.put("connectionId", id); view.put("sourceId", id());
                view.put("projectKey", "dd-client:" + id); view.put("projectName", connection.get("name")); rows.add(view);
            } catch (RuntimeException e) { unavailable.add(id); }
        }
        return new ConversationSnapshot(rows, unavailable);
    }
    public Object im(Long userId, String action, Map<String,Object> params) {
        return connections.im(userId, Objects.toString(params.get("connectionId"), ""), action, params);
    }
    private Map<String,Object> target(Map<String,Object> connection, Map<String,Object> n) {
        Map<String,Object> target = new LinkedHashMap<>(); target.put("kind", "dd-client");
        target.put("connectionId", connection.get("id")); target.put("projectId", connection.get("projectId"));
        target.put("requestId", n.get("requestId")); if (n.get("itemId") != null) target.put("itemId", n.get("itemId")); return target;
    }
    private String[] parts(String value) {
        if (value == null || !value.matches("[a-f0-9-]{36}:[1-9][0-9]{0,18}")) throw new IllegalArgumentException(com.checkba.service.LangText.of("通知编号无效", "Invalid notification ID"));
        return value.split(":", 2);
    }
    static Long number(Object value) { return value instanceof Number n ? n.longValue() : Long.valueOf(String.valueOf(value)); }
}
