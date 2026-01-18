package com.checkba.model.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 文件-标签关联实体
 */
@Entity
@Table(name = "project_file_tag", uniqueConstraints = {
    @UniqueConstraint(columnNames = {"fileId", "tagId"})
})
@Data
public class FileTag {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 文件 ID
     */
    @Column(nullable = false)
    private Long fileId;

    /**
     * 标签 ID
     */
    @Column(nullable = false)
    private Long tagId;

    /**
     * 创建者（打标签的人，系统打标则为 null 或特定系统 ID）
     */
    @Column
    private Long createdBy;

    /**
     * 创建时间
     */
    private LocalDateTime createdAt;
}
