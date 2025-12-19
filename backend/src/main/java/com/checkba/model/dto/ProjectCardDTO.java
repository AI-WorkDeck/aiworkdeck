package com.checkba.model.dto;

import lombok.Data;
import java.time.LocalDateTime;

@Data
public class ProjectCardDTO {
    private Long id;
    private String name;
    private String projectType;
    private String listedCompanyName;
    private String targetCompanyName;
    // We can omit bulky JSON fields if not needed for card display
    // private String listedCompanyInfoJson;
    // private String targetCompanyInfoJson;
    private Long userId; // Creator ID
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    // Enhanced fields
    private String myRole; // OWNER, ADMIN, MEMBER, CLIENT...
    private Long managerId;
    private String managerName;
    private String managerAvatarUrl;
}
