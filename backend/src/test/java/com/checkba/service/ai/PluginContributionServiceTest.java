// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import com.checkba.model.entity.ProjectFile;
import com.checkba.service.ProjectFileService;
import com.checkba.service.SystemSettingService;
import com.checkba.storage.StorageService;
import com.checkba.storage.StorageServiceFactory;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * 声明式贡献点（规范 v2.9 P4）：模板清单与落地 / 画像选择与降级 / 设置校验与掩码 /
 * l10n %key% 解析 / 声明文件路径逃逸闸。
 */
class PluginContributionServiceTest {

    @TempDir
    Path pluginsDir;

    private final Map<String, String> store = new HashMap<>();
    private PluginService pluginService;
    private ProjectFileService projectFileService;
    private StorageService storage;
    private PluginContributionService svc;

    private static final String MANIFEST = """
            {"id": "hr-pack", "name": "%name%", "version": "1.0.0",
             "contributes": {
               "templates": [
                 {"id": "labor-contract", "name": "%tpl.labor%", "genre": "contract", "file": "templates/labor.md"},
                 {"id": "escape", "name": "坏路径", "file": "../outside.md"}
               ],
               "styleProfiles": [
                 {"id": "court", "name": "法院画像", "file": "profiles/court.json"},
                 {"id": "broken", "name": "坏画像", "file": "profiles/broken.json"}
               ],
               "themes": [
                 {"id": "inkwash", "name": "%theme.inkwash%", "description": "宣纸水墨", "file": "themes/inkwash.json"},
                 {"id": "bad-css", "name": "注入皮肤", "file": "themes/bad-css.json"},
                 {"id": "escape-theme", "name": "越界皮肤", "file": "../escape.json"}
               ]
             },
             "settings": [
               {"key": "region", "type": "select", "label": "%set.region%", "options": ["cn", "intl"], "default": "cn"},
               {"key": "apiToken", "type": "string", "label": "令牌", "secret": true},
               {"key": "autoRefresh", "type": "boolean", "label": "自动刷新", "default": true},
               {"key": "bad key with space", "type": "string", "label": "非法键"}
             ]}
            """;

    @BeforeEach
    void setUp() throws IOException {
        SystemSettingService settings = mock(SystemSettingService.class);
        when(settings.get(anyString(), nullable(String.class))).thenAnswer(inv ->
                store.getOrDefault(inv.getArgument(0), inv.getArgument(1)));
        doAnswer(inv -> store.put(inv.getArgument(0), inv.getArgument(1)))
                .when(settings).set(anyString(), anyString());

        Path dir = pluginsDir.resolve("hr-pack");
        Files.createDirectories(dir.resolve("templates"));
        Files.createDirectories(dir.resolve("profiles"));
        Files.createDirectories(dir.resolve("themes"));
        Files.createDirectories(dir.resolve("l10n"));
        Files.writeString(dir.resolve("manifest.json"), MANIFEST, StandardCharsets.UTF_8);
        Files.writeString(dir.resolve("templates/labor.md"), "# 劳动合同模板正文", StandardCharsets.UTF_8);
        Files.writeString(dir.resolve("profiles/court.json"), "{\"version\": 1}", StandardCharsets.UTF_8);
        Files.writeString(dir.resolve("profiles/broken.json"), "not json", StandardCharsets.UTF_8);
        Files.writeString(dir.resolve("themes/inkwash.json"),
                "{\"previewSwatches\":[\"#F4F1EA\",\"#5B4B7A\"],\"roles\":{\"light\":{\"bg\":\"#F4F1EA\",\"accent\":\"#5B4B7A\"},\"dark\":{\"bg\":\"#141312\",\"accent\":\"#7E6BA3\"}}}",
                StandardCharsets.UTF_8);
        Files.writeString(dir.resolve("themes/bad-css.json"),
                "{\"roles\":{\"light\":{\"bg\":\"#fff; background:url(evil)\"},\"dark\":{\"bg\":\"#000\"}}}",
                StandardCharsets.UTF_8);
        Files.writeString(dir.resolve("l10n/zh-CN.json"),
                "{\"name\": \"HR 模板包\", \"tpl.labor\": \"劳动合同（标准版）\", \"set.region\": \"数据源区域\", \"theme.inkwash\": \"东方水墨\"}",
                StandardCharsets.UTF_8);

        pluginService = new PluginService(settings, pluginsDir.toString());
        pluginService.init();

        projectFileService = mock(ProjectFileService.class);
        storage = mock(StorageService.class);
        StorageServiceFactory factory = mock(StorageServiceFactory.class);
        when(factory.getStorageService()).thenReturn(storage);
        svc = new PluginContributionService(pluginService, settings, projectFileService, factory);
    }

    @Test
    @DisplayName("模板清单：逃逸路径的条目在解析期已丢弃；名称经 l10n 解析")
    void listTemplates() {
        var templates = svc.listTemplates();
        assertEquals(1, templates.size());
        assertEquals("labor-contract", templates.get(0).id());
        assertEquals("劳动合同（标准版）", templates.get(0).name());
        assertEquals("md", templates.get(0).fileExt());
    }

    @Test
    @DisplayName("从模板创建：RENAME 策略建记录 + 模板字节写入存储；禁用插件拒绝")
    void createFromTemplate() throws Exception {
        ProjectFile record = new ProjectFile();
        record.setId(9L);
        record.setName("劳动合同（标准版）.md");
        record.setFilePath("proj/1/劳动合同（标准版）.md");
        when(projectFileService.createFile(eq(1L), isNull(), anyString(), eq("md"), anyLong(),
                isNull(), isNull(), eq(7L), eq(ProjectFileService.ConflictPolicy.RENAME))).thenReturn(record);

        var file = svc.createFromTemplate(1L, 7L, "hr-pack", "labor-contract", null, null);
        assertEquals(9L, file.getId());
        var bytes = org.mockito.ArgumentCaptor.forClass(InputStream.class);
        verify(storage).save(eq("proj/1/劳动合同（标准版）.md"), bytes.capture());
        assertEquals("# 劳动合同模板正文", new String(bytes.getValue().readAllBytes(), StandardCharsets.UTF_8));

        pluginService.setEnabled("hr-pack", false);
        assertThrows(IllegalArgumentException.class,
                () -> svc.createFromTemplate(1L, 7L, "hr-pack", "labor-contract", null, null));
    }

    @Test
    @DisplayName("画像：选中合法项生效；坏 JSON 拒绝选中；插件禁用后选中项降级为 null")
    void styleProfileSelection() {
        svc.selectStyleProfile("hr-pack:court");
        assertEquals("{\"version\": 1}", svc.selectedStyleProfileJson());
        assertTrue(svc.listStyleProfiles().stream()
                .anyMatch(p -> p.id().equals("court") && p.selected()));

        assertThrows(Exception.class, () -> svc.selectStyleProfile("hr-pack:broken"));
        assertThrows(IllegalArgumentException.class, () -> svc.selectStyleProfile("hr-pack:nope"));

        pluginService.setEnabled("hr-pack", false);
        assertNull(svc.selectedStyleProfileJson(), "插件禁用后退默认链");
    }

    @Test
    @DisplayName("设置：非法键在解析期丢弃；secret 掩码；类型校验；桥读不到 secret")
    void settingsRoundTrip() {
        var view = svc.settingsView("hr-pack");
        assertEquals(3, view.size(), "非法键 'bad key with space' 应在解析期丢弃");
        assertEquals("数据源区域", view.get(0).get("label"));
        assertEquals("cn", view.get(0).get("value"), "缺省值来自 manifest default");

        svc.saveSettings("hr-pack", Map.of("region", "intl", "apiToken", "sk-verySecret1234", "autoRefresh", "false"));
        assertEquals("intl", store.get("plugin.hr-pack.region"));
        assertEquals("****1234", svc.settingsView("hr-pack").get(1).get("value"), "secret 只回显尾 4 位");

        assertThrows(IllegalArgumentException.class, () -> svc.saveSettings("hr-pack", Map.of("region", "jp")));
        assertThrows(IllegalArgumentException.class, () -> svc.saveSettings("hr-pack", Map.of("autoRefresh", "maybe")));
        assertThrows(IllegalArgumentException.class, () -> svc.saveSettings("hr-pack", Map.of("undeclared", "x")));

        assertEquals("intl", svc.settingValueForBridge("hr-pack", "region"));
        assertNull(svc.settingValueForBridge("hr-pack", "apiToken"), "secret 不进插件桥");
        assertNull(svc.settingValueForBridge("hr-pack", "undeclared"));
    }

    @Test
    @DisplayName("声明文件读取的 canonical 逃逸闸（第二道，防解析后目录被做手脚）")
    void readEscapeRejected() {
        assertThrows(IllegalArgumentException.class,
                () -> svc.readContributedFile("hr-pack", "../outside.md"));
    }
    @Test void scopedSettingsSeparateUsersAndProjectsAndRejectPartialInvalidWrites() {
        var meta = pluginService.getPlugin("hr-pack");
        var user = new PluginService.PluginSettingDecl();
        user.setKey("tone"); user.setType("string"); user.setScope("user");
        var project = new PluginService.PluginSettingDecl();
        project.setKey("jurisdiction"); project.setType("string"); project.setScope("project");
        meta.setSettings(List.of(user, project));
        svc.saveSettings("hr-pack", Map.of("tone", "formal", "jurisdiction", "cn"), 1L, 11L);
        svc.saveSettings("hr-pack", Map.of("tone", "plain"), 2L, 11L);
        assertEquals("formal", svc.settingsView("hr-pack", 1L, 11L).get(0).get("value"));
        assertEquals("plain", svc.settingsView("hr-pack", 2L, 12L).get(0).get("value"));
        assertNull(svc.settingsView("hr-pack", 2L, 12L).get(1).get("value"));
        assertThrows(IllegalArgumentException.class, () -> svc.saveSettings("hr-pack", Map.of("jurisdiction", "wrong"), 1L, null));
        var invalid = new java.util.LinkedHashMap<String, Object>();
        invalid.put("tone", "must-not-save"); invalid.put("undeclared", "bad");
        assertThrows(IllegalArgumentException.class, () -> svc.saveSettings("hr-pack", invalid, 1L, 11L));
        assertEquals("formal", svc.settingsView("hr-pack", 1L, 11L).get(0).get("value"));
    }

    @Test
    @DisplayName("外观皮肤：l10n 名称解析 + 令牌键归一化 + CSS 注入拦截 + 禁用后自动退回默认皮肤")
    void themeContributionAndSelection() {
        var themes = svc.listThemes();
        assertEquals(1, themes.size(), "越界与含 CSS 注入的皮肤应在解析/列表期被拦截");
        var t = themes.get(0);
        assertEquals("inkwash", t.id());
        assertEquals("东方水墨", t.name());
        assertEquals("#F4F1EA", t.lightTokens().get("--awd-bg"));
        assertEquals("#7E6BA3", t.darkTokens().get("--awd-accent"));
        assertFalse(t.selected());

        svc.selectTheme("hr-pack:inkwash");
        assertEquals("hr-pack:inkwash", svc.selectedThemeRef());
        assertTrue(svc.listThemes().get(0).selected());

        assertThrows(IllegalArgumentException.class, () -> svc.selectTheme("hr-pack:bad-css"));
        assertThrows(IllegalArgumentException.class, () -> svc.selectTheme("hr-pack:escape-theme"));

        pluginService.setEnabled("hr-pack", false);
        assertEquals("", svc.selectedThemeRef(), "插件禁用后自动退回默认皮肤");
        assertTrue(svc.listThemes().isEmpty());

        pluginService.setEnabled("hr-pack", true);
        svc.selectTheme("default");
        assertEquals("", svc.selectedThemeRef());
    }

}
