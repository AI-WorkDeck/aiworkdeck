package com.checkba.controller;

import com.checkba.model.entity.ProjectVariable;
import com.checkba.service.ProjectVariableService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/variables")
public class ProjectVariableController {

    @Autowired
    private ProjectVariableService service;

    @GetMapping("/project/{projectId}")
    public ResponseEntity<List<ProjectVariable>> getVariables(@PathVariable Long projectId) {
        return ResponseEntity.ok(service.getVariablesByProject(projectId));
    }

    @PostMapping
    public ResponseEntity<ProjectVariable> saveVariable(@RequestBody ProjectVariable variable) {
        return ResponseEntity.ok(service.createOrUpdateVariable(variable));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteVariable(@PathVariable Long id) {
        service.deleteVariable(id);
        return ResponseEntity.ok().build();
    }
}

