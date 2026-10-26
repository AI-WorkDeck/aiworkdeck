// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.harness;

import com.checkba.model.entity.HarnessEvolutionEntry;
import com.checkba.repository.HarnessEvolutionEntryRepository;
import com.checkba.service.ai.skill.SkillProperties;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.TestPropertySource;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 自进化记录持久化（dev-board#1481）：用真实 H2 + JPA（ddl-auto 建表，与四个 profile 同机制）验证
 * <ol>
 *   <li>进程重启（新服务实例、空内存缓存）后，卡片上的切换作用域 / 撤销仍能按 id 找回记录；</li>
 *   <li>历史回放按会话查得到记录，且带 assistantMessageId；</li>
 *   <li>他人记录一律按「不存在」处理；</li>
 *   <li>撤销只删 user-evo-* 命名空间的技能目录，绝不碰内置/广场技能。</li>
 * </ol>
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:harness-evolution-test;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
        "spring.jpa.hibernate.ddl-auto=create-drop"
})
class HarnessEvolutionPersistenceTest {

    @Autowired
    private HarnessEvolutionEntryRepository repository;

    @Autowired
    private EntityManager entityManager;

    @Test
    void longUnicodeJsonSurvivesDatabaseRoundTrip() {
        String payload = "{\"rule\":\"" + "规则🙂".repeat(20000) + "\"}";
        HarnessEvolutionEntry entry = new HarnessEvolutionEntry();
        entry.setId("long-json");
        entry.setPayloadJson(payload);
        repository.saveAndFlush(entry);
        entityManager.clear();
        assertEquals(payload, repository.findById(entry.getId()).orElseThrow().getPayloadJson());
    }

    @TempDir
    Path skillsDir;

    private HarnessEvolutionService newInstance() {
        SkillProperties props = new SkillProperties();
        props.setDir(skillsDir.toString());
        return new HarnessEvolutionService(null, null, props, repository);
    }

    private HarnessEvolutionService.HarnessEvolutionRecord createSteerRecord(HarnessEvolutionService svc) {
        return svc.evaluateTurnEvolution(
                "conv-persist", 7L, 10L,
                "审查这份合同",
                null,
                List.of("违约金条款请按「守约方」立场改写"),
                List.of(),
                4242L).orElseThrow();
    }

    @Test
    void recordSurvivesRestartAndStaysActionable() {
        HarnessEvolutionService.HarnessEvolutionRecord created = createSteerRecord(newInstance());
        assertEquals(4242L, created.assistantMessageId());

        // 模拟重启：全新实例，内存缓存为空，只剩数据库
        HarnessEvolutionService afterRestart = newInstance();
        List<HarnessEvolutionService.HarnessEvolutionRecord> listed =
                afterRestart.listEvolutions(7L, 10L, "conv-persist");
        assertEquals(1, listed.size());
        assertEquals(created.id(), listed.get(0).id());
        assertEquals(4242L, listed.get(0).assistantMessageId());

        HarnessEvolutionService.HarnessEvolutionRecord switched =
                afterRestart.switchScope(7L, created.id(), "user");
        assertEquals("user", switched.scope());

        HarnessEvolutionService.HarnessEvolutionRecord reverted =
                newInstance().revertEvolution(7L, created.id());
        assertEquals(HarnessEvolutionService.STATUS_REVERTED, reverted.status());
        assertEquals(HarnessEvolutionService.STATUS_REVERTED,
                newInstance().getEvolution(created.id()).orElseThrow().status());
    }

    @Test
    void otherUsersCannotSeeOrOperateRecords() {
        HarnessEvolutionService.HarnessEvolutionRecord created = createSteerRecord(newInstance());
        HarnessEvolutionService svc = newInstance();
        assertTrue(svc.listEvolutions(8L, null, null).isEmpty());
        assertThrows(IllegalArgumentException.class, () -> svc.revertEvolution(8L, created.id()));
        assertThrows(IllegalArgumentException.class, () -> svc.switchScope(8L, created.id(), "user"));
        assertEquals(HarnessEvolutionService.STATUS_APPLIED_MEMORY,
                svc.getEvolution(created.id()).orElseThrow().status());
    }

    @Test
    void promoteThenRevertOnlyTouchesUserEvoNamespace() throws Exception {
        Path builtin = Files.createDirectories(skillsDir.resolve("contract-review"));
        Files.writeString(builtin.resolve("skill.yml"), "id: contract-review\n");

        HarnessEvolutionService.HarnessEvolutionRecord created = createSteerRecord(newInstance());
        HarnessEvolutionService.HarnessEvolutionRecord promoted =
                newInstance().promoteToSkill(7L, created.id(), null, null, null, null);
        assertTrue(promoted.promotedSkillId().startsWith(HarnessEvolutionService.PROMOTED_SKILL_PREFIX));
        Path promotedDir = skillsDir.resolve(promoted.promotedSkillId());
        assertTrue(Files.exists(promotedDir.resolve("skill.yml")));

        newInstance().revertEvolution(7L, created.id());
        assertTrue(Files.notExists(promotedDir), "撤销应删除升格出的技能目录");
        assertTrue(Files.exists(builtin.resolve("skill.yml")), "撤销绝不能动内置技能目录");
    }
}
