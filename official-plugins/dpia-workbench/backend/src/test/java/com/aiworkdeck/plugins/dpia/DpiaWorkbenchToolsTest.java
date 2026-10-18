// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.aiworkdeck.plugins.dpia;

import com.checkba.plugin.api.*;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.io.*;
import java.lang.reflect.Proxy;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BiFunction;
import static com.aiworkdeck.plugins.dpia.DpiaRuntime.*;
import static org.junit.jupiter.api.Assertions.*;

class DpiaWorkbenchToolsTest {
    @TempDir Path directory;
    Path pluginRoot, dataRoot;
    FakeHost host;
    DpiaWorkbenchTools plugin;
    Request request;
    final List<Request> requests = new ArrayList<>();
    BiFunction<Request, Callback, JsonNode> behavior;

    @BeforeEach void setup() throws Exception {
        pluginRoot = directory.resolve("installed"); dataRoot = directory.toRealPath().resolve("data"); host = new FakeHost();
        behavior = (request, callback) -> JSON.createObjectNode().put("ok", true).set("value", JSON.createObjectNode());
        plugin = create(Map.of());
    }
    DpiaWorkbenchTools create(Map<String, String> environment) {
        DpiaWorkbenchTools instance = new DpiaWorkbenchTools((req, cb) -> {
            request = req; requests.add(req); return behavior.apply(req, cb);
        }, pluginRoot, dataRoot, environment);
        instance.setHost(host.proxy); return instance;
    }
    JsonNode call(String action, String json) throws Exception { return JSON.readTree(plugin.dpia_workbench_action(action, json)); }

    @Test void requiresTrustedUserProjectAndWriteAuthorizationBeforeStartingRuntime() throws Exception {
        host.context = null; assertFalse(call("list", "{}").path("ok").asBoolean());
        host.context = new ToolCall(null, null, 1L, null); assertFalse(call("list", "{}").path("ok").asBoolean());
        host.context = new ToolCall(9L, null, 1L, null); host.allowed = false;
        assertFalse(call("list", "{}").path("ok").asBoolean());
        assertFalse(JSON.readTree(plugin.dpia_workbench_task("{}")).path("ok").asBoolean());
        assertTrue(requests.isEmpty());
    }
    @Test void scopesUseHostIdentityAndActionCannotBeOverridden() throws Exception {
        assertTrue(call("list", "{\"userId\":999,\"projectId\":888,\"root\":\"/other\",\"action\":\"erase\"}").path("ok").asBoolean());
        assertEquals(dataRoot.resolve("u1/p9").toString(), request.command().getLast());
        assertEquals("list", request.payload().path("action").asText());
        host.context = new ToolCall(9L, null, 2L, null); call("list", "{}");
        assertEquals(dataRoot.resolve("u2/p9").toString(), request.command().getLast());
        host.context = new ToolCall(10L, null, 1L, null); call("list", "{}");
        assertEquals(dataRoot.resolve("u1/p10").toString(), request.command().getLast());
        host.context = new ToolCall(10L, "conversation", 1L, null);
        assertTrue(JSON.readTree(plugin.dpia_workbench_task("{\"action\":\"delete\"}")).path("ok").asBoolean());
        assertEquals("task", request.payload().path("action").asText());
    }
    @Test void settingsAndEnvironmentUsePortableDefaultsAndNeverPayloadCommands() throws Exception {
        call("list", "{\"nodePath\":\"evil\",\"pythonPath\":\"evil\"}");
        assertEquals("node", request.command().getFirst()); assertTrue(request.environment().isEmpty());
        assertEquals(pluginRoot.resolve("runtime/adapter.mjs").toString(), request.command().get(1));
        assertEquals(300, request.timeout().toSeconds());
        plugin = create(Map.of("AWD_DPIA_NODE", "/env/node", "AWD_DPIA_PYTHON", "/env/python", "AWD_DPIA_SOFFICE", "/env/office"));
        call("list", "{}"); assertEquals("/env/node", request.command().getFirst());
        assertEquals("/env/python", request.environment().get("DSH_DPIA_DOCUMENT_PYTHON"));
        assertFalse(request.environment().containsKey("DOCUMENT_PYTHON"));
        host.settings.put("nodePath", "/setting/node"); host.settings.put("pythonPath", "/setting/python");
        host.settings.put("sofficePath", "/setting/office");
        host.settings.put("pdfFontPath", "/setting/font.ttf"); call("list", "{}");
        assertEquals("/setting/node", request.command().getFirst());
        assertEquals("/setting/python", request.environment().get("DSH_DPIA_PYTHON"));
        assertEquals("/setting/office", request.environment().get("AWD_DPIA_SOFFICE"));
        assertEquals("/setting/font.ttf", request.environment().get("DSH_DPIA_PDF_FONT"));
    }
    @Test void hostCallbacksUseFixedSkillAndKeepTheirArguments() throws Exception {
        behavior = (req, callback) -> {
            var args = JSON.createObjectNode().put("key", "session-1").put("title", "评估标题")
                .put("requestId", "r1").put("prompt", "评估提示").put("skills", "evil");
            assertEquals("conversation", ((PluginSession) callback.invoke("ensure", args)).conversationId());
            callback.invoke("status", args); assertEquals(true, callback.invoke("submit", args));
            assertEquals(true, callback.invoke("cancel", args));
            assertThrows(Failure.class, () -> callback.invoke("arbitrary", args));
            return JSON.createObjectNode().put("ok", true);
        };
        assertTrue(call("start", "{}").path("ok").asBoolean());
        assertEquals(List.of("session-1", "r1", "评估提示", List.of("dpia-assessment")), host.submission);
        assertEquals(List.of("session-1", "评估标题"), host.ensure);
        assertEquals("session-1", host.status); assertEquals("session-1", host.cancel);
    }
    @Test void sessionInfoOnlyLooksUpExistingSessionWithoutCreatingOne() throws Exception {
        JsonNode result = call("sessionInfo", "{\"sessionId\":\"session-existing\"}");
        assertEquals("conversation", result.path("value").path("conversationId").asText());
        assertEquals("session-existing", host.status); assertNull(host.ensure); assertTrue(requests.isEmpty());
    }
    @Test void missingSessionMappingIsNullOnlyForStatusCallback() throws Exception {
        host.missingSession = true;
        behavior = (req, callback) -> {
            assertNull(callback.invoke("status", JSON.createObjectNode().put("key", "session-missing")));
            return JSON.createObjectNode().put("ok", true);
        };
        assertTrue(call("list", "{}").path("ok").asBoolean());
        assertFalse(call("sessionInfo", "{\"sessionId\":\"session-missing\"}").path("ok").asBoolean());
    }
    @Test void aiCannotInvokeUserConfirmationOrOtherUiActionsAndUiCannotRunTask() throws Exception {
        assertFalse(call("task", "{}").path("ok").asBoolean());
        host.context = new ToolCall(9L, "conversation", 1L, null);
        for (String action : List.of("create", "start", "confirmFact", "professionalRecord", "reviewReportPage", "completeReport", "cancel", "sessionInfo"))
            assertFalse(call(action, "{}").path("ok").asBoolean(), action);
        assertTrue(requests.isEmpty());
    }
    @Test void taskCallbackRequiresTheExactBoundConversation() throws Exception {
        host.context = new ToolCall(9L, "other-conversation", 1L, null);
        behavior = (req, callback) -> {
            callback.invoke("authorizeTask", JSON.createObjectNode().put("key", "session-1"));
            return JSON.createObjectNode().put("ok", true);
        };
        assertFalse(call("task", "{}").path("ok").asBoolean());
        host.context = new ToolCall(9L, "conversation", 1L, null);
        assertTrue(call("task", "{}").path("ok").asBoolean());
        host.missingSession = true;
        assertFalse(call("task", "{}").path("ok").asBoolean());
    }
    @Test void exportWritesScopedFileToHostWithoutReturningBytesOrLocalPath() throws Exception {
        Path file = dataRoot.resolve("u1/p9/exports/report.docx"); java.nio.file.Files.createDirectories(file.getParent());
        java.nio.file.Files.writeString(file, "document-content"); export(file, "report.docx");
        JsonNode result = call("downloadReport", "{}"); assertTrue(result.path("ok").asBoolean(), result.toString());
        assertEquals(99, result.path("value").path("fileId").asInt());
        assertEquals("report (2).docx", result.path("value").path("filename").asText());
        assertEquals("document-content", host.written); assertEquals(9, host.writtenProject);
        assertEquals(ConflictPolicy.RENAME, host.policy); assertEquals(List.of("DPIA 工作台", "导出"), host.folders);
        assertFalse(result.toString().contains(directory.toString())); assertFalse(result.toString().contains("document-content"));
    }
    @Test void exportsRejectTraversalOtherScopesDirectoriesAndSymlinks() throws Exception {
        Path exports = dataRoot.resolve("u1/p9/exports"); java.nio.file.Files.createDirectories(exports);
        Path foreign = dataRoot.resolve("u2/p9/exports/report.docx"); java.nio.file.Files.createDirectories(foreign.getParent());
        java.nio.file.Files.writeString(foreign, "foreign");
        for (Path path : List.of(foreign, exports.resolve("../../../u2/p9/exports/report.docx"), exports)) {
            export(path, "report.docx"); assertFalse(call("downloadReport", "{}").path("ok").asBoolean());
        }
        Path link = exports.resolve("link.docx"); java.nio.file.Files.createSymbolicLink(link, foreign);
        export(link, "report.docx"); assertFalse(call("downloadReport", "{}").path("ok").asBoolean());
        Path linkedDir = exports.resolve("linked-dir"); java.nio.file.Files.createSymbolicLink(linkedDir, foreign.getParent());
        export(linkedDir.resolve("report.docx"), "report.docx"); assertFalse(call("downloadReport", "{}").path("ok").asBoolean());
        Path own = exports.resolve("own.docx"); java.nio.file.Files.writeString(own, "own");
        export(own, "../bad.docx"); assertFalse(call("downloadReport", "{}").path("ok").asBoolean());
        assertNull(host.written);
    }
    @Test void scopeSymlinkFailsBeforeRuntime() throws Exception {
        java.nio.file.Files.createDirectories(dataRoot); Path elsewhere = directory.resolve("elsewhere"); java.nio.file.Files.createDirectory(elsewhere);
        java.nio.file.Files.createSymbolicLink(dataRoot.resolve("u1"), elsewhere);
        assertFalse(call("list", "{}").path("ok").asBoolean()); assertTrue(requests.isEmpty());
    }
    @Test void failuresAreStructuredAndNeverClaimSuccess() throws Exception {
        assertFalse(call("list", "[]").path("ok").asBoolean());
        behavior = (req, cb) -> { throw new RuntimeException("/secret/path token"); };
        JsonNode failure = call("list", "{}"); assertFalse(failure.path("ok").asBoolean()); assertFalse(failure.toString().contains("secret"));
        behavior = (req, cb) -> { throw new Failure("DPIA 操作超时"); };
        assertTrue(call("list", "{}").path("error").path("message").asText().contains("超时"));
        behavior = (req, cb) -> JSON.createObjectNode().put("ok", false).set("error", JSON.createObjectNode().put("message", "生成失败"));
        assertEquals("生成失败", call("list", "{}").path("error").path("message").asText());
    }
    @Test void sameScopeCallsAreSerializedEvenAcrossToolInstances() throws Exception {
        AtomicInteger active = new AtomicInteger(); AtomicInteger maximum = new AtomicInteger();
        CountDownLatch entered = new CountDownLatch(1); CountDownLatch release = new CountDownLatch(1);
        Runner runner = (req, cb) -> {
            maximum.accumulateAndGet(active.incrementAndGet(), Math::max); entered.countDown();
            try { assertTrue(release.await(5, TimeUnit.SECONDS)); }
            catch (InterruptedException e) { throw new AssertionError(e); }
            active.decrementAndGet(); return JSON.createObjectNode().put("ok", true);
        };
        DpiaWorkbenchTools first = new DpiaWorkbenchTools(runner, pluginRoot, dataRoot, Map.of()); first.setHost(host.proxy);
        DpiaWorkbenchTools second = new DpiaWorkbenchTools(runner, pluginRoot, dataRoot, Map.of()); second.setHost(host.proxy);
        try (ExecutorService pool = Executors.newFixedThreadPool(2)) {
            Future<String> a = pool.submit(() -> first.dpia_workbench_action("list", "{}")); assertTrue(entered.await(5, TimeUnit.SECONDS));
            CountDownLatch secondStarted = new CountDownLatch(1);
            Future<String> b = pool.submit(() -> { secondStarted.countDown(); return second.dpia_workbench_action("create", "{}"); });
            assertTrue(secondStarted.await(5, TimeUnit.SECONDS));
            try {
                assertThrows(TimeoutException.class, () -> b.get(100, TimeUnit.MILLISECONDS)); assertEquals(1, maximum.get());
            } finally { release.countDown(); }
            assertTrue(JSON.readTree(a.get()).path("ok").asBoolean()); assertTrue(JSON.readTree(b.get()).path("ok").asBoolean());
        }
        assertEquals(1, maximum.get());
    }
    @Test void cancellationReachesHostWhileAnAgentTaskStillHoldsTheProjectLock() throws Exception {
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        FakeHost agentHost = new FakeHost();
        agentHost.context = new ToolCall(9L, "conversation", 1L, null);
        Runner runner = (req, callback) -> {
            if ("cancel".equals(req.payload().path("action").asText())) {
                boolean accepted = (boolean) callback.invoke("cancel", JSON.createObjectNode().put("key", "session-1"));
                return JSON.createObjectNode().put("ok", true).set("value",
                        JSON.createObjectNode().put("cancelAcknowledged", accepted).put("running", true));
            }
            entered.countDown();
            try { assertTrue(release.await(5, TimeUnit.SECONDS)); }
            catch (InterruptedException e) { throw new AssertionError(e); }
            return JSON.createObjectNode().put("ok", true);
        };
        DpiaWorkbenchTools agent = new DpiaWorkbenchTools(runner, pluginRoot, dataRoot, Map.of());
        agent.setHost(agentHost.proxy);
        DpiaWorkbenchTools ui = new DpiaWorkbenchTools(runner, pluginRoot, dataRoot, Map.of());
        ui.setHost(host.proxy);
        try (ExecutorService pool = Executors.newFixedThreadPool(2)) {
            Future<String> task = pool.submit(() -> agent.dpia_workbench_task("{}"));
            assertTrue(entered.await(5, TimeUnit.SECONDS));
            try {
                Future<String> cancel = pool.submit(() -> ui.dpia_workbench_action("cancel", "{}"));
                JsonNode receipt = JSON.readTree(cancel.get(1, TimeUnit.SECONDS));
                assertTrue(receipt.path("value").path("cancelAcknowledged").asBoolean());
                assertTrue(receipt.path("value").path("running").asBoolean(), "Acknowledgement must not claim the tool stopped");
                assertEquals("session-1", host.cancel);
                assertFalse(task.isDone(), "The process can still be completing its current tool");
            } finally { release.countDown(); }
            assertTrue(JSON.readTree(task.get(5, TimeUnit.SECONDS)).path("ok").asBoolean());
        }
    }
    void export(Path file, String filename) {
        behavior = (req, cb) -> JSON.createObjectNode().put("ok", true).set("value", JSON.createObjectNode()
            .put("exportPath", file.toString()).put("filename", filename).put("mime", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
    }
    static final class FakeHost {
        ToolCall context = new ToolCall(9L, null, 1L, null);
        boolean allowed = true, missingSession; final Map<String, String> settings = new HashMap<>();
        List<?> submission, ensure, folders; String status, cancel, written; long writtenProject; ConflictPolicy policy;
        final PluginSessions sessions = new PluginSessions() {
            public void authorize() { if (!allowed) throw new SecurityException("secret"); }
            public PluginSession ensure(String key, String title) { ensure = List.of(key, title); return new PluginSession(key, "conversation", false); }
            public PluginSession status(String key) { status = key; if (missingSession) throw new NoSuchElementException(); return new PluginSession(key, "conversation", false); }
            public boolean submit(String key, String requestId, String prompt, List<String> skills) { submission = List.of(key, requestId, prompt, skills); return true; }
            public boolean cancel(String key) { cancel = key; return true; }
        };
        final PluginHost proxy = (PluginHost) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[]{PluginHost.class}, (p, method, args) -> switch (method.getName()) {
            case "call" -> context;
            case "sessions" -> sessions;
            case "settings" -> Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[]{Settings.class}, (s, m, a) -> settings.get((String) a[0]));
            case "files" -> Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[]{com.checkba.plugin.api.Files.class}, (f, m, a) -> {
                if (m.getName().equals("createFolderPath")) { folders = (List<?>) a[1]; return info(5, "导出", true); }
                if (m.getName().equals("write")) { writtenProject = (Long) a[0]; written = new String(((InputStream) a[3]).readAllBytes()); policy = (ConflictPolicy) a[4]; return info(99, "report (2).docx", false); }
                throw new UnsupportedOperationException(m.getName());
            });
            default -> throw new UnsupportedOperationException(method.getName());
        });
        static FileInfo info(long id, String name, boolean folder) { return new FileInfo(id, name, 5L, folder, "docx", 10, "DPIA 工作台/导出/" + name, null, null, null); }
    }
}
