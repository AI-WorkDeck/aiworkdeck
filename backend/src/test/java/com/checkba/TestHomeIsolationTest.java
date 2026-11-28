// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 2026-11-28 incident: a local {@code mvn test} ran desktop-profile @SpringBootTest tests whose
 * {@code security.license.dir}, H2 file and other data paths default to {@code ${user.home}/.aiworkdeck}.
 * Surefire passed no user.home, so the test JVM used the developer's real home: it read the owner's real
 * account key and refreshed account.json / entitlements.json / license.json against production.
 *
 * <p>Every test JVM must run with an isolated home under the build directory (backend/pom.xml surefire and
 * failsafe argLine {@code -Duser.home=${project.build.directory}/test-home}). This guard fails the build when
 * that is missing, so no test can reach a real ~/.aiworkdeck again.
 */
class TestHomeIsolationTest {

    @Test
    void testsNeverRunAgainstTheRealHome() {
        String testHome = System.getProperty("user.home");
        assertNotNull(testHome);
        Path home = Path.of(testHome).toAbsolutePath().normalize();
        assertTrue(home.toString().replace('\\', '/').endsWith("/target/test-home"),
                "user.home must be the isolated <build dir>/test-home, was " + home
                        + " - see backend/pom.xml surefire/failsafe argLine");
        for (String env : new String[]{"HOME", "USERPROFILE"}) {
            String real = System.getenv(env);
            if (real == null || real.isBlank()) continue;
            Path realHome = Path.of(real).toAbsolutePath().normalize();
            assertNotEquals(realHome, home, "tests must not use the real " + env);
            assertFalse(home.startsWith(realHome.resolve(".aiworkdeck")), "tests must not use the real ~/.aiworkdeck");
        }
    }

    @Test
    void noTestResourcePinsARealHomeDataDir() throws IOException {
        Path resources = Path.of("src", "test", "resources");
        if (!Files.isDirectory(resources)) return;
        try (Stream<Path> files = Files.walk(resources)) {
            for (Path f : files.filter(Files::isRegularFile)
                    .filter(p -> p.toString().endsWith(".yml") || p.toString().endsWith(".yaml") || p.toString().endsWith(".properties")).toList()) {
                String text = Files.readString(f);
                assertFalse(text.matches("(?s).*(/Users/|/home/)[^/\\s]+/\\.aiworkdeck.*"),
                        f + " pins a real home's .aiworkdeck; use ${user.home} (isolated in tests) instead");
            }
        }
    }
}
