// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.version;

import com.checkba.storage.ProjectStorageResolver;
import com.checkba.storage.StorageProperties;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

/** A clean filter that spills to disk must terminate on Unix as well as Windows. */
class VersionFilterSpillTest {
    @TempDir Path root;

    @Test void inlineFileOverJgitMemoryLimitCanBeRecordedRestoredAndReenabled() throws Exception {
        Path log = root.resolve("child.log");
        // A regression spins in native skip(), which thread interruption cannot stop.
        // Isolate it in a child JVM so failure cannot strand the test runner.
        Process child = new ProcessBuilder(
                Path.of(System.getProperty("java.home"), "bin", "java").toString(),
                "-cp", System.getProperty("surefire.test.class.path", System.getProperty("java.class.path")),
                Scenario.class.getName(), root.toString())
                .redirectErrorStream(true).redirectOutput(log.toFile()).start();
        try {
            assertTrue(child.waitFor(20, TimeUnit.SECONDS),
                    "Version filter did not terminate; child log: " + Files.readString(log));
            assertEquals(0, child.exitValue(), Files.readString(log));
            assertTrue(Files.readString(log).contains("SCENARIO_PASSED"));
        } finally {
            if (child.isAlive()) {
                child.destroyForcibly();
                assertTrue(child.waitFor(5, TimeUnit.SECONDS), "Child JVM could not be stopped");
            }
        }
    }

    public static class Scenario {
        public static void main(String[] args) throws Exception {
            Path root = Path.of(args[0]);
            var properties = new StorageProperties();
            properties.getLocal().setRootPath(root.toString());
            var service = new ProjectRepoService(new ProjectStorageResolver(properties, null));
            Path file = root.resolve("projects/7/inline.txt");
            Files.createDirectories(file.getParent());
            // Above JGit's 1 MiB spill threshold, below our 50 MiB object threshold.
            byte[] original = new byte[2 * 1024 * 1024];
            Arrays.fill(original, (byte) 'a');
            Files.write(file, original);
            Path media = file.resolveSibling("recording.mp3");
            Files.write(media, original);
            System.out.println("initializing");
            service.init(7, "Tester", "tester@example.test");
            String first = service.resolveRef(7, "HEAD");
            assertArrayEquals(original, service.readBlobAtCommit(7, first, "inline.txt"));
            assertEquals(1, service.objectPointersAt(7, first, true).size());
            assertArrayEquals(original, service.readBlobAtCommit(7, first, "recording.mp3"));
            assertTrue(service.pendingChanges(7).isEmpty());
            service.createBranch(7, "original", first);

            byte[] updated = original.clone();
            updated[0] = 'b';
            Files.write(file, updated);
            assertFalse(service.pendingChanges(7).isEmpty());
            String second = service.commitAll(7, "saved", "auto", null, "Tester", "tester@example.test");
            assertNotNull(second);
            assertArrayEquals(updated, service.readBlobAtCommit(7, second, "inline.txt"));
            service.checkoutBranch(7, "original");
            assertArrayEquals(original, Files.readAllBytes(file));
            service.checkoutBranch(7, "master");
            assertArrayEquals(updated, Files.readAllBytes(file));
            assertTrue(service.pendingChanges(7).isEmpty());

            service.deleteRepository(7);
            assertArrayEquals(updated, Files.readAllBytes(file));
            service.init(7, "Tester", "tester@example.test");
            assertTrue(service.pendingChanges(7).isEmpty());
            assertArrayEquals(updated, service.readBlobAtCommit(7, "HEAD", "inline.txt"));
            System.out.println("SCENARIO_PASSED");
        }
    }
}
