// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.dd;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.service.DdWorkflowService;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.account.AccountService;
import com.checkba.service.messagecenter.MessageCenterSource;
import com.checkba.version.CloudSyncService;
import com.checkba.version.OfficialCloudService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;
import java.util.*;

/** Local and independently hosted case libraries keep their own identity namespace. */
@Component
@lombok.RequiredArgsConstructor
public class DdLibraryMessageCenterSource implements MessageCenterSource {
    private final DdWorkflowService workflow;
    private final ProjectRepository projects;
    private final ProjectRemoteRepository remotes;
    private final CloudConnectionRepository connections;
    private final ProjectMemberService permissions;
    private final AccountService account;
    private final OfficialCloudService official;
    private final CloudSyncService cloud;
    private final ObjectMapper mapper;
    public String id() { return "dd-library"; }
    public boolean localOnly() { return true; }
    public Snapshot list(Long userId, int limit) {
        String scope = account.accountFingerprintOrNull();
        List<Entry> rows = new ArrayList<>();
        List<String> unavailable = new ArrayList<>();
        boolean hasMore = false;
        try {
            List<Entry> localEntries = new DdMessageCenterSource(workflow, projects).allEntries(userId);
            hasMore = localEntries.size() >= 200;
            for (Entry entry : localEntries) {
                if (remotes.findByProjectId(entry.projectId()).isEmpty()) rows.add(new Entry("local:" + entry.id(), id(), entry.sourceName(),
                    entry.kind(), entry.title(), entry.body(), entry.projectId(), "local-project:" + entry.projectId(), entry.projectName(),
                    entry.createdAt(), entry.readAt(), entry.actionState(), entry.target()));
            }
        } catch (RuntimeException e) { unavailable.add("local"); }
        for (ProjectRemote remote : remotes.findAll()) {
            try {
                CloudConnection connection = connections.findById(remote.getConnectionId()).orElse(null);
                if (!authorized(userId, scope, remote, connection) || isOfficial(connection)) continue;
                Project project = projects.findById(remote.getProjectId()).orElse(null);
                if (project == null) continue;
                List<Map<String,Object>> notifications = remoteNotifications(userId, scope, remote);
                List<Entry> projectEntries = new ArrayList<>();
                for (Map<String,Object> n : notifications) {
                    projectEntries.add(new Entry(remote.getProjectId() + ":" + n.get("id"), id(), com.checkba.service.LangText.of("案件库 · 客户尽调", "Case Library · Due Diligence"), Objects.toString(n.get("kind"), "NOTICE"),
                        Objects.toString(n.get("title"), com.checkba.service.LangText.of("尽调通知", "Due Diligence Notice")), "", remote.getProjectId(), "local-project:" + remote.getProjectId(), project.getName(),
                        DdMessageCenterSupport.instant(n, "createdAt"), DdMessageCenterSupport.instant(n, "readAt"),
                        Objects.toString(n.get("actionState"), "none"), target(remote.getProjectId(), n), DdMessageCenterSupport.read(n)));
                }
                rows.addAll(projectEntries);
                hasMore |= notifications.size() >= 100;
            } catch (RuntimeException e) { unavailable.add(String.valueOf(remote.getProjectId())); }
        }
        requireCurrent(scope);
        rows.sort(Comparator.comparing(Entry::createdAt, Comparator.nullsLast(Comparator.reverseOrder())));
        return new Snapshot(rows.stream().limit(limit).toList(), rows.stream().filter(e -> !e.read()).count(),
                rows.stream().filter(e -> "pending".equals(e.actionState())).count(), unavailable, hasMore || rows.size() > limit);
    }
    public void markRead(Long userId, String itemId) {
        if (itemId.startsWith("local:")) { requireLocal(userId, itemId); workflow.markRead(Long.valueOf(itemId.substring(6)), userId); return; }
        String scope = account.accountFingerprintOrNull(); String[] parts = parts(itemId);
        ProjectRemote remote = remote(userId, scope, Long.valueOf(parts[0]));
        requireNotification(userId, scope, remote, parts[1]);
        CloudSyncService.RawResponse reply = cloud.proxyDd(remote.getProjectId(), "POST", "/notifications/" + parts[1] + "/read", "", "{}".getBytes(java.nio.charset.StandardCharsets.UTF_8), "application/json");
        requireCurrent(scope); DdMessageCenterSupport.requireReadReceipt(reply.status(), reply.body(), parts[1]);
    }
    public Map<String,Object> target(Long userId, String itemId) {
        if (itemId.startsWith("local:")) return requireLocal(userId, itemId).target();
        String scope = account.accountFingerprintOrNull(); String[] parts = parts(itemId);
        ProjectRemote remote = remote(userId, scope, Long.valueOf(parts[0]));
        Map<String,Object> n = requireNotification(userId, scope, remote, parts[1]);
        requireCurrent(scope); return target(remote.getProjectId(), n);
    }
    private Entry requireLocal(Long userId, String itemId) {
        return new DdMessageCenterSource(workflow, projects).allEntries(userId).stream()
                .filter(e -> itemId.equals("local:" + e.id()) && remotes.findByProjectId(e.projectId()).isEmpty()).findFirst().orElseThrow(this::unavailable);
    }
    private ProjectRemote remote(Long userId, String scope, Long projectId) {
        ProjectRemote remote = remotes.findByProjectId(projectId).orElseThrow(this::unavailable);
        if (!authorized(userId, scope, remote, connections.findById(remote.getConnectionId()).orElse(null))) throw unavailable();
        return remote;
    }
    private boolean authorized(Long userId, String scope, ProjectRemote remote, CloudConnection connection) {
        return connection != null && Objects.equals(connection.getUserId(), userId)
                && (connection.getAccountFingerprint() == null || Objects.equals(scope, connection.getAccountFingerprint()))
                && permissions.hasReadPermission(remote.getProjectId(), userId) && !permissions.isClient(remote.getProjectId(), userId);
    }
    private boolean isOfficial(CloudConnection connection) {
        return Objects.equals(trim(connection.getServerUrl()), trim(official.officialBaseUrl()));
    }
    private String trim(String value) { return value == null ? null : value.replaceAll("/+$", ""); }
    private List<Map<String,Object>> remoteNotifications(Long userId, String scope, ProjectRemote remote) {
        remote(userId, scope, remote.getProjectId());
        CloudSyncService.RawResponse reply = cloud.proxyDd(remote.getProjectId(), "GET", "/notifications", "", null, null);
        requireCurrent(scope); if (reply.status() != 200) throw unavailable();
        try { return mapper.readValue(reply.body(), new TypeReference<List<Map<String,Object>>>() {}); }
        catch (java.io.IOException e) { throw unavailable(); }
    }
    private Map<String,Object> requireNotification(Long userId, String scope, ProjectRemote remote, String id) {
        return remoteNotifications(userId, scope, remote).stream().filter(n -> id.equals(String.valueOf(n.get("id")))).findFirst().orElseThrow(this::unavailable);
    }
    private Map<String,Object> target(Long projectId, Map<String,Object> n) {
        Map<String,Object> value = new LinkedHashMap<>(); value.put("kind", "dd"); value.put("projectId", projectId);
        value.put("requestId", n.get("requestId")); if (n.get("itemId") != null) value.put("itemId", n.get("itemId")); return value;
    }
    private String[] parts(String value) {
        if (value == null || !value.matches("[1-9][0-9]{0,18}:[1-9][0-9]{0,18}")) throw unavailable(); return value.split(":", 2);
    }
    private void requireCurrent(String scope) { if (!Objects.equals(scope, account.accountFingerprintOrNull())) throw new IllegalArgumentException(com.checkba.service.LangText.of("账户已变化，请重新打开消息中心", "Account has changed; please reopen the Message Center")); }
    private IllegalArgumentException unavailable() { return new IllegalArgumentException(com.checkba.service.LangText.of("案件库通知暂不可用，或已失去该项目权限", "Case library notifications are temporarily unavailable or project access has been lost")); }
}
