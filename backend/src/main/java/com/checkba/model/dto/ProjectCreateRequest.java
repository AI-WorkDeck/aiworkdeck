package com.checkba.model.dto;

import lombok.Data;

/**
 * 创建项目入参 DTO
 *
 * 与前端新建项目表单一一对应。
 */
@Data
public class ProjectCreateRequest {

    private String projectType;

    private String listedCompanyName;

    private String targetCompanyName;

    /**
     * 项目名称（可选），前端暂未显式传递时由后端自动生成
     */
    private String name;

    /**
     * 上市公司通过外部服务查询到的基础信息
     */
    private CompanyBasicInfoDTO listedCompanyInfo;

    /**
     * 标的公司通过外部服务查询到的基础信息
     */
    private CompanyBasicInfoDTO targetCompanyInfo;
}


