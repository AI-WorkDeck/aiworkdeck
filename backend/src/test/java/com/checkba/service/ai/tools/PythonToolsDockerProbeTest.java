// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.tools;

import org.junit.jupiter.api.Test;
import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class PythonToolsDockerProbeTest {
    static class StubTools extends PythonTools {
        long now;
        int probes;
        boolean missing = true;
        String found = "/Applications/Docker.app/Contents/Resources/bin/docker";
        Process result;
        List<String> sandboxCommand;
        StubTools() { super(null, null, null, null); }
        @Override long probeClockMillis() { return now; }
        @Override List<String> dockerCandidates() { return List.of("docker", found); }
        @Override Process startDockerProbe(String executable) throws IOException {
            probes++;
            if (missing || !executable.equals(found)) throw new IOException("absent");
            return result;
        }
        @Override public Map<String, String> injectableCredentials() { return Map.of(); }
        @Override Process startSandbox(ProcessBuilder builder) throws IOException {
            sandboxCommand = List.copyOf(builder.command());
            return result;
        }
    }
    private Process exited(int code) throws Exception {
        Process process = mock(Process.class);
        when(process.waitFor(3, TimeUnit.SECONDS)).thenReturn(true);
        when(process.exitValue()).thenReturn(code);
        when(process.getInputStream()).thenReturn(InputStream.nullInputStream());
        when(process.getErrorStream()).thenReturn(InputStream.nullInputStream());
        return process;
    }

    @Test void shortCacheExpiresAndExplicitRefreshBypassesIt() throws Exception {
        StubTools tools = new StubTools();
        assertEquals("MISSING", tools.dockerStatus());
        int probes = tools.probes;
        tools.missing = false; tools.result = exited(0);
        assertFalse(tools.isAvailable());
        assertEquals(probes, tools.probes);
        tools.now = 30_001;
        assertTrue(tools.isAvailable());
        tools.result = exited(1);
        assertEquals("DAEMON_UNAVAILABLE", tools.refreshDockerStatus());
        assertFalse(tools.isAvailable());
        tools.result = exited(0);
        assertEquals("AVAILABLE", tools.refreshDockerStatus());
        assertTrue(tools.isAvailable());
    }

    @Test void timedOutProbeIsKilledAndNeverOffersSandbox() throws Exception {
        StubTools tools = new StubTools(); tools.missing = false;
        tools.result = mock(Process.class);
        when(tools.result.isAlive()).thenReturn(true);
        assertEquals("TIMED_OUT", tools.refreshDockerStatus());
        verify(tools.result).waitFor(3, TimeUnit.SECONDS);
        verify(tools.result).destroyForcibly();
        assertFalse(tools.isAvailable());
        assertTrue(tools.run_python("print(1)").startsWith("Error"));
        assertNull(tools.sandboxCommand); // never falls back to host Python
    }

    @Test void sandboxUsesTheSameAbsoluteCliThatPassedTheProbe() throws Exception {
        StubTools tools = new StubTools(); tools.missing = false; tools.result = exited(0);
        assertEquals("AVAILABLE", tools.refreshDockerStatus());
        assertTrue(tools.run_python("print(1)").startsWith("Python Output:"));
        assertEquals(tools.found, tools.sandboxCommand.get(0));
        assertEquals("run", tools.sandboxCommand.get(1));
        assertTrue(tools.sandboxCommand.contains("python:3.9-slim"));
    }

    @Test void productionCandidatesIncludeDockerDesktopLocations() {
        PythonTools tools = new PythonTools(null, null, null, null);
        String previous = System.getProperty("os.name");
        try {
            System.setProperty("os.name", "Mac OS X");
            assertTrue(tools.dockerCandidates().contains("/Applications/Docker.app/Contents/Resources/bin/docker"));
            System.setProperty("os.name", "Windows 11");
            assertTrue(tools.dockerCandidates().stream().anyMatch(s -> s.contains("Program Files") && s.endsWith("docker.exe")));
        } finally { System.setProperty("os.name", previous); }
    }
}
