// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.api.condition.DisabledOnOs;
import org.junit.jupiter.api.condition.OS;
import org.springframework.test.util.ReflectionTestUtils;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

class LibreOfficePdfConverterTest {
    @TempDir Path dir;
    Path executable(String relative, String script) throws Exception {
        Path path = dir.resolve(relative); Files.createDirectories(path.getParent());
        Files.writeString(path, script); path.toFile().setExecutable(true); return path;
    }
    LibreOfficePdfConverter converter(Path executable) {
        var converter = new LibreOfficePdfConverter();
        ReflectionTestUtils.setField(converter, "configuredExecutable", executable.toString());
        ReflectionTestUtils.setField(converter, "timeoutSeconds", 1L);
        return converter;
    }
    void rejects(Path executable, LibreOfficePdfConverter.Failure failure) {
        var error = assertThrows(LibreOfficePdfConverter.ConversionException.class,
                () -> converter(executable).convert(new byte[]{1}, "docx"));
        assertEquals(failure, error.failure);
    }
    @Test void explicitMissingPathDoesNotSilentlyUseAnotherInstall() {
        assertNull(LibreOfficePdfConverter.findExecutable("Windows 11", dir.toString(), Map.of("PATH", "/bin"), dir.resolve("missing").toString()));
    }
    @Test void windowsCustomProgramFilesAndPathWithSpaces() throws Exception {
        Path app = executable("Other Drive/Program Files/LibreOffice/program/soffice.exe", "");
        assertEquals(app, LibreOfficePdfConverter.findExecutable("Windows 11", dir.toString(), Map.of("ProgramFiles(x86)", dir.resolve("Other Drive/Program Files").toString()), null));
        assertEquals(app, LibreOfficePdfConverter.findExecutable("Windows 11", dir.toString(), Map.of("Path", "\"" + app.getParent() + "\""), null));
    }
    @Test void windowsPrefersConsoleLauncherInInstallDirectoryAndPath() throws Exception {
        Path gui = executable("Program Files/LibreOffice/program/soffice.exe", "");
        Path cli = executable("Program Files/LibreOffice/program/soffice.com", "");
        assertEquals(cli, LibreOfficePdfConverter.findExecutable("Windows 11", dir.toString(), Map.of("ProgramFiles", dir.resolve("Program Files").toString()), null));
        assertEquals(cli, LibreOfficePdfConverter.findExecutable("Windows 11", dir.toString(), Map.of("Path", "\"" + gui.getParent() + "\""), null));
    }
    @Test void windowsDirectoryOverridePrefersConsoleButExplicitFileIsRespected() throws Exception {
        Path gui = executable("Custom Office/program/soffice.exe", "");
        Path cli = executable("Custom Office/program/soffice.com", "");
        assertEquals(cli, LibreOfficePdfConverter.findExecutable("Windows 11", dir.toString(), Map.of(), dir.resolve("Custom Office").toString()));
        assertEquals(cli, LibreOfficePdfConverter.findExecutable("Windows 11", dir.toString(), Map.of("LIBREOFFICE_PATH", cli.getParent().toString()), null));
        assertEquals(gui, LibreOfficePdfConverter.findExecutable("Windows 11", dir.toString(), Map.of(), gui.toString()));
    }
    @Test void windowsFallsBackToExeWhenConsoleLauncherIsMissing() throws Exception {
        Path gui = executable("Legacy Office/program/soffice.exe", "");
        assertEquals(gui, LibreOfficePdfConverter.findExecutable("Windows 11", dir.toString(), Map.of(), dir.resolve("Legacy Office").toString()));
        assertEquals(gui, LibreOfficePdfConverter.findExecutable("Windows 11", dir.toString(), Map.of("PATH", gui.getParent().toString()), null));
    }
    @Test void macCustomAppBundleAndPath() throws Exception {
        Path app = executable("User Apps/LibreOffice.app/Contents/MacOS/soffice", "");
        assertEquals(app, LibreOfficePdfConverter.findExecutable("Mac OS X", dir.toString(), Map.of(), dir.resolve("User Apps/LibreOffice.app").toString()));
        assertEquals(app, LibreOfficePdfConverter.findExecutable("Linux", dir.toString(), Map.of("SOFFICE_PATH", app.toString()), null));
    }
    @Test @DisabledOnOs(OS.WINDOWS) void readOnlyProbeDistinguishesMissingUnexecutableAndReady() throws Exception {
        assertEquals("MISSING", converter(dir.resolve("missing")).probe().status());
        Path invalid = executable("not executable", "#!/bin/sh\nexit 0\n"); invalid.toFile().setExecutable(false);
        assertEquals("NOT_EXECUTABLE", converter(invalid).probe().status());
        Path ready = executable("version only", "#!/bin/sh\n[ \"$#\" -eq 1 ] && [ \"$1\" = --version ]\n");
        assertEquals("AVAILABLE", converter(ready).probe().status());
        assertEquals("FAILED", converter(executable("broken", "#!/bin/sh\nexit 1\n")).probe().status());
    }

    @Test @DisabledOnOs(OS.WINDOWS) void missingNonzeroTimeoutNoOutputAndInvalidOutputAreDistinct() throws Exception {
        rejects(dir.resolve("missing"), LibreOfficePdfConverter.Failure.NOT_INSTALLED);
        Path unexecutable = executable("unexecutable/soffice", "#!/bin/sh\nexit 0\n"); unexecutable.toFile().setExecutable(false);
        rejects(unexecutable, LibreOfficePdfConverter.Failure.NOT_EXECUTABLE);
        rejects(executable("cannot start/soffice", "#!/missing-interpreter-1385\n"), LibreOfficePdfConverter.Failure.START_FAILED);
        rejects(executable("exit failed/soffice", "#!/bin/sh\nexit 7\n"), LibreOfficePdfConverter.Failure.EXIT_FAILED);
        rejects(executable("timeout/soffice", "#!/bin/sh\nsleep 10\n"), LibreOfficePdfConverter.Failure.TIMEOUT);
        rejects(executable("no output/soffice", "#!/bin/sh\nexit 0\n"), LibreOfficePdfConverter.Failure.NO_OUTPUT);
        rejects(executable("invalid/soffice", "#!/bin/sh\nfor arg in \"$@\"; do last=\"$arg\"; done\nprintf broken > \"${last%.docx}.pdf\"\n"), LibreOfficePdfConverter.Failure.INVALID_OUTPUT);
    }
}
