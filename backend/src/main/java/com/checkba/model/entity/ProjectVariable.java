package com.checkba.model.entity;

import lombok.Data;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "project_variables", uniqueConstraints = {
    @UniqueConstraint(columnNames = {"project_id", "name"})
})
public class ProjectVariable {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false)
    private Long projectId;

    @Column(nullable = false)
    private String name;

    @Column(columnDefinition = "TEXT")
    private String value;

    @Column(name = "variable_group")
    private String variableGroup;

    @Column(name = "resolved_value", columnDefinition = "TEXT")
    private String resolvedValue;

    @Column(nullable = false)
    private String type; // "TEXT" or "TEMPLATE"

    @Column(name = "creator_id")
    private Long creatorId;

    @Column(name = "creator_name")
    private String creatorName;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;
}

