package com.checkba.model.dto;

import lombok.Data;

import java.util.List;
import java.util.Map;

@Data
public class CompanyBasicInfoDTO {
    // 主键（如果来自本地镜像数据）
    private Long id;

    // 公司角色：LISTED / TARGET 等
    private String role;

    // 基础信息
    private String name;
    private String stockCode;
    private String fullName;
    private String shortName;
    private String board;
    private String totalShares;
    private String latestClosePrice;
    
    // 标的公司特有
    private String registeredAddress;
    private String registeredCapital;
    private String equityStructureRemark;

    // 列表数据
    private List<Map<String, String>> top10Shareholders;
    private List<Map<String, String>> executives;
    private List<Map<String, String>> shareholders;
}

