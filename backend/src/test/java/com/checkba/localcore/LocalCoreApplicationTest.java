// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.localcore;

import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.ai.AutoTaggingService;
import com.checkba.service.ai.ProjectRagService;
import com.checkba.version.LocalCoreVersionHandoff;
import com.checkba.version.VersionAuthorResolver;
import com.checkba.version.WorkSessionService;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.IOException;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.RejectedExecutionException;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class LocalCoreApplicationTest {
    private final LocalCoreApplication application = new LocalCoreApplication();
    private final WorkSessionService sessions = mock(WorkSessionService.class);
    private final LocalCoreVersionHandoff versions = mock(LocalCoreVersionHandoff.class);
    private final LocalCoreContentService content = mock(LocalCoreContentService.class);
    private final ProjectFileRepository files = mock(ProjectFileRepository.class);
    private final VersionAuthorResolver authors = mock(VersionAuthorResolver.class);
    private final LocalCoreContentService.SaveRequest request = new LocalCoreContentService.SaveRequest(
            UUID.randomUUID(), 7, 9, "owned-file", 11, "a".repeat(64), 3);
    private final LocalCoreContentService.SaveReceipt receipt = new LocalCoreContentService.SaveReceipt(
            request, "b".repeat(64), 3, "2026-10-25T00:00:00Z");

    private void prepare() {
        var file = new ProjectFile();
        file.setId(9L); file.setProjectId(7L); file.setUid("owned-file"); file.setIsDeleted(false);
        when(files.findById(9L)).thenReturn(Optional.of(file));
        when(authors.resolve(7L, 11L)).thenReturn(new VersionAuthorResolver.AuthorIdent("Owned author", "owned@example.test"));
        when(sessions.withFileContentWriteLock(eq(7L), any())).thenAnswer(call -> ((Supplier<?>) call.getArgument(1)).get());
        ReflectionTestUtils.setField(application, "content", content);
        ReflectionTestUtils.setField(application, "sessions", sessions);
        ReflectionTestUtils.setField(application, "versions", versions);
        ReflectionTestUtils.setField(application, "effects", new LocalCoreContentEffects(files, sessions, authors,
                mock(ProjectRagService.class), mock(AutoTaggingService.class), task -> {
                    throw new RejectedExecutionException("Owned optional task rejection");
                }));
    }

    @Test void receiptRetriesFailedVersionHandoffWithoutRepublishingBytes() throws Exception {
        prepare();
        var publication = mock(LocalCoreContentService.Publication.class);
        when(publication.run()).thenReturn(receipt);
        doThrow(new IOException("Owned handoff failure")).doNothing().when(versions).handoffProject(content, 7L);
        var failure = assertThrows(java.lang.reflect.UndeclaredThrowableException.class,
                () -> ReflectionTestUtils.invokeMethod(application, "publish", 7L, publication));
        assertInstanceOf(IOException.class, failure.getCause());
        ReflectionTestUtils.invokeMethod(application, "confirmReceipt", receipt);
        ReflectionTestUtils.invokeMethod(application, "confirmReceipt", receipt);
        verify(publication, times(1)).run();
        verify(versions, times(2)).handoffProject(content, 7L);
        verify(sessions, times(1)).onChangeSignal(7L, 11L, "Owned author");
    }

    @Test void failedSignalIsNotMarkedNotifiedAndReceiptRetriesItWithTheRealAuthor() throws Exception {
        prepare();
        var publication = mock(LocalCoreContentService.Publication.class);
        when(publication.run()).thenReturn(receipt);
        doThrow(new IllegalStateException("Owned signal failure")).doNothing()
                .when(sessions).onChangeSignal(7L, 11L, "Owned author");
        assertThrows(IllegalStateException.class, () -> ReflectionTestUtils.invokeMethod(application, "publish", 7L, publication));
        assertEquals(1, ((Map<?, ?>) ReflectionTestUtils.getField(application, "savedBeforeReady")).size());
        ReflectionTestUtils.invokeMethod(application, "confirmReceipt", receipt);
        ReflectionTestUtils.invokeMethod(application, "confirmReceipt", receipt);
        verify(publication, times(1)).run();
        verify(sessions, times(2)).onChangeSignal(7L, 11L, "Owned author");
        assertTrue(((Map<?, ?>) ReflectionTestUtils.getField(application, "savedBeforeReady")).isEmpty());
    }

    @Test void earlyAcknowledgedSaveKeepsItsNotificationUntilEffectsBecomeAvailable() {
        ReflectionTestUtils.invokeMethod(application, "notifySaved", request);
        assertEquals(1, ((Map<?, ?>) ReflectionTestUtils.getField(application, "savedBeforeReady")).size());
        prepare();
        ReflectionTestUtils.invokeMethod(application, "notifySaved", request);
        ReflectionTestUtils.invokeMethod(application, "notifySaved", request);
        verify(sessions, times(1)).onChangeSignal(7L, 11L, "Owned author");
        assertTrue(((Map<?, ?>) ReflectionTestUtils.getField(application, "savedBeforeReady")).isEmpty());
    }

    @Test void aReusedFileIdNeverNotifiesTheReplacement() {
        prepare();
        var replacement = new ProjectFile();
        replacement.setId(9L); replacement.setProjectId(7L); replacement.setUid("replacement");
        when(files.findById(9L)).thenReturn(Optional.of(replacement));
        ReflectionTestUtils.invokeMethod(application, "notifySaved", request);
        verify(sessions, never()).onChangeSignal(anyLong(), any(), any());
    }
}
