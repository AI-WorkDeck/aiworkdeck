// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version.merge;

import com.checkba.controller.CloudController;
import com.checkba.repository.ProjectAiMessageRepository;
import com.checkba.service.ProjectAiMessageService;
import com.checkba.service.ai.EditorBridgeService;
import com.checkba.service.ai.SseEmitterService;
import com.checkba.service.ai.VersionToolActionService;
import com.checkba.service.ai.context.ProjectContextHolder;
import com.checkba.service.ai.tools.VersionTools;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Real repositories and version controllers; only the acknowledged browser transport is simulated. */
class VersionToolRepositoryIntegrationTest {
    private static final String CONVERSATION = "version-repository-test";
    private final ObjectMapper mapper = new ObjectMapper().findAndRegisterModules();

    @AfterEach
    void clearContext() { ProjectContextHolder.clear(); }

    @SuppressWarnings("unchecked")
    private VersionTools tools(MergeScene scene) {
        return tools(scene, false);
    }

    @SuppressWarnings("unchecked")
    private VersionTools tools(MergeScene scene, boolean autoMerge) {
        var bridge = mock(EditorBridgeService.class);
        var sse = mock(SseEmitterService.class);
        var messages = mock(ProjectAiMessageService.class);
        var repository = mock(ProjectAiMessageRepository.class);
        var token = new Object();
        when(bridge.versionRunToken(CONVERSATION)).thenReturn(token);
        when(bridge.getCurrentConversationId()).thenReturn(CONVERSATION);
        when(sse.currentEpoch(CONVERSATION)).thenReturn(1L);
        when(messages.canUseConversation(CONVERSATION, MergeScene.USER_ID)).thenReturn(true);
        when(repository.findFirstByConversationId(CONVERSATION)).thenReturn(Optional.empty());
        when(bridge.claimVersionAction(eq(CONVERSATION), same(token), any())).thenAnswer(call -> {
            call.<Runnable>getArgument(2).run();
            return true;
        });
        var actions = new VersionToolActionService(bridge, sse, scene.memberService, messages, repository,
                scene.controller, mock(CloudController.class), scene.repoSvc, mapper);
        when(bridge.executeEditorCommand(eq("project_version_action"), anyMap())).thenAnswer(call -> {
            Map<String, Object> params = call.getArgument(1);
            String id = (String) params.get("operationId");
            assertEquals(MergeScene.PROJECT_ID, params.get("projectId"));
            assertEquals(true, actions.state(id, CONVERSATION, MergeScene.USER_ID).get("valid"));
            Map<String, Object> receipt = actions.execute(id, CONVERSATION, MergeScene.USER_ID, MergeScene.SESSION);
            // A lost HTTP receipt can be read without performing the write again.
            assertEquals(receipt, actions.execute(id, CONVERSATION, MergeScene.USER_ID, MergeScene.SESSION));
            if (autoMerge) {
                assertNotNull(((Map<?, ?>) receipt.get("result")).get("conflict"));
                Map<String, Object> file = actions.mergeStep(id, CONVERSATION, MergeScene.USER_ID, MergeScene.SESSION,
                        "merge-file", "structured", "list.xlsx", null);
                assertEquals("succeeded", ((Map<?, ?>) file.get("lastStep")).get("status"), file.toString());
                assertEquals(file, actions.mergeStep(id, CONVERSATION, MergeScene.USER_ID, MergeScene.SESSION,
                        "merge-file", "structured", "list.xlsx", null));
                Map<String, Object> finished = actions.mergeStep(id, CONVERSATION, MergeScene.USER_ID, MergeScene.SESSION,
                        "merge-finish", "finalize", null, null);
                assertEquals("succeeded", finished.get("status"), finished.toString());
            }
            return mapper.writeValueAsString(Map.of("operationId", id, "success", true, "hostReloaded", true));
        });
        ProjectContextHolder.setProjectId(String.valueOf(MergeScene.PROJECT_ID));
        ProjectContextHolder.setUserId(MergeScene.USER_ID);
        ProjectContextHolder.setConversationId(CONVERSATION);
        return new VersionTools(actions, mapper);
    }

    private Map<String, Object> json(String value) throws Exception {
        return mapper.readValue(value, new TypeReference<>() {});
    }

    @Test
    void commitAndRestoreKeepTheCurrentWorkInHistory(@TempDir Path tmp) throws Exception {
        try (MergeScene scene = new MergeScene(tmp)) {
            var tools = tools(scene);
            byte[] initial = "已核定第一版".getBytes(StandardCharsets.UTF_8);
            scene.write("note.txt", initial);
            Map<String, Object> committed = json(tools.version_commit("初稿"));
            assertEquals(true, committed.get("success"), committed.toString());
            String original = (String) committed.get("sha");
            assertTrue(original.matches("[0-9a-f]{40}"));
            assertFalse(scene.sessionSvc.activeSession(MergeScene.PROJECT_ID).isPresent());

            byte[] latest = "恢复前尚未提交的修改".getBytes(StandardCharsets.UTF_8);
            scene.write("note.txt", latest);
            Map<String, Object> restored = json(tools.version_restore(original));
            assertEquals(true, restored.get("success"), restored.toString());
            assertArrayEquals(initial, scene.read("note.txt"));
            assertArrayEquals(latest, scene.repoSvc.readBlobAtCommit(MergeScene.PROJECT_ID, "HEAD^", "note.txt"),
                    "Restoring must preserve the saved work in the preceding history entry");
            assertTrue(scene.repoSvc.isAncestor(MergeScene.PROJECT_ID, original, "HEAD"));
            Map<String, Object> history = json(tools.version_history(20, null, true));
            assertFalse(history.containsKey("error"), history.toString());
            String backup = scene.repoSvc.resolveRef(MergeScene.PROJECT_ID, "HEAD^");
            assertTrue(((java.util.List<?>) history.get("entries")).stream()
                    .anyMatch(entry -> entry instanceof Map<?, ?> row && backup.equals(row.get("sha"))),
                    "The AI must be able to find and restore the saved pre-restore backup too");
        }
    }

    @Test
    void commitOnDraftDoesNotSwitchOrMergeTheDraft(@TempDir Path tmp) throws Exception {
        try (MergeScene scene = new MergeScene(tmp)) {
            scene.write("note.txt", "起点".getBytes(StandardCharsets.UTF_8));
            scene.mainlineWork("起点");
            String main = scene.repoSvc.resolveRef(MergeScene.PROJECT_ID, "HEAD");
            var draft = scene.sessionSvc.createDraft(MergeScene.PROJECT_ID, null, "另一个方案",
                    MergeScene.USER_ID, "测试用户").draft();
            scene.write("note.txt", "稿上的修改".getBytes(StandardCharsets.UTF_8));
            Map<String, Object> committed = json(tools(scene).version_commit("记录稿上的改动"));
            assertEquals(true, committed.get("success"), committed.toString());
            assertEquals(scene.repoSvc.resolveRef(MergeScene.PROJECT_ID, draft.getBranchName()), committed.get("sha"));
            assertEquals(main, scene.repoSvc.resolveRef(MergeScene.PROJECT_ID, scene.repoSvc.mainBranch()));
        }
    }

    @Test
    void commitConflictAutomaticallyMergesThroughTrackedContinuation(@TempDir Path tmp) throws Exception {
        try (MergeScene scene = new MergeScene(tmp)) {
            scene.write("list.xlsx", MergeFixtures.xlsx("Sheet1", Map.of("A1", "甲方", "B1", "100")));
            scene.mainlineWork("起点");
            scene.sessionSvc.onChangeSignal(MergeScene.PROJECT_ID, MergeScene.USER_ID, "测试用户");
            scene.write("list.xlsx", MergeFixtures.xlsx("Sheet1", Map.of("A1", "甲方", "B1", "200")));
            scene.sessionSvc.commitNow(MergeScene.PROJECT_ID, MergeScene.USER_ID, "测试用户", "本地工作");
            String work = scene.sessionSvc.activeSession(MergeScene.PROJECT_ID).orElseThrow().getBranchName();
            scene.repoSvc.checkoutBranch(MergeScene.PROJECT_ID, scene.repoSvc.mainBranch());
            scene.write("list.xlsx", MergeFixtures.xlsx("Sheet1", Map.of("A1", "甲方修改", "B1", "100")));
            scene.repoSvc.commitAll(MergeScene.PROJECT_ID, "同事的修改", "session", null, "同事", "test@example.invalid");
            scene.repoSvc.checkoutBranch(MergeScene.PROJECT_ID, work);

            Map<String, Object> result = json(tools(scene, true).version_commit("合并本次工作"));
            assertEquals(true, result.get("success"), result.toString());
            assertEquals(true, result.get("autoMerged"));
            assertEquals(scene.repoSvc.resolveRef(MergeScene.PROJECT_ID, "HEAD"), result.get("sha"));
            assertFalse(scene.repoSvc.repositoryMerging(MergeScene.PROJECT_ID));
            Map<String, String> cells = XlsxCellReader.read(scene.read("list.xlsx"));
            assertEquals("甲方修改", cells.get("Sheet1!A1"));
            assertEquals("200", cells.get("Sheet1!B1"));
        }
    }
}
