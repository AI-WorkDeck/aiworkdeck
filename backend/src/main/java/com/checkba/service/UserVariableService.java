package com.checkba.service;

import com.checkba.model.entity.UserVariable;
import com.checkba.repository.UserVariableRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class UserVariableService {

    @Autowired
    private UserVariableRepository repository;

    public List<UserVariable> getVariablesByUser(Long userId) {
        return repository.findByUserId(userId);
    }

    public UserVariable createOrUpdateVariable(Long userId, UserVariable variable) {
        UserVariable existing = repository.findByUserIdAndName(userId, variable.getName())
                .orElse(null);

        if (existing != null) {
            existing.setValue(variable.getValue());
            existing.setType(variable.getType());
            existing.setVariableGroup(variable.getVariableGroup());
            existing.setResolvedValue(variable.getValue());
            return repository.save(existing);
        } else {
            variable.setUserId(userId);
            variable.setResolvedValue(variable.getValue());
            return repository.save(variable);
        }
    }

    public void deleteVariable(Long userId, Long id) {
        // 简单所有权校验（防误删他人变量）
        UserVariable v = repository.findById(id).orElse(null);
        if (v == null) return;
        if (!userId.equals(v.getUserId())) return;
        repository.deleteById(id);
    }
}

