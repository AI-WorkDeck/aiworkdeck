package com.checkba.model.entity;

import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 网页/截图摘录收藏（项目内 + 我的收藏）
 */
@Data
@Entity
@Table(name = "web_favorite")
public class WebFavorite {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long userId;

    /**
     * 关联项目（可为空：我的收藏里也可以有不绑定项目的）
     */
    @Column
    private Long projectId;

    /**
     * 来源 URL（可为空，例如纯截图）
     */
    @Column(columnDefinition = "TEXT")
    private String sourceUrl;

    /**
     * 标题（可为空）
     */
    @Column(length = 256)
    private String title;

    /**
     * 摘录文本（OCR 或复制的文本）
     */
    @Column(columnDefinition = "LONGTEXT")
    private String content;

    /**
     * 截图存储路径（可为空）
     */
    @Column(length = 512)
    private String imagePath;

    /**
     * 扩展元信息（JSON 字符串）：
     * - 用于网核证据：抓取时间、页面 HTML 快照摘要、selector 等
     */
    @Column(columnDefinition = "LONGTEXT")
    private String meta;

    @Column
    private LocalDateTime createdAt;
}


