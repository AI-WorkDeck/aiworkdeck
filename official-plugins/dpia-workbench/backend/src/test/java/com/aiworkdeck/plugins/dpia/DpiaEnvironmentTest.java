// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.aiworkdeck.plugins.dpia;

import org.junit.jupiter.api.Test;
import java.nio.file.Path;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static com.aiworkdeck.plugins.dpia.DpiaEnvironment.*;

class DpiaEnvironmentTest {
    static String python(boolean missing) {
        return "{\"checks\":[" + String.join(",", List.of("python", "python-docx", "pypdf", "pypdfium2", "reportlab", "font").stream()
            .map(id -> "{\"id\":\"" + id + "\",\"label\":\"" + id + "\",\"status\":\"" + (missing && id.equals("python-docx") ? "needs_attention" : "ready") + "\",\"message\":\"" + (missing ? "缺少库，请安装 requirements.txt" : "可用") + "\"}").toList()) + "]}";
    }
    @SuppressWarnings("unchecked") static Map<String,String> item(Map<String,Object> response, String id) {
        return ((List<Map<String,String>>) response.get("checks")).stream().filter(c -> c.get("id").equals(id)).findFirst().orElseThrow();
    }
    @Test void nodeMissingOrOldDoesNotPreventOtherChecks() {
        for (Result node : List.of(new Result(-1,"","无法启动程序"), new Result(0,"v18.20.0",null))) {
            var commands = new ArrayList<List<String>>();
            var check = new DpiaEnvironment((cmd, env) -> { commands.add(cmd); return cmd.get(0).equals("node") ? node : cmd.get(0).equals("python3") ? new Result(0,python(false),null) : new Result(0,"LibreOffice 26",null); }, "Mac OS X");
            var response = check.check(Path.of("/plugin"), key -> null, Map.of());
            assertEquals(false, response.get("ready")); assertEquals(3, commands.size());
            assertEquals("needs_attention", item(response,"node").get("status"));
            assertEquals("ready", item(response,"font").get("status"));
        }
    }
    @Test void missingLibrariesAndOfficeLaunchFailureAreActionable() {
        var check = new DpiaEnvironment((cmd, env) -> cmd.get(0).equals("node") ? new Result(0,"v22.0.0",null)
            : cmd.get(0).equals("python3") ? new Result(0,python(true),null) : new Result(-1,"","无法启动程序"), "Windows 11");
        var result = check.check(Path.of("/plugin"), key -> null, Map.of());
        assertEquals(false,result.get("ready"));
        assertTrue(item(result,"python-docx").get("message").contains("requirements.txt"));
        assertTrue(item(result,"libreoffice").get("message").contains("插件设置"));
    }
    @Test void settingsWinOverEnvironmentAndCommandArgumentsRemainSeparate() {
        List<List<String>> commands = new ArrayList<>(); List<Map<String,String>> environments = new ArrayList<>();
        var check = new DpiaEnvironment((cmd, env) -> { commands.add(cmd); environments.add(env); return new Result(1,"",null); }, "Windows 11");
        check.check(Path.of("/plugin space"), key -> Map.of("nodePath","/setting space/node", "pythonPath","/setting space/python", "sofficePath","/setting space/office", "pdfFontPath","/setting/font.ttf").get(key),
            Map.of("AWD_DPIA_NODE","/env/node", "AWD_DPIA_PYTHON","/env/python", "AWD_DPIA_SOFFICE","/env/office"));
        assertEquals(List.of("/setting space/node","--version"),commands.get(0));
        assertEquals(List.of("/setting space/python","/plugin space/runtime/environment-check.py"),commands.get(1));
        assertEquals("/setting/font.ttf",environments.get(1).get("DSH_DPIA_PDF_FONT"));
        assertEquals(List.of("/setting space/office","--version"),commands.get(2));
    }
    @Test void unsupportedPlatformNeverStartsAProcess() {
        var check = new DpiaEnvironment((cmd,env) -> { fail("must not launch"); return null; }, "Solaris");
        assertEquals(false,check.check(Path.of("/plugin"), key -> null,Map.of()).get("supported"));
    }
    @Test void realRuntimeWithExplicitPaths() {
        String python = System.getenv("AWD_DPIA_TEST_PYTHON");
        org.junit.jupiter.api.Assumptions.assumeTrue(python != null, "Set AWD_DPIA_TEST_PYTHON for installed runtime validation");
        var settings = Map.of("pythonPath", python, "nodePath", System.getenv().getOrDefault("AWD_DPIA_TEST_NODE", "node"),
                "sofficePath", System.getenv("AWD_DPIA_TEST_SOFFICE"), "pdfFontPath", System.getenv("AWD_DPIA_TEST_FONT"));
        var root = Path.of(System.getProperty("user.dir")).getParent();
        var result = new DpiaEnvironment().check(root, settings::get, System.getenv());
        assertEquals(true, result.get("ready"), result.toString());
    }
    @Test @org.junit.jupiter.api.condition.DisabledOnOs(org.junit.jupiter.api.condition.OS.WINDOWS)
    void actualNativeProbeIsBoundedAndHandlesNonzeroExit() {
        assertEquals(7, DpiaEnvironment.run(List.of("/bin/sh", "-c", "exit 7"), Map.of()).exitCode());
        long start = System.nanoTime();
        var result = DpiaEnvironment.run(List.of("/bin/sh", "-c", "sleep 30"), Map.of());
        assertTrue(result.failure().contains("超时"));
        assertTrue(java.time.Duration.ofNanos(System.nanoTime() - start).toSeconds() < 15);
    }

    @Test void actualMissingExecutableIsAReadableFailure() {
        var result = DpiaEnvironment.run(List.of("/definitely/missing/dpia-node", "--version"),Map.of());
        assertNotNull(result.failure()); assertTrue(result.failure().contains("执行权限"));
    }
}
