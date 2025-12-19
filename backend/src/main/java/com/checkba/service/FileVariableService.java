package com.checkba.service;

import com.checkba.model.entity.FileVariable;
import com.checkba.repository.FileVariableRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
@RequiredArgsConstructor
public class FileVariableService {

    private final FileVariableRepository fileVariableRepository;

    public List<FileVariable> getVariables(Long fileId) {
        return fileVariableRepository.findByFileId(fileId);
    }

    public FileVariable createOrUpdateVariable(FileVariable variable) {
        return fileVariableRepository.findByFileIdAndName(variable.getFileId(), variable.getName())
                .map(existing -> {
                    existing.setValue(variable.getValue());
                    existing.setType(variable.getType());
                    existing.setResolvedValue(variable.getResolvedValue());
                    existing.setVariableGroup(variable.getVariableGroup());
                    return fileVariableRepository.save(existing);
                })
                .orElseGet(() -> fileVariableRepository.save(variable));
    }

    public void deleteVariable(Long id) {
        fileVariableRepository.deleteById(id);
    }
}
