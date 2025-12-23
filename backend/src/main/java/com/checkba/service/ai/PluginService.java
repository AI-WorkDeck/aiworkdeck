package com.checkba.service.ai;

import dev.langchain4j.agent.tool.ToolSpecification;
import dev.langchain4j.agent.tool.ToolSpecifications;
import lombok.Getter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import java.io.File;
import java.io.IOException;
import java.lang.reflect.Method;
import java.net.URL;
import java.net.URLClassLoader;
import java.util.*;

/**
 * Service to manage backend plugins.
 * Scans 'plugins/' directory for JAR files and registers AI tools.
 */
@Service
@Slf4j
public class PluginService {

    @Getter
    private final List<PluginMetadata> plugins = new ArrayList<>();

    @Getter
    private final Map<String, Object> pluginTools = new HashMap<>(); // toolName -> toolObject
    
    @Getter
    private final List<ToolSpecification> toolSpecifications = new ArrayList<>();

    private String pluginsDir = "plugins";

    @lombok.Data
    public static class PluginMetadata {
        private String id;
        private String name;
        private String version;
        private String description;
        private String icon;
        private String frontendEntry;
        private List<String> backendJars;
    }

    @PostConstruct
    public void init() {
        loadPlugins();
    }

    public void loadPlugins() {
        File dir = new File(pluginsDir);
        if (!dir.exists()) {
            dir.mkdirs();
            return;
        }

        File[] pluginDirs = dir.listFiles(File::isDirectory);
        if (pluginDirs == null || pluginDirs.length == 0) {
            log.info("No plugin directories found in {}", pluginsDir);
            return;
        }

        for (File pluginDir : pluginDirs) {
            try {
                File manifestFile = new File(pluginDir, "manifest.json");
                if (!manifestFile.exists()) continue;

                log.info("Loading plugin metadata from: {}", pluginDir.getName());
                String json = cn.hutool.core.io.FileUtil.readUtf8String(manifestFile);
                PluginMetadata meta = cn.hutool.json.JSONUtil.toBean(json, PluginMetadata.class);
                plugins.add(meta);

                // Load associated JARs if any
                if (meta.getBackendJars() != null) {
                    for (String jarName : meta.getBackendJars()) {
                        File jarFile = new File(pluginDir, jarName);
                        if (jarFile.exists()) {
                            loadJar(jarFile);
                        }
                    }
                }
            } catch (Exception e) {
                log.error("Failed to load plugin: " + pluginDir.getName(), e);
            }
        }
    }

    private void loadJar(File jar) throws IOException, ClassNotFoundException {
        URLClassLoader loader = new URLClassLoader(new URL[]{jar.toURI().toURL()}, this.getClass().getClassLoader());
        
        try (java.util.jar.JarFile jarFile = new java.util.jar.JarFile(jar)) {
            Enumeration<java.util.jar.JarEntry> entries = jarFile.entries();
            
            while (entries.hasMoreElements()) {
                java.util.jar.JarEntry entry = entries.nextElement();
                String name = entry.getName();
                
                if (name.endsWith(".class")) {
                    String className = name.replace("/", ".").substring(0, name.length() - 6);
                    try {
                        Class<?> cls = loader.loadClass(className);
                        // Check if class has methods with @Tool annotation
                        boolean hasTools = Arrays.stream(cls.getDeclaredMethods())
                                .anyMatch(m -> m.isAnnotationPresent(dev.langchain4j.agent.tool.Tool.class));
                        
                        if (hasTools) {
                            log.info("Found tool class in plugin: {}", className);
                            // Instantiate and register
                            Object instance = cls.getDeclaredConstructor().newInstance();
                            registerToolObject(instance);
                        }
                    } catch (Throwable e) {
                        // Skip classes that can't be loaded (e.g. missing dependencies)
                        log.debug("Skipping class {}: {}", className, e.getMessage());
                    }
                }
            }
        } catch (Exception e) {
            log.error("Error scanning JAR {}: {}", jar.getName(), e.getMessage());
        }
    }
    
    /**
     * Registers a tool object (e.g., from a JAR or hardcoded).
     */
    public void registerToolObject(Object toolObject) {
        try {
            List<ToolSpecification> specs = ToolSpecifications.toolSpecificationsFrom(toolObject);
            for (ToolSpecification spec : specs) {
                log.info("Registered dynamic tool: {}", spec.name());
                pluginTools.put(spec.name(), toolObject);
                toolSpecifications.add(spec);
            }
        } catch (Exception e) {
            log.error("Failed to register tool object: " + toolObject.getClass().getName(), e);
        }
    }
}
