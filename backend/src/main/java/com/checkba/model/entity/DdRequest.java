package com.checkba.model.entity;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

/**
 * 尽调清单请求实体
 * 代表律师发起的一次文件收集请求（如：第一轮尽调清单）
 */
@Data
@Entity
@Table(name = "dd_request")
public class DdRequest {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 所属项目 ID
     */
    @Column(nullable = false)
    private Long projectId;

    /**
     * 清单名称（如：初步尽调清单、补充清单）
     */
    @Column(length = 256, nullable = false)
    private String name;

    /**
     * 状态
     * - DRAFT: 草稿（律师编辑中）
     * - PUBLISHED: 已发布（客户可见，开始上传）
     * - COMPLETED: 已完成（归档）
     */
    @Column(length = 32, nullable = false)
    private String status = "DRAFT";

    /**
     * 创建者 ID
     */
    @Column(nullable = false)
    private Long createdBy;

    @CreationTimestamp
    @Column(updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    private LocalDateTime updatedAt;
}
