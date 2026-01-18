package com.checkba.repository;

import com.checkba.model.entity.Tag;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface TagRepository extends JpaRepository<Tag, Long> {
    
    /**
     * Finds all tags for a specific project.
     */
    List<Tag> findByProjectId(Long projectId);
    
    /**
     * Checks if a tag with the same name exists in the project (case insensitive usually preferred, but strict for now).
     */
    boolean existsByProjectIdAndName(Long projectId, String name);

    /**
     * Finds a tag by project ID and name.
     */
    Optional<Tag> findByProjectIdAndName(Long projectId, String name);
}
