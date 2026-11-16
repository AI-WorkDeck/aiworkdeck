// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import com.checkba.service.plugin.HostServiceRegistry;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * manifest 权限全集对拍。宿主 {@link PluginService#KNOWN_PERMISSIONS}（PluginDevService 直接复用）、
 * SDK schema 及其分发副本、manifest.d.ts、市场页权限标签必须与 {@link #CANONICAL} 完全一致；
 * 宿主实际执法处（HostServiceRegistry、PluginPane）与每个官方插件 manifest 只能用其中的值。
 * 官网仓 AI-WorkDeck/aiworkdeck-website 的 scripts/verify-plugin-permissions.mts 钉着同一份清单，
 * 改这里必须同批改官网上传校验（lib/plugin-manifest-platform.ts）和那份测试。
 */
class PluginPermissionParityTest {

    static final List<String> CANONICAL = List.of("file_read", "file_write", "network", "editor", "ai", "im",
            "notifications", "lawfirm", "speech", "tasks", "clipboard", "worklog_read");

    private static final Path ROOT = Path.of("..");
    private static final ObjectMapper JSON = new ObjectMapper();

    private static void assumeRepo() {
        Assumptions.assumeTrue(Files.isDirectory(ROOT.resolve("sdk/plugin-sdk")), "非完整仓库检出，跳过对拍");
    }

    @Test
    void hostListIsCanonical() {
        assertEquals(new TreeSet<>(CANONICAL), new TreeSet<>(PluginService.KNOWN_PERMISSIONS));
        assertEquals(CANONICAL.size(), Set.copyOf(CANONICAL).size(), "CANONICAL 不能有重复");
    }

    @Test
    void everySchemaCopyEnumIsCanonical() throws Exception {
        assumeRepo();
        List<Path> schemas = new ArrayList<>(List.of(
                ROOT.resolve("sdk/plugin-sdk/manifest.schema.json"),
                Path.of("src/main/resources/plugin-dev/manifest.schema.json")));
        try (Stream<Path> s = Files.list(ROOT.resolve("examples"))) {
            s.map(d -> d.resolve("manifest.schema.json")).filter(Files::isRegularFile).forEach(schemas::add);
        }
        for (Path schema : schemas) {
            List<List<String>> enums = new ArrayList<>();
            collectPermissionEnums(JSON.readTree(schema.toFile()), enums);
            assertFalse(enums.isEmpty(), schema + " 里没找到 permissions 枚举");
            for (List<String> e : enums) assertEquals(CANONICAL, e, schema + " 的 permissions 枚举与宿主不一致");
        }
    }

    @Test
    void manifestTypeDefinitionsAreCanonical() throws Exception {
        assumeRepo();
        Pattern type = Pattern.compile("export type Permission = ([^;]+);");
        for (Path dts : List.of(ROOT.resolve("sdk/plugin-sdk/manifest.d.ts"),
                Path.of("src/main/resources/plugin-dev/manifest.d.ts"))) {
            Matcher m = type.matcher(Files.readString(dts));
            assertTrue(m.find(), dts + " 缺 Permission 类型");
            assertEquals(new TreeSet<>(CANONICAL), quoted(m.group(1)), dts + " 的 Permission 与宿主不一致");
        }
    }

    @Test
    void enforcedPermissionsAreKnown() throws Exception {
        assumeRepo();
        Set<String> enforced = new TreeSet<>();
        HostServiceRegistry.TABLE.values().forEach(ops -> ops.values().forEach(spec -> enforced.addAll(spec.requiredPermissions())));
        String pane = Files.readString(ROOT.resolve("frontend/src/components/PluginPane.vue"));
        Matcher m = Pattern.compile("(?:hasPermission\\(|denied\\(|permission: )'([a-z_]+)'").matcher(pane);
        while (m.find()) enforced.add(m.group(1));
        assertTrue(enforced.size() >= 10, "执法点解析异常：" + enforced);
        enforced.removeAll(CANONICAL);
        assertEquals(Set.of(), enforced, "宿主在执法、但不在权限全集里的值");
    }

    @Test
    void officialManifestsUseOnlyKnownPermissions() throws Exception {
        assumeRepo();
        List<Path> manifests;
        try (Stream<Path> s = Files.list(ROOT.resolve("official-plugins"))) {
            manifests = s.map(d -> d.resolve("manifest.json")).filter(Files::isRegularFile).toList();
        }
        assertFalse(manifests.isEmpty());
        for (Path manifest : manifests) {
            JsonNode root = JSON.readTree(manifest.toFile());
            Set<String> used = new LinkedHashSet<>();
            root.path("permissions").forEach(p -> used.add(p.asText()));
            root.path("tools").forEach(t -> t.path("permissions").forEach(p -> used.add(p.asText())));
            used.removeAll(CANONICAL);
            assertEquals(Set.of(), used, manifest + " 用了权限全集之外的值");
        }
    }

    @Test
    void marketplaceLabelsCoverCanonical() throws Exception {
        assumeRepo();
        Pattern label = Pattern.compile("get ([a-z_]+)\\(\\) \\{ return t\\('market\\.perm");
        for (String vue : List.of("MarketPane.vue", "MarketDetailPane.vue")) {
            Matcher m = label.matcher(Files.readString(ROOT.resolve("frontend/src/components/" + vue)));
            Set<String> keys = new TreeSet<>();
            while (m.find()) keys.add(m.group(1));
            assertEquals(new TreeSet<>(CANONICAL), keys, vue + " 的 PERMISSION_LABELS 与权限全集不一致");
        }
    }

    private static void collectPermissionEnums(JsonNode node, List<List<String>> out) {
        if (node.isObject()) {
            JsonNode permissions = node.get("permissions");
            if (permissions != null && permissions.path("items").has("enum")) {
                List<String> values = new ArrayList<>();
                permissions.path("items").path("enum").forEach(v -> values.add(v.asText()));
                out.add(values);
            }
            node.forEach(child -> collectPermissionEnums(child, out));
        } else if (node.isArray()) {
            node.forEach(child -> collectPermissionEnums(child, out));
        }
    }

    private static Set<String> quoted(String union) {
        Set<String> values = new TreeSet<>();
        Matcher m = Pattern.compile("'([a-z_]+)'").matcher(union);
        while (m.find()) values.add(m.group(1));
        return values;
    }
}
