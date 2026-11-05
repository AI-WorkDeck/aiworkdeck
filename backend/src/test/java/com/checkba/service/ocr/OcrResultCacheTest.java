// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ocr;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

class OcrResultCacheTest {
    @TempDir Path dir;

    @Test
    void sameBytesAndVariantHitDifferentBytesOrVariantMiss() {
        OcrResultCache cache = new OcrResultCache(dir, 10);
        cache.put(new byte[]{1, 2, 3}, "cloud-layout", "{\"pages\":[1]}");
        assertEquals("{\"pages\":[1]}", cache.get(new byte[]{1, 2, 3}, "cloud-layout"));
        assertNull(cache.get(new byte[]{1, 2, 4}, "cloud-layout"), "content changed: recognize again");
        assertNull(cache.get(new byte[]{1, 2, 3}, "local-layout"), "route is part of the key");
    }

    @Test
    void oldestEntriesAreEvictedBeyondTheCap() throws Exception {
        OcrResultCache cache = new OcrResultCache(dir, 2);
        cache.put(new byte[]{1}, "v", "a");
        Thread.sleep(20);
        cache.put(new byte[]{2}, "v", "b");
        Thread.sleep(20);
        cache.put(new byte[]{3}, "v", "c");
        assertNull(cache.get(new byte[]{1}, "v"));
        assertEquals("b", cache.get(new byte[]{2}, "v"));
        assertEquals("c", cache.get(new byte[]{3}, "v"));
        try (var files = Files.list(dir)) { assertEquals(2, files.count()); }
    }

    @Test
    void unreadableCacheIsAMissNotAFailure() throws Exception {
        OcrResultCache cache = new OcrResultCache(dir, 10);
        cache.put(new byte[]{9}, "v", "ok");
        try (var files = Files.list(dir)) { Files.write(files.findFirst().orElseThrow(), new byte[]{0, 1, 2}); }
        assertNull(cache.get(new byte[]{9}, "v"));
        assertNull(new OcrResultCache(dir.resolve("missing/deeper"), 10).get(new byte[]{9}, "v"));
    }

    @Test
    void variantCannotEscapeTheCacheDirectory() {
        OcrResultCache cache = new OcrResultCache(dir, 10);
        assertThrows(IllegalArgumentException.class, () -> cache.put(new byte[]{1}, "../x", "a"));
    }
}
