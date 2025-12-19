package com.checkba.controller;

import com.checkba.model.entity.FileVariable;
import com.checkba.service.FileVariableService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/file-variables")
@RequiredArgsConstructor
@CrossOrigin(origins = "*")
public class FileVariableController {

    private final FileVariableService fileVariableService;

    @GetMapping
    public Map<String, Object> getVariables(@RequestParam Long fileId) {
        List<FileVariable> variables = fileVariableService.getVariables(fileId);
        Map<String, Object> result = new HashMap<>();
        result.put("code", 0);
        result.put("data", variables);
        return result;
    }

    @PostMapping
    public Map<String, Object> createOrUpdateVariable(@RequestBody FileVariable variable) {
        FileVariable saved = fileVariableService.createOrUpdateVariable(variable);
        Map<String, Object> result = new HashMap<>();
        result.put("code", 0);
        result.put("data", saved);
        return result;
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> deleteVariable(@PathVariable Long id) {
        fileVariableService.deleteVariable(id);
        Map<String, Object> result = new HashMap<>();
        result.put("code", 0);
        result.put("message", "Deleted");
        return result;
    }
}
