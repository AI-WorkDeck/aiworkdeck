package com.checkba.repository;

import com.checkba.model.entity.DocFileLink;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface DocFileLinkRepository extends JpaRepository<DocFileLink, Long> {
    Optional<DocFileLink> findByProjectIdAndLinkKey(Long projectId, String linkKey);
}


