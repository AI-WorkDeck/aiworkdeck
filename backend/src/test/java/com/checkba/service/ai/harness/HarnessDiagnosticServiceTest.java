// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.harness;

import com.checkba.service.ai.PluginService;
import com.checkba.service.ai.ToolDisclosurePolicy;
import com.checkba.service.ai.skill.SkillProperties;
import com.checkba.service.ai.skill.SkillRegistry;
import com.checkba.service.ai.skill.SkillRouter;
import com.checkba.service.telemetry.TelemetryService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HarnessDiagnosticServiceTest {

    private ToolDisclosurePolicy disclosurePolicy;
    private SkillRegistry skillRegistry;
    private SkillRouter skillRouter;
    private HarnessDiagnosticService diagnosticService;

    @BeforeEach
    void setUp() {
        disclosurePolicy = new ToolDisclosurePolicy(true, true);
        PluginService pluginService = new PluginService();
        SkillProperties props = new SkillProperties();
        props.setDir(resolveSkillsDir());
        props.setBaseTools(List.of("extract_file_text", "list_files", "query_memory"));
        skillRegistry = new SkillRegistry(props, null, pluginService, null);
        skillRegistry.init();
        skillRouter = new SkillRouter(skillRegistry, props, Mockito.mock(TelemetryService.class), null);
        diagnosticService = new HarnessDiagnosticService(disclosurePolicy, skillRegistry, skillRouter);
    }

    @Test
    void undisclosedToolFailureTriggersInvariantCategoryExpansion() {
        Set<String> expanded = new HashSet<>();
        Optional<HarnessDiagnosticService.HarnessAdaptation> adaptation = diagnosticService.diagnoseAndAdapt(
                "conv-1",
                "run-1",
                "请在第一行下面再加一行",
                "doc_table_add_row",
                "{\"tableIndex\":0}",
                "Error: Tool not found: doc_table_add_row",
                1,
                expanded,
                List.of());

        assertTrue(adaptation.isPresent());
        assertEquals(HarnessDiagnosticService.TIER_INVARIANT, adaptation.get().tier());
        assertEquals(HarnessDiagnosticService.ACTION_EXPAND_TOOL_CATEGORY, adaptation.get().actionType());
        assertTrue(adaptation.get().expandedCategories().contains("table"));
        assertTrue(expanded.contains("table"));
    }

    @Test
    void anchorDriftErrorTriggersInvariantAnchorProbeRecovery() {
        Set<String> expanded = new HashSet<>(Set.of("edit", "revision"));
        Optional<HarnessDiagnosticService.HarnessAdaptation> adaptation = diagnosticService.diagnoseAndAdapt(
                "conv-2",
                "run-2",
                "把违约金比例改成 15%",
                "doc_replace_at_anchor",
                "{\"anchorId\":\"p12_a3\"}",
                "{\"error\":\"Anchor not found: p12_a3\"}",
                1,
                expanded,
                List.of());

        assertTrue(adaptation.isPresent());
        assertEquals(HarnessDiagnosticService.TIER_INVARIANT, adaptation.get().tier());
        assertEquals(HarnessDiagnosticService.ACTION_ANCHOR_PROBE_RECOVERY, adaptation.get().actionType());
        assertEquals("doc_replace_at_anchor", adaptation.get().toolName());
    }

    @Test
    void unactivatedDomainSkillMatchesAndMountsMidRun() {
        Set<String> expanded = new HashSet<>(Set.of("edit", "revision", "files", "legal", "evidence"));
        Optional<HarnessDiagnosticService.HarnessAdaptation> adaptation = diagnosticService.diagnoseAndAdapt(
                "conv-3",
                "run-3",
                "请全面审查这份法律意见书的事实依据与结论限定",
                "search_project_files",
                "{\"query\":\"法律意见书\"}",
                "No matches: 未找到匹配文件",
                1,
                expanded,
                List.of());

        assertTrue(adaptation.isPresent());
        assertEquals(HarnessDiagnosticService.TIER_DOMAIN, adaptation.get().tier());
        assertEquals(HarnessDiagnosticService.ACTION_MOUNT_DOMAIN_SKILL, adaptation.get().actionType());
        assertEquals("legal-opinion-review", adaptation.get().activatedSkillId());
    }

    private static String resolveSkillsDir() {
        for (String candidate : List.of("skills", "backend/skills")) {
            if (Files.isDirectory(Path.of(candidate))) {
                return candidate;
            }
        }
        return "skills";
    }

    @Test
    void upstreamMcpUnknownToolTextDoesNotExpandMcpCategoryOrAskUser() {
        String vendorError = "Error from MCP server: Unknown tool: get_article";
        // 已成功派发的 get_law_article：上游文本里的 MCP / Unknown tool 不是注册表未知工具
        Optional<HarnessDiagnosticService.HarnessAdaptation> a1 = diagnosticService.diagnoseAndAdapt(
                "conv-1", "run-1", "民法典第1082条是什么", "get_law_article",
                "{\"title\":\"民法典\",\"number\":\"1082\"}", vendorError, 1, new HashSet<>(), List.of());
        assertTrue(a1.isEmpty(), "上游错误不应触发任何自愈：" + a1);

        // 供应商不可用不触发「澄清护栏」（盲猜关键词那条）
        Optional<HarnessDiagnosticService.HarnessAdaptation> a2 = diagnosticService.diagnoseAndAdapt(
                "conv-1", "run-1", "民法典第1082条是什么", "law_search_keyword",
                "{\"title\":\"民法典\"}", "Error from MCP server: Unknown tool: get_law_list", 2,
                new HashSet<>(Set.of("legal")), List.of());
        assertTrue(a2.isEmpty(), "上游错误不应触发 ask_user 护栏：" + a2);
        Optional<HarnessDiagnosticService.HarnessAdaptation> a3 = diagnosticService.diagnoseAndAdapt(
                "conv-1", "run-1", "民法典第1082条是什么", "law_search",
                "{}", com.checkba.service.ai.tools.LegalTools.VENDOR_UNAVAILABLE_MARKER + " ...", 3,
                new HashSet<>(Set.of("legal")), List.of());
        assertTrue(a3.isEmpty(), "vendor-unavailable 标记同样不触发：" + a3);
    }

    @Test
    void genuineLookupMissStillTriggersClarifyGuardrail() {
        Optional<HarnessDiagnosticService.HarnessAdaptation> a = diagnosticService.diagnoseAndAdapt(
                "conv-1", "run-1", "找一下合同", "search_project_files",
                "{\"query\":\"x\"}", "Error: no files matched", 1, new HashSet<>(Set.of("files")), List.of());
        assertTrue(a.isPresent());
        assertEquals(HarnessDiagnosticService.ACTION_CLARIFY_WITH_USER, a.get().actionType());
    }

    @Test
    void permissionRefusalsAreNotGuardedAsEvidenceGaps() {
        String[] refusals = {
                "Not permitted: firm-wide fee ledger and dashboards are limited to law firm administrators",
                "无权访问该项目", "没有权限查看此文件", "Access denied", "HTTP 403 Forbidden", "Error: 403 Forbidden"};
        for (String r : refusals) {
            assertTrue(HarnessDiagnosticService.isPermissionDenied(r), r);
            assertTrue(diagnosticService.diagnoseAndAdapt("c", "r", "查一下", "search_project_files",
                    "{}", r, 2, new HashSet<>(), List.of()).isEmpty(), r);
        }
        assertTrue(!HarnessDiagnosticService.isPermissionDenied("Error: no files matched"));
        assertTrue(!HarnessDiagnosticService.isPermissionDenied("amount 14030 yuan"));
        assertTrue(!HarnessDiagnosticService.isPermissionDenied("Error: code 403"), "裸 403 不算");
        // 短语不在开头 200 字内不算
        assertTrue(!HarnessDiagnosticService.isPermissionDenied("x".repeat(300) + " Access denied"));
    }

    @Test
    void legalTextContainingRefusalWordsIsNeverTreatedAsPermissionDenied() {
        String content = "本案系无权代理，无权处分他人财产；对方称 forbidden；案号 403。";
        assertTrue(!HarnessDiagnosticService.isPermissionDenied(content));
        // 成功输出不走诊断（调用方仅在 success=false 时调用）；即便直接送入，也不得被当作权限拒绝而吞掉类目展开
        assertTrue(!HarnessDiagnosticService.isPermissionDenied("文件内容：\n" + content));
    }

    @Test
    void credentialAndKeyMissingErrorsAreUnavailableNotCategoryHintsOrGuard() {
        String noCred = "Error: MCP server has no credential: pkulaw-semantic";
        String noKey = "错误：网络搜索未配置：当前部署未提供博查（Bocha AI）搜索的 API Key。本次已跳过网络搜索";
        assertTrue(HarnessDiagnosticService.isToolUnavailable(noCred));
        assertTrue(HarnessDiagnosticService.isToolUnavailable(noKey));
        assertTrue(HarnessDiagnosticService.isToolUnavailable("Error searching web: Bocha API returned 502 Bad Gateway"));
        assertTrue(!HarnessDiagnosticService.isToolUnavailable("Error: no files matched"));

        assertTrue(diagnosticService.diagnoseAndAdapt("c", "r", "民法典第1082条是什么", "get_law_article",
                "{}", noCred, 1, new HashSet<>(), List.of()).isEmpty());
        // search_web 属 SEARCH_LOOKUP 之外也不得触发 ask_user；连续失败 >=2 同样不触发
        assertTrue(diagnosticService.diagnoseAndAdapt("c", "r", "查一下", "search_web",
                "{}", noKey, 2, new HashSet<>(), List.of()).isEmpty());
    }

    @Test
    void toolOutputNeverDrivesCategoryExpansion() {
        // 输出里有 mcp / 表格 等类目关键词，但指令和参数里没有
        Set<String> expanded = new HashSet<>();
        Optional<HarnessDiagnosticService.HarnessAdaptation> a = diagnosticService.diagnoseAndAdapt(
                "c", "r", "你好", "some_tool", "{}", "Error: please use the MCP table tools", 1, expanded, List.of());
        assertTrue(a.isEmpty() || !HarnessDiagnosticService.ACTION_EXPAND_TOOL_CATEGORY.equals(a.get().actionType()));
        assertTrue(expanded.isEmpty());
    }
}
