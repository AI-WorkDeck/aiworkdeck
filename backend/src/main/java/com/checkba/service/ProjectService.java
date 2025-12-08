package com.checkba.service;

import cn.hutool.json.JSONUtil;
import com.checkba.model.dto.ProjectCreateRequest;
import com.checkba.model.entity.Project;
import com.checkba.repository.ProjectRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.time.LocalDateTime;

@Service
@RequiredArgsConstructor
public class ProjectService {

    private final ProjectRepository projectRepository;

    public Project createProject(ProjectCreateRequest request) {
        if (!StringUtils.hasText(request.getProjectType())) {
            throw new IllegalArgumentException("项目类型不能为空");
        }
        if (!StringUtils.hasText(request.getListedCompanyName())) {
            throw new IllegalArgumentException("上市公司名称不能为空");
        }
        if (!StringUtils.hasText(request.getTargetCompanyName())) {
            throw new IllegalArgumentException("标的公司名称不能为空");
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

        if (request.getListedCompanyInfo() != null) {
            project.setListedCompanyInfoJson(JSONUtil.toJsonStr(request.getListedCompanyInfo()));
        }
        if (request.getTargetCompanyInfo() != null) {
            project.setTargetCompanyInfoJson(JSONUtil.toJsonStr(request.getTargetCompanyInfo()));
        }

        LocalDateTime now = LocalDateTime.now();
        project.setCreatedAt(now);
        project.setUpdatedAt(now);

        return projectRepository.save(project);
    }

    public Project getProject(Long id) {
        return projectRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("项目不存在: " + id));
    }
}


