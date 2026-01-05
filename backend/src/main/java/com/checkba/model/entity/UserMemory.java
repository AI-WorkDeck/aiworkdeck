package com.checkba.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.Type;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * 用户记忆实体
 * 存储用户级别的偏好和习惯
 */
@Entity
@Table(name = "user_memory")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UserMemory {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 用户ID（唯一）
     */
    @Column(name = "user_id", nullable = false, unique = true)
    private Long userId;

    /**
     * 用户偏好（JSON格式）
     */
    @Type(JsonType.class)
    @Column(name = "preferences", columnDefinition = "jsonb")
    private Map<String, String> preferences;

    /**
     * 常用表达（JSON格式）
     */
    @Type(JsonType.class)
    @Column(name = "frequent_phrases", columnDefinition = "jsonb")
    private List<String> frequentPhrases;

    /**
     * 工具使用统计（JSON格式）
     */
    @Type(JsonType.class)
    @Column(name = "tool_usage_stats", columnDefinition = "jsonb")
    private Map<String, Integer> toolUsageStats;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}

