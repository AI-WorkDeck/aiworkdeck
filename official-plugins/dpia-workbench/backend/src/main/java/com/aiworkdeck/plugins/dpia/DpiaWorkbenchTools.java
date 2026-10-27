// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.aiworkdeck.plugins.dpia;

import com.checkba.plugin.api.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import static com.aiworkdeck.plugins.dpia.DpiaRuntime.*;

/** Downloadable DPIA workbench bridge using only the public, scoped host SPI. */
public final class DpiaWorkbenchTools implements HostAware {
    // Bounded shared locks also serialize calls made by separate instances of the tool class.
    private static final Object[] LOCKS = new Object[256];
    static { Arrays.setAll(LOCKS, ignored -> new Object()); }
    private final Runner runner;
    private final Path pluginRoot;
    private final Path dataRoot;
    private final Map<String, String> environment;
    private PluginHost host;
    private DpiaEnvironment environmentCheck = new DpiaEnvironment();
    void setEnvironmentCheck(DpiaEnvironment check) { this.environmentCheck = check; }

    public DpiaWorkbenchTools() {
        this(new NativeRunner(), installedRoot(), Path.of(System.getProperty("user.home"), ".aiworkdeck", "plugin-data", "dpia-workbench"), System.getenv());
    }
    DpiaWorkbenchTools(Runner runner, Path pluginRoot, Path dataRoot, Map<String, String> environment) {
        this.runner = runner; this.pluginRoot = pluginRoot.toAbsolutePath().normalize();
        this.dataRoot = dataRoot.toAbsolutePath().normalize(); this.environment = Map.copyOf(environment);
    }
    @Override public void setHost(PluginHost host) { this.host = host; }

    @Tool("DPIA 工作台操作。action 为操作名，json 为 JSON 对象；用户与项目由宿主确定。导出会保存到当前项目的 DPIA 工作台/导出目录。")
    public String dpia_workbench_action(@P("操作名") String action, @P("JSON 参数对象，默认 {}") String json) {
        try {
            ToolCall call = host == null ? null : host.call();
            if (call == null || call.userId() == null || call.userId() <= 0) throw new Failure("请先登录 AI WorkDeck");
            if (call.projectId() == null || call.projectId() <= 0) throw new Failure("请先打开一个项目");
            host.sessions().authorize();
            boolean agentCall = call.conversationId() != null && !call.conversationId().isBlank();
            if (agentCall && !"task".equals(action)) throw new Failure("AI 会话只能执行已发起的 DPIA 任务；确认、复核及工作台操作须由用户执行");
            if (!agentCall && "task".equals(action)) throw new Failure("DPIA 任务只能由对应的 AI 评估会话执行");
            JsonNode parsed = JSON.readTree(json == null || json.isBlank() ? "{}" : json);
            if (parsed == null || !parsed.isObject()) throw new Failure("参数必须是 JSON 对象");
            if (action == null || action.isBlank()) throw new Failure("请指定 DPIA 操作");
            ObjectNode payload = (ObjectNode) parsed;
            payload.put("action", action);
            // Readiness must not wait for an active project task or require Node RPC.
            if ("environmentCheck".equals(action)) return ok(environmentCheck.check(pluginRoot, key -> host.settings().get(key), environment)).toString();
            Path scope = dataRoot.resolve("u" + call.userId()).resolve("p" + call.projectId());
            // Cancellation must reach the native Agent while a long report task holds the project lock.
            // Runner persists cancellation with its append-only revision guard; acknowledgement is not completion.
            if ("cancel".equals(action)) return execute(call, scope, action, payload);
            synchronized (LOCKS[Math.floorMod(scope.hashCode(), LOCKS.length)]) {
                return execute(call, scope, action, payload);
            }
        } catch (Failure e) { return error(e.getMessage()).toString(); }
        catch (Exception e) { return error("DPIA 操作未完成，请检查项目权限、参数或运行环境").toString(); }
    }

    private String execute(ToolCall call, Path scope, String action, ObjectNode payload) throws Exception {
        if (action.equals("sessionInfo")) {
            PluginSession session = host.sessions().status(text(payload, "sessionId"));
            return ok(Map.of("conversationId", session.conversationId())).toString();
        }
        safeDirectories(scope);
        // Node canonicalizes storage too (for example macOS /var -> /private/var).
        scope = scope.toRealPath();
        Map<String, String> childEnvironment = new HashMap<>();
        String python = setting("pythonPath", "AWD_DPIA_PYTHON", null);
        if (python != null) { childEnvironment.put("DSH_DPIA_PYTHON", python); childEnvironment.put("DSH_DPIA_DOCUMENT_PYTHON", python); }
        String pdfFont = setting("pdfFontPath", "DSH_DPIA_PDF_FONT", null);
        if (pdfFont != null) childEnvironment.put("DSH_DPIA_PDF_FONT", pdfFont);
        String soffice = setting("sofficePath", "AWD_DPIA_SOFFICE", null);
        if (soffice != null) childEnvironment.put("AWD_DPIA_SOFFICE", soffice);
        Request request = new Request(List.of(setting("nodePath", "AWD_DPIA_NODE", "node"),
            pluginRoot.resolve("runtime/adapter.mjs").toString(), "--root", scope.toString()),
            childEnvironment, pluginRoot, payload, Duration.ofSeconds(300));
        JsonNode result = runner.run(request, this::hostCallback);
        if (!result.path("ok").isBoolean()) throw new Failure("DPIA 运行环境返回格式异常");
        if (!result.path("ok").asBoolean()) return result.toString();
        JsonNode value = result.path("value");
        if (value.has("exportPath")) return ok(saveExport(call.projectId(), scope, value)).toString();
        return result.toString();
    }

    @Tool("DPIA 评估会话的任务原语。json 指定案件 id、operation 以及写入所需 requestId；只操作当前会话绑定的已发起评估任务。")
    public String dpia_workbench_task(@P("任务 JSON 参数对象") String json) {
        return dpia_workbench_action("task", json);
    }

    private Object hostCallback(String method, JsonNode args) {
        String key = text(args, "key");
        return switch (method) {
            case "authorizeTask" -> {
                ToolCall call = host.call();
                PluginSession session = host.sessions().status(key);
                if (call == null || call.conversationId() == null || call.conversationId().isBlank()
                    || !call.conversationId().equals(session.conversationId()))
                    throw new Failure("DPIA 任务不属于当前 AI 会话");
                yield true;
            }
            case "ensure" -> host.sessions().ensure(key, text(args, "title"));
            case "status" -> {
                try { yield host.sessions().status(key); }
                catch (NoSuchElementException e) { yield null; }
            }
            case "submit" -> host.sessions().submit(key, text(args, "requestId"), text(args, "prompt"), List.of("dpia-assessment"));
            case "cancel" -> host.sessions().cancel(key);
            default -> throw new Failure("不支持的宿主会话操作");
        };
    }

    private Object saveExport(long projectId, Path scope, JsonNode value) throws Exception {
        Path exportDirectory = scope.resolve("exports");
        Path file = Path.of(text(value, "exportPath")).toAbsolutePath().normalize();
        if (!file.startsWith(exportDirectory) || file.equals(exportDirectory)) throw new Failure("导出文件不在当前项目范围内");
        rejectSymlinks(scope, file);
        if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)
            || !file.toRealPath().startsWith(exportDirectory.toRealPath())) throw new Failure("导出文件不可读取");
        String filename = text(value, "filename");
        if (filename.equals(".") || filename.equals("..") || filename.contains("/") || filename.contains("\\")
            || filename.chars().anyMatch(Character::isISOControl)) throw new Failure("导出文件名无效");
        String mime = text(value, "mime");
        try (InputStream input = Files.newInputStream(file, LinkOption.NOFOLLOW_LINKS)) {
            FileInfo folder = host.files().createFolderPath(projectId, List.of("DPIA 工作台", "导出"));
            FileInfo saved = host.files().write(projectId, folder.id(), filename, input, ConflictPolicy.RENAME);
            return Map.of("fileId", saved.id(), "path", saved.path(), "filename", saved.name(), "mime", mime);
        }
    }

    private void safeDirectories(Path scope) throws Exception {
        // The local home directory may itself be mounted via a symlink; reject aliases within plugin storage.
        rejectSymlinks(dataRoot, scope);
        Files.createDirectories(scope);
        rejectSymlinks(dataRoot, scope);
    }
    private static void rejectSymlinks(Path start, Path end) {
        Path current = start;
        if (Files.isSymbolicLink(current)) throw new Failure("DPIA 数据目录不能使用符号链接");
        for (Path component : start.relativize(end)) {
            current = current.resolve(component);
            if (Files.isSymbolicLink(current)) throw new Failure("DPIA 数据目录不能使用符号链接");
        }
    }
    private String setting(String key, String variable, String fallback) {
        String value = host.settings().get(key);
        if (value == null || value.isBlank()) value = environment.get(variable);
        return value == null || value.isBlank() ? fallback : value.trim();
    }
    private static String text(JsonNode object, String key) {
        JsonNode value = object.path(key);
        if (!value.isTextual() || value.asText().isBlank()) throw new Failure("缺少必要参数：" + key);
        return value.asText();
    }
    private static Path installedRoot() {
        try { return Path.of(DpiaWorkbenchTools.class.getProtectionDomain().getCodeSource().getLocation().toURI()).getParent(); }
        catch (Exception e) { throw new IllegalStateException("无法定位 DPIA 插件安装目录"); }
    }
    private static ObjectNode ok(Object value) { ObjectNode result = JSON.createObjectNode().put("ok", true); result.set("value", JSON.valueToTree(value)); return result; }
    private static ObjectNode error(String message) { ObjectNode result = JSON.createObjectNode().put("ok", false); result.putObject("error").put("message", message); return result; }
}
