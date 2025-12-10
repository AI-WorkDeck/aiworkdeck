package com.checkba.repository;

import com.checkba.model.entity.ProjectVariable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface ProjectVariableRepository extends JpaRepository<ProjectVariable, Long> {
    List<ProjectVariable> findByProjectId(Long projectId);
    Optional<ProjectVariable> findByProjectIdAndName(Long projectId, String name);
}

