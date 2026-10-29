// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.mcp;

import com.checkba.service.LangText;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.networknt.schema.JsonSchema;
import com.networknt.schema.JsonSchemaFactory;
import com.networknt.schema.SpecVersion;
import com.networknt.schema.resource.DisallowSchemaLoader;
import dev.langchain4j.model.chat.request.json.JsonObjectSchema;
import java.util.*;

/** Preserve remote constraints; never fetch schema references or trust tool annotations as permissions. */
public final class UserMcpSchema {
    private static final ObjectMapper JSON = new ObjectMapper()
            .enable(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .enable(com.fasterxml.jackson.core.JsonParser.Feature.STRICT_DUPLICATE_DETECTION);
    private UserMcpSchema() {}
    public static void check(Map<String, Object> schema) { compiled(schema); }
    public static void validate(Map<String, Object> schema, Map<String, Object> args) {
        if (!compiled(schema).validate(JSON.valueToTree(args)).isEmpty()) throw invalidArguments();
    }
    public static JsonObjectSchema parameters(Map<String, Object> schema) {
        // LangChain4j 0.36 cannot represent anyOf/minimum/default/raw schemas.
        // Do not silently erase constraints: describe the complete schema and
        // validate the decoded object against it before making any request.
        return JsonObjectSchema.builder().addStringProperty("argumentsJson",
                LangText.of("符合以下完整 MCP 输入定义的 JSON 对象：", "A JSON object satisfying this complete MCP input schema: ") + stringify(schema))
                .required("argumentsJson").additionalProperties(false).build();
    }
    public static Map<String, Object> arguments(Map<String, Object> wrapper) {
        if (wrapper == null || wrapper.size() != 1 || !(wrapper.get("argumentsJson") instanceof String text) || text.length() > 128 * 1024)
            throw invalidArguments();
        try {
            Map<String, Object> decoded = JSON.readValue(text, new TypeReference<LinkedHashMap<String, Object>>() {});
            if (decoded == null) throw invalidArguments();
            return decoded;
        }
        catch (Exception e) { throw invalidArguments(); }
    }
    private static JsonSchema compiled(Map<String, Object> schema) {
        if (schema == null || !"object".equals(schema.get("type")) || stringify(schema).length() > 24 * 1024) throw invalidSchema();
        JsonNode root = JSON.valueToTree(schema);
        inspect(root, root, new HashSet<>(), 0);
        String dialect = root.path("$schema").asText("");
        SpecVersion.VersionFlag version;
        if (dialect.isEmpty() || dialect.equals("https://json-schema.org/draft/2020-12/schema")) version = SpecVersion.VersionFlag.V202012;
        else if (Set.of("http://json-schema.org/draft-07/schema#", "https://json-schema.org/draft-07/schema#", "http://json-schema.org/draft-07/schema", "https://json-schema.org/draft-07/schema").contains(dialect)) version = SpecVersion.VersionFlag.V7;
        else if (dialect.equals("https://json-schema.org/draft/2019-09/schema")) version = SpecVersion.VersionFlag.V201909;
        else throw invalidSchema();
        try {
            return JsonSchemaFactory.getInstance(version, builder -> builder.schemaLoaders(loaders ->
                    loaders.values(values -> { values.clear(); values.add(DisallowSchemaLoader.getInstance()); })))
                    .getSchema(root);
        } catch (RuntimeException e) { throw invalidSchema(); }
    }
    private static void inspect(JsonNode node, JsonNode root, Set<String> refs, int depth) {
        if (depth > 32) throw invalidSchema();
        if (node.isObject()) {
            if (node.has("$schema") && !Set.of("http://json-schema.org/draft-07/schema#", "https://json-schema.org/draft-07/schema#",
                    "http://json-schema.org/draft-07/schema", "https://json-schema.org/draft-07/schema",
                    "https://json-schema.org/draft/2020-12/schema", "https://json-schema.org/draft/2019-09/schema").contains(node.path("$schema").asText())) throw invalidSchema();
            for (String key : List.of("$ref", "$dynamicRef", "$recursiveRef")) if (node.has(key)) {
                String ref = node.path(key).asText();
                if (!ref.startsWith("#/") || !refs.add(ref)) throw invalidSchema();
                JsonNode target = root.at(ref.substring(1));
                if (target.isMissingNode()) throw invalidSchema();
                inspect(target, root, refs, depth + 1);
                refs.remove(ref);
            }
        }
        if (node.isContainerNode()) for (JsonNode child : node) inspect(child, root, refs, depth + 1);
    }
    private static String stringify(Object value) {
        try { return JSON.writeValueAsString(value); } catch (Exception e) { throw invalidSchema(); }
    }
    private static PluginMcpException invalidSchema() {
        return new PluginMcpException("unsupported_schema", 400, LangText.of("MCP 工具定义不受支持：仅支持有界的本地 JSON Schema，不加载外部引用。", "Unsupported MCP tool schema: only bounded local JSON Schema is supported; external references are never loaded."));
    }
    private static PluginMcpException invalidArguments() {
        return new PluginMcpException("invalid_arguments", 400, LangText.of("MCP 参数不符合工具定义，请核对后重试。", "MCP arguments do not satisfy the tool schema. Check them and retry."));
    }
}
