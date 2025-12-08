package com.checkba.model.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 公司镜像实体
 *
 * 说明：
 * - 用于保存从企查查等外部服务拉取的公司基础信息快照；
 * - 既可承载上市公司，也可承载标的公司（通过 role 区分）；
 * - 列表类字段（股东、董监高等）暂以 JSON 字符串存储，后续有需要可以拆分子表。
 */
@Data
@Entity
@Table(name = "company_mirror")
public class CompanyMirror {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * 公司角色：LISTED / TARGET 等
     */
    @Column(length = 32, nullable = false)
    private String role;

    /**
     * 公司名称 / 全称
     */
    @Column(length = 256, nullable = false)
    private String name;

    /**
     * 证券代码（如有）
     */
    @Column(length = 32)
    private String stockCode;

    /**
     * 公司全称
     */
    @Column(length = 256)
    private String fullName;

    /**
     * 公司简称
     */
    @Column(length = 128)
    private String shortName;

    /**
     * 所属板块
     */
    @Column(length = 128)
    private String board;

    /**
     * 股份总数（字符串形式保存，方便兼容“万股”等单位）
     */
    @Column(length = 128)
    private String totalShares;

    /**
     * 最新收盘价
     */
    @Column(length = 64)
    private String latestClosePrice;

    /**
     * 注册地址（标的公司为主）
     */
    @Column(length = 512)
    private String registeredAddress;

    /**
     * 注册资本
     */
    @Column(length = 128)
    private String registeredCapital;

    /**
     * 股权结构说明
     */
    @Column(length = 1024)
    private String equityStructureRemark;

    /**
     * 前十大股东列表 JSON
     */
    @Lob
    @Column(columnDefinition = "CLOB")
    private String top10ShareholdersJson;

    /**
     * 董监高列表 JSON
     */
    @Lob
    @Column(columnDefinition = "CLOB")
    private String executivesJson;

    /**
     * 股东列表 JSON（标的公司）
     */
    @Lob
    @Column(columnDefinition = "CLOB")
    private String shareholdersJson;

    /**
     * 记录来源（例如：QICHACHA），便于后续扩展其他来源
     */
    @Column(length = 64)
    private String source;

    /**
     * 创建时间
     */
    private LocalDateTime createdAt;

    /**
     * 最近更新时间
     */
    private LocalDateTime updatedAt;
}


