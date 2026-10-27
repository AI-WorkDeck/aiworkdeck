// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.aiworkdeck.plugins.dpia;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Path;
import java.nio.file.Files;
import java.util.Map;
import com.checkba.plugin.api.ToolCall;
import static com.aiworkdeck.plugins.dpia.DpiaRuntime.JSON;
import static org.junit.jupiter.api.Assertions.*;

/** Exercises the packaged adapter over actual stdin/stdout; requires Node.js on PATH. */
class DpiaAdapterIntegrationTest {
    @TempDir Path directory;

    @Test void realArchiveExportAcceptsHomeAliasButStillUsesCanonicalScope() throws Exception {
        Path realHome = Files.createDirectory(directory.resolve("real-home"));
        Path aliasHome = Files.createSymbolicLink(directory.resolve("alias-home"), realHome);
        Path aliasedData = aliasHome.resolve(".aiworkdeck/plugin-data/dpia-workbench");
        DpiaWorkbenchTools plugin = new DpiaWorkbenchTools(new DpiaRuntime.NativeRunner(),
            Path.of("..").toAbsolutePath().normalize(), aliasedData, Map.of());
        var host = new DpiaWorkbenchToolsTest.FakeHost(); plugin.setHost(host.proxy);
        var created = JSON.readTree(plugin.dpia_workbench_action("create", "{\"title\":\"合成别名导出\"}"));
        assertTrue(created.path("ok").asBoolean(), created.toString());
        String id = created.path("value").path("id").asText();
        var evidenceArgs = JSON.createObjectNode().put("id", id).put("version", 1)
            .put("title", "合成材料").put("text", "SYNTHETIC alias archive evidence");
        var evidence = JSON.readTree(plugin.dpia_workbench_action("evidence", evidenceArgs.toString()));
        assertTrue(evidence.path("ok").asBoolean(), evidence.toString());
        var archiveArgs = JSON.createObjectNode().put("id", id).put("version", 2);
        archiveArgs.putArray("sourceIds").add(evidence.path("value").path("evidence").get(0).path("id").asText());
        var exported = JSON.readTree(plugin.dpia_workbench_action("downloadArchive", archiveArgs.toString()));
        assertTrue(exported.path("ok").asBoolean(), exported.toString());
        assertEquals(99, exported.path("value").path("fileId").asInt());
        assertEquals("application/zip", exported.path("value").path("mime").asText());
        assertTrue(host.written.startsWith("PK")); assertEquals(9, host.writtenProject);
        assertTrue(Files.isDirectory(realHome.resolve(".aiworkdeck/plugin-data/dpia-workbench/u1/p9/exports")));
        assertFalse(exported.toString().contains(realHome.toString()));
        assertFalse(exported.toString().contains(aliasHome.toString()));
    }

    @Test void realNodeAdapterCreatesListsAndSeparatesProjects() throws Exception {
        Path pluginRoot = Path.of("..").toAbsolutePath().normalize();
        DpiaWorkbenchTools plugin = new DpiaWorkbenchTools(new DpiaRuntime.NativeRunner(), pluginRoot, directory, Map.of());
        var host = new DpiaWorkbenchToolsTest.FakeHost(); plugin.setHost(host.proxy);
        var created = JSON.readTree(plugin.dpia_workbench_action("create", "{\"title\":\"桥接集成测试\"}"));
        assertTrue(created.path("ok").asBoolean(), created.toString());
        var listed = JSON.readTree(plugin.dpia_workbench_action("list", "{}"));
        assertTrue(listed.path("ok").asBoolean(), listed.toString());
        assertEquals(1, listed.path("value").path("cases").size());
        assertEquals("桥接集成测试", listed.path("value").path("cases").get(0).path("title").asText());
        String id = created.path("value").path("id").asText();
        var startArgs = JSON.createObjectNode().put("id", id).put("version", 1).put("executionRevision", 0);
        var started = JSON.readTree(plugin.dpia_workbench_action("start", startArgs.toString()));
        assertTrue(started.path("ok").asBoolean(), started.toString());
        assertEquals("accepted", started.path("value").path("phase").asText());
        assertNotNull(host.submission); assertTrue(host.submission.get(2).toString().contains("dpia_workbench_task"));
        assertEquals(java.util.List.of("dpia-assessment"), host.submission.get(3));
        host.context = new ToolCall(9L, "conversation", 1L, null);
        var context = JSON.readTree(plugin.dpia_workbench_task(JSON.createObjectNode().put("id", id).put("operation", "context").toString()));
        assertTrue(context.path("ok").asBoolean(), context.toString());
        assertEquals(started.path("value").path("requestId").asText(), context.path("value").path("requestId").asText());
        host.context = new ToolCall(10L, null, 1L, null);
        var empty = JSON.readTree(plugin.dpia_workbench_action("list", "{}"));
        assertTrue(empty.path("ok").asBoolean(), empty.toString());
        assertEquals(0, empty.path("value").path("cases").size());
    }
}
