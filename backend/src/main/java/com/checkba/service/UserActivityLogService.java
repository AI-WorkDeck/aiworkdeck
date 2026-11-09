// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service;

import com.checkba.model.entity.Project;
import com.checkba.model.entity.UserActivityLog;
import com.checkba.repository.ProjectRepository;
import com.checkba.repository.UserActivityLogRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class UserActivityLogService {

    /** 用户活动与内容安全审计共用 180 天保留窗口；每日任务删除超过窗口的记录。 */
    static final long RETENTION_DAYS = 180;

    private final UserActivityLogRepository repository;
    private final ProjectRepository projectRepository;

    /** Server-observed network metadata plus the client User-Agent; never includes request content. */
    public record RequestMetadata(String sourceAddress, Integer sourcePort, String deviceCharacteristics) {}

    public void logActivity(Long userId, String actionType, Long targetId, String targetName, Long duration, String metaInfo, Long projectId) {
        logActivity(userId, actionType, targetId, targetName, duration, metaInfo, projectId, null);
    }

    public void logActivity(Long userId, String actionType, Long targetId, String targetName, Long duration,
                            String metaInfo, Long projectId, RequestMetadata request) {
        UserActivityLog log = new UserActivityLog();
        log.setUserId(userId);
        log.setActionType(actionType);
        log.setTargetId(targetId);
        log.setTargetName(targetName);
        log.setDuration(duration);
        log.setMetaInfo(metaInfo);
        log.setProjectId(projectId);
        if (request != null) {
            log.setSourceAddress(trim(request.sourceAddress(), 128));
            log.setSourcePort(request.sourcePort());
            log.setDeviceCharacteristics(trim(request.deviceCharacteristics(), 512));
        }
        repository.save(log);
    }

    private static String trim(String value, int max) {
        if (value == null) return null;
        String cleaned = value.replaceAll("[\\p{Cntrl}]", " ").trim();
        return cleaned.length() > max ? cleaned.substring(0, max) : cleaned;
    }

    // 按 projectId 批量补 projectName（一次 IN 查询，不逐条查）；查不到的（项目已删除）
    // 与老数据没有 projectId 的，projectName 都留空，前端归到「未关联项目」。
    public List<UserActivityLog> getUserLogs(Long userId) {
        List<UserActivityLog> logs = repository.findTop500ByUserIdOrderByTimestampDesc(userId);

        List<Long> projectIds = logs.stream()
                .map(UserActivityLog::getProjectId)
                .filter(id -> id != null)
                .distinct()
                .collect(Collectors.toList());

        if (!projectIds.isEmpty()) {
            Map<Long, String> nameById = projectRepository.findAllById(projectIds).stream()
                    .collect(Collectors.toMap(Project::getId, Project::getName));
            logs.forEach(log -> {
                if (log.getProjectId() != null) {
                    log.setProjectName(nameById.get(log.getProjectId()));
                }
            });
        }

        return logs;
    }

    /**
     * 定时清理超出保留窗口的活动日志——此前这张表没有 TTL/归档/@Scheduled 清理，
     * 行数随全量历史使用单调增长（不止活跃用户，所有历史用户都在贡献行数）。
     * 写法与同一份代码里 UserSessionService.purgeExpired() 一致。
     */
    @Scheduled(fixedDelay = 24 * 60 * 60 * 1000, initialDelay = 15 * 60 * 1000)
    public void purgeOld() {
        long removed = repository.deleteByTimestampBefore(LocalDateTime.now().minusDays(RETENTION_DAYS));
        if (removed > 0) {
            log.info("清理过期用户活动日志 {} 条", removed);
        }
    }
}
