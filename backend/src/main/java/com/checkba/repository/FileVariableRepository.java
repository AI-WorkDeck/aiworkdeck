package com.checkba.repository;

import com.checkba.model.entity.FileVariable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface FileVariableRepository extends JpaRepository<FileVariable, Long> {
    List<FileVariable> findByFileId(Long fileId);
    Optional<FileVariable> findByFileIdAndName(Long fileId, String name);
}
