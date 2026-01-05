package com.checkba.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.Type;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * 结构化记忆条目实体
 * 存储决策、结论、事实、法律引用等
 */
@Entity
@Table(name = "memory_entry", indexes = {
    @Index(name = "idx_memory_project", columnList = "project_id"),
    @Index(name = "idx_memory_type", columnList = "memory_type"),
    @Index(name = "idx_memory_key", columnList = "memory_key"),
    @Index(name = "idx_memory_conversation", columnList = "conversation_id")
})
public class MemoryEntry {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 项目ID
     */
    @Column(name = "project_id")
    private Long projectId;

    /**
     * 用户ID
     */
    @Column(name = "user_id")
    private Long userId;

    /**
     * 对话ID
     */
    @Column(name = "conversation_id", length = 100)
    private String conversationId;

    /**
     * 记忆类型
     * decision: 决策
     * conclusion: 结论
     * fact: 事实
     * reference: 法律引用
     * preference: 用户偏好
     */
    @Column(name = "memory_type", nullable = false, length = 50)
    private String memoryType;

    /**
     * 记忆关键词/标题
     */
    @Column(name = "memory_key", length = 200)
    private String memoryKey;

    /**
     * 记忆内容
     */
    @Column(name = "memory_value", columnDefinition = "TEXT", nullable = false)
    private String memoryValue;

    /**
     * 额外元数据（JSON格式）
     */
    @Type(JsonType.class)
    @Column(name = "metadata", columnDefinition = "jsonb")
    private Map<String, Object> metadata;

    /**
     * 重要性分数 (0-1)
     */
    @Column(name = "importance_score")
    private Double importanceScore = 0.5;

    /**
     * 是否受保护（法律关键信息）
     * 受保护的记忆在压缩时不会被删除
     */
    @Column(name = "is_protected")
    private Boolean isProtected = false;

    /**
     * 过期时间（可选）
     */
    @Column(name = "expires_at")
    private LocalDateTime expiresAt;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    public MemoryEntry() {}

    public MemoryEntry(Long id, Long projectId, Long userId, String conversationId, String memoryType, String memoryKey, String memoryValue, Map<String, Object> metadata, Double importanceScore, Boolean isProtected, LocalDateTime expiresAt, LocalDateTime createdAt, LocalDateTime updatedAt) {
        this.id = id;
        this.projectId = projectId;
        this.userId = userId;
        this.conversationId = conversationId;
        this.memoryType = memoryType;
        this.memoryKey = memoryKey;
        this.memoryValue = memoryValue;
        this.metadata = metadata;
        this.importanceScore = importanceScore;
        this.isProtected = isProtected;
        this.expiresAt = expiresAt;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }

    // Getters and Setters
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getProjectId() { return projectId; }
    public void setProjectId(Long projectId) { this.projectId = projectId; }
    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }
    public String getConversationId() { return conversationId; }
    public void setConversationId(String conversationId) { this.conversationId = conversationId; }
    public String getMemoryType() { return memoryType; }
    public void setMemoryType(String memoryType) { this.memoryType = memoryType; }
    public String getMemoryKey() { return memoryKey; }
    public void setMemoryKey(String memoryKey) { this.memoryKey = memoryKey; }
    public String getMemoryValue() { return memoryValue; }
    public void setMemoryValue(String memoryValue) { this.memoryValue = memoryValue; }
    public Map<String, Object> getMetadata() { return metadata; }
    public void setMetadata(Map<String, Object> metadata) { this.metadata = metadata; }
    public Double getImportanceScore() { return importanceScore; }
    public void setImportanceScore(Double importanceScore) { this.importanceScore = importanceScore; }
    public Boolean getIsProtected() { return isProtected; }
    public void setIsProtected(Boolean isProtected) { this.isProtected = isProtected; }
    public LocalDateTime getExpiresAt() { return expiresAt; }
    public void setExpiresAt(LocalDateTime expiresAt) { this.expiresAt = expiresAt; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }

    public static MemoryEntryBuilder builder() {
        return new MemoryEntryBuilder();
    }

    public static class MemoryEntryBuilder {
        private Long id;
        private Long projectId;
        private Long userId;
        private String conversationId;
        private String memoryType;
        private String memoryKey;
        private String memoryValue;
        private Map<String, Object> metadata;
        private Double importanceScore = 0.5;
        private Boolean isProtected = false;
        private LocalDateTime expiresAt;
        private LocalDateTime createdAt;
        private LocalDateTime updatedAt;

        public MemoryEntryBuilder id(Long id) { this.id = id; return this; }
        public MemoryEntryBuilder projectId(Long projectId) { this.projectId = projectId; return this; }
        public MemoryEntryBuilder userId(Long userId) { this.userId = userId; return this; }
        public MemoryEntryBuilder conversationId(String conversationId) { this.conversationId = conversationId; return this; }
        public MemoryEntryBuilder memoryType(String memoryType) { this.memoryType = memoryType; return this; }
        public MemoryEntryBuilder memoryKey(String memoryKey) { this.memoryKey = memoryKey; return this; }
        public MemoryEntryBuilder memoryValue(String memoryValue) { this.memoryValue = memoryValue; return this; }
        public MemoryEntryBuilder metadata(Map<String, Object> metadata) { this.metadata = metadata; return this; }
        public MemoryEntryBuilder importanceScore(Double importanceScore) { this.importanceScore = importanceScore; return this; }
        public MemoryEntryBuilder isProtected(Boolean isProtected) { this.isProtected = isProtected; return this; }
        public MemoryEntryBuilder expiresAt(LocalDateTime expiresAt) { this.expiresAt = expiresAt; return this; }
        public MemoryEntryBuilder createdAt(LocalDateTime createdAt) { this.createdAt = createdAt; return this; }
        public MemoryEntryBuilder updatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; return this; }

        public MemoryEntry build() {
            return new MemoryEntry(id, projectId, userId, conversationId, memoryType, memoryKey, memoryValue, metadata, importanceScore, isProtected, expiresAt, createdAt, updatedAt);
        }
    }

    /**
     * 记忆类型枚举
     */
    public static class MemoryType {
        public static final String DECISION = "decision";
        public static final String CONCLUSION = "conclusion";
        public static final String FACT = "fact";
        public static final String REFERENCE = "reference";
        public static final String PREFERENCE = "preference";
    }
}

