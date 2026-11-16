// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

/**
 * 宿主内置英文兜底（BUILTIN_PLUGIN_EN）里每个官方插件的名称，都必须与该插件自己的 en-US 词条一致：
 * plugin.name、view.main.name，以及以 manifest 中文名为键的那条。曾出现 Project Messaging / Project Chat、
 * Desensitize / File Redaction 两处分叉。
 */
class PluginBuiltinEnglishNameTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void everyFallbackNameMatchesThePluginsEnglishName() throws Exception {
        Path plugins = Path.of("..", "official-plugins");
        Assumptions.assumeTrue(Files.isDirectory(plugins), "official-plugins 不在（非完整仓库检出），跳过");
        List<String> problems = new ArrayList<>();
        int checked = 0;
        for (Map.Entry<String, Map<String, String>> e : PluginService.BUILTIN_PLUGIN_EN.entrySet()) {
            Path l10n = plugins.resolve(e.getKey()).resolve("l10n").resolve("en-US.json");
            Path manifest = plugins.resolve(e.getKey()).resolve("manifest.json");
            if (!Files.isRegularFile(l10n)) continue;
            JsonNode en = JSON.readTree(l10n.toFile());
            String name = en.path("plugin.name").asText();
            Map<String, String> table = e.getValue();
            if (table.containsKey("plugin.name") && !name.equals(table.get("plugin.name")))
                problems.add(e.getKey() + " plugin.name: " + table.get("plugin.name") + " ≠ " + name);
            String view = en.path("view.main.name").asText("");
            if (!view.isEmpty() && table.containsKey("view.main.name") && !view.equals(table.get("view.main.name")))
                problems.add(e.getKey() + " view.main.name: " + table.get("view.main.name") + " ≠ " + view);
            if (Files.isRegularFile(manifest)) {
                String zhName = JSON.readTree(manifest.toFile()).path("name").asText();
                if (table.containsKey(zhName) && !name.equals(table.get(zhName)))
                    problems.add(e.getKey() + " [" + zhName + "]: " + table.get(zhName) + " ≠ " + name);
            }
            checked++;
        }
        assertTrue(checked >= 10, "checked only " + checked);
        assertEquals(List.of(), problems);
        assertEquals("Project Chat", PluginService.BUILTIN_PLUGIN_EN.get("project-im").get("plugin.name"));
        assertEquals("File Redaction", PluginService.BUILTIN_PLUGIN_EN.get("desensitize").get("文件脱敏"));
    }
}
