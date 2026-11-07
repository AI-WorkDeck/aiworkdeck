// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.plugin;

import com.checkba.model.entity.ProjectTask;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.task.ProjectTaskService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * 宿主服务表守卫：发布副本 sdk/plugin-sdk/services.json 必须与 HostServiceRegistry 逐项一致
 * （服务/操作名、access、所需权限），并且表里每一项都有装配好的处理器。
 * 另测项目成员权限：目标 projectId 每次调用都重新核。
 */
class HostServiceRegistryTest {

    private final ProjectTaskService tasks = mock(ProjectTaskService.class);
    private final ProjectMemberService members = mock(ProjectMemberService.class);
    private final HostServiceRegistry registry = new HostServiceRegistry(tasks, members, null, null, null);

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

    private static Long eq5() { return org.mockito.ArgumentMatchers.eq(5L); }
    private static Long eq7() { return org.mockito.ArgumentMatchers.eq(7L); }
}
