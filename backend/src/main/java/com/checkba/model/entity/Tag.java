package com.checkba.model.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 项目标签实体
 */
@Entity
@Table(name = "project_tag")
@Data
public class Tag {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 所属项目 ID
     */
    @Column(nullable = false)
    private Long projectId;

    /**
     * 标签名称
     */
    @Column(nullable = false, length = 64)
    private String name;

    /**
     * 标签颜色 (Hex Code, e.g., #FF5733)
     */
    @Column(length = 7)
    private String color;

    /**
     * 是否为系统自动生成的标签（不可随意修改名称，但可以删除）
     */
    @Column(nullable = false, columnDefinition = "boolean default false")
    private Boolean isSystem = false;
    
    /**
     * 描述
     */
    @Column(length = 512)
    private String description;

    /**
     * 创建时间
     */
    private LocalDateTime createdAt;

    /**
     * 更新时间
     */
    private LocalDateTime updatedAt;
}
