package com.checkba.repository;

import com.checkba.model.entity.Project;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ProjectRepository extends JpaRepository<Project, Long> {
    /**
     * 根据用户 ID 查询项目列表，按创建时间倒序
     */
    List<Project> findByUserIdOrderByCreatedAtDesc(Long userId);

    /**
     * 查询所有 userId 为 null 的项目
     */
    List<Project> findByUserIdIsNull();
}


