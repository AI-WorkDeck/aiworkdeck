package com.checkba.model.entity;

import jakarta.persistence.*;
import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

/**
 * 项目成员实体
 * 用于管理项目与用户的多对多关系及权限
 */
@Data
@Entity
@Table(name = "project_member", uniqueConstraints = {
        @UniqueConstraint(columnNames = {"project_id", "user_id"})
})
public class ProjectMember {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false)
    private Long projectId;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    /**
     * 成员角色
     * - ADMIN: 管理员（所有权限）
     * - PARTICIPANT: 参与者（文件读写，不可修改项目信息/邀请）
     * - READ_ONLY: 只读（仅查看）
     */
    @Column(length = 32, nullable = false)
    private String role;

    @CreationTimestamp
    @Column(name = "joined_at", updatable = false)
    private LocalDateTime joinedAt;
}
