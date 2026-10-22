// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service;

import com.checkba.model.entity.FileTag;
import com.checkba.model.entity.Tag;
import com.checkba.repository.FileTagRepository;
import com.checkba.repository.TagRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class FileTagService {

    private final FileTagRepository fileTagRepository;
    private final TagRepository tagRepository;
    
    /**
     * 给文件打标签
     */
    @Transactional
    public void addTagToFile(Long fileId, Long tagId, Long userId) {
        if (!fileTagRepository.existsByFileIdAndTagId(fileId, tagId)) {
            FileTag fileTag = new FileTag();
            fileTag.setFileId(fileId);
            fileTag.setTagId(tagId);
            fileTag.setCreatedBy(userId);
            fileTag.setCreatedAt(LocalDateTime.now());
            fileTagRepository.save(fileTag);
        }
    }
    
    /**
     * 移除文件标签
     */
    @Transactional
    public void removeTagFromFile(Long fileId, Long tagId) {
        fileTagRepository.deleteByFileIdAndTagId(fileId, tagId);
    }
    
    /**
     * 获取文件的所有标签详细信息
     */
    public List<Tag> getTagsByFileId(Long fileId) {
        List<FileTag> fileTags = fileTagRepository.findByFileId(fileId);
        if (fileTags.isEmpty()) {
            return Collections.emptyList();
        }
        List<Long> tagIds = fileTags.stream().map(FileTag::getTagId).collect(Collectors.toList());
        return tagRepository.findAllById(tagIds);
    }

    /**
     * 批量获取文件的标签（用于文件列表优化查询）
     * @return Map<FileId, List<Tag>>
     */
    public Map<Long, List<Tag>> getTagsByFileIds(List<Long> fileIds) {
        if (fileIds == null || fileIds.isEmpty()) {
            return Collections.emptyMap();
        }
        // 大型本地文件夹项目可有 30,000 个文件，而绝大多数文件未打标签；
        // 先检查关联表是否为空，并按 500 个 ID 分片查询，避免拼出 30,000 个占位符的巨型 IN 查询。
        if (fileTagRepository.count() == 0) {
            return Collections.emptyMap();
        }
        List<FileTag> allFileTags;
        int chunkSize = 500;
        if (fileIds.size() <= chunkSize) {
            allFileTags = fileTagRepository.findByFileIdIn(fileIds);
        } else {
            allFileTags = new java.util.ArrayList<>();
            for (int i = 0; i < fileIds.size(); i += chunkSize) {
                List<Long> chunk = fileIds.subList(i, Math.min(i + chunkSize, fileIds.size()));
                allFileTags.addAll(fileTagRepository.findByFileIdIn(chunk));
            }
        }
        if (allFileTags.isEmpty()) {
            return Collections.emptyMap();
        }

        Set<Long> tagIds = allFileTags.stream().map(FileTag::getTagId).collect(Collectors.toSet());
        List<Tag> tags = tagRepository.findAllById(tagIds);
        Map<Long, Tag> tagMap = tags.stream().collect(Collectors.toMap(Tag::getId, t -> t));

        return allFileTags.stream()
                .filter(ft -> tagMap.containsKey(ft.getTagId()))
                .collect(Collectors.groupingBy(
                        FileTag::getFileId,
                        Collectors.mapping(ft -> tagMap.get(ft.getTagId()), Collectors.toList())
                ));
    }
    
    /**
     * 清除文件的所有标签
     */
    @Transactional
    public void clearFileTags(Long fileId) {
        fileTagRepository.deleteByFileId(fileId);
    }
}
