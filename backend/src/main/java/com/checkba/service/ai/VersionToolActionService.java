// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import com.checkba.controller.CloudController;
import com.checkba.repository.ProjectAiMessageRepository;
import com.checkba.service.ProjectAiMessageService;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.LangText;
import com.checkba.service.ai.context.ProjectContextHolder;
import com.checkba.version.ProjectRepoService;
import com.checkba.version.VersionController;
import com.checkba.version.VersionException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/** Server-owned, single-use version actions; the host must save and reload before acknowledging. */
@Service
@RequiredArgsConstructor
@Slf4j
public class VersionToolActionService {
    private final EditorBridgeService bridge;
    private final SseEmitterService sse;
    private final ProjectMemberService members;
    private final ProjectAiMessageService messages;
    private final ProjectAiMessageRepository messageRepository;
    private final VersionController versions;
    private final CloudController cloud;
    private final ProjectRepoService repos;
    private final ObjectMapper mapper;
    private final Map<String, Action> actions = new ConcurrentHashMap<>();
    private static final long RETENTION_MS = 15 * 60_000L;

    private static final class Action {
        final String id = UUID.randomUUID().toString();
        final long projectId, userId, epoch, created = System.currentTimeMillis();
        final String conversationId, operation;
        final Map<String, String> args;
        final Object runToken;
        String status = "prepared";
        volatile boolean finished;
        Map<String, Object> result;
        Map<String, Object> conflict;
        final Map<String, Step> steps = new LinkedHashMap<>();
        Step lastStep;
        Action(long projectId, long userId, String conversationId, String operation,
               Map<String, String> args, long epoch, Object runToken) {
            this.projectId = projectId; this.userId = userId; this.conversationId = conversationId;
            this.operation = operation; this.args = Map.copyOf(args); this.epoch = epoch; this.runToken = runToken;
        }
    }

    private static final class Step {
        final String id;
        String status = "executing";
        Map<String, Object> result;
        Step(String id) { this.id = id; }
    }

    private void authorize(Long projectId, Long userId, String conversationId, boolean write) {
        if (projectId == null || userId == null || !messages.canUseConversation(conversationId, userId)
                || !members.hasReadPermission(projectId, userId) || members.isClient(projectId, userId)
                || (write && !members.hasWritePermission(projectId, userId))) throw denied();
        messageRepository.findFirstByConversationId(conversationId).ifPresent(message -> {
            if (!projectId.equals(message.getProjectId()) || !userId.equals(message.getUserId())) throw denied();
        });
    }

    private static IllegalArgumentException denied() { return new IllegalArgumentException("无权执行该版本操作"); }

    public Map<String, Object> read(String operation, Integer limit, String cursor, boolean includeAuto) {
        Long projectId = ProjectContextHolder.getProjectIdAsLong(), userId = ProjectContextHolder.getUserId();
        authorize(projectId, userId, ProjectContextHolder.getConversationId(), false);
        return data("history".equals(operation)
                ? versions.historyForUser(projectId, limit == null ? 50 : Math.min(100, Math.max(1, limit)),
                    cursor, null, null, null, null, null, includeAuto, userId)
                : versions.statusForUser(projectId, userId));
    }

    public Map<String, Object> request(String operation, Map<String, String> args) {
        Long projectId = ProjectContextHolder.getProjectIdAsLong(), userId = ProjectContextHolder.getUserId();
        String conversationId = ProjectContextHolder.getConversationId();
        authorize(projectId, userId, conversationId, true);
        if (!Set.of("commit", "pull", "restore").contains(operation)) throw denied();
        if ("restore".equals(operation) && !args.getOrDefault("ref", "").matches("[0-9a-fA-F]{40}"))
            return failure("INVALID_VERSION", "请先从版本历史中选定要恢复的完整版本编号", false);
        Object runToken = bridge.versionRunToken(conversationId);
        if (runToken == null || !conversationId.equals(bridge.getCurrentConversationId())
                || sse.currentEpoch(conversationId) == 0) return failure("ACTION_CANCELLED", "本次操作已停止", false);
        actions.entrySet().removeIf(e -> {
            synchronized (e.getValue()) {
                return !"executing".equals(e.getValue().status)
                        && System.currentTimeMillis() - e.getValue().created > RETENTION_MS;
            }
        });
        Action action = new Action(projectId, userId, conversationId, operation, args,
                sse.currentEpoch(conversationId), runToken);
        actions.put(action.id, action);
        try {
            String raw = bridge.executeEditorCommand("project_version_action", Map.of(
                    "operationId", action.id, "projectId", projectId, "operation", operation));
            Map<String, Object> ack;
            try { ack = mapper.readValue(raw, new TypeReference<>() {}); }
            catch (Exception e) { ack = Map.of(); }
            synchronized (action) {
                if ("prepared".equals(action.status)) action.status = "cancelled";
                if ("executing".equals(action.status))
                    return failure("OUTCOME_UNKNOWN", "操作已开始，结果尚未确认。请核对版本状态，不要重复提交", true);
                boolean matched = action.id.equals(ack.get("operationId"));
                if (action.result == null) return matched && Boolean.FALSE.equals(ack.get("success"))
                        ? hostFailure(ack) : failure("ACTION_CANCELLED", "操作未执行或已停止", false);
                boolean refreshed = matched && Boolean.TRUE.equals(ack.get("hostReloaded"));
                if (refreshed && Boolean.TRUE.equals(ack.get("success")) && Boolean.TRUE.equals(ack.get("autoMerged"))
                        && action.result.get("conflict") instanceof Map<?, ?> conflict
                        && merged(action, conflict)) {
                    Map<String, Object> result = new LinkedHashMap<>(action.result);
                    result.remove("conflict"); result.remove("error"); result.remove("code");
                    result.put("success", true); result.put("autoMerged", true);
                    if ("pull".equals(action.operation)) {
                        result.put("status", "UPDATED");
                        result.remove("landedOnCloud"); // Initial conflict receipt cannot prove the later push.
                    } else {
                        result.put("sha", repos.resolveRef(action.projectId, "HEAD"));
                        result.put("committed", true);
                    }
                    action.result = Collections.unmodifiableMap(result);
                    action.status = "succeeded";
                    return result;
                }
                if (!Boolean.TRUE.equals(action.result.get("success"))) {
                    Map<String, Object> result = new LinkedHashMap<>(action.lastStep != null
                            && "failed".equals(action.lastStep.status) ? action.lastStep.result : action.result);
                    if (action.lastStep != null) result.put("operationResult", action.result);
                    result.put("hostReloaded", refreshed);
                    return result;
                }
                if (!refreshed || !Boolean.TRUE.equals(ack.get("success"))) {
                    Map<String, Object> result = failure("HOST_NOT_CONFIRMED", "操作结果已记录，但界面刷新尚未确认。请核对版本状态，不要重复执行", false);
                    result.put("operationResult", action.result);
                    return result;
                }
                return action.result;
            }
        } finally {
            synchronized (action) {
                action.finished = true;
                if ("prepared".equals(action.status)) action.status = "cancelled";
            }
        }
    }

    public Map<String, Object> changes(String from, String to) {
        Long projectId = ProjectContextHolder.getProjectIdAsLong(), userId = ProjectContextHolder.getUserId();
        authorize(projectId, userId, ProjectContextHolder.getConversationId(), false);
        if ((from != null && (to == null || !from.matches("[0-9a-fA-F]{40}")))
                || (to != null && !to.matches("[0-9a-fA-F]{40}")))
            return failure("INVALID_VERSION", "请从版本历史选择完整版本编号；单个版本请填写to", false);
        return data(versions.changesForUser(projectId, from, to, userId));
    }

    private boolean merged(Action action, Map<?, ?> conflict) {
        Map<String, Object> status = data(versions.statusForUser(action.projectId, action.userId));
        if (status.get("sessionEndConflict") != null || status.get("cloudConflict") != null || status.get("adoptConflict") != null) return false;
        String otherKey = "pull".equals(action.operation) ? "cloudTip" : "sessionTip";
        return conflict.get("mainlineTip") instanceof String main && conflict.get(otherKey) instanceof String other
                && repos.isAncestor(action.projectId, main, "HEAD") && repos.isAncestor(action.projectId, other, "HEAD");
    }

    private Action owned(String id, String conversationId, Long userId) {
        Action action = id == null ? null : actions.get(id);
        if (action == null || !action.conversationId.equals(conversationId) || !Objects.equals(action.userId, userId)) throw denied();
        authorize(action.projectId, userId, conversationId, true);
        return action;
    }

    public Map<String, Object> state(String id, String conversationId, Long userId) {
        return state(id, conversationId, userId, null);
    }

    public Map<String, Object> state(String id, String conversationId, Long userId, String stepId) {
        Action action = owned(id, conversationId, userId);
        synchronized (action) { invalidate(action); return snapshot(action, stepId); }
    }

    public Map<String, Object> execute(String id, String conversationId, Long userId, String sessionId) {
        Action action = owned(id, conversationId, userId);
        synchronized (action) {
            invalidate(action);
            if (!"prepared".equals(action.status)) return snapshot(action);
            if (!bridge.claimVersionAction(conversationId, action.runToken, () -> {
                if (canContinue(action)) action.status = "executing";
            }) || !"executing".equals(action.status)) {
                action.status = "cancelled";
                return snapshot(action);
            }
        }
        Map<String, Object> result;
        try {
            result = new LinkedHashMap<>(data(switch (action.operation) {
                case "commit" -> versions.endSession(action.projectId, action.args, sessionId);
                case "pull" -> cloud.update(action.projectId, sessionId);
                case "restore" -> versions.revert(action.projectId, action.args, sessionId);
                default -> throw denied();
            }));
            boolean conflict = result.get("conflict") != null || "CONFLICT".equals(result.get("status"));
            boolean unavailable = Set.of("OFFLINE", "NOT_LINKED").contains(String.valueOf(result.get("status")));
            result.put("success", !conflict && !unavailable);
            if ("commit".equals(action.operation) && !conflict) {
                boolean committed = result.get("sha") instanceof String sha && !sha.isBlank();
                result.put("committed", committed);
                result.put("noChanges", !committed);
            }
            if (conflict) { result.put("error", "仍有文件需要处理合并"); result.put("code", "VERSION_CONFLICT"); }
            else if (unavailable) { result.put("error", "尚未取回云端版本，请检查连接状态"); result.put("code", "CLOUD_UNAVAILABLE"); }
        } catch (Exception e) {
            log.warn("Version AI action failed: operation={}, project={}", action.operation, action.projectId, e);
            result = failure("VERSION_ACTION_FAILED", e instanceof VersionException ve && ve.isUserFacing()
                    ? ve.getMessage() : "版本操作未完成，请检查版本面板", true);
        }
        result.put("operation", action.operation);
        synchronized (action) {
            action.result = Collections.unmodifiableMap(result);
            if (result.get("conflict") instanceof Map<?, ?> conflict)
                action.conflict = mapper.convertValue(conflict, new TypeReference<>() {});
            action.status = Boolean.TRUE.equals(result.get("success")) ? "succeeded" : "failed";
            return snapshot(action);
        }
    }

    /** Only the original AUTO conflict can continue; every HTTP write gets a retained receipt. */
    public Map<String, Object> mergeStep(String id, String conversationId, Long userId, String sessionId,
            String stepId, String kind, String path, MultipartFile file) {
        Action action = owned(id, conversationId, userId);
        if (stepId == null || stepId.isBlank() || stepId.length() > 200) throw denied();
        Step step;
        synchronized (action) {
            if (action.steps.containsKey(stepId)) return snapshot(action, stepId);
            if ("executing".equals(action.status)) return snapshot(action, stepId);
            step = new Step(stepId);
            action.steps.put(stepId, step); action.lastStep = step;
            if (kind == null || !Set.of("structured", "file", "finalize").contains(kind) || action.conflict == null
                    || !Set.of("commit", "pull").contains(action.operation) || "succeeded".equals(action.status)
                    || !bridge.claimVersionAction(conversationId, action.runToken, () -> {
                        if (canContinue(action)) action.status = "executing";
                    }) || !"executing".equals(action.status)) {
                step.status = "failed";
                step.result = failure("MERGE_STEP_CANCELLED", "自动合并未执行，请查看当前版本状态", false);
                return snapshot(action, stepId);
            }
        }
        Map<String, Object> result = new LinkedHashMap<>();
        boolean[] dispatched = { false };
        try {
            versions.withVersionLock(action.projectId, () -> {
                if (!canContinue(action)) throw VersionException.userFacing("自动合并已停止");
                authorize(action.projectId, userId, conversationId, true);
                Map<String, Object> current = sameConflict(action);
                List<String> paths = conflictPaths(action.conflict);
                String ctx = "commit".equals(action.operation) ? "session-end" : "cloud";
                String main = (String)action.conflict.get("mainlineTip");
                String other = (String)action.conflict.get("commit".equals(action.operation) ? "sessionTip" : "cloudTip");
                Map<String, Object> payload = new LinkedHashMap<>();
                if ("finalize".equals(kind)) {
                    Map<String, String> resolutions = new LinkedHashMap<>();
                    for (String candidate : paths) {
                        if (!"MERGED".equals(mergeRow(current, candidate).get("state")))
                            throw VersionException.userFacing("仍有文件未完成合并，请先查看合并清单");
                        resolutions.put(candidate, "MERGED");
                    }
                    dispatched[0] = true;
                    payload.putAll(data("commit".equals(action.operation)
                            ? versions.resolveSessionEnd(action.projectId, Map.of("sessionId", action.conflict.get("sessionId"),
                                "resolutions", resolutions), sessionId)
                            : cloud.resolve(action.projectId, Map.of("resolutions", resolutions), sessionId)));
                    if (("commit".equals(action.operation) && (!(payload.get("sha") instanceof String sha) || sha.isBlank()))
                            || ("pull".equals(action.operation) && !Set.of("UPDATED", "UP_TO_DATE").contains(String.valueOf(payload.get("status")))))
                        throw VersionException.userFacing("合并收尾结果尚未确认，请检查版本状态");
                } else {
                    if (path == null || !paths.contains(path)) throw VersionException.userFacing("该文件不属于本次合并");
                    Map<?, ?> row = mergeRow(current, path);
                    if (!"AUTO".equals(row.get("decision")) || "MERGED".equals(row.get("state")))
                        throw VersionException.userFacing("这份文件不能自动合并，请查看合并清单");
                    if (("file".equals(kind) && !"DOCX".equals(row.get("kind")))
                            || ("structured".equals(kind) && !Set.of("XLSX", "PPTX").contains(String.valueOf(row.get("kind")))))
                        throw VersionException.userFacing("文件类型不支持本次自动合并");
                    dispatched[0] = true;
                    payload.putAll(data("file".equals(kind)
                            ? versions.mergeResolveFile(action.projectId, path, "auto", "[]", ctx, main, other, file, sessionId)
                            : versions.mergeResolveStructured(action.projectId, Map.of("path", path, "ctx", ctx,
                                "mainRef", main, "otherRef", other, "decisions", List.of()), sessionId)));
                    if (!"MERGED".equals(payload.get("state"))) throw VersionException.userFacing("文件合并结果尚未确认");
                }
                result.putAll(payload); result.put("success", true);
            });
        } catch (Exception e) {
            log.warn("AI merge continuation failed: project={}, kind={}", action.projectId, kind, e);
            result.putAll(failure("MERGE_STEP_FAILED", e instanceof VersionException ve && ve.isUserFacing()
                    ? ve.getMessage() : "自动合并未完成，请查看版本面板", dispatched[0]));
        }
        synchronized (action) {
            step.result = Collections.unmodifiableMap(result);
            step.status = Boolean.TRUE.equals(result.get("success")) ? "succeeded" : "failed";
            if ("finalize".equals(kind) && Boolean.TRUE.equals(result.get("success"))) {
                Map<String, Object> completed = new LinkedHashMap<>(result);
                completed.put("operation", action.operation); completed.put("autoMerged", true);
                if ("commit".equals(action.operation)) { completed.put("committed", true); completed.put("noChanges", false); }
                action.result = Collections.unmodifiableMap(completed); action.status = "succeeded";
            } else action.status = "failed";
            return snapshot(action, stepId);
        }
    }

    private Map<String, Object> sameConflict(Action action) {
        Map<String, Object> status = data(versions.statusForUser(action.projectId, action.userId));
        String key = "commit".equals(action.operation) ? "sessionEndConflict" : "cloudConflict";
        Object raw = status.get(key);
        if (!(raw instanceof Map<?, ?> current)) throw VersionException.userFacing("本次待合并版本已变化");
        String other = "commit".equals(action.operation) ? "sessionTip" : "cloudTip";
        if (action.conflict.get("mainlineTip") == null || action.conflict.get(other) == null
                || !action.conflict.get("mainlineTip").equals(current.get("mainlineTip"))
                || !action.conflict.get(other).equals(current.get(other))
                || ("commit".equals(action.operation) && !Objects.equals(action.conflict.get("sessionId"), current.get("sessionId")))
                || !new HashSet<>(conflictPaths(action.conflict)).equals(new HashSet<>(conflictPaths(current))))
            throw VersionException.userFacing("本次待合并版本已变化");
        return mapper.convertValue(current, new TypeReference<>() {});
    }

    private static List<String> conflictPaths(Map<?, ?> conflict) {
        if (!(conflict.get("conflictingPaths") instanceof List<?> paths) || paths.isEmpty()) throw denied();
        return paths.stream().map(String::valueOf).toList();
    }

    private static Map<?, ?> mergeRow(Map<String, Object> conflict, String path) {
        if (conflict.get("documentMerges") instanceof List<?> rows)
            for (Object row : rows) if (row instanceof Map<?, ?> map && path.equals(map.get("path"))) return map;
        throw VersionException.userFacing("这份文件没有可核实的自动合并信息");
    }

    private void invalidate(Action action) {
        if ("prepared".equals(action.status) && !canContinue(action)) action.status = "cancelled";
    }

    private boolean canContinue(Action action) {
        return !action.finished && bridge.versionRunToken(action.conversationId) == action.runToken
                && sse.currentEpoch(action.conversationId) == action.epoch
                && System.currentTimeMillis() - action.created <= 180_000;
    }

    private Map<String, Object> snapshot(Action action) {
        return snapshot(action, null);
    }

    private Map<String, Object> snapshot(Action action, String stepId) {
        Map<String, Object> state = new LinkedHashMap<>();
        state.put("valid", "prepared".equals(action.status)); state.put("status", action.status);
        state.put("canContinue", canContinue(action));
        state.put("projectId", action.projectId); state.put("operation", action.operation);
        if (action.result != null) state.put("result", action.result);
        Step step = stepId == null ? action.lastStep : action.steps.get(stepId);
        if (step != null) {
            Map<String, Object> receipt = new LinkedHashMap<>();
            receipt.put("stepId", step.id); receipt.put("status", step.status);
            receipt.put("writeSettled", !"executing".equals(step.status));
            if (step.result != null) receipt.put("result", step.result);
            state.put("lastStep", receipt);
        }
        return state;
    }

    private Map<String, Object> data(ResponseEntity<Map<String, Object>> response) {
        Map<String, Object> body = response.getBody();
        if (body == null || !Integer.valueOf(0).equals(body.get("code")) || !(body.get("data") instanceof Map<?, ?>))
            throw new IllegalStateException("Invalid version response");
        return mapper.convertValue(body.get("data"), new TypeReference<>() {});
    }

    private static Map<String, Object> failure(String code, String error, boolean unknown) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", false); result.put("error", error); result.put("code", code);
        result.put("outcomeUnknown", unknown); result.put("retryable", false);
        return result;
    }

    private static Map<String, Object> hostFailure(Map<String, Object> ack) {
        String code = String.valueOf(ack.get("code"));
        String message = switch (code) {
            case "saveBeforeCommitFailed" -> LangText.of("文件未能保存，版本操作没有执行", "Files could not be saved; the version action did not run");
            case "aiDrawioSaveFirst" -> LangText.of("请先保存打开的绘图，再执行版本操作", "Save the open drawing before running the version action");
            case "aiStreamBusy", "aiActionBusy" -> LangText.of("另一项编辑操作仍在进行，版本操作没有执行", "Another edit is still running; the version action did not run");
            case "aiEditorNotReady" -> LangText.of("编辑器尚未就绪，版本操作没有执行", "The editor is not ready; the version action did not run");
            default -> LangText.of("操作未执行或已停止，请核对当前项目", "The action did not run or was stopped; check the current project");
        };
        return failure(code, message, false);
    }
}
