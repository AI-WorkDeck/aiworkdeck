package com.checkba.model.entity;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

/**
 * 尽调清单项实体
 * 代表清单中的具体一项文件要求（如：营业执照）
 */
@Data
@Entity
@Table(name = "dd_item")
public class DdItem {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 所属清单 ID
     */
    @Column(nullable = false)
    private Long ddRequestId;

    /**
     * 标题（如：营业执照副本）
     */
    @Column(length = 512, nullable = false)
    private String title;

    /**
     * 描述/说明（如：请提供最新年检版本）
     */
    @Column(length = 1024)
    private String description;

    /**
     * 状态
     * - PENDING: 待上传
     * - UPLOADED: 已上传（待审核）
     * - APPROVED: 已确认（律师通过）
     * - REJECTED: 需重传（律师驳回）
     */
    @Column(length = 32, nullable = false)
    private String status = "PENDING";

    /**
     * 排序号
     */
    @Column(nullable = false)
    private Integer sortOrder;

    /**
     * 父项 ID (null 表示根节点)
     */
    @Column
    private Long parentId;

    /**
     * 层级 (0 表示根节点)
     */
    @Column(nullable = false)
    private Integer level = 0;

    /**
     * 示例文件 ID（关联 ProjectFile，可选）
     */
    @Column
    private Long exampleFileId;

    /**
     * 客户上传的文件 ID（关联 ProjectFile，上传后非空）
     */
    @Column
    private Long uploadedFileId;

    /**
     * 客户上传时间
     */
    @Column
    private LocalDateTime uploadedAt;

    /**
     * 客户上传人 ID
     */
    @Column
    private Long uploadedBy;

    @CreationTimestamp
    @Column(updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    private LocalDateTime updatedAt;
}
