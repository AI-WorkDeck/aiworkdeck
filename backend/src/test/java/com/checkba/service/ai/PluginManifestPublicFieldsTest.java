// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.exc.UnrecognizedPropertyException;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class PluginManifestPublicFieldsTest {
    private final ObjectMapper json = new ObjectMapper();
    @Test void jacksonAcceptsPublicSchemaReference() throws Exception {
        var metadata = json.readValue("{\"$schema\":\"./manifest.schema.json\",\"id\":\"demo-plugin\"}", PluginService.PluginMetadata.class);
        assertEquals("demo-plugin", metadata.getId());
    }
    @Test void jacksonAcceptsPublicSettingDefault() throws Exception {
        var metadata = json.readValue("{\"id\":\"demo-plugin\",\"settings\":[{\"key\":\"greeting\",\"type\":\"string\",\"default\":\"Hello\"}]}", PluginService.PluginMetadata.class);
        assertEquals("Hello", metadata.getSettings().get(0).getDefaultValue());
    }
    @Test void jacksonRetainsLegacyDefaultValue() throws Exception {
        var setting = json.readValue("{\"key\":\"count\",\"type\":\"number\",\"defaultValue\":3}", PluginService.PluginSettingDecl.class);
        assertEquals(3, setting.getDefaultValue());
    }
    @Test void runtimeParserPreservesPublicAndLegacyDefaults() {
        var service = new PluginService();
        for (String field : new String[]{"default", "defaultValue"}) {
            var metadata = service.parseManifest("{\"$schema\":\"./manifest.schema.json\",\"id\":\"demo-plugin\",\"settings\":[{\"key\":\"enabled\",\"type\":\"boolean\",\"" + field + "\":false}]}");
            assertEquals(false, metadata.getSettings().get(0).getDefaultValue(), field);
        }
    }
    @Test void jacksonStillRejectsMisspelledManifestAndSettingFields() {
        assertThrows(UnrecognizedPropertyException.class, () -> json.readValue("{\"id\":\"demo-plugin\",\"permissionz\":[]}", PluginService.PluginMetadata.class));
        assertThrows(UnrecognizedPropertyException.class, () -> json.readValue("{\"key\":\"greeting\",\"defualt\":\"Hello\"}", PluginService.PluginSettingDecl.class));
    }
}
