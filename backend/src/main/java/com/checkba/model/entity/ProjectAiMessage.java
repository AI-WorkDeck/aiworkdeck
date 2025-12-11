package com.checkba.model.entity;

import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 项目内 AI 对话消息，用于后续做历史聊天记录 / 上下文管理。
 */
@Data
@Entity
@Table(name = "project_ai_message")
public class ProjectAiMessage {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 项目 ID
     */
    @Column(nullable = false)
    private Long projectId;

    /**
     * 消息角色：USER / ASSISTANT
     */
    @Column(length = 16, nullable = false)
    private String role;

    /**
     * 消息内容（支持 markdown）
     */
    @Column(columnDefinition = "TEXT", nullable = false)
    private String content;

    /**
     * 关联的会话分组 ID（预留，便于以后做多会话）
     */
    @Column(length = 64)
    private String conversationId;

    @Column
    private LocalDateTime createdAt;
}


