// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.lawfirm;

import com.checkba.model.entity.AccountBinding;
import com.checkba.model.entity.User;
import com.checkba.repository.AccountBindingRepository;
import com.checkba.repository.UserRepository;
import com.checkba.service.collab.AccountDirectoryClient;
import com.checkba.service.collab.DirectoryAccount;
import com.checkba.service.collab.DirectoryReply;
import com.checkba.service.collab.OrgMembership;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;

import java.time.LocalDateTime;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/** 律所云端统一入口：名录身份、按律所隔离的功能开关、关闭即拒绝、乐观版本、关闭并删除。 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import({LawFirmCloudService.class, LawFirmAuthority.class, LawFirmCloudServiceTest.Features.class})
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:lawfirm-cloud-base;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect", "spring.jpa.hibernate.ddl-auto=create-drop"
})
class LawFirmCloudServiceTest {

    /** 一个合成的「time」功能：记下收到的成员与动作，关闭并删除时报告删了 3 行。 */
    static final List<String> calls = Collections.synchronizedList(new ArrayList<>());
    static final List<String> purged = Collections.synchronizedList(new ArrayList<>());

    @TestConfiguration
    static class Features {
        @Bean
        LawFirmCloudFeature timeFeature() {
            return new LawFirmCloudFeature() {
                public String key() { return "time"; }
                public Map<String, Object> execute(LawFirmAuthority.Member me, String action, Map<String, Object> params) {
                    calls.add(me.firmId() + "|" + me.userId() + "|" + action);
                    return Map.of("ok", true);
                }
                public long purge(String firmId) { purged.add(firmId); return 3; }
                public Set<String> pluginIds() { return Set.of("lawfirm-management"); }
            };
        }

        /** 另一项功能（如投标材料插件的后端），由别的包登记，同样走统一入口与开关。 */
        @Bean
        LawFirmCloudFeature pitchFeature() {
            return new LawFirmCloudFeature() {
                public String key() { return "pitch"; }
                public Set<String> pluginIds() { return Set.of("pitch-materials"); }
                public Map<String, String> names() { return Map.of("zh-CN", "投标业绩库", "en-US", "Pitch library"); }
                public Map<String, Object> execute(LawFirmAuthority.Member me, String action, Map<String, Object> params) {
                    calls.add(me.firmId() + "|" + me.userId() + "|" + action);
                    return Map.of("ok", true);
                }
            };
        }
    }

    @Autowired LawFirmCloudService cloud;
    @Autowired LawFirmAuthority authority;
    @Autowired UserRepository users;
    @Autowired AccountBindingRepository bindings;
    @MockBean AccountDirectoryClient directory;

    final Map<String, OrgMembership> membership = new HashMap<>();
    Long admin, lawyer, otherAdmin;
    String firm;

    @BeforeEach
    void setUp() {
        calls.clear();
        purged.clear();
        firm = "firm-" + UUID.randomUUID();
        admin = user(true, firm);
        lawyer = user(false, firm);
        otherAdmin = user(true, "other-" + firm);
        when(directory.configured()).thenReturn(true);
        when(directory.lookupByAccountId(anyString(), anyString())).thenAnswer(c -> {
            String me = c.getArgument(0), cand = c.getArgument(1);
            return new DirectoryReply(membership.containsKey(cand), new DirectoryAccount(cand, cand, "合成 " + cand, null),
                    membership.getOrDefault(me, OrgMembership.NONE), membership.getOrDefault(cand, OrgMembership.NONE));
        });
    }

    Long user(boolean firmAdmin, String scope) {
        User u = new User();
        u.setUsername("cloud-base-" + UUID.randomUUID());
        u.setDisplayName("合成");
        u.setPassword("synthetic");
        u.setRole("USER");
        u.setSubscriptionType("FREE");
        u.setCreatedAt(LocalDateTime.now());
        u.setUpdatedAt(LocalDateTime.now());
        Long id = users.saveAndFlush(u).getId();
        AccountBinding b = new AccountBinding();
        b.setUserId(id);
        b.setExternalAccountId("account-" + id);
        b.setCreatedAt(LocalDateTime.now());
        bindings.saveAndFlush(b);
        membership.put(b.getExternalAccountId(), new OrgMembership("team-" + scope, scope, firmAdmin));
        return id;
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> switches(Map<String, Object> view) {
        return (Map<String, Object>) view.get("switches");
    }

    @Test
    void settingsAreAdminOnlyPerFirmAndGateEveryFeatureAction() {
        Map<String, Object> view = cloud.execute(lawyer, LawFirmCloudService.SETTINGS_GET, Map.of());
        assertEquals(Map.of("pitch", false, "time", false), switches(view), "every registered feature is listed, all off by default");
        assertEquals(false, view.get("firmAdmin"));
        assertEquals(Set.of("time", "pitch"), new HashSet<>((List<?>) view.get("features")));
        assertEquals(Map.of("zh-CN", "投标业绩库", "en-US", "Pitch library"), ((Map<?, ?>) ((Map<?, ?>) view.get("labels")).get("pitch")).get("names"),
                "features bring their own switch labels");

        // 关闭时功能动作一律拒绝，连功能处理器都不会被调用
        assertThrows(IllegalStateException.class, () -> cloud.execute(lawyer, "time.mine", Map.of()));
        assertTrue(calls.isEmpty());
        // 不认识的前缀、未登记的功能（clients 本测试没有处理器）一律不受理
        assertThrows(IllegalArgumentException.class, () -> cloud.execute(admin, "clients.list", Map.of()));
        assertThrows(IllegalArgumentException.class, () -> cloud.execute(admin, "billing.x", Map.of()));
        assertThrows(IllegalArgumentException.class, () -> cloud.execute(admin, "time.", Map.of()));

        // 只有律所管理员能开；律师不能
        assertThrows(IllegalArgumentException.class, () -> cloud.execute(lawyer, LawFirmCloudService.SETTINGS_SET,
                Map.of("feature", "time", "enabled", true, "expectedVersion", 0)));
        Map<String, Object> on = cloud.execute(admin, LawFirmCloudService.SETTINGS_SET, Map.of("feature", "time", "enabled", true, "expectedVersion", 0));
        assertEquals(true, switches(on).get("time"));
        assertEquals(false, switches(on).get("pitch"));
        assertThrows(IllegalStateException.class, () -> cloud.execute(lawyer, "pitch.list", Map.of()), "switches are independent");

        cloud.execute(lawyer, "time.mine", Map.of());
        assertEquals(List.of(firm + "|" + lawyer + "|time.mine"), calls, "the feature receives the directory-resolved member");

        // 另一个律所不受影响
        assertThrows(IllegalStateException.class, () -> cloud.execute(otherAdmin, "time.mine", Map.of()));
        assertEquals(false, switches(cloud.execute(otherAdmin, LawFirmCloudService.SETTINGS_GET, Map.of())).get("time"));
        assertFalse(cloud.isEnabled("other-" + firm, "time"));
        assertTrue(cloud.isEnabled(firm, "time"));
    }

    @Test
    void staleVersionIsRejectedAndPurgeIsExplicit() {
        long v0 = ((Number) cloud.execute(admin, LawFirmCloudService.SETTINGS_GET, Map.of()).get("version")).longValue();
        long v1 = ((Number) cloud.execute(admin, LawFirmCloudService.SETTINGS_SET, Map.of("feature", "time", "enabled", true, "expectedVersion", v0)).get("version")).longValue();
        assertNotEquals(v0, v1);
        // 另一位管理员拿着旧画面再点一次
        IllegalStateException stale = assertThrows(IllegalStateException.class, () -> cloud.execute(admin, LawFirmCloudService.SETTINGS_SET,
                Map.of("feature", "pitch", "enabled", true, "expectedVersion", v0)));
        assertEquals(LawFirmCloudVersions.staleMessage(), stale.getMessage());
        assertEquals(false, switches(cloud.execute(admin, LawFirmCloudService.SETTINGS_GET, Map.of())).get("pitch"));
        // 带上当前版本就能改；两个开关在同一行、同一个版本号下
        long v1b = ((Number) cloud.execute(admin, LawFirmCloudService.SETTINGS_SET, Map.of("feature", "pitch", "enabled", true, "expectedVersion", v1)).get("version")).longValue();
        Map<String, Object> both = switches(cloud.execute(admin, LawFirmCloudService.SETTINGS_GET, Map.of()));
        assertEquals(Map.of("pitch", true, "time", true), both);

        // 关闭但不删除：数据留着；关闭并删除：交给功能清理
        long v2 = ((Number) cloud.execute(admin, LawFirmCloudService.SETTINGS_SET, Map.of("feature", "time", "enabled", false, "expectedVersion", v1b)).get("version")).longValue();
        assertTrue(purged.isEmpty());
        Map<String, Object> res = cloud.execute(admin, LawFirmCloudService.SETTINGS_SET, Map.of("feature", "time", "enabled", false, "purge", true, "expectedVersion", v2));
        assertEquals(List.of(firm), purged);
        assertEquals(3L, res.get("purged"));

        assertThrows(IllegalArgumentException.class, () -> cloud.execute(admin, LawFirmCloudService.SETTINGS_SET, Map.of("feature", "billing", "enabled", true)));
        assertThrows(IllegalArgumentException.class, () -> cloud.execute(admin, LawFirmCloudService.SETTINGS_SET, Map.of("feature", "time", "enabled", "yes")));
    }

    @Test
    void scopeHelperUsesDirectoryFactsAndStopsAtTheFirmBoundary() {
        LawFirmAuthority.Scope mine = authority.scope(lawyer);
        assertTrue(mine.inFirm(firm));
        assertEquals(Set.of("team-" + firm), mine.teamIds(), "teams are a set");
        assertTrue(mine.inTeam("team-" + firm));
        assertTrue(mine.sharesTeam(List.of("team-x", "team-" + firm)));
        assertFalse(mine.sharesTeam(List.of("team-x")));
        assertFalse(mine.firmAdmin());
        LawFirmAuthority.Scope seen = authority.scope(lawyer, admin);
        assertTrue(seen.inTeam("team-" + firm));
        assertTrue(seen.firmAdmin());
        assertThrows(IllegalArgumentException.class, () -> authority.scope(lawyer, otherAdmin), "other firms are invisible");
    }

    @Test
    void eachPluginMayCallOnlyItsOwnFeature() {
        assertTrue(cloud.pluginMayCall("lawfirm-management", "time.mine"));
        assertTrue(cloud.pluginMayCall("lawfirm-management", LawFirmCloudService.SETTINGS_SET));
        assertFalse(cloud.pluginMayCall("lawfirm-management", "pitch.list"), "lawfirm plugin cannot reach pitch");
        assertTrue(cloud.pluginMayCall("pitch-materials", "pitch.list"));
        assertFalse(cloud.pluginMayCall("pitch-materials", "time.mine"), "pitch plugin cannot reach time");
        assertFalse(cloud.pluginMayCall("pitch-materials", LawFirmCloudService.SETTINGS_SET), "only the lawfirm plugin toggles switches");
        assertFalse(cloud.pluginMayCall("some-other-plugin", "time.mine"));
        assertFalse(cloud.pluginMayCall("lawfirm-management", "clients.list"), "unregistered features are nobody's");
    }

    @Test
    void versionHelperIgnoresMissingAndRejectsGarbage() {
        LawFirmCloudVersions.check(Map.of(), 5);
        LawFirmCloudVersions.check(Map.of("expectedVersion", "5"), 5);
        assertThrows(IllegalStateException.class, () -> LawFirmCloudVersions.check(Map.of("expectedVersion", 4), 5));
        assertThrows(IllegalArgumentException.class, () -> LawFirmCloudVersions.check(Map.of("expectedVersion", "x"), 5));
    }
}
