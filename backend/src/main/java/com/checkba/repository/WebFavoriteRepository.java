package com.checkba.repository;

import com.checkba.model.entity.WebFavorite;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.data.domain.Pageable;

import java.util.List;

public interface WebFavoriteRepository extends JpaRepository<WebFavorite, Long> {

    List<WebFavorite> findByUserIdOrderByCreatedAtDesc(Long userId);

    List<WebFavorite> findByProjectIdAndUserIdOrderByCreatedAtDesc(Long projectId, Long userId);

    @Query("""
            select w from WebFavorite w
            where w.projectId = :projectId and w.userId = :userId
              and (
                :q is null
                or :q = ''
                or lower(coalesce(w.title, '')) like lower(concat('%', :q, '%'))
                or lower(coalesce(w.sourceUrl, '')) like lower(concat('%', :q, '%'))
                or lower(coalesce(w.content, '')) like lower(concat('%', :q, '%'))
              )
            order by w.createdAt desc
            """)
    List<WebFavorite> searchProjectFavorites(@Param("projectId") Long projectId,
                                             @Param("userId") Long userId,
                                             @Param("q") String q,
                                             Pageable pageable);
}


