// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ocr;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;

/**
 * Recognition results keyed by the SHA-256 of the file's bytes plus the route variant, so exporting
 * the layout Word and then the searchable PDF of the same scan recognizes (and bills) it once.
 * Stored gzip-compressed on the local disk beside project storage; holds recognized text, i.e. the
 * same content the user already keeps in that project. Oldest entries go first beyond the cap.
 * Every failure is a cache miss, never an error.
 */
public class OcrResultCache {

    private static final Pattern VARIANT = Pattern.compile("[a-z0-9-]{1,32}");

    private final Path dir;
    private final int maxEntries;

    public OcrResultCache(Path dir, int maxEntries) {
        this.dir = dir;
        this.maxEntries = Math.max(1, maxEntries);
    }

    public String get(byte[] content, String variant) {
        try {
            Path file = file(content, variant);
            if (!Files.isRegularFile(file)) return null;
            try (var in = new GZIPInputStream(Files.newInputStream(file))) {
                String value = new String(in.readAllBytes(), StandardCharsets.UTF_8);
                Files.setLastModifiedTime(file, java.nio.file.attribute.FileTime.fromMillis(System.currentTimeMillis()));
                return value;
            }
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            return null;
        }
    }

    public void put(byte[] content, String variant, String value) {
        Path file = file(content, variant);
        try {
            Files.createDirectories(dir);
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (var out = new GZIPOutputStream(bytes)) {
                out.write(value.getBytes(StandardCharsets.UTF_8));
            }
            Path temp = Files.createTempFile(dir, "put-", ".tmp");
            Files.write(temp, bytes.toByteArray());
            Files.move(temp, file, java.nio.file.StandardCopyOption.REPLACE_EXISTING, java.nio.file.StandardCopyOption.ATOMIC_MOVE);
            evict();
        } catch (Exception ignored) {
            // a cache that cannot be written only costs a future re-recognition
        }
    }

    private Path file(byte[] content, String variant) {
        if (variant == null || !VARIANT.matcher(variant).matches())
            throw new IllegalArgumentException("invalid cache variant");
        try {
            String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
            return dir.resolve(hash + "-" + variant + ".json.gz");
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private void evict() throws Exception {
        List<Path> entries;
        try (var files = Files.list(dir)) {
            entries = files.filter(p -> p.getFileName().toString().endsWith(".json.gz"))
                    .sorted(Comparator.comparingLong(p -> {
                        try { return Files.getLastModifiedTime(p).toMillis(); } catch (Exception e) { return 0L; }
                    })).toList();
        }
        for (int i = 0; i < entries.size() - maxEntries; i++) Files.deleteIfExists(entries.get(i));
    }
}
