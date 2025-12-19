package com.checkba.model.entity;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

/**
 * 尽调项评论实体
 * 用于律师和客户针对某一项文件进行沟通
 */
@Data
@Entity
@Table(name = "dd_comment")
public class DdComment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 所属清单项 ID
     */
    @Column(nullable = false)
    private Long ddItemId;

    /**
     * 发言人 ID
     */
    @Column(nullable = false)
    private Long userId;

    /**
     * 评论内容
     */
    @Column(length = 2048, nullable = false)
    private String content;

    @CreationTimestamp
    @Column(updatable = false)
    private LocalDateTime createdAt;
}
