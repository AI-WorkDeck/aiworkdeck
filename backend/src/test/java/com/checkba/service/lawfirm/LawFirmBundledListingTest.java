// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.lawfirm;

import com.checkba.service.ai.PluginService;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;

/** C18：律所管理随 app.jar 内置，插件市场的「内置插件」目录要能列出它，广场连不上也找得到。 */
class LawFirmBundledListingTest {

    @Test
    void bundledLawFirmPluginIsListedAsInstallableBundle() {
        var installer = new LawFirmBundledPluginInstaller(mock(PluginService.class), "plugins");
        Map<String, Object> row = installer.bundledListing();
        assertNotNull(row, "app.jar ships bundled-plugins/lawfirm-management");
        assertEquals("lawfirm-management", row.get("id"));
        assertEquals(Boolean.TRUE, row.get("bundled"));
        assertNotNull(row.get("version"));
        assertTrue(String.valueOf(row.get("name")).contains("律所"), "market search for 律所 must match");
    }
}
