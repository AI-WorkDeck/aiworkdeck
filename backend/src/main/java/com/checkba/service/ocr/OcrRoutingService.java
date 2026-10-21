// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ocr;

import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.*;
import com.checkba.service.ai.EditorBridgeService;
import com.checkba.service.ai.PlatformAiUserScope;
import com.checkba.service.ai.tools.ToolContextHolder;
import org.springframework.stereotype.Service;
import java.nio.file.*;
import java.time.*;
import java.util.*;

/** User choices come only from authenticated UI requests, never model tool parameters. */
@Service
public class OcrRoutingService {
    public static final String VERSION = "2026-10-21";
    public static final String NOTICE = "云端识别会将这份文档的页面图片发送至阿里云 OCR；平台通道按识别页数消耗 Credits，自备服务按供应商规则计费。结果为识别内容，不保证保留原版布局。";
    public enum Route { ASK, LOCAL, CLOUD, CANCELLED }
    private record Scope(Long user, String conversation, Long project, Long file, String stamp) {}
    private static final class Decision {
        final String id = UUID.randomUUID().toString();
        final Scope scope;
        final Instant expires;
        final boolean localAvailable;
        Route choice = Route.ASK;
        boolean remembered;
        boolean cancelled;
        final String offeredRun = currentRun();
        String authorizedRun;
        Decision(Scope scope, Instant expires, boolean localAvailable) {
            this.scope = scope; this.expires = expires; this.localAvailable = localAvailable;
        }
    }
    private final SystemSettingService settings;
    private final ProjectAiMessageService messages;
    private final ProjectFileAccessService access;
    private final ProjectFileRepository files;
    private final EditorBridgeService bridge;
    private final Clock clock;
    private final Map<Scope, Decision> decisions = new HashMap<>();
    private final Map<String, Decision> superseded = new HashMap<>();

    @org.springframework.beans.factory.annotation.Autowired
    public OcrRoutingService(SystemSettingService settings, ProjectAiMessageService messages,
            ProjectFileAccessService access, ProjectFileRepository files, EditorBridgeService bridge) {
        this(settings, messages, access, files, bridge, Clock.systemUTC());
    }
    OcrRoutingService(SystemSettingService settings, ProjectAiMessageService messages,
            ProjectFileAccessService access, ProjectFileRepository files, EditorBridgeService bridge, Clock clock) {
        this.settings = settings; this.messages = messages; this.access = access;
        this.files = files; this.bridge = bridge; this.clock = clock;
    }
    private String key(Long user) {
        if (user == null || user <= 0) throw new IllegalArgumentException("无法确认当前用户，请重新打开会话");
        return "user." + user + ".ocr.fallback";
    }
    public Map<String, Object> preference(Long user) {
        String key = key(user);
        String value = settings.get(key, "ask");
        if ("cloud".equals(value) && !VERSION.equals(settings.get(key + ".version", ""))) value = "ask";
        if (!Set.of("ask", "cloud", "local").contains(value)) value = "ask";
        return Map.of("choice", value, "notice", NOTICE, "version", VERSION);
    }
    public synchronized void savePreference(Long user, String choice, String version) {
        if (!Set.of("ask", "cloud", "local").contains(choice)) throw new IllegalArgumentException("识别方式无效");
        if ("cloud".equals(choice) && !VERSION.equals(version)) throw new IllegalArgumentException("识别说明已更新，请重新确认");
        String key = key(user);
        if (!"cloud".equals(choice)) decisions.values().stream().filter(d -> d.scope.user().equals(user) && d.choice == Route.CLOUD).forEach(d -> d.choice = Route.ASK);
        settings.setMany(Map.of(key, choice, key + ".version", VERSION, key + ".at", clock.instant().toString()));
    }
    private Scope scope(ProjectFile file, Path path) throws Exception {
        Long user = PlatformAiUserScope.current();
        key(user);
        String conversation = bridge.getCurrentConversationId();
        if (!messages.isConversationOwnedBy(conversation, user)) throw new IllegalArgumentException("当前会话不可用");
        access.requireRead(file, user);
        return new Scope(user, conversation, file.getProjectId(), file.getId(),
                path.toRealPath() + ":" + Files.size(path) + ":" + Files.getLastModifiedTime(path).toMillis());
    }
    private static String currentRun() {
        var context = ToolContextHolder.get();
        return context == null ? null : context.runId();
    }
    private void expire() {
        decisions.values().removeIf(d -> !d.expires.isAfter(clock.instant()));
        superseded.values().removeIf(d -> !d.expires.isAfter(clock.instant()));
    }
    private boolean cancelledRun(Decision decision) {
        String run = currentRun();
        return decision.cancelled && (run == null || Objects.equals(run, decision.offeredRun)
                || Objects.equals(run, decision.authorizedRun));
    }
    public synchronized Route route(ProjectFile file, Path path) throws Exception {
        Scope scope = scope(file, path); expire();
        if (java.util.stream.Stream.concat(decisions.values().stream(), superseded.values().stream())
                .anyMatch(d -> d.scope.user().equals(scope.user()) && d.scope.conversation().equals(scope.conversation())
                        && d.scope.file().equals(scope.file()) && cancelledRun(d))) return Route.CANCELLED;
        Decision decision = decisions.get(scope);
        if (decision != null) {
            String run = currentRun();
            if (decision.cancelled) {
                // A fresh run may ask again, but cannot inherit cloud consent from the cancelled task.
                return cancelledRun(decision) ? Route.CANCELLED : Route.ASK;
            }
            if (decision.choice == Route.CLOUD) {
                if (decision.authorizedRun == null) decision.authorizedRun = run;
                else if (!Objects.equals(run, decision.authorizedRun)) return Route.ASK;
            }
            return decision.choice;
        }
        return Route.valueOf(preference(scope.user()).get("choice").toString().toUpperCase(Locale.ROOT));
    }
    public synchronized void requireCloudPermission(ProjectFile original, Path path) throws Exception {
        ProjectFile current = files.findById(original.getId()).orElseThrow(() -> new IllegalArgumentException("文件已不可用"));
        if (!Objects.equals(current.getProjectId(), original.getProjectId())) throw new IllegalArgumentException("文件项目已改变");
        if (route(current, path) != Route.CLOUD) throw new IllegalStateException("云端识别授权已撤回或过期，后续页面未上传");
    }
    public synchronized boolean cloudChosenForTask(ProjectFile file, Path path) throws Exception {
        Scope scope = scope(file, path); expire();
        Decision decision = decisions.get(scope);
        return decision != null && !decision.cancelled && decision.choice == Route.CLOUD
                && (decision.authorizedRun == null || Objects.equals(currentRun(), decision.authorizedRun));
    }
    public synchronized void offer(ProjectFile file, Path path, String reason, boolean localAvailable) throws Exception {
        Scope scope = scope(file, path); expire();
        // Supersede this file's earlier decisions, including a failed one-time cloud attempt.
        decisions.entrySet().removeIf(entry -> {
            Scope previous = entry.getKey();
            if (!previous.user().equals(scope.user()) || !previous.conversation().equals(scope.conversation()) || !previous.file().equals(scope.file())) return false;
            superseded.put(entry.getValue().id, entry.getValue());
            return true;
        });
        Decision decision = new Decision(scope, clock.instant().plus(Duration.ofMinutes(30)), localAvailable);
        decisions.put(scope, decision);
        bridge.sendOcrRouteRequiredAction(Map.of("decisionId", decision.id, "conversationId", scope.conversation(),
                "fileId", file.getId(), "reason", reason, "notice", NOTICE, "version", VERSION,
                "localAvailable", localAvailable));
    }
    public synchronized void choose(Long user, String conversation, String id, String choice, boolean remember, String version) {
        key(user); expire();
        Decision decision = decisions.values().stream().filter(d -> d.id.equals(id)).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("此选择已过期，请在原会话重新发起转换"));
        if (decision.cancelled) throw new IllegalArgumentException("此识别任务已取消，请重新选择识别方式");
        Scope s = decision.scope;
        if (!s.user().equals(user) || !s.conversation().equals(conversation)
                || !messages.isConversationOwnedBy(conversation, user)) throw new IllegalArgumentException("此选择不属于当前会话");
        ProjectFile file = files.findById(s.file()).orElseThrow(() -> new IllegalArgumentException("文件已不可用"));
        if (!Objects.equals(file.getProjectId(), s.project())) throw new IllegalArgumentException("文件项目已改变");
        access.requireRead(file, user);
        Route target = switch (choice) { case "cloud" -> Route.CLOUD; case "local" -> Route.LOCAL; default -> throw new IllegalArgumentException("识别方式无效"); };
        if (target == Route.CLOUD && !VERSION.equals(version)) throw new IllegalArgumentException("识别说明已更新，请重新确认");
        if (target == Route.LOCAL && !decision.localAvailable) throw new IllegalArgumentException("当前本地组件需要更新后才能继续");
        if (decision.choice != Route.ASK) {
            if (decision.choice != target || decision.remembered != remember) throw new IllegalArgumentException("此选择已经处理，请重新发起转换");
            return; // Duplicate UI clicks are idempotent.
        }
        if (remember) savePreference(user, choice, version);
        decision.choice = target;
        decision.remembered = remember;
    }
    /** Cancel only this task. Keep its nonce as a tombstone so a late choice cannot revive it. */
    public synchronized void cancel(Long user, String conversation, String id) {
        key(user); expire();
        Decision decision = decisions.values().stream().filter(d -> d.id.equals(id)).findFirst().orElse(null);
        if (decision == null) decision = superseded.get(id);
        if (decision == null) return; // Expired nonces already reject choose.
        if (!decision.scope.user().equals(user) || !decision.scope.conversation().equals(conversation)
                || !messages.isConversationOwnedBy(conversation, user)) throw new IllegalArgumentException("此选择不属于当前会话");
        decision.cancelled = true;
    }
    public synchronized void complete(ProjectFile file, Path path) throws Exception {
        Scope scope = scope(file, path);
        Decision decision = decisions.get(scope);
        if (decision != null && !decision.cancelled && (decision.authorizedRun == null
                || Objects.equals(currentRun(), decision.authorizedRun))) decisions.remove(scope);
    }
}
