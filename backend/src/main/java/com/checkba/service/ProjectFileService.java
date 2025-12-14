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
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

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
        // 格式: projects/{projectId}/{logicalPath}/{fileName}
        // 物理根目录配置为 data，所以最终路径为 data/projects/{projectId}/{logicalPath}/{fileName}
        String logicalPath = pathBuilder.toString();
        String safeName = fileName;
        
        if (StringUtils.hasText(logicalPath)) {
            return String.format("projects/%d/%s/%s", projectId, logicalPath, safeName);
        } else {
            return String.format("projects/%d/%s", projectId, safeName);
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

        String oldName = file.getName();
        String oldFilePath = file.getFilePath();
        
        // 处理文件名：如果是文件，确保保留文件后缀
        String finalNewName = newName.trim();
        if (!file.getIsFolder()) {
            // 检查原文件名是否有后缀
            String oldExtension = "";
            int lastDotIndex = oldName.lastIndexOf('.');
            if (lastDotIndex > 0 && lastDotIndex < oldName.length() - 1) {
                oldExtension = oldName.substring(lastDotIndex);
            }
            
            // 如果新名称不包含后缀，但原名称有后缀，则保留原后缀
            if (!finalNewName.contains(".") && StringUtils.hasText(oldExtension)) {
                finalNewName = finalNewName + oldExtension;
            }
            // 如果新名称不包含后缀，且原名称也没有后缀，但 fileType 存在，则添加 fileType 后缀
            else if (!finalNewName.contains(".") && !StringUtils.hasText(oldExtension) 
                    && StringUtils.hasText(file.getFileType())) {
                finalNewName = finalNewName + "." + file.getFileType();
            }
        }
        
        // 更新文件名
        file.setName(finalNewName);
        file.setUpdatedAt(LocalDateTime.now());

        // 如果是文件（非文件夹），需要更新 filePath 并重命名物理文件
        if (!file.getIsFolder() && StringUtils.hasText(oldFilePath)) {
            // 构建新的文件路径
            String newFilePath = buildPhysicalPath(file.getProjectId(), file.getParentId(), finalNewName);
            file.setFilePath(newFilePath);
            
            // 重命名物理文件
            try {
                movePhysicalFile(oldFilePath, newFilePath);
                log.info("物理文件重命名成功: fileId={}, oldPath={}, newPath={}", fileId, oldFilePath, newFilePath);
            } catch (Exception e) {
                log.warn("物理文件重命名失败，继续更新数据库记录: fileId={}, oldPath={}, newPath={}", 
                    fileId, oldFilePath, newFilePath, e);
                // 如果物理文件重命名失败，回滚 filePath
                file.setFilePath(oldFilePath);
            }
        }

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

        // 记录文件路径用于向量库刷新和物理文件删除
        String filePath = file.getFilePath();
        
        // 删除物理文件（仅对文件，文件夹不需要删除物理文件）
        if (!file.getIsFolder() && StringUtils.hasText(filePath)) {
            try {
                storageServiceFactory.getStorageService().delete(filePath);
                log.info("物理文件删除成功: fileId={}, path={}", fileId, filePath);
            } catch (Exception e) {
                // 物理文件删除失败不影响数据库删除，只记录警告
                log.warn("物理文件删除失败，继续删除数据库记录: fileId={}, path={}", fileId, filePath, e);
            }
        }
        
        // 删除数据库记录
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

        String oldFilePath = file.getFilePath();
        Long oldParentId = file.getParentId();
        
        // 更新父文件夹和排序序号
        file.setParentId(newParentId);
        if (newSortOrder != null) {
            file.setSortOrder(newSortOrder);
        }
        file.setUpdatedAt(LocalDateTime.now());

        // 如果是文件（非文件夹），需要更新 filePath 并移动物理文件
        if (!file.getIsFolder()) {
            return moveSingleFileWithPhysical(file, oldFilePath, oldParentId);
        }

        // 文件夹移动：需要同步更新子文件的 filePath，并移动所有子文件的物理文件
        ProjectFile savedFolder = projectFileRepository.save(file);
        try {
            moveFolderDescendantPhysicalFiles(savedFolder);
        } catch (Exception e) {
            log.warn("文件夹移动：同步移动子文件物理文件失败（数据库已更新 parentId）: folderId={}", savedFolder.getId(), e);
        }
        return savedFolder;
    }

    /**
     * 批量删除（支持文件夹递归删除）
     */
    @Transactional
    public void batchDelete(Long projectId, com.checkba.model.dto.ProjectFileBatchRequest request, Long userId) {
        if (request == null || request.getFileIds() == null || request.getFileIds().isEmpty()) {
            throw new IllegalArgumentException("fileIds 不能为空");
        }
        for (Long id : request.getFileIds()) {
            if (id == null) continue;
            delete(id, userId);
        }
    }

    /**
     * 批量移动（支持文件夹递归移动）
     */
    @Transactional
    public List<ProjectFile> batchMove(Long projectId, com.checkba.model.dto.ProjectFileBatchRequest request, Long userId) {
        if (request == null || request.getFileIds() == null || request.getFileIds().isEmpty()) {
            throw new IllegalArgumentException("fileIds 不能为空");
        }
        List<ProjectFile> result = new ArrayList<>();
        for (Long id : request.getFileIds()) {
            if (id == null) continue;
            result.add(move(id, request.getTargetParentId(), null, userId));
        }
        return result;
    }

    /**
     * 批量复制（支持文件夹递归复制）
     */
    @Transactional
    public List<ProjectFile> batchCopy(Long projectId, com.checkba.model.dto.ProjectFileBatchRequest request, Long userId) {
        if (request == null || request.getFileIds() == null || request.getFileIds().isEmpty()) {
            throw new IllegalArgumentException("fileIds 不能为空");
        }
        if (request.getTargetParentId() == null && projectId == null) {
            // 防御性校验
            throw new IllegalArgumentException("projectId 不能为空");
        }
        List<ProjectFile> createdRoots = new ArrayList<>();
        for (Long id : request.getFileIds()) {
            if (id == null) continue;
            ProjectFile source = projectFileRepository.findById(id)
                    .orElseThrow(() -> new IllegalArgumentException("文件不存在: " + id));
            if (!Objects.equals(source.getProjectId(), projectId)) {
                throw new IllegalArgumentException("跨项目复制不支持");
            }
            createdRoots.add(copyRecursive(projectId, source, request.getTargetParentId(), userId));
        }
        return createdRoots;
    }

    private ProjectFile moveSingleFileWithPhysical(ProjectFile file, String oldFilePath, Long oldParentId) {
        if (StringUtils.hasText(oldFilePath)) {
            String newFilePath = buildPhysicalPath(file.getProjectId(), file.getParentId(), file.getName());
            file.setFilePath(newFilePath);
            try {
                movePhysicalFile(oldFilePath, newFilePath);
                log.info("物理文件移动成功: fileId={}, oldPath={}, newPath={}", file.getId(), oldFilePath, newFilePath);
            } catch (Exception e) {
                log.warn("物理文件移动失败，继续更新数据库记录: fileId={}, oldPath={}, newPath={}",
                        file.getId(), oldFilePath, newFilePath, e);
                file.setFilePath(oldFilePath);
                file.setParentId(oldParentId);
            }
        }
        return projectFileRepository.save(file);
    }

    /**
     * 文件夹移动后：递归更新其子孙文件的 filePath，并移动物理文件
     */
    private void moveFolderDescendantPhysicalFiles(ProjectFile folder) throws Exception {
        if (folder == null || !Boolean.TRUE.equals(folder.getIsFolder())) return;
        List<ProjectFile> children = projectFileRepository.findByProjectIdAndParentIdOrderBySortOrderAsc(folder.getProjectId(), folder.getId());
        for (ProjectFile child : children) {
            if (Boolean.TRUE.equals(child.getIsFolder())) {
                moveFolderDescendantPhysicalFiles(child);
                continue;
            }
            String oldPath = child.getFilePath();
            if (!StringUtils.hasText(oldPath)) continue;
            String newPath = buildPhysicalPath(child.getProjectId(), child.getParentId(), child.getName());
            if (oldPath.equals(newPath)) continue;
            try {
                movePhysicalFile(oldPath, newPath);
                child.setFilePath(newPath);
                child.setUpdatedAt(LocalDateTime.now());
                projectFileRepository.save(child);
            } catch (Exception e) {
                log.warn("移动子文件物理文件失败: fileId={}, oldPath={}, newPath={}", child.getId(), oldPath, newPath, e);
            }
        }
    }

    /**
     * 递归复制文件/文件夹
     */
    private ProjectFile copyRecursive(Long projectId, ProjectFile source, Long targetParentId, Long userId) {
        if (Boolean.TRUE.equals(source.getIsFolder())) {
            String newFolderName = resolveUniqueName(projectId, targetParentId, source.getName());
            ProjectFile newFolder = new ProjectFile();
            newFolder.setProjectId(projectId);
            newFolder.setParentId(targetParentId);
            newFolder.setIsFolder(true);
            newFolder.setName(newFolderName);
            newFolder.setSortOrder(0);
            newFolder.setUserId(userId);
            newFolder.setCreatedAt(LocalDateTime.now());
            newFolder.setUpdatedAt(LocalDateTime.now());
            ProjectFile savedFolder = projectFileRepository.save(newFolder);

            List<ProjectFile> children = projectFileRepository.findByProjectIdAndParentIdOrderBySortOrderAsc(projectId, source.getId());
            for (ProjectFile child : children) {
                copyRecursive(projectId, child, savedFolder.getId(), userId);
            }
            return savedFolder;
        }

        // file
        String newName = resolveUniqueName(projectId, targetParentId, source.getName());
        ProjectFile newFile = new ProjectFile();
        newFile.setProjectId(projectId);
        newFile.setParentId(targetParentId);
        newFile.setIsFolder(false);
        newFile.setName(newName);
        newFile.setFileType(source.getFileType());
        newFile.setFileSize(source.getFileSize());
        String newPath = buildPhysicalPath(projectId, targetParentId, newName);
        newFile.setFilePath(newPath);
        newFile.setWpsFileId(generateWpsFileId(projectId));
        newFile.setSortOrder(0);
        newFile.setUserId(userId);
        newFile.setCreatedAt(LocalDateTime.now());
        newFile.setUpdatedAt(LocalDateTime.now());
        ProjectFile saved = projectFileRepository.save(newFile);

        // copy physical
        if (StringUtils.hasText(source.getFilePath())) {
            try {
                copyPhysicalFile(source.getFilePath(), newPath);
            } catch (Exception e) {
                log.warn("复制物理文件失败: sourcePath={}, targetPath={}", source.getFilePath(), newPath, e);
            }
        }
        return saved;
    }

    private String resolveUniqueName(Long projectId, Long parentId, String desiredName) {
        if (!StringUtils.hasText(desiredName)) return desiredName;
        String base = desiredName.trim();
        String ext = "";
        int dot = base.lastIndexOf('.');
        if (dot > 0 && dot < base.length() - 1) {
            ext = base.substring(dot);
            base = base.substring(0, dot);
        }
        String candidate = base + ext;
        int i = 1;
        while (projectFileRepository.existsByProjectIdAndParentIdAndNameAndIdNot(projectId, parentId, candidate, -1L)) {
            candidate = base + " (" + i + ")" + ext;
            i++;
            if (i > 1000) {
                candidate = base + "-" + UUID.randomUUID() + ext;
                break;
            }
        }
        return candidate;
    }

    private String generateWpsFileId(Long projectId) {
        // 与前端生成规则保持一致的风格（无需完全一致，但确保全局唯一）
        String rand = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        return String.format("project_%d_doc_%d_%s", projectId, System.currentTimeMillis(), rand);
    }

    private void copyPhysicalFile(String sourcePath, String targetPath) throws Exception {
        var resource = storageServiceFactory.getStorageService().load(sourcePath);
        try (var inputStream = resource.getInputStream()) {
            storageServiceFactory.getStorageService().save(targetPath, inputStream);
        }
    }
    
    /**
     * 移动/重命名物理文件
     * 通过读取旧文件、写入新位置、删除旧文件来实现
     */
    private void movePhysicalFile(String oldPath, String newPath) throws Exception {
        try {
            // 读取旧文件
            var resource = storageServiceFactory.getStorageService().load(oldPath);
            
            // 写入新位置
            try (var inputStream = resource.getInputStream()) {
                storageServiceFactory.getStorageService().save(newPath, inputStream);
            }
            
            // 删除旧文件
            storageServiceFactory.getStorageService().delete(oldPath);
            
            log.info("物理文件移动/重命名成功: {} -> {}", oldPath, newPath);
        } catch (Exception e) {
            log.error("物理文件移动/重命名失败: {} -> {}", oldPath, newPath, e);
            throw e;
        }
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

