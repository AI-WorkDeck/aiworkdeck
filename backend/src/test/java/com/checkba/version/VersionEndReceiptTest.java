// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version;

import com.checkba.controller.AuthController;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.UserService;
import com.checkba.service.telemetry.TelemetryService;
import org.junit.jupiter.api.Test;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class VersionEndReceiptTest {
    private final WorkSessionService sessions = mock(WorkSessionService.class);
    private final ProjectMemberService members = mock(ProjectMemberService.class);
    private final VersionController controller = controller();
    private VersionController controller() {
        return new VersionController(mock(ProjectRepoService.class), sessions, members, mock(UserService.class),
                null, mock(TelemetryService.class), null);
    }
    private void permit(long user, long project) {
        when(members.hasReadPermission(project, user)).thenReturn(true);
        when(members.hasWritePermission(project, user)).thenReturn(true);
    }
    private String requestId() {
        permit(1, 7);
        when(sessions.exitStatus(7L)).thenReturn(new WorkSessionService.ExitStatus(true, true, 1, null, false));
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("session")).thenReturn(1L);
            Map<?, ?> data = (Map<?, ?>) controller.exitStatus(7L, "session").getBody().get("data");
            String epoch = (String) data.get("receiptEpoch");
            String[] opaqueParts = epoch.split(":");
            assertEquals(2, opaqueParts.length);
            for (String part : opaqueParts) assertDoesNotThrow(() -> UUID.fromString(part));
            return epoch + ":" + UUID.randomUUID();
        }
    }
    private Map<?, ?> submit(VersionController target, long user, long project, Map<String, String> body) {
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("session")).thenReturn(user);
            return (Map<?, ?>) target.endSession(project, body, "session").getBody().get("data");
        }
    }
    @Test
    void duplicateAndLateOriginalReplayOneReceiptAndPreserveConflict() {
        String id = requestId();
        var conflict = new WorkSessionService.SessionEndConflict(2, "title", java.util.List.of("file.txt"), "main", "work");
        when(sessions.endSession(eq(7L), eq(1L), anyString(), eq("title")))
                .thenReturn(new WorkSessionService.SessionEndResult(null, null, conflict));
        var body = Map.of("requestId", id, "title", "title");
        Map<?, ?> first = submit(controller, 1, 7, body);
        assertEquals("SUCCEEDED", first.get("receiptState"));
        assertNotNull(first.get("conflict"));
        assertEquals(first, submit(controller, 1, 7, body));
        verify(sessions, times(1)).endSession(eq(7L), eq(1L), anyString(), eq("title"));
        assertThrows(VersionException.class, () -> submit(controller, 1, 7, Map.of("requestId", id, "title", "changed")));
    }
    @Test
    void runningDuplicateDoesNotAcquireAnotherWriteAndCompletesAfterOriginal() throws Exception {
        String id = requestId();
        var body = Map.of("requestId", id, "title", "");
        var entered = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        when(sessions.endSession(eq(7L), eq(1L), anyString(), eq(""))).thenAnswer(invocation -> {
            entered.countDown();
            assertTrue(release.await(5, TimeUnit.SECONDS));
            return new WorkSessionService.SessionEndResult("sha", null, null);
        });
        var original = new java.util.concurrent.FutureTask<>(() -> submit(controller, 1, 7, body));
        Thread thread = new Thread(original); thread.start();
        try {
            assertTrue(entered.await(3, TimeUnit.SECONDS));
            assertEquals("RUNNING", submit(controller, 1, 7, body).get("receiptState"));
        } finally { release.countDown(); }
        assertEquals("SUCCEEDED", original.get(3, TimeUnit.SECONDS).get("receiptState"));
        assertEquals("sha", submit(controller, 1, 7, body).get("sha"));
        verify(sessions, times(1)).endSession(eq(7L), eq(1L), anyString(), eq(""));
    }
    @Test
    void failureIsTerminalAndNeverRetriesMutation() {
        String id = requestId();
        when(sessions.endSession(eq(7L), eq(1L), anyString(), eq("")))
                .thenThrow(VersionException.userFacing("Expected synthetic failure"));
        var body = Map.of("requestId", id, "title", "");
        Map<?, ?> failed = submit(controller, 1, 7, body);
        assertEquals("FAILED", failed.get("receiptState"));
        assertEquals("Expected synthetic failure", failed.get("message"));
        assertEquals(failed, submit(controller, 1, 7, body));
        verify(sessions, times(1)).endSession(eq(7L), eq(1L), anyString(), eq(""));
    }
    @Test
    void restartReturnsUnknownAndPermissionsAndIdentityScopeRemainEnforced() {
        String id = requestId();
        var body = Map.of("requestId", id, "title", "");
        assertEquals("UNKNOWN", submit(controller(), 1, 7, body).get("receiptState"));
        verify(sessions, never()).endSession(anyLong(), anyLong(), anyString(), any());
        // Cross-scope retries must not claim an ID even before its original POST arrives.
        permit(2, 7); permit(1, 8);
        assertEquals("UNKNOWN", submit(controller, 2, 7, body).get("receiptState"));
        assertEquals("UNKNOWN", submit(controller, 1, 8, body).get("receiptState"));
        verify(sessions, never()).endSession(anyLong(), anyLong(), anyString(), any());
        when(sessions.endSession(anyLong(), anyLong(), anyString(), eq("")))
                .thenReturn(new WorkSessionService.SessionEndResult("sha", null, null));
        submit(controller, 1, 7, body);
        assertThrows(IllegalArgumentException.class, () -> submit(controller, 3, 7, body));
        assertEquals(Map.of("receiptState", "UNKNOWN"), submit(controller, 2, 7, body));
        assertEquals(Map.of("receiptState", "UNKNOWN"), submit(controller, 1, 8, body));
        verify(sessions, times(1)).endSession(anyLong(), anyLong(), anyString(), eq(""));
    }
    @Test
    void legacyCallerStillReceivesOriginalShape() {
        permit(1, 7);
        when(sessions.endSession(eq(7L), eq(1L), anyString(), eq("")))
                .thenReturn(new WorkSessionService.SessionEndResult("sha", null, null));
        Map<?, ?> result = submit(controller, 1, 7, Map.of("title", ""));
        assertEquals("sha", result.get("sha"));
        assertFalse(result.containsKey("receiptState"));
    }
}
