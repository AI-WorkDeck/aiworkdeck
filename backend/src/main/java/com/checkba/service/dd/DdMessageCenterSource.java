// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.dd;

import com.checkba.model.entity.DdNotification;
import com.checkba.repository.ProjectRepository;
import com.checkba.service.DdWorkflowService;
import com.checkba.service.messagecenter.MessageCenterSource;
import org.springframework.stereotype.Component;
import java.time.ZoneId;
import java.util.*;

/** The existing DD workflow owns both delivery and decisions; this is only an inbox projection. */
@Component
@lombok.RequiredArgsConstructor
public class DdMessageCenterSource implements MessageCenterSource {
    private final DdWorkflowService workflow;
    private final ProjectRepository projects;
    public String id() { return "dd"; }
    public Snapshot list(Long userId, int limit) {
        List<Entry> entries = allEntries(userId);
        return new Snapshot(entries.stream().limit(Math.max(1, Math.min(200, limit))).toList(),
                entries.stream().filter(e -> !e.read()).count(),
                entries.stream().filter(e -> "pending".equals(e.actionState())).count(), List.of(), entries.size() >= 200 || entries.size() > limit);
    }
    List<Entry> allEntries(Long userId) {
        return workflow.accountInbox(userId).stream().map(n ->
                new Entry(n.getId().toString(), id(), "客户尽调", n.getKind(), n.getTitle(), "",
                        n.getProjectId(), "project:" + n.getProjectId(), projects.findById(n.getProjectId())
                            .map(p -> Objects.toString(p.getName(), "项目")).orElse("项目"),
                        n.getCreatedAt().atZone(ZoneId.systemDefault()).toInstant(), n.getReadAt() == null ? null
                            : n.getReadAt().atZone(ZoneId.systemDefault()).toInstant(), n.getActionState(), target(n))).toList();
    }
    public void markRead(Long userId, String itemId) { require(userId, itemId); workflow.markRead(Long.valueOf(itemId), userId); }
    public Map<String,Object> target(Long userId, String itemId) { return target(require(userId, itemId)); }
    private DdNotification require(Long userId, String id) {
        return workflow.accountInbox(userId).stream().filter(n -> n.getId().toString().equals(id)).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("通知不存在或已失去项目权限"));
    }
    private Map<String,Object> target(DdNotification n) {
        Map<String,Object> target = new LinkedHashMap<>(); target.put("kind", "dd");
        target.put("projectId", n.getProjectId()); target.put("requestId", n.getRequestId());
        if (n.getItemId() != null) target.put("itemId", n.getItemId());
        return target;
    }
}
