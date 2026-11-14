// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

/** 宿主内置英文兜底里的项目沟通名称，必须与插件自己的 en-US 词条一致（两处曾分别写成 Project Messaging / Project Chat）。 */
class PluginBuiltinEnglishNameTest {
    @Test
    void projectImFallbackMatchesPluginEnglishName() throws Exception {
        Path l10n = Path.of("..", "official-plugins", "project-im", "l10n", "en-US.json");
        Assumptions.assumeTrue(Files.isRegularFile(l10n), "official-plugins 不在（非完整仓库检出），跳过");
        String pluginName = new ObjectMapper().readTree(l10n.toFile()).path("plugin.name").asText();
        assertEquals("Project Chat", pluginName);
        assertEquals(pluginName, PluginService.BUILTIN_PLUGIN_EN.get("project-im").get("plugin.name"));
        assertEquals(pluginName, PluginService.BUILTIN_PLUGIN_EN.get("project-im").get("项目沟通"));
    }
}
