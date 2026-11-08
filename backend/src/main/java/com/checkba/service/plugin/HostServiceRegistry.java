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
import com.checkba.service.im.ImGatewayService;
import com.checkba.service.lawfirm.LawFirmManagementService;
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
                    "redact", new Spec("write", List.of("file_read", "file_write"))),
            "lawfirm", Map.of(
                    "overview", new Spec("read", List.of("lawfirm")),
                    "conflictCheck", new Spec("read", List.of("lawfirm")),
                    "feeLedger", new Spec("read", List.of("lawfirm"))),
            "im", Map.of(
                    "listConversations", new Spec("read", List.of("im")),
                    "readMessages", new Spec("read", List.of("im"))));

    /** 单次返回给模型的字符上限，超出截断并注明。 */
    static final int MAX_RESULT_CHARS = 30_000;

    private final ProjectTaskService tasks;
    private final ProjectMemberService members;
    private final ContentSearchService search;
    private final TagService tags;
    private final ObjectProvider<SensitiveController> sensitive;
    private final ObjectProvider<LawFirmManagementService> lawfirm;
    private final ObjectProvider<ImGatewayService> im;
    private final Map<String, Map<String, Handler>> handlers = new LinkedHashMap<>();

    public HostServiceRegistry(ProjectTaskService tasks, ProjectMemberService members, ContentSearchService search,
                               TagService tags, ObjectProvider<SensitiveController> sensitive,
                               ObjectProvider<LawFirmManagementService> lawfirm, ObjectProvider<ImGatewayService> im) {
        this.tasks = tasks;
        this.members = members;
        this.search = search;
        this.tags = tags;
        this.sensitive = sensitive;
        this.lawfirm = lawfirm;
        this.im = im;
        register("calendar", "list", this::calendarList);
        register("calendar", "listForUser", this::calendarListForUser);
        register("calendar", "create", this::calendarCreate);
        register("calendar", "update", this::calendarUpdate);
        register("calendar", "delete", this::calendarDelete);
        register("search", "query", this::searchQuery);
        register("search", "tags", this::searchTags);
        register("sensitive", "preview", call -> sensitiveRun(call, "preview"));
        register("sensitive", "redact", call -> sensitiveRun(call, "desensitize"));
        register("lawfirm", "overview", this::lawfirmOverview);
        register("lawfirm", "conflictCheck", this::lawfirmConflictCheck);
        register("lawfirm", "feeLedger", this::lawfirmFeeLedger);
        register("im", "listConversations", this::imListConversations);
        register("im", "readMessages", this::imReadMessages);
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

    /** 脱敏面板默认勾选的策略（panel 的 selectedStrategies 初始值）。 */
    static final List<String> SENSITIVE_DEFAULT_STRATEGIES = List.of("COMPANY", "CHINESE_NAME", "PHONE", "ID_CARD",
            "UNIFIED_SOCIAL_CREDIT", "LAWYER_LICENSE", "EMAIL", "BANK_CARD", "ADDRESS");

    /** 走 SensitiveController 同一条路径（读/写权限闸、落盘、重名处理）；恢复密钥与原词映射不回给模型。 */
    private Object sensitiveRun(Call call, String action) {
        SensitiveController controller = sensitive.getIfAvailable();
        if (controller == null) throw new IllegalArgumentException("Sensitive service unavailable");
        Map<String, Object> a = call.args();
        Long fileId = longArg(a, "fileId");
        if (fileId == null) throw new IllegalArgumentException(LangText.of("缺少 fileId", "fileId is required"));
        // Agent 只用 MASK：TOKEN 需要用户自选的复敏密码，绝不经 Agent（传 null 只会得到「请输入复敏密码」，模型会反复重试）
        List<String> customTerms = strings(a.get("customTerms"));
        List<String> strategies = strings(a.get("strategies"));
        if ((strategies == null || strategies.isEmpty()) && (customTerms == null || customTerms.isEmpty())) {
            strategies = SENSITIVE_DEFAULT_STRATEGIES; // 与脱敏面板默认勾选一致
        }
        var request = new SensitiveController.Request(fileId, strategies, "MASK",
                customTerms, strings(a.get("excludedTerms")), null, null);
        ResponseEntity<?> response = controller.executeAs(request, call.userId(), action);
        Object body = response.getBody();
        if (!response.getStatusCode().is2xxSuccessful()) {
            Object error = body instanceof Map<?, ?> m ? m.get("error") : null;
            throw new IllegalArgumentException(String.valueOf(error == null ? "Sensitive operation failed" : error)
                    + " [Not retryable with the same arguments; do not retry, tell the user what failed.]");
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

    // ---- lawfirm（只读；与 PluginLawFirmController 同一入口 LawFirmManagementService.execute。
    //      全所数据（收费台账、全所看板）要 canViewFirmWide：系统管理员 / 律所管理员 / 桌面单机；conflictCheck 与 UI 收案表单同口径，登录即可）----

    private static final int LAWFIRM_ROW_LIMIT = 30;

    private Map<String, Object> lawfirmExecute(Call call, String action, Map<String, Object> params, Long projectId) {
        LawFirmManagementService service = lawfirm.getIfAvailable();
        if (service == null) throw new IllegalArgumentException("Law firm service unavailable");
        return service.execute(call.userId(), projectId, action, params);
    }

    /** 传了 projectId 就先核该项目读权限（比 REST 更严，不会让模型跨项目窥探）；不传则是全所视图，同 REST。 */
    private Long optionalReadableProject(Call call) {
        if (call.projectId() == null || longArg(call.args(), "projectId") == null) return null;
        return requireProject(call, false);
    }

    private Object lawfirmOverview(Call call) {
        Long projectId = optionalReadableProject(call);
        Map<String, Object> a = call.args();
        LawFirmManagementService service = lawfirm.getIfAvailable();
        if (service == null) throw new IllegalArgumentException("Law firm service unavailable");
        if (!service.canViewFirmWide(call.userId())) {
            // 没有全所查看资格：只给「有读权限的某项目」的事项级数据，绝不给全所看板/收费
            if (projectId == null) service.requireFirmWide(call.userId());
            Map<String, Object> scoped = new LinkedHashMap<>();
            scoped.put("restricted", true);
            scoped.put("matters", filterRows(service.listProjectMatters(projectId), null, text(a, "query"), limit(a, LAWFIRM_ROW_LIMIT)));
            return scoped;
        }
        String scope = "mine".equals(text(a, "scope")) ? "mine" : "all";
        Map<String, Object> full = lawfirmExecute(call, "overview", Map.of("scope", scope), projectId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("summary", full.get("summary"));
        out.put("kpi", full.get("kpi"));
        out.put("matters", filterRows(full.get("matters"), projectId, text(a, "query"), limit(a, LAWFIRM_ROW_LIMIT)));
        out.put("pendingClearances", filterRows(full.get("pendingClearances"), null, null, LAWFIRM_ROW_LIMIT));
        return out;
    }

    private Object lawfirmConflictCheck(Call call) {
        Map<String, Object> a = call.args();
        Map<String, Object> params = new LinkedHashMap<>();
        for (String key : List.of("title", "practiceArea", "clientName", "clientCreditCode", "clientRole", "counterpartyName",
                "counterpartyCreditCode", "relatedParties", "relatedPartyName", "relatedPartyRole", "feeMode",
                "contractAmountYuan", "disputeTargetYuan", "ethicalWallApplied", "clientWaiverUploaded")) {
            if (a.get(key) != null) params.put(key, a.get(key));
        }
        if (text(a, "clientName") == null && text(a, "counterpartyName") == null && text(a, "relatedPartyName") == null) {
            throw new IllegalArgumentException(LangText.of("请至少提供 clientName 或 counterpartyName", "Provide at least clientName or counterpartyName"));
        }
        return lawfirmExecute(call, "precheckConflict", params, optionalReadableProject(call));
    }

    private Object lawfirmFeeLedger(Call call) {
        // 收费台账是全所数据：即便传了 projectId，也只有全所查看资格者可读
        LawFirmManagementService service = lawfirm.getIfAvailable();
        if (service == null) throw new IllegalArgumentException("Law firm service unavailable");
        service.requireFirmWide(call.userId());
        Long projectId = optionalReadableProject(call);
        Map<String, Object> a = call.args();
        Map<String, Object> full = lawfirmExecute(call, "overview", Map.of("scope", "all"), projectId);
        String kind = text(a, "kind") == null ? "both" : text(a, "kind");
        int limit = limit(a, 50);
        Map<String, Object> out = new LinkedHashMap<>();
        Object summary = full.get("summary");
        if (summary instanceof Map<?, ?> s) {
            Map<String, Object> money = new LinkedHashMap<>();
            for (String key : List.of("arTotalCents", "collectionRatePercent", "billingRatePercent", "pendingInvoiceCount")) money.put(key, s.get(key));
            out.put("summary", money);
        }
        if (!"collections".equals(kind)) out.put("invoices", filterRows(full.get("invoices"), projectId, text(a, "query"), limit));
        if (!"invoices".equals(kind)) out.put("collections", filterRows(full.get("collections"), projectId, text(a, "query"), limit));
        return out;
    }

    private static int limit(Map<String, Object> a, int fallback) {
        Integer v = intArg(a, "limit");
        return v == null ? fallback : Math.max(1, Math.min(100, v));
    }

    /** 按项目 id / 关键字过滤并截断；行里没有 projectId 字段时不按项目滤。 */
    private static List<Object> filterRows(Object rows, Long projectId, String query, int limit) {
        List<Object> out = new ArrayList<>();
        if (!(rows instanceof List<?> list)) return out;
        String needle = query == null || query.isBlank() ? null : query.trim().toLowerCase(java.util.Locale.ROOT);
        for (Object row : list) {
            if (out.size() >= limit) break;
            if (projectId != null && row instanceof Map<?, ?> m && m.containsKey("projectId")
                    && !String.valueOf(projectId).equals(String.valueOf(m.get("projectId")))) continue;
            if (needle != null && !cn.hutool.json.JSONUtil.toJsonStr(row).toLowerCase(java.util.Locale.ROOT).contains(needle)) continue;
            out.add(row);
        }
        return out;
    }

    // ---- im（只读；走 ImGatewayService，会话成员资格与代理范围由 ImService 校验）----

    private Object imExecute(Call call, String action, Map<String, Object> params) {
        ImGatewayService gateway = im.getIfAvailable();
        if (gateway == null) throw new IllegalArgumentException("IM service unavailable");
        return gateway.execute(call.userId(), action, params);
    }

    private Object imListConversations(Call call) {
        Object result = imExecute(call, "list", Map.of());
        if (result instanceof Map<?, ?> m && m.get("conversations") instanceof List<?> list) {
            return Map.of("conversations", list.stream().limit(100).toList());
        }
        return result;
    }

    private Object imReadMessages(Call call) {
        Map<String, Object> a = call.args();
        // 不能叫 conversationId：ToolRegistry.executeDeclared 会剥掉模型传的 conversationId（那是 Agent 会话 id）
        String conversationId = text(a, "imConversationId");
        if (conversationId == null || conversationId.isBlank()) {
            throw new IllegalArgumentException(LangText.of("缺少 imConversationId", "imConversationId is required"));
        }
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("conversationId", conversationId.trim());
        params.put("limit", limit(a, 30));
        if (a.get("beforeId") != null && a.get("afterId") != null) {
            throw new IllegalArgumentException(LangText.of("beforeId 与 afterId 只能二选一", "Use either beforeId or afterId"));
        }
        if (a.get("beforeId") != null) params.put("beforeId", longArg(a, "beforeId"));
        if (a.get("afterId") != null) params.put("afterId", longArg(a, "afterId"));
        return imExecute(call, "messages", params);
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
