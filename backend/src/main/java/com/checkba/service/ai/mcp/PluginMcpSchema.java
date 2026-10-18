// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.mcp;

import dev.langchain4j.model.chat.request.json.*;
import java.util.*;

/** Explicit supported JSON Schema subset; unsupported constraints fail closed, never silently disappear. */
public final class PluginMcpSchema {
    private PluginMcpSchema() {}
    public static JsonObjectSchema object(Map<String, Object> schema) {
        JsonSchemaElement result = convert(schema, 0);
        if (!(result instanceof JsonObjectSchema object)) throw invalid();
        return object;
    }
    @SuppressWarnings("unchecked")
    private static JsonSchemaElement convert(Map<String, Object> s, int depth) {
        if (s == null || depth > 8 || s.size() > 8) throw invalid();
        String description = s.get("description") instanceof String value ? value : null;
        if (description != null && description.length() > 2000) throw invalid();
        String type = String.valueOf(s.get("type"));
        Set<String> allowed = new HashSet<>(Set.of("type", "description", "title"));
        if ("object".equals(type)) allowed.addAll(Set.of("properties", "required", "additionalProperties"));
        if ("array".equals(type)) allowed.add("items");
        if ("string".equals(type)) allowed.add("enum");
        if (!allowed.containsAll(s.keySet())) throw invalid();
        if (s.containsKey("enum")) {
            if (!(s.get("enum") instanceof List<?> values) || values.isEmpty() || values.size() > 100
                    || values.stream().anyMatch(v -> !(v instanceof String))) throw invalid();
            return JsonEnumSchema.builder().description(description).enumValues((List<String>) values).build();
        }
        return switch (type) {
            case "object" -> {
                if (s.containsKey("properties") && !(s.get("properties") instanceof Map)) throw invalid();
                Map<String, Object> properties = (Map<String, Object>) s.getOrDefault("properties", Map.of());
                if (properties.size() > 64) throw invalid();
                Map<String, JsonSchemaElement> converted = new LinkedHashMap<>();
                for (var p : properties.entrySet()) {
                    if (!p.getKey().matches("[A-Za-z_][A-Za-z0-9_-]{0,63}") || !(p.getValue() instanceof Map)) throw invalid();
                    converted.put(p.getKey(), convert((Map<String, Object>) p.getValue(), depth + 1));
                }
                if (s.containsKey("required") && !(s.get("required") instanceof List)) throw invalid();
                List<?> required = (List<?>) s.getOrDefault("required", List.of());
                if (required.stream().anyMatch(v -> !(v instanceof String) || !properties.containsKey(v))) throw invalid();
                if (s.containsKey("additionalProperties") && !(s.get("additionalProperties") instanceof Boolean)) throw invalid();
                yield JsonObjectSchema.builder().description(description).properties(converted)
                        .required((List<String>) required).additionalProperties((Boolean) s.get("additionalProperties")).build();
            }
            case "array" -> {
                if (!(s.get("items") instanceof Map)) throw invalid();
                yield JsonArraySchema.builder().description(description).items(convert((Map<String, Object>) s.get("items"), depth + 1)).build();
            }
            case "string" -> JsonStringSchema.builder().description(description).build();
            case "boolean" -> JsonBooleanSchema.builder().description(description).build();
            case "integer" -> JsonIntegerSchema.builder().description(description).build();
            case "number" -> JsonNumberSchema.builder().description(description).build();
            default -> throw invalid();
        };
    }
    @SuppressWarnings("unchecked")
    public static void validateArguments(Map<String, Object> schema, Object value) {
        switch (String.valueOf(schema.get("type"))) {
            case "object" -> {
                if (!(value instanceof Map<?, ?> obj)) throw invalidArgs();
                Map<String, Object> props = (Map<String, Object>) schema.getOrDefault("properties", Map.of());
                for (Object key : (List<?>) schema.getOrDefault("required", List.of())) if (!obj.containsKey(key)) throw invalidArgs();
                for (var entry : obj.entrySet()) {
                    if (props.containsKey(entry.getKey())) validateArguments((Map<String, Object>) props.get(entry.getKey()), entry.getValue());
                    else if (Boolean.FALSE.equals(schema.get("additionalProperties"))) throw invalidArgs();
                }
            }
            case "array" -> {
                if (!(value instanceof List<?> list) || list.size() > 10000) throw invalidArgs();
                for (Object item : list) validateArguments((Map<String, Object>) schema.get("items"), item);
            }
            case "string" -> {
                if (!(value instanceof String) || (schema.containsKey("enum") && !((List<?>) schema.get("enum")).contains(value))) throw invalidArgs();
            }
            case "boolean" -> { if (!(value instanceof Boolean)) throw invalidArgs(); }
            case "number", "integer" -> {
                if (!(value instanceof Number n) || !Double.isFinite(n.doubleValue())
                        || ("integer".equals(schema.get("type")) && n.doubleValue() != Math.rint(n.doubleValue()))) throw invalidArgs();
            }
            default -> throw invalidArgs();
        }
    }
    private static PluginMcpException invalid() { return new PluginMcpException("invalid_schema", 400, "Unsupported or invalid MCP input schema."); }
    private static PluginMcpException invalidArgs() { return new PluginMcpException("invalid_arguments", 400, "MCP arguments do not match the declared schema."); }
}
