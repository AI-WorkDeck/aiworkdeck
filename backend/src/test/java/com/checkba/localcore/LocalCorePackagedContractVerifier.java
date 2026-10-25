// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.localcore;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;

/** Runs at Maven verify: validates the actual nested-jar loader without starting application services. */
public final class LocalCorePackagedContractVerifier {
    public static final class Probe {
        public static void main(String[] args) {
            var contract = LocalCorePersistenceContract.bundled();
            if (contract == null) throw new IllegalStateException("Packaged persistence contract unavailable");
            System.out.println("PACKAGED_PERSISTENCE_CONTRACT_OK=" + contract.id());
        }
    }

    public static void main(String[] args) throws Exception {
        Path directory = Files.createTempDirectory("awd-persistence-contract-");
        String resource = "com/checkba/localcore/LocalCorePackagedContractVerifier$Probe.class";
        Path probe = directory.resolve(resource), log = directory.resolve("probe.log");
        Process process = null;
        try {
            Files.createDirectories(probe.getParent());
            // Copy only this probe: adding test-classes would change the mapping scan under test.
            try (var input = LocalCorePackagedContractVerifier.class.getClassLoader().getResourceAsStream(resource)) {
                if (input == null) throw new IllegalStateException("Packaged contract probe unavailable");
                Files.copy(input, probe);
            }
            String executable = System.getProperty("os.name").startsWith("Windows") ? "java.exe" : "java";
            process = new ProcessBuilder(Path.of(System.getProperty("java.home"), "bin", executable).toString(),
                    "-Dloader.main=com.checkba.localcore.LocalCorePackagedContractVerifier$Probe",
                    "-Dloader.path=" + directory, "-cp", Path.of(args[0]).toAbsolutePath().toString(),
                    "org.springframework.boot.loader.launch.PropertiesLauncher")
                    .directory(directory.toFile()).redirectErrorStream(true).redirectOutput(log.toFile()).start();
            if (!process.waitFor(30, TimeUnit.SECONDS)) throw new IllegalStateException("Packaged contract probe timed out");
            String output = Files.readString(log);
            if (process.exitValue() != 0 || !output.matches("(?s).*PACKAGED_PERSISTENCE_CONTRACT_OK=[a-f0-9]{64}\\R.*"))
                throw new IllegalStateException("Packaged persistence contract verification failed: " + output);
            System.out.print(output);
        } finally {
            if (process != null && process.isAlive()) {
                process.destroyForcibly(); process.waitFor(5, TimeUnit.SECONDS);
            }
            // This directory contains only this verifier's class and output.
            try (var paths = Files.walk(directory)) {
                for (Path path : paths.sorted(java.util.Comparator.reverseOrder()).toList()) Files.deleteIfExists(path);
            }
        }
    }
}
