// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.skill;

import com.checkba.service.ai.PluginService;
import com.checkba.service.telemetry.TelemetryService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;

/**
 * 懒人模式内置常驻工作流多版本管理、项目级版本记忆与 Prompt 注入单测（dev-board#1438）。
 */
class BuiltinWorkflowVersionServiceTest {

    private SkillRegistry registry;
    private BuiltinWorkflowVersionService versionService;
    private SkillRouter router;

    @BeforeEach
    void setUp() {
        SkillProperties props = new SkillProperties();
        props.setDir(Path.of("skills").toString());
        registry = new SkillRegistry(props, null, new PluginService(), null);
        registry.init();
        versionService = new BuiltinWorkflowVersionService(registry, null, null);
        router = new SkillRouter(registry, props, mock(TelemetryService.class), null);
        router.setBuiltinWorkflowVersionService(versionService);
    }

    @Test
    @DisplayName("默认列出五个内置常驻工作流，每个均含只读的系统默认版")
    void listsAllFiveBuiltinWorkflowsWithSystemDefault() {
        List<BuiltinWorkflowVersionService.WorkflowStateView> states =
                versionService.listWorkflowStates(1L, "proj-1");

        assertEquals(
                List.of("contract-review", "evidence-linked-report", "file-organization", "legal-opinion-review", "presentation-design"),
                states.stream().map(BuiltinWorkflowVersionService.WorkflowStateView::getSkillId).toList());

        for (var state : states) {
            assertEquals("default", state.getActiveVersionId());
            assertTrue(state.isActiveIsSystemDefault());
            assertEquals("系统默认版", state.getActiveVersionName());
            assertFalse(state.getActiveQuickPrompt().isBlank());
            assertEquals(1, state.getVersions().size());
            var defVer = state.getVersions().get(0);
            assertTrue(defVer.isSystemDefault());
            assertFalse(defVer.getPromptTemplate().isBlank(), state.getSkillId() + " 系统默认 Prompt 不应为空");
        }
    }

    @Test
    @DisplayName("支持创建多个自定义版本、按项目独立切换版本，且系统默认版始终保留兜底")
    void supportsMultipleCustomVersionsAndPerProjectSelection() {
        Long userId = 42L;

        // 1. 创建「我的个人版」并设为全局默认，不在 proj-A 单独覆盖
        var reqPersonal = new BuiltinWorkflowVersionService.SaveVersionRequest();
        reqPersonal.setName("我的个人版");
        reqPersonal.setQuickPrompt("按我的个人偏好审查当前合同，重点关注违约金上限");
        reqPersonal.setPromptTemplate("## 个人版合同审查规则\n1. 违约金上限不得超过合同总额 10%。");
        reqPersonal.setOutput("个人版输出约定：开头先给风险评级。");
        reqPersonal.setApplyToProject(false);
        reqPersonal.setSetAsGlobalDefault(true);

        var afterPersonal = versionService.saveCustomVersion(userId, null, "contract-review", reqPersonal);
        assertEquals(2, afterPersonal.getVersions().size());
        String personalVersionId = afterPersonal.getVersions().get(1).getId();
        assertNotEquals("default", personalVersionId);
        assertEquals("我的个人版", afterPersonal.getActiveVersionName());

        // 2. 在项目 proj-A 下创建并启用「甲方强势版」
        var reqPartyA = new BuiltinWorkflowVersionService.SaveVersionRequest();
        reqPartyA.setName("甲方强势版");
        reqPartyA.setQuickPrompt("请站在甲方强势地位审查合同，严控付款节点与单方解约权");
        reqPartyA.setPromptTemplate("## 甲方强势审查工作流\n1. 付款前必须收到合规增值税专票；\n2. 保留甲方无条件单方解除权。");
        reqPartyA.setOutput("甲方版输出约定：优先列出乙方义务缺口。");
        reqPartyA.setApplyToProject(true);
        reqPartyA.setSetAsGlobalDefault(false);

        var stateProjA = versionService.saveCustomVersion(userId, "proj-A", "contract-review", reqPartyA);
        assertEquals(3, stateProjA.getVersions().size());
        String partyAVersionId = stateProjA.getActiveVersionId();
        assertEquals("甲方强势版", stateProjA.getActiveVersionName());
        assertEquals("project", stateProjA.getActiveScope());

        // 3. 项目 proj-B 未单设项目偏好，应自动继承用户的全局默认「我的个人版」
        var stateProjB = versionService.getWorkflowState(userId, "proj-B", "contract-review");
        assertEquals(personalVersionId, stateProjB.getActiveVersionId());
        assertEquals("我的个人版", stateProjB.getActiveVersionName());
        assertEquals("global", stateProjB.getActiveScope());

        // 4. 在项目 proj-C 中显式切回「系统默认版」，不受全局默认影响
        var stateProjC = versionService.selectVersion(userId, "proj-C", "contract-review", "default", "project");
        assertEquals("default", stateProjC.getActiveVersionId());
        assertTrue(stateProjC.isActiveIsSystemDefault());
        assertEquals("系统默认版", stateProjC.getActiveVersionName());
        assertEquals("project", stateProjC.getActiveScope());

        // 5. 校验 SkillRouter 在不同项目下注入各自对应的版本 Prompt
        SkillDefinition contractSkill = registry.getSkill("contract-review").orElseThrow();

        String injectionA = router.promptInjectionFor(contractSkill, userId, "proj-A");
        assertTrue(injectionA.contains("合同审查（甲方强势版）"));
        assertTrue(injectionA.contains("保留甲方无条件单方解除权"));
        assertTrue(injectionA.contains("甲方版输出约定：优先列出乙方义务缺口"));

        String injectionB = router.promptInjectionFor(contractSkill, userId, "proj-B");
        assertTrue(injectionB.contains("合同审查（我的个人版）"));
        assertTrue(injectionB.contains("违约金上限不得超过合同总额 10%"));

        String injectionC = router.promptInjectionFor(contractSkill, userId, "proj-C");
        assertFalse(injectionC.contains("甲方强势版"));
        assertFalse(injectionC.contains("我的个人版"));
        assertTrue(injectionC.contains(contractSkill.getPromptTemplate()));

        // 6. 删除正在被 proj-A 选用的「甲方强势版」，proj-A 自动回退到全局默认或系统默认，且系统默认版不可删除
        assertThrows(IllegalArgumentException.class,
                () -> versionService.deleteCustomVersion(userId, "proj-A", "contract-review", "default"));

        var afterDeleteA = versionService.deleteCustomVersion(userId, "proj-A", "contract-review", partyAVersionId);
        assertEquals(2, afterDeleteA.getVersions().size());
        assertEquals(personalVersionId, afterDeleteA.getActiveVersionId());

        var afterDeletePersonal = versionService.deleteCustomVersion(userId, "proj-A", "contract-review", personalVersionId);
        assertEquals(1, afterDeletePersonal.getVersions().size());
        assertEquals("default", afterDeletePersonal.getActiveVersionId());
        assertTrue(afterDeletePersonal.isActiveIsSystemDefault());
    }
}
