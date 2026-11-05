// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ocr;

public class OcrResult {
    private String text;
    private String raw;

    public OcrResult() {
    }

    public OcrResult(String text, String raw) {
        this.text = text;
        this.raw = raw;
    }

    public String getText() {
        return text;
    }

    public void setText(String text) {
        this.text = text;
    }

    private static final com.fasterxml.jackson.databind.ObjectMapper MAPPER = new com.fasterxml.jackson.databind.ObjectMapper();

    /**
     * Readable text for a RecognizeAllText result. Aliyun's {@code content} joins the whole page into
     * one space-separated line; {@code raw.subImages[].blockInfo.blockDetails[]} carries the same
     * text one line per block, so prefer it (sub-images separated by a blank line) and fall back to
     * {@code content} when raw has no blocks. Both tiers serialize raw with camelCase field names.
     */
    public static String lines(String raw, String content) {
        String fallback = content == null ? "" : content;
        if (raw == null || raw.isBlank()) return fallback;
        com.fasterxml.jackson.databind.JsonNode root;
        try {
            root = MAPPER.readTree(raw);
        } catch (Exception e) {
            return fallback;
        }
        java.util.List<String> images = new java.util.ArrayList<>();
        for (var image : root.path("subImages")) {
            java.util.List<String> lines = new java.util.ArrayList<>();
            for (var block : image.path("blockInfo").path("blockDetails")) {
                String line = block.path("blockContent").asText("").strip();
                if (!line.isEmpty()) lines.add(line);
            }
            if (!lines.isEmpty()) images.add(String.join("\n", lines));
        }
        return images.isEmpty() ? fallback : String.join("\n\n", images);
    }

    public String getRaw() {
        return raw;
    }

    public void setRaw(String raw) {
        this.raw = raw;
    }
}
