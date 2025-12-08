package com.checkba.model.dto;

import lombok.Data;

@Data
public class CompanySearchRequest {
    /**
     * 项目类型，仅作为透传占位
     */
    private String projectType;

    /**
     * 公司角色：LISTED / TARGET
     */
    private String role;

    /**
     * 搜索关键字：可以是公司名称，也可以是股票代码
     */
    private String name;
}

