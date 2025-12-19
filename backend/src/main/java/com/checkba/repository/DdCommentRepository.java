package com.checkba.repository;

import com.checkba.model.entity.DdComment;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface DdCommentRepository extends JpaRepository<DdComment, Long> {
    List<DdComment> findByDdItemIdOrderByCreatedAtAsc(Long ddItemId);
}