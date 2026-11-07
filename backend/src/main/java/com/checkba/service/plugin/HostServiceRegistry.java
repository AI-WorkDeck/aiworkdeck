// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.plugin;

import com.checkba.controller.SensitiveController;
import com.checkba.model.dto.SearchRequest;
import com.checkba.model.entity.ProjectTask;
import com.checkba.service.ContentSearchService;
import com.checkba.service.LangText;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.TagService;
import com.checkba.service.task.ProjectTaskService;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import org.springframework.http.ResponseEntity;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 宿主后端固定服务表（规范 v2.13 §20 / 设计 C4）：{@code (service, operation) → 处理器 + 所需权限 + access}。
 *
 * <p>声明式工具（manifest {@code tools[].handler.type=service}）由 {@code ToolRegistry} 经本表执行；
 * 服务名/操作名与前端 {@code awd.services.request} 同名，发布副本是 {@code sdk/plugin-sdk/services.json}
 * （{@code HostServiceRegistryParityTest} 钉住两者逐字一致）。
 *
 * <p>身份只来自调用方传入的 userId（服务端上下文）；参数里的 projectId 只当「目标项目」，
 * 每次调用都重新核成员权限（读：成员；写：可写且非 CLIENT），与 tencent_meeting_action 的 requireProject 同口径。
 */
@Service
public class HostServiceRegistry {

    /** 表中一个操作的静态描述（校验器与对拍测试只用这部分，不需要 Spring 装配）。 */
    public record Spec(String access, List<String> requiredPermissions) {}

    /** 一次调用：userId 来自服务端上下文；projectId 是目标项目（参数优先，缺省为会话项目）。 */
    public record Call(Long userId, Long projectId, Map<String, Object> args) {}

    @FunctionalInterface
    public interface Handler {
        Object call(Call call) throws Exception;
    }

    /** 静态表，键 = service → operation。与 sdk/plugin-sdk/services.json 逐项一致。 */
    public static final Map<String, Map<String, Spec>> TABLE = Map.of(
            "calendar", Map.of(
                    "list", new Spec("read", List.of("tasks")),
                    "listForUser", new Spec("read", List.of("tasks")),
                    "create", new Spec("write", List.of("tasks")),
                    "update", new Spec("write", List.of("tasks")),
                    "delete", new Spec("destructive", List.of("tasks"))),
            "search", Map.of(
                    "query", new Spec("read", List.of("file_read")),
                    "tags", new Spec("read", List.of("file_read"))),
            "sensitive", Map.of(
                    "preview", new Spec("read", List.of("file_read", "file_write")),
                    "redact", new Spec("write", List.of("file_read", "file_write"))));

    /** 单次返回给模型的字符上限，超出截断并注明。 */
    static final int MAX_RESULT_CHARS = 30_000;

    private final ProjectTaskService tasks;
    private final ProjectMemberService members;
    private final ContentSearchService search;
    private final TagService tags;
    private final ObjectProvider<SensitiveController> sensitive;
    private final Map<String, Map<String, Handler>> handlers = new LinkedHashMap<>();

    public HostServiceRegistry(ProjectTaskService tasks, ProjectMemberService members, ContentSearchService search,
                               TagService tags, ObjectProvider<SensitiveController> sensitive) {
        this.tasks = tasks;
        this.members = members;
        this.search = search;
        this.tags = tags;
        this.sensitive = sensitive;
        register("calendar", "list", this::calendarList);
        register("calendar", "listForUser", this::calendarListForUser);
        register("calendar", "create", this::calendarCreate);
        register("calendar", "update", this::calendarUpdate);
        register("calendar", "delete", this::calendarDelete);
        register("search", "query", this::searchQuery);
        register("search", "tags", this::searchTags);
        register("sensitive", "preview", call -> sensitiveRun(call, "preview"));
        register("sensitive", "redact", call -> sensitiveRun(call, "desensitize"));
    }

    private void register(String service, String operation, Handler handler) {
        handlers.computeIfAbsent(service, k -> new LinkedHashMap<>()).put(operation, handler);
    }

    /** 静态描述；表里没有返回 empty。 */
    public static Optional<Spec> spec(String service, String operation) {
        return Optional.ofNullable(TABLE.get(service)).map(ops -> ops.get(operation));
    }

    /** 已装配处理器的操作名（对拍测试核对与 TABLE 一致）。 */
    public Map<String, List<String>> registeredOperations() {
        Map<String, List<String>> out = new LinkedHashMap<>();
        handlers.forEach((service, ops) -> out.put(service, List.copyOf(ops.keySet())));
        return out;
    }

    /**
     * 执行一次调用。权限（manifest permissions ⊇ requiredPermissions）由调用方在这之前核；
     * 这里只管项目/文件级的成员权限。失败抛 IllegalArgumentException（文案可直接回给模型）。
     */
    public String invoke(String service, String operation, Long userId, Long contextProjectId, Map<String, Object> args) {
        Handler handler = Optional.ofNullable(handlers.get(service)).map(ops -> ops.get(operation))
                .orElseThrow(() -> new IllegalArgumentException("Unknown host service operation: " + service + "." + operation));
        if (userId == null) throw new IllegalArgumentException(LangText.of("无法获取当前用户身份", "Cannot determine the current user"));
        Map<String, Object> safe = args == null ? Map.of() : args;
        Long projectId = longArg(safe, "projectId");
        if (projectId == null) projectId = contextProjectId;
        Object result;
        try {
            result = handler.call(new Call(userId, projectId, safe));
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalArgumentException(e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage(), e);
        }
        String text = result instanceof String s ? s : cn.hutool.json.JSONUtil.toJsonStr(result);
        return text.length() <= MAX_RESULT_CHARS ? text
                : text.substring(0, MAX_RESULT_CHARS) + "\n...[truncated, narrow the request]";
    }

    // ---- 项目成员权限 ----

    private Long requireProject(Call call, boolean write) {
        Long projectId = call.projectId();
        if (projectId == null || projectId <= 0) {
            throw new IllegalArgumentException(LangText.of("缺少目标项目（projectId）", "projectId is required"));
        }
        if (write && tasks.isScratchProject(projectId)) {
            // 随手工作区（SCRATCH）不是用户指的项目：写入必须明确目标，不静默落进去
            throw new IllegalArgumentException(LangText.of("当前没有绑定正式项目，请先询问用户要写入哪个项目并传 projectId",
                    "No project is selected; ask the user which project to write to and pass projectId"));
        }
        boolean allowed = write
                ? members.hasWritePermission(projectId, call.userId()) && !members.isClient(projectId, call.userId())
                : members.hasReadPermission(projectId, call.userId());
        if (!allowed) {
            throw new IllegalArgumentException(LangText.of("无权访问该项目", "You don't have access to this project"));
        }
        return projectId;
    }

    // ---- calendar ----

    private Object calendarList(Call call) {
        Long projectId = requireProject(call, false);
        return tasks.listByProject(projectId, date(call.args(), "from"), date(call.args(), "to"));
    }

    private Object calendarListForUser(Call call) {
        return tasks.listForUser(call.userId(), date(call.args(), "from"), date(call.args(), "to"));
    }

    private Object calendarCreate(Call call) {
        Long projectId = requireProject(call, true);
        Map<String, Object> a = call.args();
        LocalDate dueDate = date(a, "dueDate");
        LocalTime dueTime = time(a, "dueTime");
        ProjectTaskService.TaskDraft draft = new ProjectTaskService.TaskDraft(
                text(a, "title"), dueDate, dueTime, text(a, "type"), text(a, "priority"), text(a, "notes"),
                longArg(a, "assigneeId"), intArg(a, "remindBefore"), longList(a.get("fileIds")));
        ProjectTask task = tasks.createAiTask(projectId, draft, call.userId());
        return tasks.toResponseMap(task);
    }

    private Object calendarUpdate(Call call) {
        ProjectTask task = ownedTask(call);
        Map<String, Object> updates = new LinkedHashMap<>(call.args());
        for (String key : List.of("taskId", "projectId")) updates.remove(key);
        if (updates.isEmpty()) throw new IllegalArgumentException(LangText.of("没有要修改的字段", "No fields to update"));
        return tasks.toResponseMap(tasks.updateTask(task.getId(), updates));
    }

    private Object calendarDelete(Call call) {
        ProjectTask task = ownedTask(call);
        tasks.deleteTask(task.getId());
        return Map.of("deleted", true);
    }

    /** 任务所在项目才是权限依据，不信参数里的 projectId。 */
    private ProjectTask ownedTask(Call call) {
        Long taskId = longArg(call.args(), "taskId");
        if (taskId == null) throw new IllegalArgumentException(LangText.of("缺少 taskId", "taskId is required"));
        ProjectTask task = tasks.getTask(taskId);
        requireProject(new Call(call.userId(), task.getProjectId(), call.args()), true);
        return task;
    }

    // ---- search ----

    private Object searchQuery(Call call) {
        Long projectId = requireProject(call, false);
        Map<String, Object> a = call.args();
        String query = text(a, "query");
        if (query == null || query.isBlank() || query.length() > 10_000) {
            throw new IllegalArgumentException(LangText.of("query 缺失或过长", "query is missing or too long"));
        }
        SearchRequest request = new SearchRequest();
        request.setQuery(query.trim());
        request.setFilenameOnly(Boolean.TRUE.equals(a.get("filenameOnly")));
        request.setCaseSensitive(Boolean.TRUE.equals(a.get("caseSensitive")));
        request.setWholeWord(Boolean.TRUE.equals(a.get("wholeWord")));
        request.setUseRegex(Boolean.TRUE.equals(a.get("useRegex")));
        List<Long> tagIds = longList(a.get("tagIds"));
        if (tagIds != null) request.setTagIds(tagIds.stream().filter(id -> id != null && id > 0).limit(200).toList());
        return search.searchContent(projectId, request, call.userId());
    }

    private Object searchTags(Call call) {
        Long projectId = requireProject(call, false);
        List<Map<String, Object>> out = new ArrayList<>();
        for (var tag : tags.getProjectTags(projectId)) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", tag.getId());
            row.put("name", tag.getName());
            row.put("color", tag.getColor());
            row.put("type", tag.getType());
            out.add(row);
        }
        return out;
    }

    // ---- sensitive ----

    /** 走 SensitiveController 同一条路径（读/写权限闸、落盘、重名处理）；恢复密钥与原词映射不回给模型。 */
    private Object sensitiveRun(Call call, String action) {
        SensitiveController controller = sensitive.getIfAvailable();
        if (controller == null) throw new IllegalArgumentException("Sensitive service unavailable");
        Map<String, Object> a = call.args();
        Long fileId = longArg(a, "fileId");
        if (fileId == null) throw new IllegalArgumentException(LangText.of("缺少 fileId", "fileId is required"));
        var request = new SensitiveController.Request(fileId, strings(a.get("strategies")),
                "preview".equals(action) ? text(a, "mode") : "MASK".equals(text(a, "mode")) ? "MASK" : "TOKEN",
                strings(a.get("customTerms")), strings(a.get("excludedTerms")), null, null);
        ResponseEntity<?> response = controller.executeAs(request, call.userId(), action);
        Object body = response.getBody();
        if (!response.getStatusCode().is2xxSuccessful()) {
            Object error = body instanceof Map<?, ?> m ? m.get("error") : null;
            throw new IllegalArgumentException(String.valueOf(error == null ? "Sensitive operation failed" : error));
        }
        if ("preview".equals(action) || !(body instanceof Map<?, ?> map)) return body;
        Map<String, Object> safe = new LinkedHashMap<>();
        Object file = map.get("file");
        if (file instanceof com.checkba.model.entity.ProjectFile f) {
            safe.put("file", Map.of("id", f.getId(), "name", f.getName()));
        }
        for (String key : List.of("counts", "suspects", "warnings")) safe.put(key, map.get(key));
        safe.put("recoveryKitSaved", map.get("recoveryKit") instanceof String k && !k.isEmpty());
        return safe;
    }

    // ---- 参数容错 ----

    private static String text(Map<String, Object> a, String key) {
        Object v = a.get(key);
        return v == null ? null : String.valueOf(v);
    }

    private static Long longArg(Map<String, Object> a, String key) {
        Object v = a.get(key);
        if (v == null || (v instanceof String s && s.isBlank())) return null;
        if (v instanceof Number n) return n.longValue();
        try {
            return Long.parseLong(String.valueOf(v).trim());
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(key + " must be an integer");
        }
    }

    private static Integer intArg(Map<String, Object> a, String key) {
        Long v = longArg(a, key);
        return v == null ? null : Math.toIntExact(v);
    }

    private static LocalDate date(Map<String, Object> a, String key) {
        String v = text(a, key);
        if (v == null || v.isBlank()) return null;
        try {
            return LocalDate.parse(v.trim());
        } catch (DateTimeParseException e) {
            throw new IllegalArgumentException(key + " must be an ISO date yyyy-MM-dd");
        }
    }

    private static LocalTime time(Map<String, Object> a, String key) {
        String v = text(a, key);
        if (v == null || v.isBlank()) return null;
        try {
            return LocalTime.parse(v.trim());
        } catch (DateTimeParseException e) {
            throw new IllegalArgumentException(key + " must be HH:mm");
        }
    }

    private static List<Long> longList(Object v) {
        if (!(v instanceof List<?> list)) return null;
        List<Long> out = new ArrayList<>();
        for (Object item : list) {
            if (item instanceof Number n) out.add(n.longValue());
            else if (item != null) {
                try {
                    out.add(Long.parseLong(String.valueOf(item).trim()));
                } catch (NumberFormatException e) {
                    throw new IllegalArgumentException("id lists must contain integers");
                }
            }
        }
        return out;
    }

    private static List<String> strings(Object v) {
        if (!(v instanceof List<?> list)) return null;
        return list.stream().filter(x -> x != null).map(String::valueOf).limit(50).toList();
    }
}
