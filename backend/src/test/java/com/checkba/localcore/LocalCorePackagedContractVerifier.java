// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.localcore;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.jar.JarEntry;
import java.util.jar.JarOutputStream;
import java.util.zip.ZipFile;

/** Validates both the Boot loader and the installed desktop's app.jar + lib layout. */
public final class LocalCorePackagedContractVerifier {
    public static final class Probe {
        public static void main(String[] args) {
            var resolver = new org.springframework.core.io.support.PathMatchingResourcePatternResolver();
            if (new org.springframework.orm.jpa.persistenceunit.PersistenceManagedTypesScanner(resolver)
                    .scan("com.checkba").getManagedClassNames().isEmpty())
                throw new IllegalStateException("Packaged application mappings are not discoverable");
            var contract = LocalCorePersistenceContract.bundled();
            if (contract == null) throw new IllegalStateException("Packaged persistence contract unavailable");
            System.out.println("PACKAGED_PERSISTENCE_CONTRACT_OK=" + contract.id());
        }
    }

    public static void main(String[] args) throws Exception {
        Path directory = Files.createTempDirectory("awd-persistence-contract-");
        String resource = "com/checkba/localcore/LocalCorePackagedContractVerifier$Probe.class";
        Path probe = directory.resolve(resource);
        try {
            Files.createDirectories(probe.getParent());
            // Keep the probe outside the application archive, as a separate loader input.
            try (var input = LocalCorePackagedContractVerifier.class.getClassLoader().getResourceAsStream(resource)) {
                if (input == null) throw new IllegalStateException("Packaged contract probe unavailable");
                Files.copy(input, probe);
            }
            Path packaged = Path.of(args[0]).toAbsolutePath();
            verify(directory, "boot", List.of(
                    "-Dloader.main=com.checkba.localcore.LocalCorePackagedContractVerifier$Probe",
                    "-Dloader.path=" + directory, "-cp", packaged.toString(),
                    "org.springframework.boot.loader.launch.PropertiesLauncher"));
            // Same BOOT-INF/classes -> app.jar and BOOT-INF/lib -> lib transform
            // as desktop/scripts/prepare-backend.js, without building a JRE.
            Path libraries = Files.createDirectory(directory.resolve("lib"));
            Path app = directory.resolve("app.jar");
            try (var archive = new ZipFile(packaged.toFile());
                 var output = new JarOutputStream(Files.newOutputStream(app))) {
                for (var entries = archive.entries(); entries.hasMoreElements();) {
                    var entry = entries.nextElement();
                    if (entry.getName().startsWith("BOOT-INF/classes/")) {
                        String name = entry.getName().substring("BOOT-INF/classes/".length());
                        if (name.isEmpty()) continue;
                        output.putNextEntry(new JarEntry(name));
                        if (!entry.isDirectory()) {
                            try (var input = archive.getInputStream(entry)) { input.transferTo(output); }
                        }
                        output.closeEntry();
                    } else if (entry.getName().startsWith("BOOT-INF/lib/") && entry.getName().endsWith(".jar")) {
                        Path target = libraries.resolve(entry.getName().substring("BOOT-INF/lib/".length())).normalize();
                        if (!target.getParent().equals(libraries)) throw new IllegalStateException("Invalid library path");
                        try (var input = archive.getInputStream(entry)) { Files.copy(input, target); }
                    }
                }
            }
            String separator = java.io.File.pathSeparator;
            verify(directory, "desktop-split", List.of("-cp", directory + separator + app + separator + libraries + "/*",
                    "com.checkba.localcore.LocalCorePackagedContractVerifier$Probe"));
        } finally {
            // Only this verifier's extracted archives, probe and output live here.
            try (var paths = Files.walk(directory)) {
                for (Path path : paths.sorted(java.util.Comparator.reverseOrder()).toList()) Files.deleteIfExists(path);
            }
        }
    }

    private static void verify(Path directory, String layout, List<String> arguments) throws Exception {
        String executable = System.getProperty("os.name").startsWith("Windows") ? "java.exe" : "java";
        var command = new ArrayList<String>();
        command.add(Path.of(System.getProperty("java.home"), "bin", executable).toString());
        command.addAll(arguments);
        Path log = directory.resolve(layout + ".log");
        Process process = new ProcessBuilder(command).directory(directory.toFile())
                .redirectErrorStream(true).redirectOutput(log.toFile()).start();
        try {
            if (!process.waitFor(30, TimeUnit.SECONDS)) throw new IllegalStateException(layout + " contract probe timed out");
            String output = Files.readString(log);
            if (process.exitValue() != 0 || !output.matches("(?s).*PACKAGED_PERSISTENCE_CONTRACT_OK=[a-f0-9]{64}\\R.*"))
                throw new IllegalStateException(layout + " persistence contract verification failed: " + output);
            System.out.print(layout + ": " + output);
        } finally {
            if (process.isAlive()) { process.destroyForcibly(); process.waitFor(5, TimeUnit.SECONDS); }
        }
    }
}
