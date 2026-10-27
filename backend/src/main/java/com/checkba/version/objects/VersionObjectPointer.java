// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.version.objects;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/** NUL makes Git treat pointers as binary: hashes must never be line-merged. */
public final class VersionObjectPointer {
    private static final byte[] MAGIC = "\0AIWorkDeck version object v1\n".getBytes(StandardCharsets.US_ASCII);
    public static final int MAX_BYTES = 160;

    private VersionObjectPointer() {}

    public static byte[] encode(LocalVersionObjectStore.ObjectRef ref) {
        return (new String(MAGIC, StandardCharsets.US_ASCII) + "sha256 " + ref.sha256()
                + "\nsize " + ref.size() + "\n").getBytes(StandardCharsets.US_ASCII);
    }

    public static LocalVersionObjectStore.ObjectRef parse(byte[] bytes) {
        if (bytes.length > MAX_BYTES || bytes.length < MAGIC.length
                || !Arrays.equals(MAGIC, Arrays.copyOf(bytes, MAGIC.length))) return null;
        String rest = new String(bytes, MAGIC.length, bytes.length - MAGIC.length, StandardCharsets.US_ASCII);
        if (!rest.matches("sha256 [0-9a-f]{64}\\nsize (0|[1-9][0-9]*)\\n")) return null;
        try {
            String[] lines = rest.split("\n");
            return new LocalVersionObjectStore.ObjectRef(lines[0].substring(7), Long.parseLong(lines[1].substring(5)));
        } catch (IllegalArgumentException e) { return null; }
    }
}
