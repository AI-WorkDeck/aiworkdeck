// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.repository;

import com.checkba.model.entity.UserActivityLog;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;

public interface UserActivityLogRepository extends JpaRepository<UserActivityLog, Long> {
    // 限制返回最近 500 条：活动日志随每次页面访问/开关文件持续增长，无界全量查询有 OOM/慢查询风险；
    // "最近动态"语义天然有界，500 条足够展示。
    List<UserActivityLog> findTop500ByUserIdOrderByTimestampDesc(Long userId);

    // 工作记录按日期范围查（[from, to)），条数由调用方的 Pageable 封顶（dev-board#1713）。
    List<UserActivityLog> findByUserIdAndTimestampGreaterThanEqualAndTimestampLessThanOrderByTimestampDesc(
            Long userId, LocalDateTime from, LocalDateTime to, Pageable pageable);

    // 保留窗口清理：该表此前没有 TTL/归档/@Scheduled 清理，行数随全量历史使用单调增长。
    // 见 UserActivityLogService.purgeOld()。
    long deleteByTimestampBefore(LocalDateTime cutoff);

    /** 律所客户档案「最近往来」：每个项目最后一条工作记录的时间，行为 [projectId, max(timestamp)]。 */
    @Query("select a.projectId, max(a.timestamp) from UserActivityLog a where a.projectId in :projectIds group by a.projectId")
    List<Object[]> latestTimestampByProjectIds(@Param("projectIds") java.util.Collection<Long> projectIds);
}
