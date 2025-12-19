package com.checkba.repository;

import com.checkba.model.entity.UserActivityLog;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface UserActivityLogRepository extends JpaRepository<UserActivityLog, Long> {
    List<UserActivityLog> findByUserIdOrderByTimestampDesc(Long userId);
}
