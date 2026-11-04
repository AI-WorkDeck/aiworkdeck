// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba;

import org.junit.jupiter.api.Test;
import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;
import java.util.regex.Pattern;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Native browser/tool processes must not share Surefire's result protocol stream (#1709). */
class SurefireTransportIntegrityTest {
    @Test void forkActuallyUsesTcp() throws Exception {
        String command = System.getProperty("sun.java.command", "");
        var configName = Pattern.compile("\\b(surefire-\\d+_\\d+tmp)\\b").matcher(command);
        assertTrue(configName.find(), "Surefire fork must identify its boot configuration");
        Path config = Path.of(System.getProperty("basedir"), "target", "surefire", configName.group(1));
        var properties = new Properties();
        try (var input = Files.newInputStream(config)) { properties.load(input); }
        assertTrue(properties.getProperty("forkNodeConnectionString", "").startsWith("tcp://"),
                "The fork's actual boot configuration must use the TCP event channel");
    }
    @Test void nativeStdoutAndStderrDoNotCorruptTestEvents() throws Exception {
        // Deliberately bypass System.out/System.err, like Playwright's native download process.
        // Do not close these wrappers: the process owns its standard descriptors.
        var stdout = new FileOutputStream(FileDescriptor.out);
        var stderr = new FileOutputStream(FileDescriptor.err);
        for (int i = 0; i < 20; i++) {
            stdout.write(("native-stdout-probe-" + i + "\n").getBytes(StandardCharsets.UTF_8));
            stderr.write(("native-stderr-probe-" + i + "\n").getBytes(StandardCharsets.UTF_8));
        }
        stdout.flush();
        stderr.flush();
    }
}
