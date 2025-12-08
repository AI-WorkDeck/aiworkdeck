package com.checkba.repository;

import com.checkba.model.entity.CompanyMirror;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface CompanyMirrorRepository extends JpaRepository<CompanyMirror, Long> {

    List<CompanyMirror> findByRoleOrderByUpdatedAtDesc(String role);

    Optional<CompanyMirror> findFirstByRoleAndStockCode(String role, String stockCode);

    Optional<CompanyMirror> findFirstByRoleAndName(String role, String name);
}


