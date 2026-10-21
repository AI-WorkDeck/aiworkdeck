// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.pack;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

class ModelPresenceTest {
    @TempDir Path root;
    private Path fixture() throws Exception {
        Path dir = root.resolve("asr");
        String revision = "a".repeat(40);
        String snapshot = "hub/models--Systran--faster-whisper-medium/snapshots/" + revision;
        Path modelRoot = dir.resolve(snapshot);
        Files.createDirectories(modelRoot);
        Path ref = dir.resolve("hub/models--Systran--faster-whisper-medium/refs/main");
        Files.createDirectories(ref.getParent());
        Files.writeString(ref, revision);
        var files = new ArrayList<Map<String, Object>>();
        for (String name : List.of("config.json", "tokenizer.json", "vocabulary.json", "model.bin")) {
            Files.writeString(modelRoot.resolve(name), "{}");
            files.add(Map.of("path", snapshot + "/" + name, "size", 2));
        }
        Files.writeString(dir.resolve(".aiworkdeck-complete"), new ObjectMapper().writeValueAsString(
                Map.of("schema", 1, "id", "asr-models", "revision", revision, "root", snapshot, "files", files)));
        return modelRoot;
    }
    @Test void timestampAloneRequiresExplicitRepair() throws Exception {
        Files.createDirectories(root.resolve("asr"));
        Files.writeString(root.resolve("asr/.aiworkdeck-complete"), "2026-10-21");
        assertFalse(new ModelPresence(root.toString()).installed("asr-models"));
    }
    @Test void completeLegacyLayoutRemainsUsableWithoutWritingOrDownloading() throws Exception {
        Path model = fixture();
        Path marker = root.resolve("asr/.aiworkdeck-complete");
        String legacy = "2026-10-21T01:02:03.000Z";
        Files.writeString(marker, legacy);
        assertTrue(new ModelPresence(root.toString()).installed("asr-models"));
        assertEquals(legacy, Files.readString(marker));
        Files.delete(model.resolve("model.bin"));
        assertFalse(new ModelPresence(root.toString()).installed("asr-models"));
    }
    @Test void inventoryAcceptsFilesAndRejectsTruncation() throws Exception {
        Path model = fixture();
        ModelPresence presence = new ModelPresence(root.toString());
        assertTrue(presence.installed("asr-models"));
        Files.writeString(model.resolve("model.bin"), "x");
        assertFalse(presence.installed("asr-models"));
    }
    @Test void missingFileAndChangedRevisionCannotKeepInstalledState() throws Exception {
        Path model = fixture();
        Files.delete(model.resolve("tokenizer.json"));
        assertFalse(new ModelPresence(root.toString()).installed("asr-models"));
        fixture();
        Files.writeString(root.resolve("asr/hub/models--Systran--faster-whisper-medium/refs/main"), "b".repeat(40));
        assertFalse(new ModelPresence(root.toString()).installed("asr-models"));
    }
    @Test void emptyInventoryAndTraversalAreRejected() throws Exception {
        fixture();
        Files.writeString(root.resolve("asr/.aiworkdeck-complete"), "{\"schema\":1,\"id\":\"asr-models\",\"root\":\"..\",\"files\":[]}");
        assertFalse(new ModelPresence(root.toString()).installed("asr-models"));
        assertFalse(new ModelPresence(root.toString()).installed("../asr-models"));
    }
}
