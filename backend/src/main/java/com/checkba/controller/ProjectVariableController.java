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
    public ResponseEntity<?> saveVariable(
            @RequestHeader(value = "X-Session-Id", required = false) String sessionId,
            @RequestBody ProjectVariable variable
    ) {
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) {
            // For project variables, we might allow creation without explicit login if it's a client mode, 
            // but usually we need a creator. 
            // If userId is null, we can try to get it from context or just leave it null (system).
        } else {
            variable.setCreatorId(userId);
            // We ideally want the username/display name too, but AuthController only exposes ID efficiently.
            // We can fetch user or just use ID. For now, we set ID. 
            // To get name, we would need UserService. 
            // Let's assume frontend might send name or we fetch it. 
            // For simplicity in this step, if frontend sends creatorName, we keep it, else we might leave it or fetch.
            // But common pattern here:
            if (variable.getCreatorName() == null) {
                 String username = AuthController.getUsernameFromSession(sessionId);
                 variable.setCreatorName(username != null ? username : "Unknown");
            }
        }
        return ResponseEntity.ok(service.createOrUpdateVariable(variable));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteVariable(@PathVariable Long id) {
        service.deleteVariable(id);
        return ResponseEntity.ok().build();
    }
}

