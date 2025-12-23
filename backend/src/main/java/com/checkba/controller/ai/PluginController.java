package com.checkba.controller.ai;

import com.checkba.service.ai.PluginService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Controller to expose plugin information to the frontend.
 */
@RestController
@RequestMapping("/api/plugins")
@RequiredArgsConstructor
public class PluginController {

    private final PluginService pluginService;

    @GetMapping("/list")
    public List<PluginService.PluginMetadata> listPlugins() {
        return pluginService.getPlugins();
    }
}
