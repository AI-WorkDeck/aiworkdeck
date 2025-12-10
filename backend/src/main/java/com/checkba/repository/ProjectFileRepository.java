package com.checkba.repository;

import com.checkba.model.entity.ProjectFile;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface ProjectFileRepository extends JpaRepository<ProjectFile, Long> {
    /**
     * 根据项目 ID 和父文件夹 ID 查询文件列表（按排序序号排序）
     */
    List<ProjectFile> findByProjectIdAndParentIdOrderBySortOrderAsc(Long projectId, Long parentId);

    /**
     * 根据项目 ID 查询所有文件
     */
    List<ProjectFile> findByProjectIdOrderBySortOrderAsc(Long projectId);

    /**
     * 根据父文件夹 ID 查询子文件数量
     */
    long countByParentId(Long parentId);

    /**
     * 检查同一父文件夹下是否存在同名文件/文件夹
     */
    boolean existsByProjectIdAndParentIdAndNameAndIdNot(Long projectId, Long parentId, String name, Long excludeId);

    /**
     * 根据 WPS 文件 ID 查询文件
     */
    Optional<ProjectFile> findByWpsFileId(String wpsFileId);
}

