// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.pack;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 「模型下没下」的只读判定。落盘由 Electron 的 model-manager.js 负责
 * （{@code ~/.aiworkdeck/models/<name>/.aiworkdeck-complete}，写标记是下载成功的最后一步），
 * 后端只需要读一眼——打包态后端 cwd 就是 ~/.aiworkdeck，与 ai.packs.dir 同一套相对路径惯例。
 */
@Component
public class ModelPresence {

    private static final String MARKER = ".aiworkdeck-complete";

    private static final ObjectMapper JSON = new ObjectMapper();
    private final Path root;

    public ModelPresence(@Value("${ai.models.dir:models}") String dir) {
        this.root = Paths.get(dir).toAbsolutePath().normalize();
    }

    /** modelId 形如 {@code mineru-models} → 目录 {@code <root>/mineru}。 */
    public boolean installed(String modelId) {
        if (modelId == null) return false;
        String name = modelId.endsWith("-models")
                ? modelId.substring(0, modelId.length() - "-models".length())
                : modelId;
        if (!name.matches("^[a-z0-9-]{1,32}$")) return false; // 兼防路径穿越
        Path dir = root.resolve(name);
        try {
            String raw = Files.readString(dir.resolve(MARKER));
            var marker = raw.trim().matches("\\d{4}-\\d{2}-\\d{2}T[\\d:.]+Z")
                    ? legacyInventory(modelId, dir) : JSON.readTree(raw);
            if (marker.path("schema").asInt() != 1 || !modelId.equals(marker.path("id").asText())) return false;
            Path realDir = dir.toRealPath();
            String relativeRoot = marker.path("root").asText();
            Path modelRoot = dir.resolve(relativeRoot).normalize();
            if (relativeRoot.isBlank() || !modelRoot.toRealPath().startsWith(realDir)) return false;
            var files = marker.path("files");
            if (!files.isArray() || files.isEmpty()) return false;
            Set<String> present = new HashSet<>();
            for (var file : files) {
                String relative = file.path("path").asText();
                long length = file.path("size").asLong(-1);
                Path target = dir.resolve(relative).normalize();
                if (relative.isBlank() || length <= 0 || !present.add(relative)
                        || !target.toRealPath().startsWith(realDir) || !Files.isRegularFile(target)
                        || Files.size(target) != length) return false;
            }
            if ("mineru-models".equals(modelId)) {
                var config = JSON.readTree(Files.readString(dir.resolve("mineru.json")));
                if (!Path.of(config.path("models-dir").path("pipeline").asText()).toRealPath().equals(modelRoot.toRealPath())) return false;
                if (!present.contains("mineru.json")) return false;
                for (String required : List.of("models/Layout/PP-DocLayoutV2", "models/MFR/unimernet_hf_small_2503",
                        "models/MFR/pp_formulanet_plus_m", "models/OCR/paddleocr_torch",
                        "models/TabRec/SlanetPlus/slanet-plus.onnx", "models/TabRec/UnetStructure/unet.onnx",
                        "models/TabCls/paddle_table_cls/PP-LCNet_x1_0_table_cls.onnx")) {
                    String prefix = relativeRoot + "/" + required;
                    if (present.stream().noneMatch(f -> f.equals(prefix) || f.startsWith(prefix + "/"))) return false;
                }
            } else {
                boolean asr = "asr-models".equals(modelId);
                if (!asr && !"kokoro-models".equals(modelId)) return false;
                String repo = asr ? "Systran--faster-whisper-medium" : "hexgrad--Kokoro-82M-v1.1-zh";
                String revision = Files.readString(dir.resolve("hub/models--" + repo + "/refs/main")).trim();
                if (!revision.matches("[a-fA-F0-9]{40,64}") || !revision.equals(marker.path("revision").asText())
                        || !relativeRoot.equals("hub/models--" + repo + "/snapshots/" + revision)) return false;
                List<String> required = asr ? List.of("config.json", "tokenizer.json", asrVocabulary(modelRoot), "model.bin")
                        : List.of("config.json", "kokoro-v1_1-zh.pth", "voices/zf_001.pt", "voices/zm_010.pt", "voices/af_maple.pt", "voices/bf_vale.pt");
                for (String file : required) {
                    if (!present.contains(relativeRoot + "/" + file)) return false;
                    if (file.endsWith(".json")) JSON.readTree(Files.readString(modelRoot.resolve(file)));
                }
            }
            return true;
        } catch (Exception ignored) {
            // Incomplete layouts need repair; never hash GBs in a presence check.
            return false;
        }
    }
    /** CTranslate2 loads a JSON string array first, or its legacy text vocabulary. */
    private String asrVocabulary(Path modelRoot) throws Exception {
        Path json = modelRoot.resolve("vocabulary.json");
        if (Files.exists(json)) {
            var tokens = JSON.reader().with(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                    .readTree(Files.readString(json));
            if (!tokens.isArray() || tokens.isEmpty()) throw new IllegalArgumentException("invalid ASR vocabulary");
            for (var token : tokens) if (!token.isTextual()) throw new IllegalArgumentException("invalid ASR vocabulary");
            return "vocabulary.json";
        }
        if (Files.readString(modelRoot.resolve("vocabulary.txt")).isBlank()) throw new IllegalArgumentException("empty ASR vocabulary");
        return "vocabulary.txt";
    }

    /** Legacy compatibility: establish only a structure/size baseline; desktop persists its schema. */
    private com.fasterxml.jackson.databind.JsonNode legacyInventory(String id, Path dir) throws Exception {
        Path modelRoot;
        String revision = null;
        List<String> required;
        if ("mineru-models".equals(id)) {
            modelRoot = Path.of(JSON.readTree(Files.readString(dir.resolve("mineru.json")))
                    .path("models-dir").path("pipeline").asText());
            if (!modelRoot.isAbsolute()) throw new IllegalArgumentException("missing pipeline");
            required = List.of("models/Layout/PP-DocLayoutV2", "models/MFR/unimernet_hf_small_2503",
                    "models/MFR/pp_formulanet_plus_m", "models/OCR/paddleocr_torch",
                    "models/TabRec/SlanetPlus/slanet-plus.onnx", "models/TabRec/UnetStructure/unet.onnx",
                    "models/TabCls/paddle_table_cls/PP-LCNet_x1_0_table_cls.onnx");
        } else {
            boolean asr = "asr-models".equals(id);
            if (!asr && !"kokoro-models".equals(id)) throw new IllegalArgumentException("unknown model");
            Path hub = dir.resolve("hub/models--" + (asr ? "Systran--faster-whisper-medium" : "hexgrad--Kokoro-82M-v1.1-zh"));
            revision = Files.readString(hub.resolve("refs/main")).trim();
            modelRoot = hub.resolve("snapshots/" + revision);
            required = asr ? List.of("config.json", "tokenizer.json", asrVocabulary(modelRoot), "model.bin")
                    : List.of("config.json", "kokoro-v1_1-zh.pth", "voices/zf_001.pt", "voices/zm_010.pt", "voices/af_maple.pt", "voices/bf_vale.pt");
        }
        var marker = JSON.createObjectNode().put("schema", 1).put("id", id).put("revision", revision)
                .put("root", dir.relativize(modelRoot).toString().replace('\\', '/'));
        var files = marker.putArray("files");
        var targets = new java.util.ArrayList<Path>();
        for (String name : required) targets.add(modelRoot.resolve(name));
        if ("mineru-models".equals(id)) targets.add(dir.resolve("mineru.json"));
        for (Path target : targets) {
            int count = files.size();
            try (var paths = Files.walk(target)) {
                for (Path file : paths.toList()) {
                    if (Files.isDirectory(file)) {
                        if (Files.isSymbolicLink(file)) throw new IllegalArgumentException("model directory symlink is not supported");
                        continue;
                    }
                    if (!Files.isRegularFile(file)) throw new IllegalArgumentException("invalid model file");
                    if (!file.toRealPath().startsWith(dir.toRealPath()) || Files.size(file) <= 0
                            || file.toString().matches(".*\\.(incomplete|tmp)$")) throw new IllegalArgumentException("incomplete model");
                    files.addObject().put("path", dir.relativize(file).toString().replace('\\', '/')).put("size", Files.size(file));
                }
            }
            if (files.size() == count) throw new IllegalArgumentException("empty model directory");
        }
        return marker;
    }

}
