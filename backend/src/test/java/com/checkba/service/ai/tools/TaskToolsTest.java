// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.tools;

import com.checkba.model.entity.ProjectTask;
import com.checkba.service.task.ProjectTaskService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * task_create / task_list（dev-board #53）单测。
 *
 * ProjectTaskService 是 mock：本类只验证 TaskTools 这一层的契约——参数解析、
 * 服务端上下文（projectId/userId）如何传给 service、异常如何转成可行动的错误文案、
 * 以及空列表绝不返回空字符串（工具空输出会掀翻整轮对话，见 ToolExecutionResultMessage
 * .ensureNotBlank 那条已知地雷）。source=ai/fileId 归属校验 IDOR 围栏本身的行为由
 * ProjectTaskServiceTest 覆盖，这里只验证 IllegalArgumentException 被正确回喂。
 */
class TaskToolsTest {

    private ProjectTaskService taskService;
    private TaskTools tools;

    @BeforeEach
    void setUp() {
        taskService = mock(ProjectTaskService.class);
        when(taskService.resolveProjects(eq(10L), any(), eq(true))).thenReturn(List.of(project(1L, "P")));
        tools = new TaskTools(taskService);
    }

    private ProjectTask task(long id, String title, LocalDate dueDate, LocalTime dueTime) {
        ProjectTask t = new ProjectTask();
        t.setId(id);
        t.setProjectId(1L);
        t.setTitle(title);
        t.setDueDate(dueDate);
        t.setDueTime(dueTime);
        return t;
    }

    @Test
    @DisplayName("task_create：创建成功，走 createAiTask（source=ai），返回摘要含 id/title/dueDate")
    void createSucceeds() {
        ProjectTaskService.TaskDraft expected = new ProjectTaskService.TaskDraft("提交答辩状",
                LocalDate.of(2026, 9, 1), LocalTime.of(9, 30), null, null, null, null, null, null);
        when(taskService.createAiTask(eq(1L), eq(expected), eq(10L)))
                .thenReturn(task(5L, "提交答辩状", LocalDate.of(2026, 9, 1), LocalTime.of(9, 30)));

        String out = tools.task_create("提交答辩状", "2026-09-01", "09:30", null,
                null, null, null, null, null, null, "P", 1L, 10L);

        assertTrue(out.contains("提交答辩状"), out);
        assertTrue(out.contains("id=5"), out);
        assertTrue(out.contains("2026-09-01"), out);
        assertTrue(out.contains("09:30"), out);
        verify(taskService).createAiTask(1L, expected, 10L);
    }

    @Test
    @DisplayName("task_create：dueDate 缺失/格式非法——不调用 service，返回可行动错误")
    void createRejectsBadDueDate() {
        String out = tools.task_create("任务", "not-a-date", null, null,
                null, null, null, null, null, null, "P", 1L, 10L);

        assertTrue(out.startsWith("错误"), out);
        verify(taskService, never()).createAiTask(any(), any(ProjectTaskService.TaskDraft.class), any());
    }

    @Test
    @DisplayName("task_create：fileId 越权——service 抛出的 IllegalArgumentException 转成可行动错误文案（非空白）")
    void createRejectsFileFromAnotherProject() {
        when(taskService.createAiTask(eq(1L), argThat(d -> d.fileIds() != null && d.fileIds().contains(99L)), eq(10L)))
                .thenThrow(new IllegalArgumentException("文件不属于该项目"));

        String out = tools.task_create("任务", "2026-09-01", null, 99L,
                null, null, null, null, null, null, "P", 1L, 10L);

        assertFalse(out.isBlank());
        assertTrue(out.contains("文件不属于该项目"), out);
    }

    @Test
    @DisplayName("task_list：空列表返回明确文案，绝不是空字符串")
    void listEmptyReturnsExplicitText() {
        when(taskService.listForUser(9L, null, null)).thenReturn(List.of());

        String out = tools.task_list(null, null, null, 1L, 9L);

        assertFalse(out.isBlank(), "空工具输出会掀翻整轮对话（ensureNotBlank），必须给明确文案");
        assertTrue(out.contains("暂无"), out);
    }

    @Test
    @DisplayName("task_list：非空列表格式化为紧凑行，含 title/dueDate/dueTime/status/fileName")
    void listNonEmptyFormatsRows() {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("title", "提交答辩状");
        row.put("dueDate", LocalDate.of(2026, 9, 1));
        row.put("dueTime", LocalTime.of(9, 30));
        row.put("status", "OPEN");
        row.put("fileName", "答辩状.docx");
        when(taskService.listForUser(9L, null, null)).thenReturn(List.of(row));

        String out = tools.task_list(null, null, null, 1L, 9L);

        assertTrue(out.contains("提交答辩状"), out);
        assertTrue(out.contains("2026-09-01"), out);
        assertTrue(out.contains("09:30"), out);
        assertTrue(out.contains("OPEN"), out);
        assertTrue(out.contains("答辩状.docx"), out);
    }

    @Test
    @DisplayName("task_list：projectId 与 userId 都缺失时返回可行动错误，不调用 service")
    void listRejectsMissingProjectId() {
        String out = tools.task_list(null, null, null, null, null);

        assertTrue(out.startsWith("错误"), out);
        verifyNoInteractions(taskService);
    }

    @Test
    @DisplayName("task_list：projectId 缺失但有 userId = 跨用户可访问项目查询，行带项目名；不查单项目")
    void listWithoutProjectIdQueriesAcrossUserProjects() {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", 5L);
        row.put("title", "举证期限");
        row.put("dueDate", LocalDate.of(2026, 11, 10));
        row.put("status", "OPEN");
        row.put("projectName", "金冠纾困");
        LocalDate from = LocalDate.of(2026, 11, 9);
        LocalDate to = LocalDate.of(2026, 11, 15);
        when(taskService.listForUser(9L, from, to)).thenReturn(List.of(row));

        String out = tools.task_list("2026-11-09", "2026-11-15", null, null, 9L);

        assertTrue(out.contains("举证期限"), out);
        assertTrue(out.contains("项目：金冠纾困"), out);
        verify(taskService, never()).listByProject(any(), any(), any());
    }

    @Test
    @DisplayName("task_list：默认跨项目，即使会话绑定了项目；用户不是成员的项目不出现（由 listForUser 按成员关系给出）")
    void listAllProjectsFlagOverridesBoundProject() {
        Map<String, Object> mine = new LinkedHashMap<>();
        mine.put("id", 5L);
        mine.put("title", "我的事项");
        mine.put("dueDate", LocalDate.of(2026, 11, 10));
        mine.put("status", "OPEN");
        mine.put("projectName", "我的案");
        // listForUser 只会返回 getUserProjects 里的项目；非成员项目 B 的事项不在其中
        when(taskService.listForUser(9L, null, null)).thenReturn(List.of(mine));

        String out = tools.task_list(null, null, null, 1L, 9L);

        assertTrue(out.contains("我的案"), out);
        assertFalse(out.contains("非成员案"), out);
        verify(taskService, never()).listByProject(any(), any(), any());
    }

    @Test
    @DisplayName("task_list：跨项目无结果也给明确文案")
    void listAcrossProjectsEmptyHasText() {
        when(taskService.listForUser(9L, null, null)).thenReturn(List.of());
        String out = tools.task_list(null, null, null, null, 9L);
        assertTrue(out.contains("暂无"), out);
    }

    @Test
    @DisplayName("task_list：project 收窄到一个项目；歧义时报错列候选，不查询")
    void listNarrowsToOneProjectAndReportsAmbiguity() {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", 5L);
        row.put("title", "举证期限");
        row.put("dueDate", LocalDate.of(2026, 11, 6));
        row.put("status", "OPEN");
        when(taskService.resolveProjects(9L, "星河并购", false)).thenReturn(List.of(project(3L, "股权转让项目-星河并购")));
        when(taskService.listByProject(3L, null, null)).thenReturn(List.of(row));
        String out = tools.task_list(null, null, "星河并购", 1L, 9L);
        assertTrue(out.contains("项目：股权转让项目-星河并购") && out.contains("2026-11-06 周五"), out);

        when(taskService.resolveProjects(9L, "星河", false)).thenReturn(List.of(project(3L, "股权转让项目-星河并购"), project(4L, "星河租赁合同纠纷")));
        String amb = tools.task_list(null, null, "星河", 1L, 9L);
        assertTrue(amb.startsWith("错误") && amb.contains("ask_user") && amb.contains("星河租赁合同纠纷"), amb);
        verify(taskService, never()).listByProject(eq(4L), any(), any());
    }

    @Test
    @DisplayName("task_create：「星河」匹配两个项目（含没有事项的）→ 歧义，必须 ask_user；全名唯一时直接用")
    void createXingheAmbiguousThenFullNameUnique() {
        when(taskService.resolveProjects(eq(10L), eq("星河"), eq(true))).thenReturn(List.of(
                project(3L, "股权转让项目-星河并购"), project(4L, "星河租赁合同纠纷")));
        String out = tools.task_create("开庭", "2026-11-11", "10:00", null, null, null, null, null, null, null, "星河", 1L, 10L);
        assertTrue(out.startsWith("错误") && out.contains("ask_user") && out.contains("星河租赁合同纠纷"), out);
        verify(taskService, never()).createAiTask(any(), any(ProjectTaskService.TaskDraft.class), any());
    }

    // ==================== dev-board#895 ====================

    @Test
    @DisplayName("task_create：新参数全部透传，fileIds 逗号分隔（含中文逗号/空格）与旧 fileId 合并，返回带类型中文名")
    void createPassesNewParams() {
        ProjectTask created = task(6L, "开庭", LocalDate.of(2026, 10, 12), LocalTime.of(9, 30));
        created.setType("HEARING");
        ProjectTaskService.TaskDraft expected = new ProjectTaskService.TaskDraft("开庭",
                LocalDate.of(2026, 10, 12), LocalTime.of(9, 30), "HEARING", "HIGH", "带原件",
                2L, 1440, List.of(7L, 12L, 15L));
        when(taskService.createAiTask(eq(1L), eq(expected), eq(10L))).thenReturn(created);

        String out = tools.task_create("开庭", "2026-10-12", "09:30", 7L,
                "HEARING", "带原件", "HIGH", "12， 15", 2L, 1440, "P", 1L, 10L);

        assertTrue(out.contains("开庭"), out);
        assertTrue(out.contains("id=6"), out);
        verify(taskService).createAiTask(1L, expected, 10L);
    }

    @Test
    @DisplayName("task_create：fileIds 不是数字——不调用 service，返回以「错误」开头的文案")
    void createRejectsBadFileIds() {
        String out = tools.task_create("x", "2026-10-12", null, null,
                null, null, null, "12,abc", null, null, "P", 1L, 10L);
        assertTrue(out.startsWith("错误"), out);
        verify(taskService, never()).createAiTask(any(), any(ProjectTaskService.TaskDraft.class), any());
    }

    @Test
    @DisplayName("task_create：非法 type 由服务层拒绝，错误文案回喂模型")
    void createSurfacesInvalidType() {
        when(taskService.createAiTask(eq(1L), any(ProjectTaskService.TaskDraft.class), eq(10L)))
                .thenThrow(new IllegalArgumentException("type 只能是 DEADLINE/HEARING/MEETING/TODO/OTHER"));
        String out = tools.task_create("x", "2026-10-12", null, null,
                "PARTY", null, null, null, null, null, "P", 1L, 10L);
        assertTrue(out.startsWith("错误"), out);
        assertTrue(out.contains("DEADLINE"), out);
    }

    @Test
    @DisplayName("task_update：只把传了的字段交给 updateTask，返回摘要含状态")
    void updatePassesOnlyProvidedFields() {
        when(taskService.getTask(5L)).thenReturn(task(5L, "开庭", LocalDate.of(2026, 10, 12), null));
        ProjectTask updated = task(5L, "开庭", LocalDate.of(2026, 10, 14), LocalTime.of(14, 0));
        updated.setType("HEARING");
        updated.setStatus("OPEN");
        Map<String, Object> expected = new java.util.HashMap<>();
        expected.put("dueDate", "2026-10-14");
        expected.put("dueTime", "14:00");
        expected.put("type", "HEARING");
        when(taskService.updateTask(5L, expected)).thenReturn(updated);

        String out = tools.task_update(5L, null, "2026-10-14", "14:00", null, "HEARING", "", null, 1L);

        assertTrue(out.contains("已更新"), out);
        assertTrue(out.contains("2026-10-14"), out);
        assertTrue(out.contains("开庭"), out);
        verify(taskService).updateTask(5L, expected);
    }

    @Test
    @DisplayName("task_update：事项不属于当前项目（服务端注入的 projectId）——拒绝，不调用 updateTask")
    void updateRejectsTaskFromAnotherProject() {
        ProjectTask foreign = task(5L, "别人的", LocalDate.of(2026, 10, 12), null);
        foreign.setProjectId(2L);
        when(taskService.getTask(5L)).thenReturn(foreign);

        String out = tools.task_update(5L, "改名", null, null, null, null, null, null, 1L);

        assertTrue(out.startsWith("错误"), out);
        verify(taskService, never()).updateTask(anyLong(), anyMap());
    }

    @Test
    @DisplayName("task_update：taskId 不存在、没有任何要改的字段、日期非法——都返回「错误」开头的非空文案")
    void updateRejectsBadInput() {
        when(taskService.getTask(404L)).thenThrow(new IllegalArgumentException("任务不存在"));
        String notFound = tools.task_update(404L, "x", null, null, null, null, null, null, 1L);
        assertTrue(notFound.startsWith("错误") && notFound.contains("任务不存在"), notFound);

        String nothing = tools.task_update(5L, null, null, null, null, null, null, null, 1L);
        assertTrue(nothing.startsWith("错误"), nothing);

        String badDate = tools.task_update(5L, null, "下周三", null, null, null, null, null, 1L);
        assertTrue(badDate.startsWith("错误"), badDate);

        String noProject = tools.task_update(5L, "x", null, null, null, null, null, null, null);
        assertTrue(noProject.startsWith("错误"), noProject);
        verify(taskService, never()).updateTask(anyLong(), anyMap());
    }

    @Test
    @DisplayName("task_list：行输出含 id、类型中文名、时间、负责人、多个文件名；HIGH 标重要")
    void listRowsIncludeTypeAssigneeAndFiles() {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", 8L);
        row.put("title", "开庭");
        row.put("type", "HEARING");
        row.put("priority", "HIGH");
        row.put("dueDate", LocalDate.of(2026, 10, 12));
        row.put("dueTime", LocalTime.of(9, 30));
        row.put("status", "OPEN");
        row.put("assigneeName", "韩泽伟");
        row.put("fileName", "起诉状.docx");
        row.put("files", List.of(
                Map.of("fileId", 1L, "fileName", "起诉状.docx"),
                Map.of("fileId", 2L, "fileName", "证据清单.xlsx")));
        Map<String, Object> legacy = new LinkedHashMap<>();
        legacy.put("id", 9L);
        legacy.put("title", "旧事项");
        legacy.put("dueDate", LocalDate.of(2026, 10, 13));
        legacy.put("status", "DONE");
        when(taskService.listForUser(9L, null, null)).thenReturn(List.of(row, legacy));

        String out = tools.task_list(null, null, null, 1L, 9L);

        assertTrue(out.contains("id=8"), out);
        assertTrue(out.contains("开庭"), out);
        assertTrue(out.contains("重要"), out);
        assertTrue(out.contains("2026-10-12 周一 09:30"), out);
        assertTrue(out.contains("负责人：韩泽伟"), out);
        assertTrue(out.contains("起诉状.docx、证据清单.xlsx"), out);
        assertTrue(out.contains("截止日"), "type 缺省按截止日展示：" + out);
    }

    private static com.checkba.model.entity.Project project(long id, String name) {
        var p = new com.checkba.model.entity.Project();
        p.setId(id);
        p.setName(name);
        return p;
    }

    @Test
    @DisplayName("task_create projectName：精确匹配优先于当前项目，写入匹配项目")
    void taskCreateProjectNameExactWinsOverConversationProject() {
        when(taskService.resolveProjects(eq(10L), eq("张三案"), eq(true))).thenReturn(List.of(project(5L, "张三案")));
        ProjectTask created = new ProjectTask();
        created.setId(1L);
        created.setTitle("开庭");
        created.setDueDate(LocalDate.of(2026, 12, 2));
        when(taskService.createAiTask(eq(5L), any(ProjectTaskService.TaskDraft.class), eq(10L))).thenReturn(created);
        String out = tools.task_create("开庭", "2026-12-02", "10:00", null, null, null, null, null, null, null, "张三案", 1L, 10L);
        assertTrue(out.startsWith("已在项目"), out);
        verify(taskService, never()).createAiTask(eq(1L), any(ProjectTaskService.TaskDraft.class), any());
    }

    @Test
    @DisplayName("task_create projectName：包含匹配唯一命中时使用；服务层给出单个候选即可")
    void taskCreateProjectNameContainsUnique() {
        when(taskService.resolveProjects(eq(10L), eq("张三"), eq(true))).thenReturn(List.of(project(6L, "张三劳动争议案")));
        ProjectTask created = new ProjectTask();
        created.setId(2L);
        created.setTitle("x");
        created.setDueDate(LocalDate.of(2026, 12, 2));
        when(taskService.createAiTask(eq(6L), any(ProjectTaskService.TaskDraft.class), eq(10L))).thenReturn(created);
        assertTrue(tools.task_create("x", "2026-12-02", null, null, null, null, null, null, null, null, "张三", null, 10L).startsWith("已在项目"));
    }

    @Test
    @DisplayName("task_create projectName：有歧义——不创建，列最多 5 个候选并让模型问用户")
    void taskCreateProjectNameAmbiguous() {
        when(taskService.resolveProjects(eq(10L), eq("案"), eq(true))).thenReturn(List.of(
                project(1L, "A案"), project(2L, "B案"), project(3L, "C案"), project(4L, "D案"), project(5L, "E案"), project(6L, "F案")));
        String out = tools.task_create("x", "2026-12-02", null, null, null, null, null, null, null, null, "案", 1L, 10L);
        assertTrue(out.startsWith("错误") && out.contains("A案") && out.contains("E案") && !out.contains("F案"), out);
        verify(taskService, never()).createAiTask(any(), any(ProjectTaskService.TaskDraft.class), any());
    }

    @Test
    @DisplayName("task_create projectName：没找到——不创建")
    void taskCreateProjectNameNone() {
        when(taskService.resolveProjects(eq(10L), eq("不存在"), eq(true))).thenReturn(List.of());
        String out = tools.task_create("x", "2026-12-02", null, null, null, null, null, null, null, null, "不存在", 1L, 10L);
        assertTrue(out.startsWith("错误"), out);
        verify(taskService, never()).createAiTask(any(), any(ProjectTaskService.TaskDraft.class), any());
    }

    @Test
    @DisplayName("task_create：project 必填——缺失/空白不创建，不回退到会话项目（含 SCRATCH）")
    void taskCreateRequiresProjectName() {
        for (String name : new String[]{null, "  "}) {
            String out = tools.task_create("x", "2026-12-02", null, null, null, null, null, null, null, null, name, 99L, 10L);
            assertTrue(out.startsWith("错误") && out.contains("project"), out);
        }
        verify(taskService, never()).createAiTask(any(), any(ProjectTaskService.TaskDraft.class), any());
    }

    @Test
    @DisplayName("task_create：结果以解析出的项目开头；包含匹配时附带提示，精确匹配不附带；日期带星期")
    void taskCreateLeadsWithResolvedProjectAndNotesFuzzyMatch() {
        when(taskService.resolveProjects(eq(10L), eq("星河"), eq(true))).thenReturn(List.of(project(8L, "星河科技案")));
        ProjectTask created = new ProjectTask();
        created.setId(3L);
        created.setTitle("开庭");
        created.setDueDate(LocalDate.of(2026, 11, 6));
        when(taskService.createAiTask(eq(8L), any(ProjectTaskService.TaskDraft.class), eq(10L))).thenReturn(created);
        String out = tools.task_create("开庭", "2026-11-06", null, null, null, null, null, null, null, null, "星河", 1L, 10L);
        assertTrue(out.startsWith("已在项目「星河科技案」创建"), out);
        assertTrue(out.contains("按「星河」匹配到「星河科技案」"), out);
        assertTrue(out.contains("2026-11-06 周五"), out);

        when(taskService.resolveProjects(eq(10L), eq("星河科技案"), eq(true))).thenReturn(List.of(project(8L, "星河科技案")));
        String exact = tools.task_create("开庭", "2026-11-06", null, null, null, null, null, null, null, null, "星河科技案", 1L, 10L);
        assertFalse(exact.contains("匹配到"), exact);
    }

    // ---- 服务端核对用户消息（模型从先前工具输出抄全名替用户挑项目） ----

    private static final List<com.checkba.model.entity.Project> XINGHE = List.of(
            project(3L, "股权转让项目-星河并购"), project(4L, "星河租赁合同纠纷"), project(5L, "张某劳动争议案"));

    private void userSays(String message) {
        com.checkba.service.ai.tools.ToolContextHolder.set(new com.checkba.service.ai.tools.ToolContext(
                1L, "c", 10L, "m", List.of(), null, null, null, null, null, null, null, message));
        when(taskService.projectsMentionedBy(eq(10L), any())).thenAnswer(
                i -> ProjectTaskService.mentionedProjects(XINGHE, i.getArgument(1)));
    }

    @org.junit.jupiter.api.AfterEach
    void clearHolder() {
        com.checkba.service.ai.tools.ToolContextHolder.clear();
    }

    private String createFor(String modelProject, long resolvedId, String resolvedName) {
        when(taskService.resolveProjects(eq(10L), eq(modelProject), eq(true))).thenReturn(List.of(project(resolvedId, resolvedName)));
        ProjectTask created = new ProjectTask();
        created.setId(9L);
        created.setTitle("开庭提醒");
        created.setDueDate(LocalDate.of(2026, 11, 11));
        when(taskService.createAiTask(eq(resolvedId), any(ProjectTaskService.TaskDraft.class), eq(10L))).thenReturn(created);
        return tools.task_create("开庭提醒", "2026-11-11", "10:00", null, null, null, null, null, null, null, modelProject, 1L, 10L);
    }

    @Test
    @DisplayName("用户说「星河」、模型传了某一个项目的全名 → 服务端按消息判定歧义并拒绝")
    void userMessageAmbiguousRefusesModelPickedFullName() {
        userSays("下周三上午十点给星河加一个开庭提醒");
        String out = createFor("股权转让项目-星河并购", 3L, "股权转让项目-星河并购");
        assertTrue(out.startsWith("错误") && out.contains("ask_user") && out.contains("星河租赁合同纠纷")
                && out.contains("股权转让项目-星河并购"), out);
        verify(taskService, never()).createAiTask(any(), any(ProjectTaskService.TaskDraft.class), any());
    }

    @Test
    @DisplayName("用户说「星河并购」→ 唯一最长匹配，放行；用户说「劳动争议案」放行；说「这个案子」不干预")
    void userMessageUniqueOrAbsentIsAllowed() {
        userSays("下周三上午十点给星河并购加一个开庭提醒");
        assertTrue(createFor("星河并购", 3L, "股权转让项目-星河并购").startsWith("已在项目"));
        userSays("给劳动争议案加一个开庭提醒");
        assertTrue(createFor("劳动争议案", 5L, "张某劳动争议案").startsWith("已在项目"));
        userSays("给这个案子加一个开庭提醒");
        assertTrue(createFor("张某劳动争议案", 5L, "张某劳动争议案").startsWith("已在项目"));
    }

    @Test
    @DisplayName("消息里原样出现所选项目全名 → 放行；task_list 的 project 同样核对")
    void userMessageContainingFullNameAndTaskList() {
        userSays("给星河租赁合同纠纷加一个开庭提醒，不是星河并购");
        assertTrue(createFor("星河租赁合同纠纷", 4L, "星河租赁合同纠纷").startsWith("已在项目"));
        userSays("星河有哪些期限");
        when(taskService.resolveProjects(eq(9L), eq("股权转让项目-星河并购"), eq(false))).thenReturn(List.of(project(3L, "股权转让项目-星河并购")));
        com.checkba.service.ai.tools.ToolContextHolder.set(new com.checkba.service.ai.tools.ToolContext(
                1L, "c", 9L, "m", List.of(), null, null, null, null, null, null, null, "星河有哪些期限"));
        when(taskService.projectsMentionedBy(eq(9L), any())).thenAnswer(i -> ProjectTaskService.mentionedProjects(XINGHE, i.getArgument(1)));
        String out = tools.task_list(null, null, "股权转让项目-星河并购", 1L, 9L);
        assertTrue(out.startsWith("错误") && out.contains("ask_user"), out);
    }
}
