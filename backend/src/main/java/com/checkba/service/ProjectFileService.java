package com.checkba.service;

import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.ai.ProjectRagService;
import com.checkba.storage.StorageServiceFactory;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

/**
 * 项目文件服务
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ProjectFileService {

    private final ProjectFileRepository projectFileRepository;
    private final ProjectRagService projectRagService;
    private final StorageServiceFactory storageServiceFactory;

    /**
     * 获取项目的文件树（指定父文件夹下的文件列表）
     */
    public List<ProjectFile> getFilesByParent(Long projectId, Long parentId) {
        if (projectId == null) {
            throw new IllegalArgumentException("项目 ID 不能为空");
        }
        return projectFileRepository.findByProjectIdAndParentIdOrderBySortOrderAsc(projectId, parentId);
    }

    /**
     * 获取项目的完整文件树（递归获取所有文件和文件夹）
     */
    public List<ProjectFile> getFileTree(Long projectId) {
        if (projectId == null) {
            throw new IllegalArgumentException("项目 ID 不能为空");
        }
        return projectFileRepository.findByProjectIdOrderBySortOrderAsc(projectId);
    }

    /**
     * 创建文件夹
     */
    @Transactional
    public ProjectFile createFolder(Long projectId, Long parentId, String name, Long userId) {
        if (projectId == null) {
            throw new IllegalArgumentException("项目 ID 不能为空");
        }
        if (!StringUtils.hasText(name)) {
            throw new IllegalArgumentException("文件夹名称不能为空");
        }
        if (userId == null) {
            throw new IllegalArgumentException("用户 ID 不能为空");
        }

        // 检查同名文件夹是否存在
        if (projectFileRepository.existsByProjectIdAndParentIdAndNameAndIdNot(projectId, parentId, name, -1L)) {
            throw new IllegalArgumentException("该文件夹下已存在同名文件夹: " + name);
        }

        // 获取当前父文件夹下的最大排序序号
        List<ProjectFile> siblings = projectFileRepository.findByProjectIdAndParentIdOrderBySortOrderAsc(projectId, parentId);
        int maxSortOrder = siblings.stream()
                .mapToInt(ProjectFile::getSortOrder)
                .max()
                .orElse(-1);

        ProjectFile folder = new ProjectFile();
        folder.setProjectId(projectId);
        folder.setParentId(parentId);
        folder.setIsFolder(true);
        folder.setName(name.trim());
        folder.setSortOrder(maxSortOrder + 1);
        folder.setUserId(userId);
        folder.setCreatedAt(LocalDateTime.now());
        folder.setUpdatedAt(LocalDateTime.now());

        return projectFileRepository.save(folder);
    }

    /**
     * 构建文件的物理存储路径
     * 格式: projects/{projectId}/{logical_path}/{fileName}
     */
    private String buildPhysicalPath(Long projectId, Long parentId, String fileName) {
        StringBuilder pathBuilder = new StringBuilder();
        
        // 构建逻辑路径
        Long currentParentId = parentId;
        int depth = 0;
        // 防止无限循环
        while (currentParentId != null && depth < 20) {
            Optional<ProjectFile> parentOpt = projectFileRepository.findById(currentParentId);
            if (parentOpt.isPresent()) {
                ProjectFile parent = parentOpt.get();
                if (pathBuilder.length() > 0) {
                    pathBuilder.insert(0, "/");
                }
                pathBuilder.insert(0, parent.getName());
                currentParentId = parent.getParentId();
            } else {
                break;
            }
            depth++;
        }
        
        // 构建完整路径
        // 格式: {projectId}/{logicalPath}/{fileName}
        // 物理根目录配置为 data，所以最终路径为 data/{projectId}/{logicalPath}/{fileName}
        String logicalPath = pathBuilder.toString();
        String safeName = fileName;
        
        if (StringUtils.hasText(logicalPath)) {
            return String.format("%d/%s/%s", projectId, logicalPath, safeName);
        } else {
            return String.format("%d/%s", projectId, safeName);
        }
    }

    /**
     * 创建文件
     */
    @Transactional
    public ProjectFile createFile(Long projectId, Long parentId, String name, String fileType, 
                                  Long fileSize, String filePath, String wpsFileId, Long userId) {
        if (projectId == null) {
            throw new IllegalArgumentException("项目 ID 不能为空");
        }
        if (!StringUtils.hasText(name)) {
            throw new IllegalArgumentException("文件名不能为空");
        }
        if (userId == null) {
            throw new IllegalArgumentException("用户 ID 不能为空");
        }

        // 检查同名文件是否存在
        if (projectFileRepository.existsByProjectIdAndParentIdAndNameAndIdNot(projectId, parentId, name, -1L)) {
            throw new IllegalArgumentException("该文件夹下已存在同名文件: " + name);
        }

        // 获取当前父文件夹下的最大排序序号
        List<ProjectFile> siblings = projectFileRepository.findByProjectIdAndParentIdOrderBySortOrderAsc(projectId, parentId);
        int maxSortOrder = siblings.stream()
                .mapToInt(ProjectFile::getSortOrder)
                .max()
                .orElse(-1);

        // 如果未提供 filePath，则自动构建
        if (!StringUtils.hasText(filePath)) {
            filePath = buildPhysicalPath(projectId, parentId, name);
        }

        ProjectFile file = new ProjectFile();
        file.setProjectId(projectId);
        file.setParentId(parentId);
        file.setIsFolder(false);
        file.setName(name.trim());
        file.setFileType(fileType);
        file.setFileSize(fileSize);
        file.setFilePath(filePath);
        file.setWpsFileId(wpsFileId);
        file.setSortOrder(maxSortOrder + 1);
        file.setUserId(userId);
        file.setCreatedAt(LocalDateTime.now());
        file.setUpdatedAt(LocalDateTime.now());

        ProjectFile savedFile = projectFileRepository.save(file);
        
        // 尝试创建物理文件（从模板复制）
        try {
            storageServiceFactory.getStorageService().load(filePath);
            log.info("物理文件创建成功: {}", filePath);
        } catch (Exception e) {
            log.warn("物理文件创建可能失败 (如果是第一次访问会自动创建): {}", filePath, e);
        }
        
        return savedFile;
    }

    /**
     * 重命名文件或文件夹
     */
    @Transactional
    public ProjectFile rename(Long fileId, String newName, Long userId) {
        if (fileId == null) {
            throw new IllegalArgumentException("文件 ID 不能为空");
        }
        if (!StringUtils.hasText(newName)) {
            throw new IllegalArgumentException("新名称不能为空");
        }

        ProjectFile file = projectFileRepository.findById(fileId)
                .orElseThrow(() -> new IllegalArgumentException("文件不存在: " + fileId));

        // 检查权限（只有创建者可以重命名）
        if (!file.getUserId().equals(userId)) {
            throw new IllegalArgumentException("无权重命名此文件");
        }

        // 检查同名文件是否存在
        if (projectFileRepository.existsByProjectIdAndParentIdAndNameAndIdNot(
                file.getProjectId(), file.getParentId(), newName.trim(), fileId)) {
            throw new IllegalArgumentException("该文件夹下已存在同名文件/文件夹: " + newName);
        }

        file.setName(newName.trim());
        file.setUpdatedAt(LocalDateTime.now());

        return projectFileRepository.save(file);
    }

    /**
     * 删除文件或文件夹（如果是文件夹，会递归删除所有子文件）
     */
    @Transactional
    public void delete(Long fileId, Long userId) {
        if (fileId == null) {
            throw new IllegalArgumentException("文件 ID 不能为空");
        }

        ProjectFile file = projectFileRepository.findById(fileId)
                .orElseThrow(() -> new IllegalArgumentException("文件不存在: " + fileId));

        // 检查权限（只有创建者可以删除）
        if (!file.getUserId().equals(userId)) {
            throw new IllegalArgumentException("无权删除此文件");
        }

        // 如果是文件夹，递归删除所有子文件
        if (file.getIsFolder()) {
            List<ProjectFile> children = projectFileRepository.findByProjectIdAndParentIdOrderBySortOrderAsc(
                    file.getProjectId(), fileId);
            for (ProjectFile child : children) {
                delete(child.getId(), userId);
            }
        }

        // 记录文件路径用于向量库刷新
        String filePath = file.getFilePath();
        
        projectFileRepository.deleteById(fileId);
        
        // 触发向量库增量刷新（文件删除）
        if (file.getProjectId() != null && filePath != null) {
            projectRagService.refreshProjectKnowledgeIncremental(
                    String.valueOf(file.getProjectId()), filePath);
        }
    }

    /**
     * 移动文件或文件夹（拖拽排序）
     */
    @Transactional
    public ProjectFile move(Long fileId, Long newParentId, Integer newSortOrder, Long userId) {
        if (fileId == null) {
            throw new IllegalArgumentException("文件 ID 不能为空");
        }

        ProjectFile file = projectFileRepository.findById(fileId)
                .orElseThrow(() -> new IllegalArgumentException("文件不存在: " + fileId));

        // 检查权限
        if (!file.getUserId().equals(userId)) {
            throw new IllegalArgumentException("无权移动此文件");
        }

        // 检查不能移动到自己的子文件夹中
        if (file.getIsFolder() && newParentId != null) {
            if (isDescendant(fileId, newParentId)) {
                throw new IllegalArgumentException("不能将文件夹移动到自己的子文件夹中");
            }
        }

        // 检查目标文件夹下是否存在同名文件
        Long targetParentId = newParentId != null ? newParentId : file.getParentId();
        if (projectFileRepository.existsByProjectIdAndParentIdAndNameAndIdNot(
                file.getProjectId(), targetParentId, file.getName(), fileId)) {
            throw new IllegalArgumentException("目标文件夹下已存在同名文件/文件夹: " + file.getName());
        }

        // 更新父文件夹和排序序号
        file.setParentId(newParentId);
        if (newSortOrder != null) {
            file.setSortOrder(newSortOrder);
        }
        file.setUpdatedAt(LocalDateTime.now());

        return projectFileRepository.save(file);
    }

    /**
     * 检查 targetId 是否是 sourceId 的后代
     */
    private boolean isDescendant(Long sourceId, Long targetId) {
        if (targetId == null) {
            return false;
        }
        ProjectFile target = projectFileRepository.findById(targetId).orElse(null);
        if (target == null) {
            return false;
        }
        if (target.getParentId() == null) {
            return false;
        }
        if (target.getParentId().equals(sourceId)) {
            return true;
        }
        return isDescendant(sourceId, target.getParentId());
    }

    /**
     * 获取文件详情
     */
    public ProjectFile getFile(Long fileId) {
        return projectFileRepository.findById(fileId)
                .orElseThrow(() -> new IllegalArgumentException("文件不存在: " + fileId));
    }
}

