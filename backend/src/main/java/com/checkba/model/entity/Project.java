package com.checkba.model.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 项目实体
 *
 * 说明：
 * - 用于持久化“创建项目”时录入的基础信息；
 * - 目前只包含项目级元数据和公司基础信息 JSON，后续可以在本实体上继续扩展。
 */
@Data
@Entity
@Table(name = "project")
public class Project {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 项目名称
     */
    @Column(length = 256, nullable = false)
    private String name;

    /**
     * 项目类型，例如：MAJOR_ASSET_RESTRUCTURING
     */
    @Column(length = 64, nullable = false)
    private String projectType;

    /**
     * 上市公司名称
     */
    @Column(length = 256, nullable = false)
    private String listedCompanyName;

    /**
     * 标的公司名称
     */
    @Column(length = 256, nullable = false)
    private String targetCompanyName;

    /**
     * 上市公司从外部服务补全的基础信息 JSON
     */
    @Lob
    @Column(columnDefinition = "TEXT")
    private String listedCompanyInfoJson;

    /**
     * 标的公司从外部服务补全的基础信息 JSON
     */
    @Lob
    @Column(columnDefinition = "TEXT")
    private String targetCompanyInfoJson;

    /**
     * 项目创建者用户 ID
     */
    @Column(nullable = false)
    private Long userId;

    /**
     * 创建时间
     */
    private LocalDateTime createdAt;

    /**
     * 最近更新时间
     */
    private LocalDateTime updatedAt;
}


