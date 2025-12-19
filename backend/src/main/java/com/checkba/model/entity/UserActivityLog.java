package com.checkba.model.entity;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

/**
 * 用户活动日志实体
 * 用于记录用户行为，统计工作时间
 */
@Data
@Entity
@Table(name = "user_activity_log")
public class UserActivityLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    /**
     * 行为类型
     * - LOGIN: 登录
     * - OPEN_FILE: 打开文件
     * - CLOSE_FILE: 关闭文件
     * - PAGE_VIEW: 页面访问
     * - OPEN_URL: 打开网页
     * - CLOSE_URL: 关闭网页
     */
    @Column(name = "action_type", length = 64, nullable = false)
    private String actionType;

    /**
     * 目标 ID (projectId 或 fileId)
     * 可为空，取决于 actionType
     */
    @Column(name = "target_id")
    private Long targetId;
    
    /**
     * 目标名称 (文件名或项目名)
     * 可为空，取决于 actionType
     */
    @Column(name = "target_name", length = 512)
    private String targetName;

    /**
     * 发生时间
     */
    @CreationTimestamp
    @Column(nullable = false)
    private LocalDateTime timestamp;

    /**
     * 持续时间（秒）
     * 仅对 CLOSE_FILE / PAGE_VIEW 等结束事件有效，表示该次会话的持续时长
     */
    @Column
    private Long duration;
    
    /**
     * 附加信息 JSON
     */
    @Column(columnDefinition = "TEXT")
    private String metaInfo;
}
