// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.plugin;

import com.checkba.model.entity.AgentInboxItem;
import com.checkba.model.entity.PluginAgentSession;
import com.checkba.repository.*;
import com.checkba.service.*;
import com.checkba.service.ai.*;
import com.checkba.service.ai.skill.SkillProperties;
import com.checkba.service.ai.skill.SkillRegistry;
import com.checkba.service.ai.tools.ToolContext;
import com.checkba.service.evidence.EvidenceAnchorService;
import com.checkba.service.evidence.EvidenceLinkService;
import com.checkba.storage.StorageServiceFactory;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.zip.ZipInputStream;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Reviewed local ZIP loading test, NOT a marketplace/signature acceptance test.
 * Build the standard bundle first; -Ddpia.install.bundle can select another local ZIP.
 * Actual JAR, Node, host SPI, skill registry, inbox and session services; memory repositories
 * and model execution are stubs. All plugin data is confined to a separate JVM's temporary home.
 */
class DpiaPluginInstallationTest {
    @TempDir Path temporary;

    @Test void reviewedBundleLoadsInIsolatedDevelopmentHost() throws Exception {
        Path repo = Path.of("").toAbsolutePath();
        if (repo.getFileName().toString().equals("backend")) repo = repo.getParent();
        String bundle = System.getProperty("dpia.install.bundle");
        Path archive = bundle == null ? repo.resolve("official-plugins/dpia-workbench/dist/dpia-workbench-1.0.0.zip")
                : Path.of(bundle).toAbsolutePath();
        if (bundle == null) assumeTrue(Files.isRegularFile(archive), "Build official-plugins/dpia-workbench first");
        else assertTrue(Files.isRegularFile(archive), "Missing plugin ZIP: " + archive);
        assumeTrue(commandAvailable("node"), "Node.js is required for the real plugin runtime test");
        assumeTrue(commandAvailable("python3"), "Python 3 is required for the upstream case initializer");
        Path home = Files.createDirectory(temporary.resolve("home"));
        Path log = temporary.resolve("installation.log");
        String classpath = System.getProperty("surefire.test.class.path", System.getProperty("java.class.path"));
        ProcessBuilder process = new ProcessBuilder(Path.of(System.getProperty("java.home"), "bin/java").toString(),
                "-Duser.home=" + home, "-cp", classpath, Probe.class.getName(),
                archive.toString(), home.toString())
                .directory(repo.toFile()).redirectErrorStream(true).redirectOutput(log.toFile());
        process.environment().put("HOME", home.toString());
        process.environment().put("XDG_CACHE_HOME", home.resolve("cache").toString());
        process.environment().put("XDG_CONFIG_HOME", home.resolve("config").toString());
        for (String key : List.of("AWD_DPIA_NODE", "AWD_DPIA_PYTHON", "AWD_DPIA_SOFFICE", "NODE_OPTIONS", "PYTHONPATH"))
            process.environment().remove(key);
        Process child = process.start();
        try {
            assertTrue(child.waitFor(120, TimeUnit.SECONDS), "Installation probe timed out");
            String output = Files.readString(log);
            assertEquals(0, child.exitValue(), output);
            assertTrue(output.contains("DPIA_LOCAL_BUNDLE_PASS"), output);
            System.out.println(output.substring(output.indexOf("DPIA_LOCAL_BUNDLE_PASS")));
        } finally {
            child.descendants().forEach(ProcessHandle::destroyForcibly);
            child.destroyForcibly();
        }
    }

    private static boolean commandAvailable(String executable) throws Exception {
        Process process;
        try { process = new ProcessBuilder(executable, "--version").redirectOutput(ProcessBuilder.Redirect.DISCARD)
                .redirectError(ProcessBuilder.Redirect.DISCARD).start(); }
        catch (java.io.IOException unavailable) { return false; }
        try { return process.waitFor(5, TimeUnit.SECONDS) && process.exitValue() == 0; }
        finally { process.destroyForcibly(); }
    }

    public static class Probe {
        private static final ObjectMapper JSON = new ObjectMapper();
        private static final String PLUGIN = "dpia-workbench";
        private static final String OLD_HOST_FIXTURE = "0.64.1";
        private final Map<String, String> settingsData = new HashMap<>();
        private final Map<String, PluginAgentSession> bindings = new HashMap<>();
        private final Map<String, AgentInboxItem> inputs = new LinkedHashMap<>();
        private final SystemSettingService settings = mock(SystemSettingService.class);
        private final ProjectMemberService members = mock(ProjectMemberService.class);
        private final PluginAgentSessionRepository sessions = mock(PluginAgentSessionRepository.class);
        private final AgentInboxItemRepository inboxRepository = mock(AgentInboxItemRepository.class);
        private final AgentOrchestrator modelExecution = mock(AgentOrchestrator.class);
        private ToolRegistry tools;

        public static void main(String[] args) throws Exception { new Probe().run(args); }

        private void run(String[] args) throws Exception {
            Path home = Path.of(args[1]);
            assertEquals(home, Path.of(System.getProperty("user.home")));
            Path pluginsDir = Files.createDirectories(home.resolve("plugins"));
            Path installed = Files.createDirectory(pluginsDir.resolve(PLUGIN));
            // Local reviewed package only. No .awd-dev marker or signature-validation override is used.
            try (var zip = new ZipInputStream(Files.newInputStream(Path.of(args[0])))) {
                for (var entry = zip.getNextEntry(); entry != null; entry = zip.getNextEntry()) {
                    Path target = installed.resolve(entry.getName()).normalize();
                    assertTrue(target.startsWith(installed), "Unsafe ZIP path");
                    if (entry.isDirectory()) Files.createDirectories(target);
                    else { Files.createDirectories(target.getParent()); Files.copy(zip, target); }
                }
            }
            JsonNode manifest = JSON.readTree(installed.resolve("manifest.json").toFile());
            assertEquals(PLUGIN, manifest.path("id").asText());
            for (String required : List.of("runtime/adapter.mjs", "web/index.html", "skill/skill.yml",
                    "runtime/upstream/runner.js", manifest.path("backendJars").get(0).asText()))
                assertTrue(Files.isRegularFile(installed.resolve(required)), required);
            when(settings.get(anyString(), nullable(String.class))).thenAnswer(i ->
                    settingsData.getOrDefault(i.getArgument(0), i.getArgument(1)));
            doAnswer(i -> { settingsData.put(i.getArgument(0), i.getArgument(1)); return null; })
                    .when(settings).set(anyString(), anyString());

            // Fixed compatibility fixture: this older host lacks the new session SPI.
            PluginService released = new PluginService(settings, pluginsDir.toString());
            ReflectionTestUtils.setField(released, "appVersion", OLD_HOST_FIXTURE);
            released.init();
            assertNotNull(released.incompatibleReason(PLUGIN));
            assertFalse(released.isEnabled(PLUGIN));
            assertTrue(released.getPluginTools().isEmpty());
            assertThrows(IllegalStateException.class, () -> released.setEnabled(PLUGIN, true));

            // Explicit, unreleased development-host version; never use the "dev" version bypass.
            settingsData.put(PluginService.DISABLED_KEY, "[\"dpia-workbench\"]");
            PluginService plugins = new PluginService(settings, pluginsDir.toString());
            ReflectionTestUtils.setField(plugins, "appVersion", "0.65.0");
            SkillProperties props = new SkillProperties();
            props.setDir(Files.createDirectory(home.resolve("skills")).toString());
            SkillRegistry skills = new SkillRegistry(props, settings, plugins, null);
            AgentRunStateService states = mock(AgentRunStateService.class);
            wireRepositories();
            AgentInboxService inbox = new AgentInboxService(inboxRepository, mock(SseEmitterService.class), states);
            ConversationIssuanceService issuance = new ConversationIssuanceService(true, false);
            ChatModelFactory models = mock(ChatModelFactory.class);
            PluginAgentSessionService sessionService = new PluginAgentSessionService(sessions, issuance, members,
                    mock(ProjectAiMessageService.class), plugins, skills, inbox, modelExecution, states,
                    mock(AgentRunRecordRepository.class), models);
            PluginHostFactory hosts = new PluginHostFactory(mock(ProjectFileService.class), mock(ProjectFileRepository.class),
                    mock(StorageServiceFactory.class), members, mock(DocumentTextService.class), mock(OcrService.class),
                    mock(TagService.class), mock(TagRepository.class), mock(FileTagService.class), mock(EvidenceLinkService.class),
                    mock(EvidenceAnchorService.class), mock(PluginJobService.class), mock(EditorBridgeService.class), settings,
                    mock(StyleProfileResolver.class), models, mock(AuxModelResolver.class), mock(TokenUsageService.class), JSON);
            hosts.agentSessions = provider(sessionService);
            ReflectionTestUtils.setField(plugins, "pluginHostFactoryProvider", provider(hosts));
            ReflectionTestUtils.setField(plugins, "skillRegistry", skills);
            ClientCapabilityService capabilities = mock(ClientCapabilityService.class);
            when(capabilities.isToolVisible(anyString(), nullable(String.class))).thenReturn(true);
            tools = new ToolRegistry(List.of(), plugins, capabilities);
            ReflectionTestUtils.setField(tools, "pluginHostFactory", hosts);
            ReflectionTestUtils.setField(plugins, "toolRegistry", tools);
            plugins.init(); skills.init(); tools.init();
            assertTrue(plugins.getPluginTools().isEmpty(), "Disabled plugin must not load its JAR");
            plugins.setEnabled(PLUGIN, true);
            var skill = skills.getSkill("dpia-assessment").orElseThrow();
            assertEquals(PLUGIN, skill.getSourcePluginId());
            assertEquals(com.checkba.service.ai.skill.SkillDefinition.ToolPolicy.RESTRICT, skill.getToolPolicy());
            assertEquals(List.of("dpia_workbench_task", "search_web", "browse_url"), skill.getAllowedTools());
            assertTrue(skills.isAvailable(skill), "Enabling plugin must enable its packaged skill");
            Object bean = tools.resolve("dpia_workbench_action").orElseThrow().bean();
            assertEquals(installed.resolve(manifest.path("backendJars").get(0).asText()),
                    Path.of(bean.getClass().getProtectionDomain().getCodeSource().getLocation().toURI()));
            assertNotSame(getClass().getClassLoader(), bean.getClass().getClassLoader());

            when(modelExecution.acceptInboxSubmission(anyString(), eq(false))).thenAnswer(i -> {
                inbox.claim(i.getArgument(0), "stub-model-run", false);
                return "stub-model-run";
            });
            ToolContext panel = new ToolContext(9001L, null, 7001L, null);
            JsonNode created = action("create", Map.of("title", "隔离包验收"), panel);
            String id = created.path("id").asText();
            assertFalse(id.isBlank());
            assertEquals(1, action("list", Map.of(), panel).path("cases").size());
            JsonNode started = action("start", Map.of("id", id, "version", 1, "executionRevision", 0), panel);
            assertEquals("accepted", started.path("phase").asText());
            assertEquals(1, inputs.size());
            AgentInboxItem item = inputs.values().iterator().next();
            assertEquals(7001L, issuance.ownerOf(item.getConversationId()));
            assertEquals(List.of("dpia-assessment"), inbox.requestOf(item).getSkillIds());
            assertEquals("none", inbox.requestOf(item).getClientCapability());
            assertTrue(item.getMessage().contains("dpia_workbench_task"));
            verify(modelExecution).acceptInboxSubmission(item.getId(), false);
            ToolContext agent = new ToolContext(9001L, item.getConversationId(), 7001L, null);
            JsonNode context = task(Map.of("id", id, "operation", "context"), agent);
            String request = context.path("requestId").asText();
            assertEquals(started.path("requestId").asText(), request);
            JsonNode written = task(Map.of("id", id, "operation", "write", "requestId", request,
                    "path", "installation-check.md", "content", "temporary installation evidence"), agent);
            Path saved = Path.of(written.path("path").asText());
            assertTrue(saved.toRealPath().startsWith(home.toRealPath().resolve(".aiworkdeck/plugin-data/dpia-workbench/u7001/p9001")));
            assertEquals("temporary installation evidence", Files.readString(saved));
            JsonNode read = task(Map.of("id", id, "operation", "read", "path", saved.toString()), agent);
            assertEquals("temporary installation evidence", read.path("text").asText());
            assertEquals(0, action("list", Map.of(), new ToolContext(9002L, null, 7001L, null)).path("cases").size());
            assertEquals(0, action("list", Map.of(), new ToolContext(9001L, null, 7002L, null)).path("cases").size());
            var foreign = tools.execute("dpia_workbench_task", JSON.writeValueAsString(Map.of("json",
                    JSON.writeValueAsString(Map.of("id", id, "operation", "context")))),
                    new ToolContext(9001L, "conv-foreign", 7001L, null));
            assertFalse(JSON.readTree(foreign.output()).path("ok").asBoolean(), foreign.output());
            plugins.setEnabled(PLUGIN, false);
            assertTrue(tools.resolve("dpia_workbench_action").isEmpty());
            assertFalse(tools.execute("dpia_workbench_task", "{}", agent).found());
            assertFalse(skills.isAvailable(skill));
            // A retained bean must recheck authorization even if registry dispatch is bypassed.
            hosts.bindCall(panel);
            try {
                String rejected = (String) bean.getClass().getMethod("dpia_workbench_action", String.class, String.class)
                        .invoke(bean, "list", "{}");
                assertFalse(JSON.readTree(rejected).path("ok").asBoolean(), rejected);
            } finally { hosts.clear(); }
            System.out.println("DPIA_LOCAL_BUNDLE_PASS: old-host compatibility fixture " + OLD_HOST_FIXTURE
                    + " rejected; development host 0.65.0 loaded actual JAR/skill; Node create/list/start/task read/write;"
                    + " scoped data and conversation; disable enforced for registry and retained bean. Model and repositories STUBBED."
                    + " Reviewed local ZIP load only; marketplace/signature installation NOT tested.");
        }

        private JsonNode action(String action, Map<String, ?> payload, ToolContext call) throws Exception {
            return invoke("dpia_workbench_action", Map.of("action", action, "json", JSON.writeValueAsString(payload)), call);
        }
        private JsonNode task(Map<String, ?> payload, ToolContext call) throws Exception {
            return invoke("dpia_workbench_task", Map.of("json", JSON.writeValueAsString(payload)), call);
        }
        private JsonNode invoke(String name, Map<String, ?> args, ToolContext call) throws Exception {
            var result = tools.execute(name, JSON.writeValueAsString(args), call);
            assertTrue(result.found(), result.output());
            JsonNode envelope = JSON.readTree(result.output());
            assertTrue(envelope.path("ok").asBoolean(), result.output());
            return envelope.path("value");
        }
        private static <T> ObjectProvider<T> provider(T value) {
            @SuppressWarnings("unchecked") ObjectProvider<T> provider = mock(ObjectProvider.class);
            when(provider.getObject()).thenReturn(value);
            when(provider.getIfAvailable()).thenReturn(value);
            return provider;
        }
        private String scope(String plugin, Long user, Long project, String key) {
            return plugin + ":" + user + ":" + project + ":" + key;
        }
        private void wireRepositories() {
            when(members.hasWritePermission(anyLong(), anyLong())).thenReturn(true);
            when(sessions.findByPluginIdAndUserIdAndProjectIdAndSessionKey(anyString(), anyLong(), anyLong(), anyString()))
                    .thenAnswer(i -> Optional.ofNullable(bindings.get(scope(i.getArgument(0), i.getArgument(1),
                            i.getArgument(2), i.getArgument(3)))));
            when(sessions.saveAndFlush(any())).thenAnswer(i -> {
                PluginAgentSession row = i.getArgument(0);
                bindings.put(scope(row.getPluginId(), row.getUserId(), row.getProjectId(), row.getSessionKey()), row);
                return row;
            });
            when(inboxRepository.saveAndFlush(any())).thenAnswer(i -> save(i.getArgument(0)));
            when(inboxRepository.save(any())).thenAnswer(i -> save(i.getArgument(0)));
            when(inboxRepository.findById(anyString())).thenAnswer(i -> Optional.ofNullable(inputs.get(i.getArgument(0))));
            when(inboxRepository.findConversationIdById(anyString())).thenAnswer(i ->
                    Optional.ofNullable(inputs.get(i.getArgument(0))).map(AgentInboxItem::getConversationId));
            when(inboxRepository.findByConversationIdOrderByPositionAscCreatedAtAsc(anyString()))
                    .thenAnswer(i -> rows(i.getArgument(0), null));
            when(inboxRepository.findByConversationIdAndStateOrderByPositionAscCreatedAtAsc(anyString(), anyString()))
                    .thenAnswer(i -> rows(i.getArgument(0), i.getArgument(1)));
            when(inboxRepository.findByConversationIdAndUserIdAndClientRequestId(anyString(), anyLong(), anyString()))
                    .thenAnswer(i -> inputs.values().stream().filter(row -> Objects.equals(row.getConversationId(), i.getArgument(0))
                            && Objects.equals(row.getUserId(), i.getArgument(1))
                            && Objects.equals(row.getClientRequestId(), i.getArgument(2))).findFirst());
        }
        private AgentInboxItem save(AgentInboxItem row) { inputs.put(row.getId(), row); return row; }
        private List<AgentInboxItem> rows(String conversation, String state) {
            return inputs.values().stream().filter(row -> Objects.equals(conversation, row.getConversationId())
                    && (state == null || state.equals(row.getState()))).toList();
        }
    }
}
