package com.checkba.repository;

import com.checkba.model.entity.DdItem;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface DdItemRepository extends JpaRepository<DdItem, Long> {
    List<DdItem> findByDdRequestIdOrderBySortOrderAsc(Long ddRequestId);
}