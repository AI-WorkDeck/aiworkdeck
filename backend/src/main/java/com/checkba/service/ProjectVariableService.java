package com.checkba.service;

import com.checkba.model.entity.ProjectVariable;
import com.checkba.repository.ProjectVariableRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class ProjectVariableService {

    @Autowired
    private ProjectVariableRepository repository;

    public List<ProjectVariable> getVariablesByProject(Long projectId) {
        return repository.findByProjectId(projectId);
    }

    public ProjectVariable createOrUpdateVariable(ProjectVariable variable) {
        ProjectVariable existing = repository.findByProjectIdAndName(variable.getProjectId(), variable.getName())
                .orElse(null);

        if (existing != null) {
            existing.setValue(variable.getValue());
            existing.setType(variable.getType());
            existing.setVariableGroup(variable.getVariableGroup());
            // TODO: Implement template parsing logic for nested variables
            if ("TEXT".equals(variable.getType())) {
                existing.setResolvedValue(variable.getValue());
            } else {
                existing.setResolvedValue(variable.getValue());
            }
            return repository.save(existing);
        } else {
            if ("TEXT".equals(variable.getType())) {
                variable.setResolvedValue(variable.getValue());
            } else {
                variable.setResolvedValue(variable.getValue());
            }
            return repository.save(variable);
        }
    }

    public void deleteVariable(Long id) {
        repository.deleteById(id);
    }
}

