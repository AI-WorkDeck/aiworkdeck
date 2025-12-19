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
 * 用户实体
 *
 * 说明：
 * - 用于存储用户基本信息
 * - 支持用户对项目的管理和权限控制
 */
@Data
@Entity
@Table(name = "user")
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 用户名（唯一）
     */
    @Column(length = 64, nullable = false, unique = true)
    private String username;

    /**
     * 用户显示名称
     */
    @Column(length = 128, nullable = false)
    private String displayName;

    /**
     * 用户头像 URL（可选）
     */
    @Column(length = 512)
    private String avatarUrl;

    /**
     * 用户邮箱（可选）
     */
    @Column(length = 256)
    private String email;

    /**
     * 用户密码（加密存储）
     * 注意：实际生产环境应使用 BCrypt 等加密算法
     */
    @Column(length = 256, nullable = false)
    private String password;

    /**
     * 用户角色
     * - USER: 普通用户
     * - ADMIN: 系统管理员
     */
    @Column(length = 32, nullable = false)
    private String role = "USER";

    /**
     * 订阅类型
     * - FREE: 免费用户
     * - PAID: 付费用户
     */
    @Column(length = 32, nullable = false)
    private String subscriptionType = "FREE";

    /**
     * 创建时间
     */
    private LocalDateTime createdAt;

    /**
     * 最近更新时间
     */
    private LocalDateTime updatedAt;
}

