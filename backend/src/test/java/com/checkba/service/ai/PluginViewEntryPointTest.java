// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** C1: a view may declare the host entry point "reviews", only on a global workspace view. */
class PluginViewEntryPointTest {

    @TempDir Path dir;

    private PluginService.PluginMetadata meta(String placement, String scope, String entryPoint) throws Exception {
        Files.createDirectories(dir.resolve("web"));
        Files.writeString(dir.resolve("web/index.html"), "<!doctype html>");
        PluginService.PluginViewDecl view = new PluginService.PluginViewDecl();
        view.setId("main");
        view.setName("Main");
        view.setEntry("web/index.html");
        view.setPlacement(placement);
        view.setScope(scope);
        view.setEntryPoint(entryPoint);
        PluginService.Contributes contributes = new PluginService.Contributes();
        contributes.setViews(List.of(view));
        PluginService.PluginMetadata meta = new PluginService.PluginMetadata();
        meta.setContributes(contributes);
        return meta;
    }

    @Test
    void reviewsOnGlobalWorkspaceViewIsAccepted() throws Exception {
        assertDoesNotThrow(() -> PluginManifestContractValidator.validateViews(meta("workspace", "global", "reviews"), dir.toFile()));
    }

    @Test
    void viewWithoutEntryPointIsUnchanged() throws Exception {
        assertDoesNotThrow(() -> PluginManifestContractValidator.validateViews(meta("workspace", "project", null), dir.toFile()));
    }

    @Test
    void unknownEntryPointIsRefused() throws Exception {
        var m = meta("workspace", "global", "inbox");
        assertThrows(IllegalArgumentException.class, () -> PluginManifestContractValidator.validateViews(m, dir.toFile()));
    }

    @Test
    void reviewsOnProjectOrSidebarViewIsRefused() throws Exception {
        var project = meta("workspace", "project", "reviews");
        assertThrows(IllegalArgumentException.class, () -> PluginManifestContractValidator.validateViews(project, dir.toFile()));
        var sidebar = meta("sidebar", "global", "reviews");
        assertThrows(IllegalArgumentException.class, () -> PluginManifestContractValidator.validateViews(sidebar, dir.toFile()));
    }
}
