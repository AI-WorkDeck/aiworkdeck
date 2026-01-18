package com.checkba.controller;

import com.checkba.model.entity.Tag;
import com.checkba.service.TagService;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/projects/{projectId}/tags")
@RequiredArgsConstructor
public class TagController {

    private final TagService tagService;

    /**
     * Get all tags for a project
     */
    @GetMapping
    public List<Tag> getProjectTags(@PathVariable Long projectId) {
        return tagService.getProjectTags(projectId);
    }

    /**
     * Create a new tag
     */
    @PostMapping
    public Tag createTag(
            @PathVariable Long projectId,
            @RequestBody CreateTagRequest request) {
        return tagService.createTag(projectId, request.getName(), request.getColor(), request.getDescription());
    }

    /**
     * Update an existing tag
     */
    @PutMapping("/{tagId}")
    public Tag updateTag(
            @PathVariable Long projectId,
            @PathVariable Long tagId,
            @RequestBody UpdateTagRequest request) {
        return tagService.updateTag(tagId, request.getName(), request.getColor(), request.getDescription());
    }

    /**
     * Delete a tag
     */
    @DeleteMapping("/{tagId}")
    public void deleteTag(
            @PathVariable Long projectId,
            @PathVariable Long tagId) {
        tagService.deleteTag(tagId);
    }
    
    @Data
    public static class CreateTagRequest {
        private String name;
        private String color;
        private String description;
    }
    
    @Data
    public static class UpdateTagRequest {
        private String name;
        private String color;
        private String description;
    }
}
