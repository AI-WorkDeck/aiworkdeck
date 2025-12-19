package com.checkba.model.entity;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

/**
 * 项目邀请/访问码实体
 */
@Data
@Entity
@Table(name = "project_invitation")
public class ProjectInvitation {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long projectId;

    /**
     * 访问码（唯一）
     */
    @Column(length = 32, nullable = false, unique = true)
    private String accessCode;

    /**
     * 邀请类型
     * - CLIENT: 客户
     */
    @Column(length = 32, nullable = false)
    private String type = "CLIENT";

    /**
     * 关联的影子用户 ID
     * (客户使用此码登录时，实际登录的是这个 User)
     */
    @Column(nullable = false)
    private Long relatedUserId;

    @CreationTimestamp
    @Column(updatable = false)
    private LocalDateTime createdAt;
    
    /**
     * 创建者（律师）
     */
    @Column
    private Long createdBy;
}
