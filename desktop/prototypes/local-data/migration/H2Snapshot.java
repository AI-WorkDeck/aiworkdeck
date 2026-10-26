// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.JsonGenerator;
import java.io.OutputStream;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.sql.*;
import java.util.*;

/** Offline, lossless JDBC snapshot. This does not grant a new writer ownership. */
public final class H2Snapshot {
    private static final JsonFactory JSON = new JsonFactory();

    private static String hash(Path path) throws Exception {
        var digest = MessageDigest.getInstance("SHA-256");
        try (var input = Files.newInputStream(path)) {
            byte[] buffer = new byte[65536];
            for (int read; (read = input.read(buffer)) >= 0;) digest.update(buffer, 0, read);
        }
        return HexFormat.of().formatHex(digest.digest());
    }

    private static String quote(String name) { return "\"" + name.replace("\"", "\"\"") + "\""; }

    private static void record(OutputStream output, Map<String, ?> record) throws Exception {
        var json = JSON.createGenerator(output);
        json.disable(JsonGenerator.Feature.AUTO_CLOSE_TARGET);
        value(json, record);
        json.close();
        output.write('\n');
    }

    private static void value(JsonGenerator json, Object value) throws Exception {
        if (value == null) json.writeNull();
        else if (value instanceof String s) json.writeString(s);
        else if (value instanceof Number n) json.writeNumber(n.toString());
        else if (value instanceof Boolean b) json.writeBoolean(b);
        else if (value instanceof Map<?, ?> map) {
            json.writeStartObject();
            for (var entry : map.entrySet()) {
                json.writeFieldName((String) entry.getKey());
                value(json, entry.getValue());
            }
            json.writeEndObject();
        } else if (value instanceof Collection<?> list) {
            json.writeStartArray();
            for (var item : list) value(json, item);
            json.writeEndArray();
        } else throw new IllegalArgumentException("Unsupported snapshot value");
    }

    private static boolean binary(int type) {
        return type == Types.BINARY || type == Types.VARBINARY || type == Types.LONGVARBINARY || type == Types.BLOB;
    }

    private static List<Map<String, Object>> metadata(ResultSet result) throws SQLException {
        try (result) {
            var rows = new ArrayList<Map<String, Object>>();
            var meta = result.getMetaData();
            while (result.next()) {
                var row = new LinkedHashMap<String, Object>();
                for (int i = 1; i <= meta.getColumnCount(); i++) row.put(meta.getColumnLabel(i), result.getString(i));
                rows.add(row);
            }
            return rows;
        }
    }

    private static List<Map<String, Object>> identities(Connection db, String schema, String table) throws SQLException {
        // getColumns() exposes IS_AUTOINCREMENT but not the next identity value.
        // H2's structured metadata preserves values consumed by purged rows or
        // rolled-back inserts without parsing or translating SCRIPT output.
        var identities = new ArrayList<Map<String, Object>>();
        String sql = "SELECT COLUMN_NAME, IDENTITY_START, IDENTITY_BASE, IDENTITY_INCREMENT, "
                + "IDENTITY_MINIMUM, IDENTITY_MAXIMUM, IDENTITY_CYCLE FROM INFORMATION_SCHEMA.COLUMNS "
                + "WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND IS_IDENTITY='YES' ORDER BY ORDINAL_POSITION";
        try (var query = db.prepareStatement(sql)) {
            query.setString(1, schema);
            query.setString(2, table);
            try (var rows = query.executeQuery()) {
                while (rows.next()) {
                    var identity = new LinkedHashMap<String, Object>();
                    identity.put("column", rows.getString("COLUMN_NAME"));
                    identity.put("start", rows.getString("IDENTITY_START"));
                    identity.put("next", rows.getString("IDENTITY_BASE"));
                    identity.put("increment", rows.getString("IDENTITY_INCREMENT"));
                    identity.put("minimum", rows.getString("IDENTITY_MINIMUM"));
                    identity.put("maximum", rows.getString("IDENTITY_MAXIMUM"));
                    identity.put("cycle", rows.getString("IDENTITY_CYCLE"));
                    identities.add(identity);
                }
            }
        }
        return identities;
    }

    static void export(Path source, Path destination) throws Exception {
        if (!source.isAbsolute() || !destination.isAbsolute()
                || !source.toString().endsWith(".mv.db") || source.toString().contains(";")
                || !Files.isRegularFile(source, LinkOption.NOFOLLOW_LINKS)
                || !source.normalize().equals(source.toRealPath())) {
            throw new IllegalArgumentException("An existing absolute non-symlink .mv.db file is required");
        }
        Path parent = destination.getParent();
        if (parent == null || !parent.normalize().equals(parent.toRealPath())
                || Files.exists(destination, LinkOption.NOFOLLOW_LINKS)) {
            throw new IllegalArgumentException("A new destination under a real directory is required");
        }
        String sourceHash = hash(source);
        String base = source.toString().substring(0, source.toString().length() - ".mv.db".length());
        // Never use AUTO_SERVER or caller-supplied JDBC options: attaching to a live
        // backend would produce a moving snapshot and bypass offline ownership.
        String url = "jdbc:h2:file:" + base + ";IFEXISTS=TRUE;ACCESS_MODE_DATA=r;AUTO_SERVER=FALSE;DB_CLOSE_ON_EXIT=FALSE"
                + ";MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;NON_KEYWORDS=VALUE";
        try (Connection db = DriverManager.getConnection(url, "sa", "")) {
            db.setAutoCommit(false);
            db.setTransactionIsolation(Connection.TRANSACTION_SERIALIZABLE);
            Files.createDirectory(destination);
            Path staged = destination.resolve("snapshot.jsonl.pending");
            var counts = new LinkedHashMap<String, Object>();
            try (var output = Files.newOutputStream(staged, StandardOpenOption.CREATE_NEW)) {
                record(output, Map.of("kind", "header", "format", "awd-h2-snapshot-v1",
                        "sourceSha256", sourceHash, "h2Version", db.getMetaData().getDatabaseProductVersion()));
                // Preserve the original DDL as evidence. Translating it to SQLite is
                // a separate checked migration, never a string-replacement operation.
                try (var statement = db.createStatement(); var rows = statement.executeQuery("SCRIPT NODATA")) {
                    while (rows.next()) record(output, Map.of("kind", "source-ddl", "sql", rows.getString(1)));
                }
                var tables = new TreeSet<String>();
                String schema = db.getSchema();
                try (var rows = db.getMetaData().getTables(null, schema, "%", new String[]{"BASE TABLE", "TABLE"})) {
                    while (rows.next()) tables.add(rows.getString("TABLE_NAME"));
                }
                for (String table : tables) {
                    var details = db.getMetaData();
                    record(output, Map.of("kind", "table", "name", table,
                            "columns", metadata(details.getColumns(null, schema, table, "%")),
                            "identityColumns", identities(db, schema, table),
                            "primaryKeys", metadata(details.getPrimaryKeys(null, schema, table)),
                            "foreignKeys", metadata(details.getImportedKeys(null, schema, table)),
                            "indexes", metadata(details.getIndexInfo(null, schema, table, false, false))));
                    long count = 0;
                    try (var statement = db.createStatement(); var rows = statement.executeQuery("SELECT * FROM " + quote(schema) + "." + quote(table))) {
                        var meta = rows.getMetaData();
                        while (rows.next()) {
                            var values = new LinkedHashMap<String, Object>();
                            for (int i = 1; i <= meta.getColumnCount(); i++) {
                                int type = meta.getColumnType(i);
                                String encoded;
                                if (binary(type)) {
                                    byte[] bytes = rows.getBytes(i);
                                    encoded = bytes == null ? null : Base64.getEncoder().encodeToString(bytes);
                                } else encoded = rows.getString(i);
                                // Numeric/date values stay strings to preserve 64-bit IDs,
                                // decimal precision, timestamp precision and NULL exactly.
                                values.put(meta.getColumnName(i), encoded);
                            }
                            record(output, Map.of("kind", "row", "table", table, "values", values));
                            count++;
                        }
                    }
                    counts.put(table, count);
                }
                db.rollback();
                if (!sourceHash.equals(hash(source))) throw new IllegalStateException("Source changed during export");
                record(output, Map.of("kind", "complete", "sourceSha256", sourceHash, "counts", counts));
            }
            try (var file = FileChannel.open(staged, StandardOpenOption.WRITE)) { file.force(true); }
            Files.move(staged, destination.resolve("snapshot.jsonl"), StandardCopyOption.ATOMIC_MOVE);
        }
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 2) throw new IllegalArgumentException("Usage: H2Snapshot /absolute/source.mv.db /absolute/new-output");
        export(Path.of(args[0]), Path.of(args[1]));
        System.out.println("Offline snapshot complete; source unchanged; no ownership transfer");
    }
}
