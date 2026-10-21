// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ocr;

import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.*;
import com.checkba.service.ai.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static org.junit.jupiter.api.Assertions.*;

class OcrRoutingServiceTest {
    @TempDir Path tmp;
    SystemSettingService settings = mock(SystemSettingService.class);
    ProjectAiMessageService messages = mock(ProjectAiMessageService.class);
    ProjectFileAccessService access = mock(ProjectFileAccessService.class);
    ProjectFileRepository files = mock(ProjectFileRepository.class);
    EditorBridgeService bridge = mock(EditorBridgeService.class);
    Clock clock = mock(Clock.class);
    Map<String, String> saved = new HashMap<>();
    Map<String, Object> payload;
    ProjectFile file;
    Path source;
    OcrRoutingService routing;

    @BeforeEach void setup() throws Exception {
        source = Files.writeString(tmp.resolve("synthetic.pdf"), "synthetic");
        file = new ProjectFile(); file.setId(7L); file.setProjectId(3L);
        when(clock.instant()).thenReturn(Instant.parse("2026-10-21T00:00:00Z"));
        when(settings.get(anyString(), any())).thenAnswer(i -> saved.getOrDefault(i.getArgument(0), i.getArgument(1)));
        doAnswer(i -> { saved.putAll(i.getArgument(0)); return null; }).when(settings).setMany(anyMap());
        when(messages.isConversationOwnedBy("conv", 1L)).thenReturn(true);
        when(bridge.getCurrentConversationId()).thenReturn("conv");
        when(files.findById(7L)).thenReturn(Optional.of(file));
        doAnswer(i -> { payload = new HashMap<>(i.getArgument(0)); return null; }).when(bridge).sendOcrRouteRequiredAction(anyMap());
        routing = new OcrRoutingService(settings, messages, access, files, bridge, clock);
    }
    OcrRoutingService.Route route() { return PlatformAiUserScope.call(1L, () -> { try { return routing.route(file, source); } catch (Exception e) { throw new RuntimeException(e); } }); }
    void offer(boolean local) { PlatformAiUserScope.run(1L, () -> { try { routing.offer(file, source, "synthetic reason", local); } catch (Exception e) { throw new RuntimeException(e); } }); }
    void choose(String choice, boolean remember) { routing.choose(1L, "conv", (String)payload.get("decisionId"), choice, remember, OcrRoutingService.VERSION); }

    @Test void defaultsAndOtherCloudKeysNeverImplyOcrConsent() {
        saved.put("external.ocr.provider", "platform"); saved.put("ai.crossBorder.consentAt", "today");
        assertEquals(OcrRoutingService.Route.ASK, route());
        routing.savePreference(1L, "cloud", OcrRoutingService.VERSION);
        assertEquals(OcrRoutingService.Route.CLOUD, route());
        assertEquals("ask", routing.preference(2L).get("choice"));
        saved.put("user.1.ocr.fallback.version", "old");
        assertEquals(OcrRoutingService.Route.ASK, route());
    }
    @Test void choiceIsBoundToUserConversationAndCurrentFilePermission() {
        offer(true); String id = (String)payload.get("decisionId");
        assertThrows(IllegalArgumentException.class, () -> routing.choose(2L, "conv", id, "cloud", false, OcrRoutingService.VERSION));
        assertThrows(IllegalArgumentException.class, () -> routing.choose(1L, "other", id, "cloud", false, OcrRoutingService.VERSION));
        doThrow(new IllegalArgumentException("revoked")).when(access).requireRead(file, 1L);
        assertThrows(IllegalArgumentException.class, () -> choose("cloud", false));
    }
    @Test void expiredDecisionCannotAuthorizeCloud() {
        offer(true);
        when(clock.instant()).thenReturn(Instant.parse("2026-10-21T01:00:00Z"));
        assertThrows(IllegalArgumentException.class, () -> choose("cloud", false));
        assertEquals(OcrRoutingService.Route.ASK, route());
    }
    @Test void oneTimeChoiceIsIdempotentAndNotAStoredPreference() throws Exception {
        offer(true); choose("cloud", false); choose("cloud", false);
        assertEquals(OcrRoutingService.Route.CLOUD, route());
        assertEquals("ask", routing.preference(1L).get("choice"));
        assertThrows(IllegalArgumentException.class, () -> choose("local", false));
        Files.writeString(source, "different synthetic content");
        assertEquals(OcrRoutingService.Route.ASK, route());
    }
    @Test void cloudFailureRequiresAnotherUserChoiceEvenWhenCloudWasRemembered() {
        routing.savePreference(1L, "cloud", OcrRoutingService.VERSION);
        offer(true);
        assertEquals(OcrRoutingService.Route.ASK, route());
        choose("local", false);
        assertEquals(OcrRoutingService.Route.LOCAL, route());
    }
    @Test void rememberedChoiceAndWithdrawalAreExplicitAndUserScoped() {
        offer(true); choose("cloud", true);
        assertEquals("cloud", routing.preference(1L).get("choice"));
        assertEquals("ask", routing.preference(2L).get("choice"));
        assertThrows(IllegalArgumentException.class, () -> routing.savePreference(1L, "cloud", "old"));
        routing.savePreference(1L, "ask", OcrRoutingService.VERSION);
        assertEquals("ask", routing.preference(1L).get("choice"));
    }
    @Test void unsupportedLocalRuntimeDoesNotStartAnInstallationLoop() {
        offer(false);
        assertThrows(IllegalArgumentException.class, () -> choose("local", false));
        choose("cloud", false);
        assertEquals(OcrRoutingService.Route.CLOUD, route());
    }
    @Test void movedFileAndMissingUserCannotBeAuthorized() {
        offer(true); file.setProjectId(5L);
        assertThrows(IllegalArgumentException.class, () -> choose("cloud", false));
        assertThrows(Exception.class, () -> routing.route(file, source));
    }
    @Test void eachUploadRechecksSavedConsentAndFreshFilePermission() throws Exception {
        routing.savePreference(1L, "cloud", OcrRoutingService.VERSION);
        ProjectFile fresh = new ProjectFile(); fresh.setId(7L); fresh.setProjectId(3L);
        when(files.findById(7L)).thenReturn(Optional.of(fresh));
        PlatformAiUserScope.run(1L, () -> {
            assertDoesNotThrow(() -> routing.requireCloudPermission(file, source));
            verify(access).requireRead(fresh, 1L);
            routing.savePreference(1L, "ask", OcrRoutingService.VERSION);
            assertThrows(IllegalStateException.class, () -> routing.requireCloudPermission(file, source));
            routing.savePreference(1L, "cloud", OcrRoutingService.VERSION);
            doThrow(new IllegalArgumentException("revoked access")).when(access).requireRead(fresh, 1L);
            assertThrows(IllegalArgumentException.class, () -> routing.requireCloudPermission(file, source));
        });
    }
    @Test void cancelBeforeLateChoiceCannotAuthorizeAndDoesNotEraseRememberedPreference() {
        routing.savePreference(1L, "cloud", OcrRoutingService.VERSION);
        offer(true);
        String id = (String)payload.get("decisionId");
        routing.cancel(1L, "conv", id);
        assertThrows(IllegalArgumentException.class, () -> choose("cloud", false));
        assertEquals(OcrRoutingService.Route.CANCELLED, route());
        assertEquals("cloud", routing.preference(1L).get("choice"));
        routing.cancel(1L, "conv", id); // idempotent
    }
    @Test void cancellationAfterChoiceBlocksAllRemainingUploadsAndRejectsOtherUser() {
        offer(true); choose("cloud", false);
        String id = (String)payload.get("decisionId");
        assertThrows(IllegalArgumentException.class, () -> routing.cancel(2L, "conv", id));
        routing.cancel(1L, "conv", id);
        assertEquals(OcrRoutingService.Route.CANCELLED, route());
        PlatformAiUserScope.run(1L, () -> assertThrows(IllegalStateException.class, () -> routing.requireCloudPermission(file, source)));
    }
    @Test void newRunMustAskAgainInsteadOfReusingCancelledCloudPreference() {
        routing.savePreference(1L, "cloud", OcrRoutingService.VERSION);
        try {
            com.checkba.service.ai.tools.ToolContextHolder.set(new com.checkba.service.ai.tools.ToolContext(3L, "conv", 1L, null, List.of(), Set.of(), "original", Set.of()));
            offer(true); choose("cloud", false);
            com.checkba.service.ai.tools.ToolContextHolder.set(new com.checkba.service.ai.tools.ToolContext(3L, "conv", 1L, null, List.of(), Set.of(), "resumed", Set.of()));
            assertEquals(OcrRoutingService.Route.CLOUD, route());
            String oldId = (String)payload.get("decisionId");
            routing.cancel(1L, "conv", oldId);
            assertEquals(OcrRoutingService.Route.CANCELLED, route());
            com.checkba.service.ai.tools.ToolContextHolder.set(new com.checkba.service.ai.tools.ToolContext(3L, "conv", 1L, null, List.of(), Set.of(), "new-user-task", Set.of()));
            assertEquals(OcrRoutingService.Route.ASK, route());
            offer(true);
            assertNotEquals(oldId, payload.get("decisionId"));
            assertThrows(IllegalArgumentException.class, () -> routing.choose(1L, "conv", oldId, "cloud", false, OcrRoutingService.VERSION));
            choose("cloud", false);
            assertEquals(OcrRoutingService.Route.CLOUD, route());
            com.checkba.service.ai.tools.ToolContextHolder.set(new com.checkba.service.ai.tools.ToolContext(3L, "conv", 1L, null, List.of(), Set.of(), "resumed", Set.of()));
            assertEquals(OcrRoutingService.Route.CANCELLED, route(), "A new choice cannot revive the cancelled old run");
        } finally { com.checkba.service.ai.tools.ToolContextHolder.clear(); }
    }

    @Test void lateCancellationStillBlocksSupersededRunAfterSourceChanges() throws Exception {
        routing.savePreference(1L, "cloud", OcrRoutingService.VERSION);
        try {
            com.checkba.service.ai.tools.ToolContextHolder.set(new com.checkba.service.ai.tools.ToolContext(3L, "conv", 1L, null, List.of(), Set.of(), "old-run", Set.of()));
            offer(true); choose("cloud", false);
            assertEquals(OcrRoutingService.Route.CLOUD, route());
            String oldId = (String) payload.get("decisionId");
            com.checkba.service.ai.tools.ToolContextHolder.set(new com.checkba.service.ai.tools.ToolContext(3L, "conv", 1L, null, List.of(), Set.of(), "new-run", Set.of()));
            offer(true); choose("cloud", false);
            routing.cancel(1L, "conv", oldId);
            assertEquals(OcrRoutingService.Route.CLOUD, route());
            com.checkba.service.ai.tools.ToolContextHolder.set(new com.checkba.service.ai.tools.ToolContext(3L, "conv", 1L, null, List.of(), Set.of(), "old-run", Set.of()));
            Files.writeString(source, "Updated synthetic file");
            assertEquals(OcrRoutingService.Route.CANCELLED, route());
        } finally { com.checkba.service.ai.tools.ToolContextHolder.clear(); }
    }

}
