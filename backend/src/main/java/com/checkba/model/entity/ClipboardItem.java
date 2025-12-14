package com.checkba.model.entity;

import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 剪贴板记录（类似 Paste）：仅记录本应用可感知的剪贴板行为（如 OCR/粘贴事件/复制按钮）。
 */
@Data
@Entity
@Table(name = "clipboard_item")
public class ClipboardItem {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long userId;

    /**
     * TEXT / FILE
     */
    @Column(length = 16, nullable = false)
    private String type;

    /**
     * 文本内容（TEXT）
     */
    @Column(columnDefinition = "LONGTEXT")
    private String text;

    /**
     * 扩展元信息（JSON 字符串，FILE 等场景）
     */
    @Column(columnDefinition = "TEXT")
    private String meta;

    @Column
    private LocalDateTime createdAt;
}


