package com.checkba.repository;

import com.checkba.model.entity.DdRequest;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface DdRequestRepository extends JpaRepository<DdRequest, Long> {
    List<DdRequest> findByProjectIdOrderByCreatedAtDesc(Long projectId);
}
