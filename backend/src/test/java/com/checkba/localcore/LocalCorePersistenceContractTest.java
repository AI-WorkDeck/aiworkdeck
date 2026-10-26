// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.localcore;

import org.junit.jupiter.api.Test;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayInputStream;
import java.util.Map;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.jar.JarOutputStream;
import java.util.jar.JarEntry;
import java.net.JarURLConnection;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.core.env.MapPropertySource;
import static org.junit.jupiter.api.Assertions.*;

class LocalCorePersistenceContractTest {
    @TempDir Path temporary;

    @Test void classFingerprintMatchesExplodedAndPackagedLayoutsAndDetectsEveryClassChange() throws Exception {
        Path root = temporary.resolve("classes"), own = root.resolve("com/checkba/localcore/LocalCorePersistenceContract.class");
        Path ordinary = root.resolve("com/checkba/service/PreviouslyOrdinary.class");
        Files.createDirectories(own.getParent()); Files.createDirectories(ordinary.getParent());
        Files.write(own, new byte[]{1, 2}); Files.write(ordinary, new byte[]{3, 4});
        String expected = LocalCorePersistenceContract.applicationInputs(own.toUri().toURL());
        // Test/runtime-only classes in a sibling output directory cannot stale the generated app proof.
        Path testClass = temporary.resolve("test-classes/com/checkba/Test.class");
        Files.createDirectories(testClass.getParent()); Files.write(testClass, new byte[]{5});
        assertEquals(expected, LocalCorePersistenceContract.applicationInputs(own.toUri().toURL()));
        Path archive = temporary.resolve("app.jar");
        try (var out = new JarOutputStream(Files.newOutputStream(archive))) {
            for (Path file : new Path[]{ordinary, own}) {
                out.putNextEntry(new JarEntry(root.relativize(file).toString().replace('\\', '/')));
                out.write(Files.readAllBytes(file)); out.closeEntry();
            }
        }
        var packaged = java.net.URI.create("jar:" + archive.toUri() + "!/com/checkba/localcore/LocalCorePersistenceContract.class").toURL();
        try { assertEquals(expected, LocalCorePersistenceContract.applicationInputs(packaged)); }
        finally { ((JarURLConnection) packaged.openConnection()).getJarFile().close(); }
        Files.write(ordinary, new byte[]{3, 5});
        assertNotEquals(expected, LocalCorePersistenceContract.applicationInputs(own.toUri().toURL()), "New persistence annotations on an ordinary class must invalidate stale resources");
        Files.write(ordinary, new byte[]{3, 4});
        Files.write(root.resolve("com/checkba/Added.class"), new byte[]{6});
        assertNotEquals(expected, LocalCorePersistenceContract.applicationInputs(own.toUri().toURL()));
        Files.delete(root.resolve("com/checkba/Added.class")); Files.delete(ordinary);
        assertNotEquals(expected, LocalCorePersistenceContract.applicationInputs(own.toUri().toURL()));
        assertThrows(IllegalStateException.class, () -> LocalCorePersistenceContract.applicationInputs(null));
    }

    @Test void fullDesktopMappingGeneratesStableSchemaAcrossIndependentDatabases() throws Exception {
        assertEquals(LocalCorePersistenceContractGenerator.schema(), LocalCorePersistenceContractGenerator.schema());
    }

    @Test void packagedContractRequiresCurrentMappingsDependenciesFormatAndBootstrapEpoch() throws Exception {
        var mapper = new ObjectMapper();
        byte[] original;
        try (var input = getClass().getResourceAsStream(LocalCorePersistenceContract.RESOURCE)) {
            assertNotNull(input); original = input.readAllBytes();
        }
        var valid = LocalCorePersistenceContract.decode(new ByteArrayInputStream(original));
        assertNotNull(valid);
        assertEquals(valid, LocalCorePersistenceContract.bundled());
        assertNull(LocalCorePersistenceContract.decode(null));
        for (var invalid : Map.<String, Object>of("format", 99, "bootstrapEpoch", "2", "h2", "unknown",
                "hibernate", "unknown", "schema", "incomplete", "applicationInputs", "b".repeat(64)).entrySet()) {
            var tree = mapper.readTree(original);
            ((com.fasterxml.jackson.databind.node.ObjectNode) tree).set(invalid.getKey(), mapper.valueToTree(invalid.getValue()));
            assertNull(LocalCorePersistenceContract.decode(new ByteArrayInputStream(mapper.writeValueAsBytes(tree))), invalid.getKey());
        }
        var changedSchema = (com.fasterxml.jackson.databind.node.ObjectNode) mapper.readTree(original);
        changedSchema.put("schema", "a".repeat(64));
        assertNotEquals(valid.id(), LocalCorePersistenceContract.decode(
                new ByteArrayInputStream(mapper.writeValueAsBytes(changedSchema))).id());
    }

    @Test void runtimeConfigurationMustMatchTheGeneratedContractExactly() {
        var contract = LocalCorePersistenceContract.bundled();
        assertNotNull(contract);
        var environment = LocalCorePersistenceContractGenerator.desktopEnvironment();
        assertTrue(contract.supports(environment));
        environment.getPropertySources().addFirst(new MapPropertySource("unknown-init",
                Map.of("spring.sql.init.mode", "always")));
        assertFalse(contract.supports(environment));
    }
}
