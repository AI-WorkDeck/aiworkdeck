// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.localcore;

import javax.sql.DataSource;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;

/**
 * Remembers a completed legacy initialization in the same H2 database, without changing its schema.
 * A new backend build or a change to the covered schema requires legacy initialization again. This is an
 * eligibility check, not a migration or a readiness signal. The caller must check that the existing
 * database file exists before opening it, and must never run Hibernate DDL alongside a writable core.
 */
public final class LocalCoreSchemaProof {
    static final String KEY = "local.core.schemaProof";
    private static final String CONTRACT = "1";
    private static final Set<String> REQUIRED = Set.of("app_users", "project", "project_file", "system_setting");
    private final DataSource dataSource;
    private final String build;

    public LocalCoreSchemaProof(DataSource dataSource, String backendBuild) {
        this.dataSource = Objects.requireNonNull(dataSource);
        if (backendBuild == null || backendBuild.isBlank() || backendBuild.length() > 256
                || backendBuild.indexOf('\n') >= 0 || backendBuild.indexOf('\r') >= 0) {
            throw new IllegalArgumentException("An explicit backend build identity is required");
        }
        this.build = backendBuild;
    }

    public boolean isCurrent() throws SQLException {
        return matchesRecordedSchema(true);
    }

    /** Recovery may run on a new build, but only against the unchanged, previously recorded schema. */
    public boolean isRecordedSchema() throws SQLException {
        return matchesRecordedSchema(false);
    }

    private boolean matchesRecordedSchema(boolean sameBuild) throws SQLException {
        try (Connection c = dataSource.getConnection()) {
            Shape shape = inspect(c);
            if (!shape.compatible()) return false;
            try (var s = c.prepareStatement("SELECT \"value\" FROM system_setting WHERE config_key=?")) {
                s.setString(1, KEY);
                try (ResultSet r = s.executeQuery()) {
                    if (!r.next()) return false;
                    String recorded = r.getString(1);
                    boolean matches = sameBuild ? proof(shape).equals(recorded)
                            : recorded != null && recorded.matches(CONTRACT + "\\n[^\\r\\n]{1,256}\\n" + shape.digest());
                    return matches && !r.next();
                }
            }
        }
    }

    /** Call only after the legacy path's DDL and required business initialization have succeeded. */
    public void recordAfterLegacyInitialization() throws SQLException {
        try (Connection c = dataSource.getConnection()) {
            c.setAutoCommit(false);
            try {
                Shape shape = inspect(c);
                if (!shape.compatible()) throw new IllegalStateException("Existing desktop H2 schema is required");
                try (var s = c.prepareStatement("MERGE INTO system_setting(config_key, \"value\") KEY(config_key) VALUES (?, ?)")) {
                    s.setString(1, KEY); s.setString(2, proof(shape)); s.executeUpdate();
                }
                c.commit();
            } catch (SQLException | RuntimeException e) {
                c.rollback(); throw e;
            }
        }
    }

    private String proof(Shape shape) { return CONTRACT + "\n" + build + "\n" + shape.digest(); }
    private record Shape(boolean compatible, String digest) {}

    private static Shape inspect(Connection c) throws SQLException {
        DatabaseMetaData metadata = c.getMetaData();
        if (!"H2".equals(metadata.getDatabaseProductName())) return new Shape(false, "");
        // These objects do not occur in the existing desktop schema. Leave installations with
        // custom executable/schema objects on the legacy path rather than bless a partial digest.
        for (String[] object : new String[][]{{"TRIGGERS", "TRIGGER_SCHEMA"}, {"ROUTINES", "ROUTINE_SCHEMA"},
                {"DOMAINS", "DOMAIN_SCHEMA"}, {"SEQUENCES", "SEQUENCE_SCHEMA"}}) {
            try (var s = c.createStatement(); ResultSet r = s.executeQuery("SELECT 1 FROM INFORMATION_SCHEMA."
                    + object[0] + " WHERE UPPER(" + object[1] + ") NOT IN ('INFORMATION_SCHEMA','PG_CATALOG')")) {
                if (r.next()) return new Shape(false, "");
            }
        }
        List<List<String>> records = new ArrayList<>();
        Set<String> tables = new HashSet<>();
        try (ResultSet found = metadata.getTables(null, null, "%", new String[]{"TABLE", "VIEW"})) {
            while (found.next()) {
                String schema = found.getString("TABLE_SCHEM"), table = found.getString("TABLE_NAME");
                if ("INFORMATION_SCHEMA".equalsIgnoreCase(schema) || "PG_CATALOG".equalsIgnoreCase(schema)) continue;
                if ("VIEW".equalsIgnoreCase(found.getString("TABLE_TYPE"))) return new Shape(false, "");
                records.add(List.of("table", schema, table, found.getString("TABLE_TYPE")));
                if ("PUBLIC".equalsIgnoreCase(schema)) tables.add(table.toLowerCase(Locale.ROOT));
                try (ResultSet columns = metadata.getColumns(null, schema, table, "%")) {
                    while (columns.next()) {
                        if ("YES".equalsIgnoreCase(columns.getString("IS_GENERATEDCOLUMN"))) return new Shape(false, "");
                        records.add(row(columns, "column", schema, table,
                            "COLUMN_NAME", "ORDINAL_POSITION", "DATA_TYPE", "TYPE_NAME", "COLUMN_SIZE",
                            "DECIMAL_DIGITS", "NULLABLE", "COLUMN_DEF", "IS_AUTOINCREMENT", "IS_GENERATEDCOLUMN"));
                    }
                }
                try (ResultSet keys = metadata.getPrimaryKeys(null, schema, table)) {
                    while (keys.next()) records.add(row(keys, "primary", schema, table, "COLUMN_NAME", "KEY_SEQ", "PK_NAME"));
                }
                try (ResultSet indexes = metadata.getIndexInfo(null, schema, table, false, false)) {
                    while (indexes.next()) {
                        if (indexes.getShort("TYPE") != DatabaseMetaData.tableIndexStatistic) records.add(row(indexes,
                                "index", schema, table, "INDEX_NAME", "NON_UNIQUE", "TYPE", "ORDINAL_POSITION", "COLUMN_NAME", "ASC_OR_DESC", "FILTER_CONDITION"));
                    }
                }
                try (ResultSet keys = metadata.getImportedKeys(null, schema, table)) {
                    while (keys.next()) records.add(row(keys, "foreign", schema, table, "PKTABLE_SCHEM", "PKTABLE_NAME",
                            "PKCOLUMN_NAME", "FKCOLUMN_NAME", "KEY_SEQ", "UPDATE_RULE", "DELETE_RULE", "FK_NAME", "DEFERRABILITY"));
                }
            }
        }
        // JDBC omits CHECK expressions and static identity options. H2's documented system tables
        // supply them; current sequence positions and optimizer statistics are deliberately excluded.
        // https://h2database.com/html/systemtables.html
        appendStableRows(c, records, "COLUMNS", "TABLE_SCHEMA", Set.of("IDENTITY_BASE", "SELECTIVITY"));
        appendStableRows(c, records, "TABLE_CONSTRAINTS", "CONSTRAINT_SCHEMA", Set.of());
        appendStableRows(c, records, "CHECK_CONSTRAINTS", "CONSTRAINT_SCHEMA", Set.of());
        records.sort(Comparator.comparing(LocalCoreSchemaProof::encoded));
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            for (List<String> record : records) digest.update(encoded(record).getBytes(StandardCharsets.UTF_8));
            return new Shape(tables.containsAll(REQUIRED), HexFormat.of().formatHex(digest.digest()));
        } catch (NoSuchAlgorithmException e) { throw new AssertionError(e); }
    }

    private static void appendStableRows(Connection c, List<List<String>> records, String table,
                                         String schemaColumn, Set<String> excluded) throws SQLException {
        try (var s = c.createStatement(); ResultSet r = s.executeQuery("SELECT * FROM INFORMATION_SCHEMA." + table
                + " WHERE UPPER(" + schemaColumn + ") NOT IN ('INFORMATION_SCHEMA','PG_CATALOG')")) {
            while (r.next()) {
                List<String> values = new ArrayList<>(); values.add(table);
                for (int i = 1; i <= r.getMetaData().getColumnCount(); i++) {
                    String name = r.getMetaData().getColumnLabel(i).toUpperCase(Locale.ROOT);
                    if (!excluded.contains(name)) { values.add(name); values.add(r.getString(i)); }
                }
                records.add(values);
            }
        }
    }

    private static List<String> row(ResultSet r, String kind, String schema, String table, String... fields) throws SQLException {
        List<String> row = new ArrayList<>(); row.add(kind); row.add(schema); row.add(table);
        for (String field : fields) row.add(r.getString(field));
        return row;
    }

    /** Length-delimited values distinguish nulls and arbitrary identifier/default strings. */
    private static String encoded(List<String> fields) {
        StringBuilder value = new StringBuilder();
        for (String field : fields) value.append(field == null ? "-1:" : field.length() + ":" + field);
        return fields.size() + ":" + value;
    }
}
