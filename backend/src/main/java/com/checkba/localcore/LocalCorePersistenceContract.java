// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.localcore;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.context.properties.bind.Bindable;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.core.env.ConfigurableEnvironment;
import java.io.InputStream;
import java.net.JarURLConnection;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;
import java.util.TreeMap;

/** Build-generated desktop persistence compatibility, independent of the running process identity. */
public record LocalCorePersistenceContract(String id, String bootstrapEpoch, Map<String, String> configuration) {
    static final String RESOURCE = "/local-core/persistence-contract.json";
    // Bump when old data needs preparation before early reads/writes, even if mappings are unchanged.
    static final String BOOTSTRAP_EPOCH = "1";
    static final int FORMAT = 1;

    public LocalCorePersistenceContract {
        if (id == null || !id.matches("[a-f0-9]{64}") || !BOOTSTRAP_EPOCH.equals(bootstrapEpoch))
            throw new IllegalArgumentException("Unsupported persistence contract");
        configuration = Map.copyOf(configuration);
    }

    record Manifest(int format, String schema, String h2, String hibernate, String bootstrapEpoch,
                    String applicationInputs, Map<String, String> configuration) {}

    /** No supplied property can assert a contract. Missing/stale packaged resources fail closed. */
    static LocalCorePersistenceContract bundled() {
        return Bundled.VALUE;
    }
    private static final class Bundled {
        private static final LocalCorePersistenceContract VALUE = readBundled();
    }
    private static LocalCorePersistenceContract readBundled() {
        try (InputStream input = LocalCorePersistenceContract.class.getResourceAsStream(RESOURCE)) {
            return decode(input);
        } catch (Exception unsupported) { return null; }
    }
    static LocalCorePersistenceContract decode(InputStream input) throws Exception {
        if (input == null) return null;
        var m = new ObjectMapper().readValue(input, Manifest.class);
        if (m.format() != FORMAT || !BOOTSTRAP_EPOCH.equals(m.bootstrapEpoch())
                || m.schema() == null || !m.schema().matches("[a-f0-9]{64}")
                || !version("org.h2.Driver").equals(m.h2())
                || !version("org.hibernate.Version").equals(m.hibernate())
                || !applicationInputs().equals(m.applicationInputs()) || m.configuration() == null) return null;
        String id = hash(new ObjectMapper().writeValueAsBytes(new TreeMap<>(Map.of(
                "format", m.format(), "schema", m.schema(), "h2", m.h2(), "hibernate", m.hibernate(),
                "configuration", new TreeMap<>(m.configuration())))));
        return new LocalCorePersistenceContract(id, m.bootstrapEpoch(), m.configuration());
    }

    boolean supports(ConfigurableEnvironment environment) {
        try { return configuration.equals(configuration(environment)); }
        catch (RuntimeException unknown) { return false; }
    }

    static Map<String, String> configuration(ConfigurableEnvironment environment) {
        var result = new TreeMap<String, String>();
        for (String prefix : new String[]{"spring.jpa", "spring.sql.init"}) {
            Binder.get(environment).bind(prefix, Bindable.mapOf(String.class, String.class)).orElseGet(Map::of)
                    .forEach((key, value) -> result.put(prefix + "." + key, value));
        }
        return Map.copyOf(result);
    }

    static String version(String name) throws ReflectiveOperationException {
        // Nested Spring Boot jars can omit Package.implementationVersion. Use each
        // dependency's runtime API so development and packaged launches agree.
        ClassLoader loader = LocalCorePersistenceContract.class.getClassLoader();
        String value = switch (name) {
            case "org.h2.Driver" -> (String) Class.forName("org.h2.engine.Constants", false, loader)
                    .getField("VERSION").get(null);
            case "org.hibernate.Version" -> (String) Class.forName(name, false, loader)
                    .getMethod("getVersionString").invoke(null);
            default -> throw new IllegalArgumentException("Unsupported persistence dependency");
        };
        if (value == null || !value.matches("[0-9]+\\.[0-9]+\\.[0-9]+(?:[.-][A-Za-z0-9]+)*"))
            throw new IllegalStateException("Dependency version unavailable");
        return value;
    }

    /** Verify every application class without repeating Spring's entity metadata scan at startup.
     * The build still derives the schema from Hibernate. This byte fingerprint detects stale
     * generated resources, including a previously ordinary class becoming a persistence type;
     * it is deliberately excluded from the compatibility ID so compatible rebuilds stay fast.
     */
    static String applicationInputs() throws Exception {
        return applicationInputs(LocalCorePersistenceContract.class.getResource("LocalCorePersistenceContract.class"));
    }

    static String applicationInputs(java.net.URL resource) throws Exception {
        String prefix = "com/checkba/";
        var inputs = new TreeMap<String, String>();
        if (resource != null && resource.openConnection() instanceof JarURLConnection connection) {
            // Borrow the loader's archive; close entry streams, not its shared JarFile.
            var jar = connection.getJarFile();
            var entries = jar.entries();
            while (entries.hasMoreElements()) {
                var entry = entries.nextElement();
                if (entry.getName().startsWith(prefix) && entry.getName().endsWith(".class")) {
                    try (var input = jar.getInputStream(entry)) { inputs.put(entry.getName(), hash(input.readAllBytes())); }
                }
            }
        } else if (resource != null && "file".equals(resource.getProtocol())) {
            Path root = Path.of(resource.toURI()).getParent().getParent();
            try (var paths = Files.walk(root)) {
                for (Path path : paths.filter(p -> Files.isRegularFile(p) && p.toString().endsWith(".class")).toList()) {
                    inputs.put(prefix + root.relativize(path).toString().replace('\\', '/'), hash(Files.readAllBytes(path)));
                }
            }
        }
        if (!inputs.containsKey(prefix + "localcore/LocalCorePersistenceContract.class"))
            throw new IllegalStateException("Application classes unavailable");
        return hash(new ObjectMapper().writeValueAsBytes(inputs));
    }

    static String hash(byte[] bytes) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }
}
