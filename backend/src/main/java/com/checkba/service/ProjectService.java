package com.checkba.service;

import cn.hutool.json.JSONUtil;
import com.checkba.model.dto.ProjectCreateRequest;
import com.checkba.model.entity.Project;
import com.checkba.model.entity.ProjectVariable;
import com.checkba.repository.ProjectRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;
import java.util.List;

@Service
@RequiredArgsConstructor
public class ProjectService {

    private final ProjectRepository projectRepository;
    private final TushareService tushareService;
    private final ProjectVariableService projectVariableService;

    public Project createProject(ProjectCreateRequest request, Long userId) {
        if (!StringUtils.hasText(request.getProjectType())) {
            throw new IllegalArgumentException("项目类型不能为空");
        }
        if (!StringUtils.hasText(request.getListedCompanyName())) {
            throw new IllegalArgumentException("上市公司名称不能为空");
        }
        if (!StringUtils.hasText(request.getTargetCompanyName())) {
            throw new IllegalArgumentException("标的公司名称不能为空");
        }
        if (userId == null) {
            throw new IllegalArgumentException("用户 ID 不能为空");
        }

        Project project = new Project();

        String name = request.getName();
        if (!StringUtils.hasText(name)) {
            // 默认项目名：{上市公司名称} - {标的公司名称} 项目
            name = request.getListedCompanyName() + " - " + request.getTargetCompanyName() + " 项目";
        }

        project.setName(name);
        project.setProjectType(request.getProjectType());
        project.setListedCompanyName(request.getListedCompanyName());
        project.setTargetCompanyName(request.getTargetCompanyName());
        project.setUserId(userId);

        if (request.getListedCompanyInfo() != null) {
            project.setListedCompanyInfoJson(JSONUtil.toJsonStr(request.getListedCompanyInfo()));
        }
        if (request.getTargetCompanyInfo() != null) {
            project.setTargetCompanyInfoJson(JSONUtil.toJsonStr(request.getTargetCompanyInfo()));
        }

        LocalDateTime now = LocalDateTime.now();
        project.setCreatedAt(now);
        project.setUpdatedAt(now);

        Project savedProject = projectRepository.save(project);

        // Fetch and save Tushare variables for listed company
        try {
            List<ProjectVariable> vars = tushareService.fetchAndCreateVariables(savedProject.getId(), request.getListedCompanyName());
            for (ProjectVariable var : vars) {
                projectVariableService.createOrUpdateVariable(var);
            }
        } catch (Exception e) {
            // Log but don't fail project creation? Or fail? 
            // Usually external service failure shouldn't block core flow if possible, 
            // but the user explicitly requested this data.
            // For now, log error and proceed.
            // System.err.println("Failed to fetch Tushare data: " + e.getMessage());
            // Using logger if available, or just printing stack trace for dev.
            e.printStackTrace();
        }

        return savedProject;
    }

    /**
     * 获取用户的项目列表
     */
    public List<Project> getUserProjects(Long userId) {
        if (userId == null) {
            throw new IllegalArgumentException("用户 ID 不能为空");
        }
        return projectRepository.findByUserIdOrderByCreatedAtDesc(userId);
    }

    public Project getProject(Long id) {
        return projectRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("项目不存在: " + id));
    }

    /**
     * 删除项目
     */
    public void deleteProject(Long id) {
        if (!projectRepository.existsById(id)) {
            throw new IllegalArgumentException("项目不存在: " + id);
        }
        projectRepository.deleteById(id);
    }
}
