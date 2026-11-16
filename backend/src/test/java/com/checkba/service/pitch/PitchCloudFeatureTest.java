// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.pitch;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.when;

import com.checkba.service.lawfirm.LawFirmAuthority;
import java.util.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;

/**
 * 共享业绩：A 与 B 同在 t1，C 在同所的 t2，D 在别的律所。
 * 团队可见只给 t1；改全所后 C 可见；D 永远不可见；撤回后谁都检索不到；真实客户名只在勾选时上传；使用记录只能记可见的别人的条目。
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import(PitchCloudFeature.class)
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:pitch-cloud;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect", "spring.jpa.hibernate.ddl-auto=create-drop"
})
class PitchCloudFeatureTest {
    @Autowired PitchCloudFeature feature;
    @MockBean LawFirmAuthority authority;

    static final LawFirmAuthority.Member A = new LawFirmAuthority.Member(1L, "a", "firm1", "律师甲", false);
    static final LawFirmAuthority.Member B = new LawFirmAuthority.Member(2L, "b", "firm1", "律师乙", false);
    static final LawFirmAuthority.Member C = new LawFirmAuthority.Member(3L, "c", "firm1", "律师丙", false);
    static final LawFirmAuthority.Member D = new LawFirmAuthority.Member(4L, "d", "firm2", "律师丁", false);

    @BeforeEach
    void scopes() {
        when(authority.scope(anyLong())).thenAnswer(inv -> {
            long id = inv.getArgument(0);
            return switch ((int) id) {
                case 1 -> new LawFirmAuthority.Scope(1L, "firm1", Set.of("t1", "t3"), false);
                case 2 -> new LawFirmAuthority.Scope(2L, "firm1", Set.of("t1"), false);
                case 3 -> new LawFirmAuthority.Scope(3L, "firm1", Set.of("t2"), false);
                default -> new LawFirmAuthority.Scope(4L, "firm2", Set.of("t1"), false);
            };
        });
    }

    Map<String, Object> credential(boolean includeClient, String scope, List<String> teams) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("title", "某市属平台公司常年法律顾问");
        payload.put("client", "江岭市城市发展投资集团有限公司");
        payload.put("clientAlias", "某市属城市发展平台公司");
        payload.put("year", "2024");
        payload.put("secret", "不在白名单的字段");
        payload.put("lawyers", List.of("律师甲"));
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("localId", "c1");
        p.put("kind", "credential");
        p.put("scope", scope);
        p.put("teams", teams);
        p.put("includeClient", includeClient);
        p.put("payload", payload);
        return p;
    }

    @SuppressWarnings("unchecked")
    List<Map<String, Object>> search(LawFirmAuthority.Member me) {
        return (List<Map<String, Object>>) feature.execute(me, "pitch.search", Map.of()).get("entries");
    }

    @Test
    @SuppressWarnings("unchecked")
    void teamThenFirmThenWithdraw() {
        Map<String, Object> shared = feature.execute(A, "pitch.share", credential(false, "team", List.of("t1")));
        String id = (String) shared.get("id");
        assertEquals(1, search(B).size());
        assertEquals(0, search(C).size());
        assertEquals(0, search(D).size());
        assertEquals(0, search(A).size()); // 自己的不出现在检索里
        Map<String, Object> payload = (Map<String, Object>) search(B).get(0).get("payload");
        assertFalse(payload.containsKey("client"));
        assertFalse(payload.containsKey("secret"));
        assertEquals("律师甲", search(B).get(0).get("owner"));

        Map<String, Object> firm = credential(true, "firm", List.of());
        firm.put("expectedVersion", shared.get("version"));
        feature.execute(A, "pitch.share", firm);
        assertEquals(1, search(C).size());
        assertEquals("江岭市城市发展投资集团有限公司", ((Map<String, Object>) search(C).get(0).get("payload")).get("client"));
        assertEquals(0, search(D).size());

        assertEquals(1, feature.execute(B, "pitch.recordUse", Map.of("ids", List.of(id), "label", "青川城投提案")).get("recorded"));
        assertEquals(0, feature.execute(D, "pitch.recordUse", Map.of("ids", List.of(id), "label", "x")).get("recorded"));
        List<Map<String, Object>> uses = (List<Map<String, Object>>) feature.execute(A, "pitch.usage", Map.of("id", id)).get("uses");
        assertEquals(1, uses.size());
        assertEquals("律师乙", uses.get(0).get("by"));
        assertThrows(IllegalArgumentException.class, () -> feature.execute(B, "pitch.usage", Map.of("id", id)));

        assertThrows(IllegalArgumentException.class, () -> feature.execute(B, "pitch.withdraw", Map.of("id", id)));
        feature.execute(A, "pitch.withdraw", Map.of("id", id));
        assertEquals(0, search(B).size());
        assertEquals(0, search(C).size());
        List<Map<String, Object>> mine = (List<Map<String, Object>>) feature.execute(A, "pitch.mine", Map.of()).get("entries");
        assertEquals(true, mine.get(0).get("withdrawn"));
        assertEquals(1L, ((Number) mine.get(0).get("uses")).longValue());
    }

    @Test
    void teamSharingIsLimitedToOwnTeamsAndNeedsAChoiceWhenSeveral() {
        assertThrows(IllegalArgumentException.class, () -> feature.execute(A, "pitch.share", credential(false, "team", List.of("t2"))));
        assertThrows(IllegalArgumentException.class, () -> feature.execute(A, "pitch.share", credential(false, "team", List.of())));
        Map<String, Object> p = credential(false, "team", List.of());
        p.put("localId", "c9");
        feature.execute(B, "pitch.share", p); // B 只有一个团队：自动取 t1
        assertEquals(1, search(A).size());
    }

    @Test
    void staleVersionIsRejected() {
        feature.execute(A, "pitch.share", credential(false, "firm", List.of()));
        Map<String, Object> p = credential(false, "firm", List.of());
        p.put("expectedVersion", 99);
        assertThrows(IllegalStateException.class, () -> feature.execute(A, "pitch.share", p));
    }

    @Test
    void purgeRemovesOnlyThatFirm() {
        feature.execute(A, "pitch.share", credential(false, "firm", List.of()));
        Map<String, Object> other = credential(false, "firm", List.of());
        feature.execute(D, "pitch.share", other);
        assertTrue(feature.purge("firm1") >= 1);
        assertEquals(0, search(C).size());
        assertEquals(1, ((List<?>) feature.execute(D, "pitch.mine", Map.of()).get("entries")).size());
    }

    @Test
    void contractDeclaresKeyPluginAndLabels() {
        assertEquals("pitch", feature.key());
        assertEquals(Set.of("pitch-materials"), feature.pluginIds());
        assertTrue(feature.names().containsKey("zh-CN") && feature.names().containsKey("en-US"));
    }
}
