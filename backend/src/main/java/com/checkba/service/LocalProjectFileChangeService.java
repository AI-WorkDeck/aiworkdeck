// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service;

import com.checkba.repository.ProjectRepository;
import jakarta.annotation.PreDestroy;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** 本机项目对账完成的门铃；不依赖 AI 会话，不发送文件名或磁盘路径。 */
@Service
public class LocalProjectFileChangeService {
    private record Subscription(Long projectId, Long userId) {}

    private final ProjectRepository projects;
    private final ProjectMemberService members;
    private final ProjectFileAccessService fileAccess;
    private final Map<SseEmitter, Subscription> subscriptions = new ConcurrentHashMap<>();

    public LocalProjectFileChangeService(ProjectRepository projects, ProjectMemberService members,
                                         ProjectFileAccessService fileAccess) {
        this.projects = projects;
        this.members = members;
        this.fileAccess = fileAccess;
    }

    public boolean canSubscribe(Long projectId, Long userId) {
        return userId != null && members.hasReadPermission(projectId, userId)
                && !fileAccess.isClient(projectId, userId)
                && projects.findById(projectId).map(p -> StringUtils.hasText(p.getLocalRoot())).orElse(false);
    }

    public SseEmitter connect(Long projectId, Long userId) {
        SseEmitter emitter = new SseEmitter(0L);
        Subscription subscription = new Subscription(projectId, userId);
        subscriptions.put(emitter, subscription);
        emitter.onCompletion(() -> subscriptions.remove(emitter));
        emitter.onTimeout(() -> close(emitter));
        emitter.onError(error -> subscriptions.remove(emitter));
        // 先登记再 ready：客户端补读一次，覆盖建立连接前/重连期间发生的对账。
        send(emitter, subscription, "ready");
        return emitter;
    }

    public void filesChanged(Long projectId) {
        subscriptions.forEach((emitter, subscription) -> {
            if (subscription.projectId().equals(projectId)) send(emitter, subscription, "files_changed");
        });
    }

    @Scheduled(fixedDelay = 15_000)
    public void ping() {
        subscriptions.forEach((emitter, subscription) -> send(emitter, subscription, "ping"));
    }

    private void send(SseEmitter emitter, Subscription subscription, String event) {
        try {
            // 长连接不能在项目权限已撤销之后继续收到活动信号。
            if (!canSubscribe(subscription.projectId(), subscription.userId())) {
                close(emitter);
                return;
            }
            emitter.send(SseEmitter.event().name(event).data(Map.of("projectId", subscription.projectId())));
        } catch (Exception e) {
            close(emitter);
        }
    }

    private void close(SseEmitter emitter) {
        subscriptions.remove(emitter);
        try { emitter.complete(); } catch (Exception ignored) { }
    }

    @PreDestroy
    public void shutdown() {
        subscriptions.keySet().forEach(this::close);
    }
}
