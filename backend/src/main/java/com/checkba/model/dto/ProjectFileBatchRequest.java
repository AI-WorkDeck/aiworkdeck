package com.checkba.model.dto;

import lombok.Data;

import java.util.List;

/**
 * 项目文件批量操作请求
 *
 * 说明：
 * - move/copy：需要 targetParentId
 * - delete：仅使用 fileIds
 */
@Data
public class ProjectFileBatchRequest {
    /**
     * 需要操作的文件/文件夹 ID 列表
     */
    private List<Long> fileIds;

    /**
     * 目标父文件夹 ID（move/copy 使用；null 表示根目录）
     */
    private Long targetParentId;
}


