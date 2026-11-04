// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.skill;

import com.checkba.service.AppLanguageService;
import com.checkba.service.account.AccountException;
import com.checkba.service.account.AccountService;
import com.checkba.service.ai.PluginService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

class SkillAuthoringServiceTest {

    @TempDir Path dir;
    SkillRegistry registry;
    AccountService account;
    SkillAuthoringService service;

    @BeforeEach
    void setUp() {
        SkillProperties props = new SkillProperties();
        props.setDir(dir.toString());
        registry = new SkillRegistry(props, null, new PluginService(), null);
        registry.init();
        account = mock(AccountService.class);
        AppLanguageService lang = mock(AppLanguageService.class);
        when(lang.language()).thenReturn("zh-CN");
        service = new SkillAuthoringService(props, registry, account, lang);
    }

    private static SkillAuthoringService.Draft draft(String id, String name, String desc, List<String> triggers) {
        return new SkillAuthoringService.Draft(id, name, desc, triggers, "材料A", "规则1", "一份清单", "先检查再输出");
    }

    private SkillAuthoringService.Draft ok() {
        return draft("sig-pages", "签字页", "核对签字页", List.of(" 签字页 ", "签字页", "股东会"));
    }

    private void assertNothingWritten() throws IOException {
        try (var s = Files.list(dir)) {
            assertEquals(0, s.count());
        }
    }

    @Test
    void createWritesFilesAndRegistersSkill() throws IOException {
        when(account.currentDisplayNameOrNull()).thenReturn("张律师");
        service.create(ok());

        assertTrue(Files.isRegularFile(dir.resolve("sig-pages/skill.yml")));
        String prompt = Files.readString(dir.resolve("sig-pages/prompt.md"));
        assertTrue(prompt.contains("# 签字页"));
        for (String s : new String[]{"## 输入", "## 规则", "## 输出", "## 做法"}) assertTrue(prompt.contains(s), s);

        SkillDefinition sk = registry.getSkill("sig-pages").orElseThrow();
        assertTrue(sk.isAuthoredLocally());
        assertEquals("1.0.0", sk.getVersion());
        assertNotNull(sk.getCreatedAt());
        assertDoesNotThrow(() -> Instant.parse(sk.getCreatedAt()));
        assertEquals(List.of("zh-CN"), sk.getLanguages());
        assertEquals(List.of("签字页", "股东会"), sk.getTriggers());
        assertEquals("张律师", sk.getAuthor());
    }

    @Test
    void recreateBumpsVersionAndKeepsCreatedAt() {
        SkillDefinition first = service.create(ok());
        String createdAt = first.getCreatedAt();
        SkillDefinition second = service.create(ok());
        assertEquals("1.0.1", second.getVersion());
        assertEquals(createdAt, second.getCreatedAt());
    }

    @Test
    void createRefusesIdOwnedByNonAuthoredSkill() throws IOException {
        Path d = dir.resolve("foreign");
        Files.createDirectories(d);
        Files.writeString(d.resolve("skill.yml"), "id: foreign\nname: 别人的\ntriggers: [x]\n");
        Files.writeString(d.resolve("prompt.md"), "原文");
        registry.rescan();
        String before = Files.readString(d.resolve("skill.yml"));

        assertThrows(IllegalArgumentException.class,
                () -> service.create(draft("foreign", "我的", "d", List.of("t"))));
        assertEquals(before, Files.readString(d.resolve("skill.yml")));
        assertEquals("原文", Files.readString(d.resolve("prompt.md")));
    }

    @Test
    void invalidInputsAreRejectedAndNothingWritten() throws IOException {
        List<SkillAuthoringService.Draft> bad = List.of(
                draft("Bad_ID", "n", "d", List.of("t")),
                draft("a", "n", "d", List.of("t")),
                draft("good-id", "  ", "d", List.of("t")),
                draft("good-id", "n".repeat(61), "d", List.of("t")),
                draft("good-id", "n", "d".repeat(201), List.of("t")),
                draft("good-id", "n", "d", List.of()),
                draft("good-id", "n", "d", java.util.stream.IntStream.range(0, 21).mapToObj(i -> "t" + i).toList()),
                draft("good-id", "n", "d", List.of("t".repeat(41))));
        for (var d : bad) assertThrows(IllegalArgumentException.class, () -> service.create(d), d.toString());
        assertNothingWritten();
    }

    @Test
    void yamlInjectionLookingNamesRoundTrip() {
        for (String name : new String[]{"x\nid: evil", "a: b"}) {
            SkillDefinition sk = service.create(draft("inj-test", name, "d", List.of("t")));
            assertEquals("inj-test", sk.getId());
            assertEquals(name.trim(), sk.getName());
        }
    }

    private static final Map<String, Object> REPLY = Map.of("skill", Map.of("version", "1.0.0"));

    @Test
    void publishSubmitsAndRecordsVersion() throws IOException {
        service.create(ok());
        when(account.submitSkill(any())).thenReturn(REPLY);

        var r = service.publish("sig-pages");

        assertEquals("1.0.0", r.version());
        assertFalse(r.updated());
        @SuppressWarnings("unchecked") ArgumentCaptor<Map<String, Object>> cap = ArgumentCaptor.forClass(Map.class);
        verify(account, times(1)).submitSkill(cap.capture());
        verify(account, never()).updatePublishedSkill(anyString(), any());
        Map<String, Object> body = cap.getValue();
        assertTrue(body.keySet().containsAll(List.of("id", "name", "description", "triggers", "allowedTools", "prompt")));
        assertEquals(Files.readString(dir.resolve("sig-pages/prompt.md")), body.get("prompt"));
        assertEquals("1.0.0", service.publishedVersion("sig-pages"));
    }

    @Test
    void publishFallsBackToUpdateOnIdTaken() {
        service.create(ok());
        when(account.submitSkill(any())).thenThrow(new AccountException(AccountException.Kind.REJECTED, "msg", "id_taken"));
        when(account.updatePublishedSkill(eq("sig-pages"), any())).thenReturn(Map.of("skill", Map.of("version", "1.0.3")));

        var r = service.publish("sig-pages");

        assertTrue(r.updated());
        assertEquals("1.0.3", r.version());
        assertEquals("1.0.3", service.publishedVersion("sig-pages"));
    }

    @Test
    void publishForbiddenUpdateBecomesIdTaken() {
        service.create(ok());
        when(account.submitSkill(any())).thenThrow(new AccountException(AccountException.Kind.REJECTED, "msg", "id_taken"));
        when(account.updatePublishedSkill(anyString(), any()))
                .thenThrow(new AccountException(AccountException.Kind.REJECTED, "x", "forbidden"));

        AccountException e = assertThrows(AccountException.class, () -> service.publish("sig-pages"));

        assertEquals("id_taken", e.getReason());
        assertTrue(e.getMessage().contains("sig-pages"));
        assertNull(service.publishedVersion("sig-pages"));
        assertFalse(Files.exists(dir.resolve("sig-pages/publish.json")));
    }

    @Test
    void publishRefusesNonAuthoredSkill() throws IOException {
        Path d = dir.resolve("foreign");
        Files.createDirectories(d);
        Files.writeString(d.resolve("skill.yml"), "id: foreign\nname: 别人的\ntriggers: [x]\n");
        Files.writeString(d.resolve("prompt.md"), "原文");
        registry.rescan();

        assertThrows(IllegalArgumentException.class, () -> service.publish("foreign"));
        verifyNoInteractions(account);
    }

    @Test
    void publishPropagatesNotConnected() {
        service.create(ok());
        var ex = new AccountException(AccountException.Kind.NOT_CONNECTED, "nc");
        when(account.submitSkill(any())).thenThrow(ex);
        assertSame(ex, assertThrows(AccountException.class, () -> service.publish("sig-pages")));
        verify(account, never()).updatePublishedSkill(anyString(), any());
    }

    @Test
    void createRefusesExistingUnloadedDirectory() throws Exception {
        java.nio.file.Path broken = dir.resolve("broken-skill");
        java.nio.file.Files.createDirectories(broken);
        java.nio.file.Files.writeString(broken.resolve("skill.yml"), "not: [valid");
        registry.rescan();

        assertThrows(IllegalArgumentException.class, () -> service.create(new SkillAuthoringService.Draft(
                "broken-skill", "名称", "简介", java.util.List.of("触发"), null, null, null, null)));
        assertEquals("not: [valid", java.nio.file.Files.readString(broken.resolve("skill.yml")), "未加载的目录不得被覆盖");
    }
}
