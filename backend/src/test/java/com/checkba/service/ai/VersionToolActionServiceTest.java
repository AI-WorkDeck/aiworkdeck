// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import com.checkba.controller.CloudController;
import com.checkba.model.entity.ProjectAiMessage;
import com.checkba.repository.ProjectAiMessageRepository;
import com.checkba.service.ProjectAiMessageService;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.ai.context.ProjectContextHolder;
import com.checkba.service.telemetry.TelemetryService;
import com.checkba.version.ProjectRepoService;
import com.checkba.version.VersionController;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import org.springframework.http.ResponseEntity;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class VersionToolActionServiceTest {
    final ObjectMapper mapper = new ObjectMapper();
    final SseEmitterService sse = mock(SseEmitterService.class);
    final EditorBridgeService bridge = spy(new EditorBridgeService(sse, mapper, mock(TelemetryService.class)));
    final ProjectMemberService members = mock(ProjectMemberService.class);
    final ProjectAiMessageService messages = mock(ProjectAiMessageService.class);
    final ProjectAiMessageRepository messageRepository = mock(ProjectAiMessageRepository.class);
    final VersionController versions = mock(VersionController.class);
    final CloudController cloud = mock(CloudController.class);
    final ProjectRepoService repos = mock(ProjectRepoService.class);
    final VersionToolActionService service = new VersionToolActionService(bridge, sse, members, messages,
            messageRepository, versions, cloud, repos, mapper);
    final BlockingQueue<Map<String, Object>> sent = new LinkedBlockingQueue<>();
    final ExecutorService pool = Executors.newCachedThreadPool();
    final AtomicLong epoch = new AtomicLong(1);

    @BeforeEach void setup() throws Exception {
        when(messages.canUseConversation("conv", 7L)).thenReturn(true);
        when(members.hasReadPermission(1L, 7L)).thenReturn(true);
        when(members.hasWritePermission(1L, 7L)).thenReturn(true);
        when(messageRepository.findFirstByConversationId("conv")).thenReturn(Optional.empty());
        when(sse.currentEpoch("conv")).thenAnswer(i -> epoch.get());
        when(versions.statusForUser(1L, 7L)).thenReturn(ok(Map.of("enabled", true, "working", false)));
        bridge.clearForNewRun("conv");
        doAnswer(i -> { sent.add(mapper.readValue(i.getArgument(2, String.class), new TypeReference<>() {})); return null; })
                .when(sse).send(eq("conv"), eq("client_action"), anyString());
        doAnswer(i -> { i.getArgument(1, Runnable.class).run(); return null; })
                .when(versions).withVersionLock(eq(1L), any(Runnable.class));
    }
    @AfterEach void cleanup() { bridge.cancelPendingActions("conv"); pool.shutdownNow(); ProjectContextHolder.clear(); }
    void context() { ProjectContextHolder.setProjectId("1"); ProjectContextHolder.setUserId(7L);
        ProjectContextHolder.setConversationId("conv"); bridge.setCurrentConversationId("conv"); }
    Future<Map<String, Object>> start(String op, Map<String, String> args) {
        return pool.submit(() -> { context(); try { return service.request(op, args); }
            finally { ProjectContextHolder.clear(); bridge.clearCurrentConversationId(); } });
    }
    Map<String, Object> command() throws Exception { Map<String, Object> c = sent.poll(5, TimeUnit.SECONDS); assertNotNull(c); return c; }
    String id(Map<String, Object> c) { return (String) ((Map<?, ?>) c.get("params")).get("operationId"); }
    void ack(Map<String, Object> c, boolean merged) { bridge.completeEditorAction((String)c.get("requestId"), "conv", true,
            Map.of("operationId", id(c), "success", true, "hostReloaded", true, "autoMerged", merged), null); }
    static ResponseEntity<Map<String, Object>> ok(Map<String, Object> data) { return ResponseEntity.ok(Map.of("code", 0, "data", data)); }
    @SuppressWarnings("unchecked") Map<String, Object> result(Map<String, Object> state) { return (Map<String, Object>) state.get("result"); }

    @Test void readUsesTrustedProjectAndRejectsMissingOrCrossProjectContext() {
        assertThrows(IllegalArgumentException.class, () -> service.read("status", null, null, false));
        context(); assertEquals(true, service.read("status", null, null, false).get("enabled"));
        ProjectAiMessage message = new ProjectAiMessage(); message.setUserId(7L); message.setProjectId(2L);
        when(messageRepository.findFirstByConversationId("conv")).thenReturn(Optional.of(message));
        assertThrows(IllegalArgumentException.class, () -> service.read("status", null, null, false));
        verify(versions, times(1)).statusForUser(anyLong(), anyLong());
    }
    @Test void readOnlyCanInspectButCannotPrepareAndClientsCannotInspect() {
        context(); when(members.hasWritePermission(1L, 7L)).thenReturn(false);
        assertEquals(true, service.read("status", null, null, false).get("enabled"));
        assertThrows(IllegalArgumentException.class, () -> service.request("commit", Map.of()));
        when(members.isClient(1L, 7L)).thenReturn(true);
        assertThrows(IllegalArgumentException.class, () -> service.read("status", null, null, false));
        assertTrue(sent.isEmpty());
    }
    @Test void historyCapsLimitAndRestoreRejectsMovingRef() {
        context(); when(versions.historyForUser(1L, 100, "cursor", null, null, null, null, null, true, 7L))
                .thenReturn(ok(Map.of("entries", List.of())));
        assertEquals(List.of(), service.read("history", 500, "cursor", true).get("entries"));
        assertEquals("INVALID_VERSION", service.request("restore", Map.of("ref", "HEAD")).get("code"));
        assertTrue(sent.isEmpty());
    }

    @Test void changesUsesTrustedContextAndOnlyFullHistoryShas() {
        context(); when(members.hasWritePermission(1L, 7L)).thenReturn(false);
        when(versions.changesForUser(1L, null, null, 7L)).thenReturn(ok(Map.of("scope", "working", "changes", List.of())));
        assertEquals("working", service.changes(null, null).get("scope"));
        String from = "a".repeat(40), to = "b".repeat(40);
        when(versions.changesForUser(1L, from, to, 7L)).thenReturn(ok(Map.of("scope", "compare")));
        assertEquals("compare", service.changes(from, to).get("scope"));
        for (String ref : List.of("HEAD", "main", "abc123", ""))
            assertEquals("INVALID_VERSION", service.changes(null, ref).get("code"));
        assertEquals("INVALID_VERSION", service.changes(from, null).get("code"));
        verify(versions, times(2)).changesForUser(anyLong(), nullable(String.class), nullable(String.class), anyLong());
        ProjectContextHolder.setProjectId("2");
        assertThrows(IllegalArgumentException.class, () -> service.changes(null, null));
        assertTrue(sent.isEmpty(), "Read-only inspection never requests saves or mutations");
    }
    @Test void ticketBindsUserConversationAndArgumentsAndRechecksPermission() throws Exception {
        Future<?> tool = start("commit", Map.of("title", "Pinned title")); Map<String, Object> c = command();
        assertThrows(IllegalArgumentException.class, () -> service.execute(id(c), "conv", 8L, "s"));
        assertThrows(IllegalArgumentException.class, () -> service.state(id(c), "other", 7L));
        assertThrows(IllegalArgumentException.class, () -> service.execute("forged", "conv", 7L, "s"));
        when(members.hasWritePermission(1L, 7L)).thenReturn(false);
        assertThrows(IllegalArgumentException.class, () -> service.execute(id(c), "conv", 7L, "s"));
        verify(versions, never()).endSession(anyLong(), anyMap(), any());
        bridge.cancelPendingActions("conv"); tool.get(5, TimeUnit.SECONDS);
    }
    @Test void stopOrNewConnectionBeforeExecuteCannotWrite() throws Exception {
        Future<?> first = start("commit", Map.of()); Map<String, Object> c = command();
        bridge.cancelPendingActions("conv"); first.get(5, TimeUnit.SECONDS);
        assertEquals("cancelled", service.execute(id(c), "conv", 7L, "s").get("status"));
        assertEquals(false, service.state(id(c), "conv", 7L).get("canContinue"));
        bridge.clearForNewRun("conv"); Future<?> second = start("pull", Map.of()); c = command();
        epoch.incrementAndGet();
        assertEquals("cancelled", service.execute(id(c), "conv", 7L, "s").get("status"));
        ack(c, false); second.get(5, TimeUnit.SECONDS);
        verifyNoInteractions(cloud); verify(versions, never()).endSession(anyLong(), anyMap(), any());
    }
    @Test void timeoutFinallyInvalidatesUnstartedTicket() throws Exception {
        String[] id = new String[1];
        doAnswer(i -> { id[0] = (String)((Map<?, ?>) i.getArgument(1)).get("operationId");
            return "{\"error\":\"timeout\",\"outcomeUnknown\":true}"; })
                .when(bridge).executeEditorCommand(eq("project_version_action"), anyMap());
        context(); assertEquals("ACTION_CANCELLED", service.request("commit", Map.of()).get("code"));
        assertEquals("cancelled", service.execute(id[0], "conv", 7L, "s").get("status"));
        verify(versions, never()).endSession(anyLong(), anyMap(), any());
    }
    @Test void concurrentAndRetriedExecuteUseOneStoredResultEvenAfterStop() throws Exception {
        CountDownLatch entered = new CountDownLatch(1), finish = new CountDownLatch(1);
        when(versions.endSession(1L, Map.of("title", "Pinned"), "s")).thenAnswer(i -> {
            entered.countDown(); assertTrue(finish.await(5, TimeUnit.SECONDS)); return ok(Map.of("sha", "abc", "notice", "")); });
        Future<Map<String, Object>> tool = start("commit", Map.of("title", "Pinned")); Map<String, Object> c = command();
        Future<Map<String, Object>> execute = pool.submit(() -> service.execute(id(c), "conv", 7L, "s"));
        assertTrue(entered.await(5, TimeUnit.SECONDS));
        assertEquals("executing", service.execute(id(c), "conv", 7L, "s").get("status"));
        bridge.cancelPendingActions("conv"); assertEquals(true, tool.get(5, TimeUnit.SECONDS).get("outcomeUnknown"));
        finish.countDown(); Map<String, Object> done = execute.get(5, TimeUnit.SECONDS);
        assertEquals("succeeded", done.get("status")); assertEquals("abc", result(done).get("sha"));
        epoch.incrementAndGet(); assertEquals(done, service.execute(id(c), "conv", 7L, "s"));
        assertEquals(done, service.state(id(c), "conv", 7L));
        verify(versions, times(1)).endSession(1L, Map.of("title", "Pinned"), "s");
    }
    @Test void commitNoticeAndDraftShaAreReportedWithoutInventingCloudSuccess() throws Exception {
        for (Map<String, Object> response : List.of(Map.<String,Object>of("sha", "", "notice", "No changes"), Map.<String,Object>of("sha", "draft-sha", "notice", ""))) {
            when(versions.endSession(1L, Map.of(), "s")).thenReturn(ok(response));
            Future<Map<String, Object>> tool = start("commit", Map.of()); Map<String, Object> c = command();
            Map<String, Object> state = service.execute(id(c), "conv", 7L, "s"); ack(c, false);
            Map<String, Object> answer = tool.get(5, TimeUnit.SECONDS);
            assertEquals(response.get("sha"), answer.get("sha")); assertEquals(response.get("notice"), answer.get("notice"));
            assertEquals(result(state), answer); assertFalse(answer.containsKey("landedOnCloud"));
        }
    }
    @Test void pullConflictIsNotSuccessAndAutoMergeRequiresBothAncestries() throws Exception {
        Map<String,Object> conflict = Map.of("mainlineTip", "local", "cloudTip", "remote", "conflictingPaths", List.of("a.docx"));
        when(cloud.update(1L, "s")).thenReturn(ok(Map.of("status", "CONFLICT", "conflict", conflict, "affectedFileIds", List.of())));
        for (boolean ancestors : List.of(false, true)) {
            when(repos.isAncestor(1L, "local", "HEAD")).thenReturn(ancestors);
            when(repos.isAncestor(1L, "remote", "HEAD")).thenReturn(ancestors);
            Future<Map<String, Object>> tool = start("pull", Map.of()); Map<String, Object> c = command();
            Map<String,Object> state = service.execute(id(c), "conv", 7L, "s");
            assertEquals(true, state.get("canContinue"));
            assertEquals(false, result(state).get("success")); assertEquals(conflict, result(state).get("conflict"));
            ack(c, true); Map<String,Object> answer = tool.get(5, TimeUnit.SECONDS);
            assertEquals(ancestors, answer.get("success")); assertEquals(!ancestors, answer.containsKey("error"));
            assertEquals(false, service.state(id(c), "conv", 7L).get("canContinue"));
        }
    }
    @Test void restoreUsesBoundShaAndReturnsAffectedFiles() throws Exception {
        String sha = "a".repeat(40);
        when(versions.revert(1L, Map.of("ref", sha), "s")).thenReturn(ok(Map.of("sha", "restored", "affectedFileIds", List.of(3L))));
        Future<Map<String, Object>> tool = start("restore", Map.of("ref", sha)); Map<String, Object> c = command();
        service.execute(id(c), "conv", 7L, "s"); ack(c, false);
        assertEquals(List.of(3L), tool.get(5, TimeUnit.SECONDS).get("affectedFileIds"));
        verify(versions).revert(1L, Map.of("ref", sha), "s");
    }
    @Test void internalErrorAndForgedAckCannotClaimSuccess() throws Exception {
        when(cloud.update(1L, "s")).thenThrow(new RuntimeException("secret filesystem path"));
        Future<Map<String, Object>> tool = start("pull", Map.of()); Map<String, Object> c = command();
        Map<String,Object> state = service.execute(id(c), "conv", 7L, "s");
        assertEquals("failed", state.get("status")); assertFalse(state.toString().contains("secret"));
        ack(c, false); assertEquals(false, tool.get(5, TimeUnit.SECONDS).get("success"));
        Future<Map<String, Object>> forged = start("commit", Map.of()); c = command(); ack(c, false);
        assertEquals("ACTION_CANCELLED", forged.get(5, TimeUnit.SECONDS).get("code"));
        verify(versions, never()).endSession(anyLong(), anyMap(), any());
    }

    @Test void saveFailureRetainsReasonAndNeverExecutes() throws Exception {
        Future<Map<String,Object>> tool = start("commit", Map.of()); Map<String,Object> c = command();
        bridge.completeEditorAction((String)c.get("requestId"), "conv", true,
                Map.of("operationId", id(c), "success", false, "code", "saveBeforeCommitFailed"), null);
        Map<String,Object> answer = tool.get(5, TimeUnit.SECONDS);
        assertEquals("saveBeforeCommitFailed", answer.get("code")); assertEquals(false, answer.get("outcomeUnknown"));
        assertEquals("cancelled", service.execute(id(c), "conv", 7L, "s").get("status"));
        verify(versions, never()).endSession(anyLong(), anyMap(), any());
    }

    @Test void businessFailureAndReloadFailureRemainDistinct() throws Exception {
        when(cloud.update(1L, "s")).thenReturn(ok(Map.of("status", "OFFLINE")));
        Future<Map<String,Object>> tool = start("pull", Map.of()); Map<String,Object> c = command();
        service.execute(id(c), "conv", 7L, "s");
        bridge.completeEditorAction((String)c.get("requestId"), "conv", true,
                Map.of("operationId", id(c), "success", false, "hostReloaded", true), null);
        assertEquals("CLOUD_UNAVAILABLE", tool.get(5, TimeUnit.SECONDS).get("code"));
        when(versions.endSession(1L, Map.of(), "s")).thenReturn(ok(Map.of("sha", "done", "notice", "")));
        tool = start("commit", Map.of()); c = command(); service.execute(id(c), "conv", 7L, "s");
        bridge.completeEditorAction((String)c.get("requestId"), "conv", true,
                Map.of("operationId", id(c), "success", false, "hostReloaded", false, "code", "aiReloadFailed"), null);
        Map<String,Object> answer = tool.get(5, TimeUnit.SECONDS);
        assertEquals("HOST_NOT_CONFIRMED", answer.get("code"));
        assertEquals("done", ((Map<?,?>)answer.get("operationResult")).get("sha"));
    }

    record Pending(Future<Map<String,Object>> tool, Map<String,Object> command, Map<String,Object> conflict) {}
    Map<String,Object> conflict(String operation, String kind, String decision, String state) {
        Map<String,Object> conflict = new LinkedHashMap<>();
        conflict.put("mainlineTip", "main"); conflict.put("commit".equals(operation) ? "sessionTip" : "cloudTip", "other");
        if ("commit".equals(operation)) conflict.put("sessionId", 11);
        conflict.put("conflictingPaths", List.of("a.docx"));
        conflict.put("documentMerges", List.of(Map.of("path", "a.docx", "kind", kind, "decision", decision, "state", state)));
        return conflict;
    }
    void currentConflict(String operation, Map<String,Object> conflict) {
        when(versions.statusForUser(1L,7L)).thenReturn(ok(Map.of("enabled", true,
                "commit".equals(operation) ? "sessionEndConflict" : "cloudConflict", conflict)));
    }
    Pending startConflict(String operation, String kind) throws Exception {
        Map<String,Object> conflict=conflict(operation,kind,"AUTO","PENDING");
        if ("commit".equals(operation)) when(versions.endSession(1L,Map.of(),"s")).thenReturn(ok(Map.of("conflict",conflict,"sha","")));
        else when(cloud.update(1L,"s")).thenReturn(ok(Map.of("status","CONFLICT","conflict",conflict)));
        currentConflict(operation,conflict);
        Future<Map<String,Object>> tool=start(operation,Map.of()); Map<String,Object> command=command();
        assertEquals("failed",service.execute(id(command),"conv",7L,"s").get("status"));
        return new Pending(tool,command,conflict);
    }
    Map<String,Object> step(Pending p, String id, String kind, String path) {
        return service.mergeStep(id(p.command()),"conv",7L,"s",id,kind,path,null);
    }
    @SuppressWarnings("unchecked") Map<String,Object> lastStep(Map<String,Object> state) { return (Map<String,Object>)state.get("lastStep"); }

    @Test void continuationRejectsForeignPathsChangedIdentityManualRowsAndPrematureFinalize() throws Exception {
        Pending p=startConflict("commit","XLSX"); String operationId=id(p.command());
        Map<String,Object> invalid=step(p,"null-kind",null,"a.docx");
        assertEquals("failed",lastStep(invalid).get("status")); assertEquals(true,lastStep(invalid).get("writeSettled"));
        assertEquals(lastStep(invalid),lastStep(service.state(operationId,"conv",7L,"null-kind")));
        assertEquals(lastStep(invalid),lastStep(step(p,"null-kind","structured","a.docx")));
        assertThrows(IllegalArgumentException.class, () -> service.mergeStep(operationId,"conv",8L,"s","spoof","structured","a.docx",null));
        assertThrows(IllegalArgumentException.class, () -> service.mergeStep(operationId,"wrong",7L,"s","spoof","structured","a.docx",null));
        assertEquals("failed",lastStep(step(p,"foreign","structured","other.docx")).get("status"));
        Map<String,Object> changed=new LinkedHashMap<>(p.conflict()); changed.put("mainlineTip","new-main"); currentConflict("commit",changed);
        assertEquals("failed",lastStep(step(p,"stale","structured","a.docx")).get("status"));
        currentConflict("commit",conflict("commit","XLSX","MANUAL","PENDING"));
        assertEquals("failed",lastStep(step(p,"manual","structured","a.docx")).get("status"));
        currentConflict("commit",p.conflict());
        assertEquals("failed",lastStep(step(p,"early","finalize",null)).get("status"));
        assertEquals("failed",lastStep(step(p,"foreign","structured","a.docx")).get("status"),"Rejected step IDs cannot be repurposed");
        verify(versions,never()).mergeResolveStructured(anyLong(),anyMap(),any());
        verify(versions,never()).resolveSessionEnd(anyLong(),anyMap(),any());
        ack(p.command(),false); p.tool().get(5,TimeUnit.SECONDS);
    }

    @Test void continuationUsesOneClaimAndRetainsItsOwnReceiptAfterStopAndConnectionChange() throws Exception {
        Pending p=startConflict("commit","XLSX"); String operationId=id(p.command());
        CountDownLatch entered=new CountDownLatch(1), finish=new CountDownLatch(1);
        when(versions.mergeResolveStructured(eq(1L),anyMap(),eq("s"))).thenAnswer(i->{
            entered.countDown(); assertTrue(finish.await(5,TimeUnit.SECONDS)); return ok(Map.of("path","a.docx","state","MERGED")); });
        Future<Map<String,Object>> running=pool.submit(()->step(p,"one","structured","a.docx"));
        assertTrue(entered.await(5,TimeUnit.SECONDS));
        Map<String,Object> active=service.state(operationId,"conv",7L,"one");
        assertEquals("executing",active.get("status")); assertEquals("executing",lastStep(active).get("status"));
        assertEquals(false,lastStep(active).get("writeSettled"));
        assertEquals("executing",lastStep(step(p,"one","structured","a.docx")).get("status"));
        bridge.cancelPendingActions("conv"); assertEquals(true,p.tool().get(5,TimeUnit.SECONDS).get("outcomeUnknown"));
        epoch.incrementAndGet(); finish.countDown(); Map<String,Object> done=running.get(5,TimeUnit.SECONDS);
        assertEquals("failed",done.get("status"),"The original conflict is still waiting for finalize");
        assertEquals("succeeded",lastStep(done).get("status")); assertEquals(true,lastStep(done).get("writeSettled"));
        assertEquals(done,service.state(operationId,"conv",7L,"one"));
        assertEquals("failed",lastStep(step(p,"after-stop","finalize",null)).get("status"));
        assertEquals("succeeded",lastStep(service.state(operationId,"conv",7L,"one")).get("status"),"New steps do not replace an earlier receipt");
        assertFalse(service.state(operationId,"conv",7L,"never-seen").containsKey("lastStep"));
        verify(versions,times(1)).mergeResolveStructured(eq(1L),anyMap(),eq("s"));
        verify(versions,never()).resolveSessionEnd(anyLong(),anyMap(),any());
    }

    @Test void cancelledWhileWaitingForRepositoryLockCannotStartWritingLater() throws Exception {
        Pending p=startConflict("commit","XLSX");
        CountDownLatch queued=new CountDownLatch(1), unlock=new CountDownLatch(1);
        doAnswer(i->{queued.countDown();assertTrue(unlock.await(5,TimeUnit.SECONDS));i.getArgument(1,Runnable.class).run();return null;})
                .when(versions).withVersionLock(eq(1L),any(Runnable.class));
        Future<Map<String,Object>> running=pool.submit(()->step(p,"queued","structured","a.docx"));
        assertTrue(queued.await(5,TimeUnit.SECONDS));bridge.cancelPendingActions("conv");p.tool().get(5,TimeUnit.SECONDS);unlock.countDown();
        Map<String,Object> done=running.get(5,TimeUnit.SECONDS);
        assertEquals("failed",lastStep(done).get("status")); assertEquals(true,lastStep(done).get("writeSettled"));
        verify(versions,never()).mergeResolveStructured(anyLong(),anyMap(),any());
    }

    @Test void autoDocxUsesPinnedRefsAndFinalizeOnlyMergedPathsUpdatesTheOriginalResult() throws Exception {
        Pending p=startConflict("commit","DOCX");
        var file=new org.springframework.mock.web.MockMultipartFile("file","a.docx","application/octet-stream",new byte[]{1});
        when(versions.mergeResolveFile(1L,"a.docx","auto","[]","session-end","main","other",file,"s"))
                .thenReturn(ok(Map.of("state","MERGED","path","a.docx")));
        Map<String,Object> written=service.mergeStep(id(p.command()),"conv",7L,"s","docx","file","a.docx",file);
        assertEquals("succeeded",lastStep(written).get("status")); assertNotNull(result(written).get("conflict"));
        currentConflict("commit",conflict("commit","DOCX","AUTO","MERGED"));
        when(versions.resolveSessionEnd(1L,Map.of("sessionId",11,"resolutions",Map.of("a.docx","MERGED")),"s"))
                .thenReturn(ok(Map.of("sha","merged-sha")));
        Map<String,Object> done=step(p,"finish","finalize",null);
        assertEquals("succeeded",done.get("status")); assertEquals("merged-sha",result(done).get("sha")); assertFalse(result(done).containsKey("conflict"));
        assertEquals(done,step(p,"finish","finalize",null));
        ack(p.command(),true);assertEquals("merged-sha",p.tool().get(5,TimeUnit.SECONDS).get("sha"));
        verify(versions,times(1)).resolveSessionEnd(anyLong(),anyMap(),any());
    }

    @Test void cloudFinalizePreservesUnsyncedOutcomeAndFailedWritesStillHaveSettledReceipts() throws Exception {
        Pending p=startConflict("pull","XLSX");
        when(versions.mergeResolveStructured(eq(1L),anyMap(),eq("s"))).thenThrow(new RuntimeException("secret path"));
        Map<String,Object> failed=step(p,"failed-write","structured","a.docx");
        assertEquals(true,lastStep(failed).get("writeSettled"));
        assertEquals(true,((Map<?,?>)lastStep(failed).get("result")).get("outcomeUnknown"));
        assertFalse(failed.toString().contains("secret"));
        currentConflict("pull",conflict("pull","XLSX","AUTO","MERGED"));
        when(cloud.resolve(1L,Map.of("resolutions",Map.of("a.docx","MERGED")),"s"))
                .thenReturn(ok(Map.of("status","UPDATED","affectedFileIds",List.of(3),"landedOnCloud",false)));
        Map<String,Object> done=step(p,"cloud-finish","finalize",null);
        assertEquals("succeeded",done.get("status")); assertEquals(false,result(done).get("landedOnCloud"));
        ack(p.command(),true); assertEquals(false,p.tool().get(5,TimeUnit.SECONDS).get("landedOnCloud"));
    }
}
