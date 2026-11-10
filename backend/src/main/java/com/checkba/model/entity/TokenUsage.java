// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.model.entity;

import jakarta.persistence.*;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Objects;

/**
 * 记录每次 LLM 调用的 Token 消耗与预估费用。
 * 用于后续按用户/项目计费。
 */
@Entity
@Table(name = "token_usage")
public class TokenUsage {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column
    private Long userId;

    @Column
    private Long projectId;

    /**
     * 调用的模型名称 (e.g. "anthropic/claude-3.5-sonnet")
     */
    @Column(nullable = false)
    private String model;

    @Column(nullable = false)
    private Integer promptTokens;

    @Column(nullable = false)
    private Integer completionTokens;

    @Column(nullable = false)
    private Integer totalTokens;

    /**
     * 本次调用产生的费用（单位：美元或其他基准货币，保留6位小数）
     */
    @Column(precision = 19, scale = 6)
    private BigDecimal cost;

    /**
     * 本次调用 promptTokens 中命中提示缓存的部分（缓存读，约按输入价 1/10 计）。
     * 可空：历史行、上游没回缓存字段的通道为 null（与「命中 0」区分开）。ddl-auto 自动建列。
     */
    @Column
    private Integer cachedTokens;

    /** 本次调用写入提示缓存的 token 数（Anthropic/Qwen 显式缓存，约 1.25x 输入价）。可空，语义同 cachedTokens。 */
    @Column
    private Integer cacheWriteTokens;

    /**
     * cost 的口径（Spec §3「本地统计 vs 平台结算」两套数字必须分开标注）：
     * <ul>
     *   <li>{@code estimate}：BYOK 通道，按 {@code AllowedModels} 的单价表本地估算，不是真实账单；</li>
     *   <li>{@code platform}：平台通道，来自 OpenRouter 账户实际扣费，是真花的钱。</li>
     * </ul>
     * platform 行在对账完成前 cost 为 null——平台的钱不允许用估算值顶替。
     */
    @Column(length = 16)
    private String costSource;

    @Column(nullable = false)
    private LocalDateTime createdAt = LocalDateTime.now();
    
    /**
     * 关联的会话ID (可选)
     */
    @Column(length = 64)
    private String conversationId;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getUserId() {
        return userId;
    }

    public void setUserId(Long userId) {
        this.userId = userId;
    }

    public Long getProjectId() {
        return projectId;
    }

    public void setProjectId(Long projectId) {
        this.projectId = projectId;
    }

    public String getModel() {
        return model;
    }

    public void setModel(String model) {
        this.model = model;
    }

    public Integer getPromptTokens() {
        return promptTokens;
    }

    public void setPromptTokens(Integer promptTokens) {
        this.promptTokens = promptTokens;
    }

    public Integer getCompletionTokens() {
        return completionTokens;
    }

    public void setCompletionTokens(Integer completionTokens) {
        this.completionTokens = completionTokens;
    }

    public Integer getTotalTokens() {
        return totalTokens;
    }

    public void setTotalTokens(Integer totalTokens) {
        this.totalTokens = totalTokens;
    }

    public BigDecimal getCost() {
        return cost;
    }

    public void setCost(BigDecimal cost) {
        this.cost = cost;
    }

    public Integer getCachedTokens() {
        return cachedTokens;
    }

    public void setCachedTokens(Integer cachedTokens) {
        this.cachedTokens = cachedTokens;
    }

    public Integer getCacheWriteTokens() {
        return cacheWriteTokens;
    }

    public void setCacheWriteTokens(Integer cacheWriteTokens) {
        this.cacheWriteTokens = cacheWriteTokens;
    }

    public String getCostSource() {
        return costSource;
    }

    public void setCostSource(String costSource) {
        this.costSource = costSource;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }

    public String getConversationId() {
        return conversationId;
    }

    public void setConversationId(String conversationId) {
        this.conversationId = conversationId;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        TokenUsage that = (TokenUsage) o;
        return Objects.equals(id, that.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id);
    }
}
