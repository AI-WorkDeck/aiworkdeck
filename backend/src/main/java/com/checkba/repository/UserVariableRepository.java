package com.checkba.repository;

import com.checkba.model.entity.UserVariable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface UserVariableRepository extends JpaRepository<UserVariable, Long> {
    List<UserVariable> findByUserId(Long userId);
    Optional<UserVariable> findByUserIdAndName(Long userId, String name);
}

