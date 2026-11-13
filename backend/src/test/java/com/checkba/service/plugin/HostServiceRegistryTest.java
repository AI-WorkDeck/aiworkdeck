// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.plugin;

import com.checkba.model.entity.ProjectTask;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.task.ProjectTaskService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.checkba.service.im.ImGatewayService;
import com.checkba.service.lawfirm.LawFirmManagementService;
import org.junit.jupiter.api.Assumptions;
import org.springframework.beans.factory.ObjectProvider;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.*;

/**
 * 宿主服务表守卫：发布副本 sdk/plugin-sdk/services.json 必须与 HostServiceRegistry 逐项一致
 * （服务/操作名、access、所需权限），并且表里每一项都有装配好的处理器。
 * 另测项目成员权限：目标 projectId 每次调用都重新核。
 */
class HostServiceRegistryTest {

    private final ProjectTaskService tasks = mock(ProjectTaskService.class);
    private final ProjectMemberService members = mock(ProjectMemberService.class);
    private final LawFirmManagementService lawfirm = mock(LawFirmManagementService.class);
    private final ImGatewayService im = mock(ImGatewayService.class);
    @SuppressWarnings("unchecked")
    private final ObjectProvider<LawFirmManagementService> lawfirmProvider = mock(ObjectProvider.class);
    @SuppressWarnings("unchecked")
    private final ObjectProvider<ImGatewayService> imProvider = mock(ObjectProvider.class);
    private final HostServiceRegistry registry = newRegistry();

    private HostServiceRegistry newRegistry() {
        when(lawfirmProvider.getIfAvailable()).thenReturn(lawfirm);
        when(imProvider.getIfAvailable()).thenReturn(im);
        when(lawfirm.canViewFirmWide(7L)).thenReturn(true); // 默认律所管理员；普通成员用例里改成 false
        return new HostServiceRegistry(tasks, members, null, null, null, lawfirmProvider, imProvider);
    }

    @Test
    void servicesJsonMatchesHostServiceRegistry() throws Exception {
        Path published = Path.of("..", "sdk", "plugin-sdk", "services.json");
        Assumptions.assumeTrue(Files.isRegularFile(published), "sdk/plugin-sdk/services.json 不在（非完整仓库检出），跳过对拍");
        JsonNode services = new ObjectMapper().readTree(published.toFile()).path("services");

        var expected = new TreeSet<String>();
        var actual = new TreeSet<String>();
        services.fields().forEachRemaining(service -> service.getValue().path("operations").fields().forEachRemaining(op -> {
            List<String> permissions = new java.util.ArrayList<>();
            op.getValue().path("requiredPermissions").forEach(p -> permissions.add(p.asText()));
            expected.add(service.getKey() + "." + op.getKey() + "|" + op.getValue().path("access").asText() + "|" + permissions);
        }));
        HostServiceRegistry.TABLE.forEach((service, ops) -> ops.forEach((op, spec) ->
                actual.add(service + "." + op + "|" + spec.access() + "|" + spec.requiredPermissions())));
        assertEquals(expected, actual, "services.json 与 HostServiceRegistry.TABLE 不一致，改一处要同批改另一处");

        var handled = new TreeSet<String>();
        registry.registeredOperations().forEach((service, ops) -> ops.forEach(op -> handled.add(service + "." + op)));
        var table = new TreeSet<String>();
        HostServiceRegistry.TABLE.forEach((service, ops) -> ops.keySet().forEach(op -> table.add(service + "." + op)));
        assertEquals(table, handled, "表里每个操作都必须有处理器");
    }

    @Test
    void readRequiresMembershipOfTheTargetProject() {
        when(members.hasReadPermission(9L, 7L)).thenReturn(false);
        var e = assertThrows(IllegalArgumentException.class,
                () -> registry.invoke("calendar", "list", 7L, 5L, Map.of("projectId", 9)));
        assertTrue(e.getMessage().contains("项目") || e.getMessage().contains("project"));
        verify(tasks, never()).listByProject(any(), any(), any());

        when(members.hasReadPermission(5L, 7L)).thenReturn(true);
        when(tasks.listByProject(5L, null, null)).thenReturn(List.of(Map.of("id", 1)));
        assertTrue(registry.invoke("calendar", "list", 7L, 5L, Map.of()).contains("\"id\":1"));
    }

    @Test
    void writeRequiresWritePermissionAndUsesServerIdentity() {
        when(members.hasWritePermission(5L, 7L)).thenReturn(true);
        when(members.isClient(5L, 7L)).thenReturn(false);
        ProjectTask task = new ProjectTask();
        task.setId(11L);
        when(tasks.createAiTask(eq5(), any(ProjectTaskService.TaskDraft.class), eq7())).thenReturn(task);
        when(tasks.toResponseMap(task)).thenReturn(Map.of("id", 11));
        // 模型伪造的 userId 参数不起作用：身份只来自调用方
        String out = registry.invoke("calendar", "create", 7L, 5L,
                Map.of("title", "举证期限", "dueDate", "2026-12-01", "userId", 99));
        assertTrue(out.contains("11"));
        verify(tasks).createAiTask(eq5(), any(ProjectTaskService.TaskDraft.class), eq7());

        when(members.isClient(5L, 7L)).thenReturn(true);
        assertThrows(IllegalArgumentException.class, () -> registry.invoke("calendar", "create", 7L, 5L,
                Map.of("title", "x", "dueDate", "2026-12-01")));
    }

    @Test
    void writeToScratchProjectIsRefusedEvenForMembers() {
        when(tasks.isScratchProject(77L)).thenReturn(true);
        when(members.hasWritePermission(77L, 7L)).thenReturn(true);
        var e = assertThrows(IllegalArgumentException.class, () -> registry.invoke("calendar", "create", 7L, 77L,
                Map.of("title", "x", "dueDate", "2026-12-01")));
        assertTrue(e.getMessage().contains("projectId"));
        verify(tasks, never()).createAiTask(any(), any(ProjectTaskService.TaskDraft.class), any());
        // 读不受影响
        when(members.hasReadPermission(77L, 7L)).thenReturn(true);
        registry.invoke("calendar", "list", 7L, 77L, Map.of());
    }

    @Test
    void updateAndDeleteCheckTheProjectOwningTheTask() {
        ProjectTask task = new ProjectTask();
        task.setId(3L);
        task.setProjectId(42L);
        when(tasks.getTask(3L)).thenReturn(task);
        when(members.hasWritePermission(42L, 7L)).thenReturn(false);
        // 参数里的 projectId 指向有权限的项目也不能绕过：以任务所在项目为准
        assertThrows(IllegalArgumentException.class, () -> registry.invoke("calendar", "delete", 7L, 5L,
                Map.of("taskId", 3, "projectId", 5)));
        verify(tasks, never()).deleteTask(any());
    }

    @Test
    void unknownOperationAndMissingUserAreRefused() {
        assertThrows(IllegalArgumentException.class, () -> registry.invoke("calendar", "nope", 7L, 5L, Map.of()));
        assertThrows(IllegalArgumentException.class, () -> registry.invoke("calendar", "listForUser", null, 5L, Map.of()));
    }

    // ---- sensitive（Agent 只用 MASK + 面板默认策略）----

    @SuppressWarnings("unchecked")
    private HostServiceRegistry withSensitive(com.checkba.controller.SensitiveController controller) {
        ObjectProvider<com.checkba.controller.SensitiveController> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(controller);
        return new HostServiceRegistry(tasks, members, null, null, provider, lawfirmProvider, imProvider);
    }

    @Test
    void sensitiveAlwaysMasksAndFallsBackToPanelDefaultStrategies() {
        var controller = mock(com.checkba.controller.SensitiveController.class);
        doReturn(org.springframework.http.ResponseEntity.ok(Map.of("counts", Map.of()))).when(controller).executeAs(any(), eq(7L), any());
        var reg = withSensitive(controller);
        var captor = org.mockito.ArgumentCaptor.forClass(com.checkba.controller.SensitiveController.Request.class);

        reg.invoke("sensitive", "redact", 7L, null, Map.of("fileId", 3, "mode", "TOKEN"));
        verify(controller).executeAs(captor.capture(), eq(7L), eq("desensitize"));
        assertEquals("MASK", captor.getValue().mode(), "TOKEN 需要用户密码，Agent 一律 MASK");
        assertNull(captor.getValue().password());
        assertEquals(HostServiceRegistry.SENSITIVE_DEFAULT_STRATEGIES, captor.getValue().strategies());

        reg.invoke("sensitive", "preview", 7L, null, Map.of("fileId", 3));
        verify(controller).executeAs(captor.capture(), eq(7L), eq("preview"));
        assertEquals("MASK", captor.getValue().mode());
        assertFalse(captor.getValue().strategies().isEmpty());

        // 只给自定义词：不再硬塞默认策略
        reg.invoke("sensitive", "preview", 7L, null, Map.of("fileId", 3, "customTerms", List.of("张三")));
        verify(controller, times(2)).executeAs(captor.capture(), eq(7L), eq("preview"));
        assertTrue(captor.getValue().strategies() == null || captor.getValue().strategies().isEmpty());
    }

    @Test
    void sensitiveFailureIsMarkedNotRetryable() {
        var controller = mock(com.checkba.controller.SensitiveController.class);
        doReturn(org.springframework.http.ResponseEntity.badRequest().body(Map.of("error", "Unknown redaction strategy")))
                .when(controller).executeAs(any(), any(), any());
        var e = assertThrows(IllegalArgumentException.class,
                () -> withSensitive(controller).invoke("sensitive", "redact", 7L, null, Map.of("fileId", 3)));
        assertTrue(e.getMessage().contains("Unknown redaction strategy") && e.getMessage().contains("Not retryable"), e.getMessage());
    }

    // ---- lawfirm（只读）----

    private static Map<String, Object> overviewFixture() {
        return Map.of(
                "summary", Map.of("arTotalCents", 1000, "collectionRatePercent", 50.0, "billingRatePercent", 80.0, "pendingInvoiceCount", 2, "secret", "x"),
                "kpi", Map.of("k", 1),
                "users", List.of(Map.of("username", "should-not-leak")),
                "matters", List.of(Map.of("id", 1, "projectId", 5, "title", "甲公司并购"), Map.of("id", 2, "projectId", 6, "title", "乙公司诉讼")),
                "pendingClearances", List.of(Map.of("id", 9)),
                "invoices", List.of(Map.of("id", 1, "projectId", 5, "matterTitle", "甲公司并购"), Map.of("id", 2, "projectId", 6, "matterTitle", "乙")),
                "collections", List.of(Map.of("id", 3, "projectId", 5, "payerName", "甲")));
    }

    @Test
    void lawfirmOverviewIsTrimmedAndUsesServerIdentity() {
        when(lawfirm.execute(eq(7L), isNull(), eq("overview"), any())).thenReturn(overviewFixture());
        String out = registry.invoke("lawfirm", "overview", 7L, 5L, Map.of("userId", 99));
        assertTrue(out.contains("甲公司并购") && out.contains("乙公司诉讼"), out);
        assertFalse(out.contains("should-not-leak"), "未列入的字段（用户目录）不回给模型");
        verify(lawfirm).execute(eq(7L), isNull(), eq("overview"), eq(Map.of("scope", "all")));
    }

    @Test
    void lawfirmOverviewWithProjectChecksMembershipAndFilters() {
        when(members.hasReadPermission(9L, 7L)).thenReturn(false);
        assertThrows(IllegalArgumentException.class, () -> registry.invoke("lawfirm", "overview", 7L, 5L, Map.of("projectId", 9)));
        verify(lawfirm, never()).execute(any(), any(), any(), any());

        when(members.hasReadPermission(5L, 7L)).thenReturn(true);
        when(lawfirm.execute(eq(7L), eq(5L), eq("overview"), any())).thenReturn(overviewFixture());
        String out = registry.invoke("lawfirm", "overview", 7L, null, Map.of("projectId", 5, "query", "并购"));
        assertTrue(out.contains("甲公司并购"));
        assertFalse(out.contains("乙公司诉讼"));
    }

    /** 团队服务器（非 local-mode）：三个 lawfirm 只读操作读的都是本机台账，即便是管理员也一律拒绝，且不触达台账。 */
    @Test
    void lawfirmReadsAreRefusedOnServerProfile() {
        doThrow(new IllegalArgumentException("本机收费台账仅在桌面端可用")).when(lawfirm).requireLocalLedger();
        when(members.hasReadPermission(5L, 7L)).thenReturn(true);
        for (var op : List.of(Map.entry("overview", Map.<String, Object>of()), Map.entry("overview", Map.<String, Object>of("projectId", 5)),
                Map.entry("feeLedger", Map.<String, Object>of()), Map.entry("conflictCheck", Map.<String, Object>of("clientName", "甲公司")))) {
            var e = assertThrows(IllegalArgumentException.class, () -> registry.invoke("lawfirm", op.getKey(), 7L, null, op.getValue()), op.getKey());
            assertTrue(e.getMessage().contains("本机收费台账仅在桌面端可用"), e.getMessage());
        }
        verify(lawfirm, never()).execute(any(), any(), any(), any());
        verify(lawfirm, never()).listProjectMatters(any());
    }

    private void makeMember() {
        when(lawfirm.canViewFirmWide(7L)).thenReturn(false);
        doThrow(new IllegalArgumentException("无权查看：全所收费台账与看板仅限律所管理员")).when(lawfirm).requireFirmWide(7L);
    }

    @Test
    void lawfirmFirmWideOverviewIsDeniedForPlainMember() {
        makeMember();
        var e = assertThrows(IllegalArgumentException.class, () -> registry.invoke("lawfirm", "overview", 7L, null, Map.of()));
        assertTrue(e.getMessage().contains("无权查看"));
        verify(lawfirm, never()).execute(any(), any(), any(), any());
    }

    @Test
    void lawfirmOverviewForMemberWithProjectIsMatterLevelOnly() {
        makeMember();
        when(members.hasReadPermission(5L, 7L)).thenReturn(true);
        when(lawfirm.listProjectMatters(5L)).thenReturn(List.of(Map.of("id", 1, "title", "项目事项")));
        String out = registry.invoke("lawfirm", "overview", 7L, null, Map.of("projectId", 5));
        assertTrue(out.contains("项目事项") && out.contains("\"restricted\":true"), out);
        assertFalse(out.contains("kpi") || out.contains("summary"), "不回全所看板/汇总");
        verify(lawfirm, never()).execute(any(), any(), any(), any());
        // 没有该项目读权限仍被拒
        when(members.hasReadPermission(9L, 7L)).thenReturn(false);
        assertThrows(IllegalArgumentException.class, () -> registry.invoke("lawfirm", "overview", 7L, null, Map.of("projectId", 9)));
    }

    @Test
    void lawfirmFeeLedgerIsDeniedForPlainMemberEvenWithProject() {
        makeMember();
        when(members.hasReadPermission(5L, 7L)).thenReturn(true);
        assertThrows(IllegalArgumentException.class, () -> registry.invoke("lawfirm", "feeLedger", 7L, null, Map.of()));
        assertThrows(IllegalArgumentException.class, () -> registry.invoke("lawfirm", "feeLedger", 7L, null, Map.of("projectId", 5)));
        verify(lawfirm, never()).execute(any(), any(), any(), any());
    }

    @Test
    void lawfirmConflictCheckForwardsOnlyWhitelistedParamsAndNeverWrites() {
        when(lawfirm.execute(eq(7L), isNull(), eq("precheckConflict"), any())).thenReturn(Map.of("riskLevel", "RED"));
        assertThrows(IllegalArgumentException.class, () -> registry.invoke("lawfirm", "conflictCheck", 7L, null, Map.of("title", "x")));
        String out = registry.invoke("lawfirm", "conflictCheck", 7L, null,
                Map.of("clientName", "甲", "counterpartyName", "乙", "applicantName", "冒名", "leadLawyerUserId", 99));
        assertTrue(out.contains("RED"));
        verify(lawfirm).execute(eq(7L), isNull(), eq("precheckConflict"), eq(Map.of("clientName", "甲", "counterpartyName", "乙")));
        verify(lawfirm, never()).execute(any(), any(), eq("submitIntake"), any());
        assertThrows(IllegalArgumentException.class, () -> registry.invoke("lawfirm", "conflictCheck", null, null, Map.of("clientName", "甲")));
    }

    @Test
    void lawfirmFeeLedgerFiltersByKindProjectAndMembership() {
        when(lawfirm.execute(eq(7L), any(), eq("overview"), any())).thenReturn(overviewFixture());
        String invoices = registry.invoke("lawfirm", "feeLedger", 7L, null, Map.of("kind", "invoices"));
        assertTrue(invoices.contains("\"invoices\"") && !invoices.contains("\"collections\""), invoices);
        assertTrue(invoices.contains("arTotalCents"));

        when(members.hasReadPermission(9L, 7L)).thenReturn(false);
        assertThrows(IllegalArgumentException.class, () -> registry.invoke("lawfirm", "feeLedger", 7L, null, Map.of("projectId", 9)));

        when(members.hasReadPermission(5L, 7L)).thenReturn(true);
        String scoped = registry.invoke("lawfirm", "feeLedger", 7L, null, Map.of("projectId", 5));
        assertTrue(scoped.contains("甲公司并购"));
        assertFalse(scoped.contains("\"matterTitle\":\"乙\""), scoped);
    }

    @Test
    void lawfirmServiceFailureIsSurfacedNotSwallowed() {
        when(lawfirm.execute(any(), any(), any(), any())).thenThrow(new IllegalArgumentException("请先登录"));
        var e = assertThrows(IllegalArgumentException.class, () -> registry.invoke("lawfirm", "overview", 7L, null, Map.of()));
        assertEquals("请先登录", e.getMessage());
    }

    // ---- im（只读）----

    @Test
    void imListConversationsUsesServerIdentity() {
        when(im.execute(eq(7L), eq("list"), any())).thenReturn(Map.of("conversations", List.of(Map.of("id", "c1", "title", "项目群"))));
        String out = registry.invoke("im", "listConversations", 7L, 5L, Map.of("userId", 99));
        assertTrue(out.contains("项目群"));
        verify(im).execute(7L, "list", Map.of());
        assertThrows(IllegalArgumentException.class, () -> registry.invoke("im", "listConversations", null, 5L, Map.of()));
    }

    @Test
    void imReadMessagesForwardsOnlyPagingAndRelaysMembershipDenial() {
        assertThrows(IllegalArgumentException.class, () -> registry.invoke("im", "readMessages", 7L, null, Map.of()));
        assertThrows(IllegalArgumentException.class, () -> registry.invoke("im", "readMessages", 7L, null,
                Map.of("imConversationId", "c1", "beforeId", 5, "afterId", 1)));

        when(im.execute(eq(7L), eq("messages"), any())).thenReturn(Map.of("messages", List.of(Map.of("id", 3, "text", "你好"))));
        String out = registry.invoke("im", "readMessages", 7L, null,
                Map.of("imConversationId", "c1", "limit", 500, "beforeId", 10, "action", "send", "text", "x"));
        assertTrue(out.contains("你好"));
        verify(im).execute(7L, "messages", Map.of("conversationId", "c1", "limit", 100, "beforeId", 10L));

        // 非会话成员：ImService 抛出的拒绝原样回给模型，不返回任何消息
        when(im.execute(eq(7L), eq("messages"), eq(Map.of("conversationId", "other", "limit", 30))))
                .thenThrow(new IllegalArgumentException("无权访问该会话"));
        var e = assertThrows(IllegalArgumentException.class, () -> registry.invoke("im", "readMessages", 7L, null, Map.of("imConversationId", "other")));
        assertEquals("无权访问该会话", e.getMessage());
    }

    @Test
    void worklogSummaryIsOwnRecordsOnlyAndNeedsProjectReadAccess() {
        var worklog = mock(com.checkba.service.activity.WorklogSummaryService.class);
        registry.setWorklog(worklog);
        when(members.hasReadPermission(9L, 7L)).thenReturn(false);
        assertThrows(IllegalArgumentException.class, () -> registry.invoke("worklog", "summary", 7L, 9L, Map.of("userId", 99)));
        verify(worklog, never()).summarize(any(), any());
        when(members.hasReadPermission(5L, 7L)).thenReturn(true);
        when(worklog.summarize(7L, 5L)).thenReturn(Map.of("totalHours", 3.5));
        // 模型传的 userId 不影响：只按服务端身份汇总
        assertTrue(registry.invoke("worklog", "summary", 7L, 5L, Map.of("userId", 99)).contains("3.5"));
        verify(worklog).summarize(7L, 5L);
    }

    private static Long eq5() { return org.mockito.ArgumentMatchers.eq(5L); }
    private static Long eq7() { return org.mockito.ArgumentMatchers.eq(7L); }
}
