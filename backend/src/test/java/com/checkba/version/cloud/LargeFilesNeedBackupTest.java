// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version.cloud;

import com.checkba.service.mobile.MobileRelayClientService;
import com.checkba.version.ProjectRepoService;
import com.checkba.version.VersionException;
import com.checkba.version.objects.LocalVersionObjectStore.ObjectRef;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * C12 (lane C S2): a case with a 30 MB .mp4 could not be submitted without file cloud backup, and the
 * lawyer got a vanishing generic toast. The refusal now carries kind LARGE_FILES_NEED_BACKUP, names
 * the files and says deleting them won't help; the online status warns before 交稿.
 */
class LargeFilesNeedBackupTest {
    ProjectRepoService repos;
    MobileRelayClientService relay;
    ProjectObjectSyncService sync;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setup() {
        repos = mock(ProjectRepoService.class);
        relay = mock(MobileRelayClientService.class);
        ObjectProvider<MobileRelayClientService> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(relay);
        when(repos.mainBranch()).thenReturn("refs/heads/master");
        when(repos.objectPointersAt(eq(7L), anyString(), eq(true))).thenReturn(List.of(new ObjectRef("a".repeat(64), 30_000_000L)));
        when(repos.objectPointerPaths(eq(7L), anyString(), eq(true), anyInt())).thenReturn(List.of("证据/庭审录像.mp4"));
        when(relay.catalogAccountScope()).thenReturn("scope");
        try {
            org.eclipse.jgit.lib.Repository repo = mock(org.eclipse.jgit.lib.Repository.class);
            org.eclipse.jgit.lib.RefDatabase refs = mock(org.eclipse.jgit.lib.RefDatabase.class);
            when(repo.getRefDatabase()).thenReturn(refs);
            when(refs.getRefsByPrefix(anyString())).thenReturn(List.of());
            when(repos.open(7L)).thenReturn(repo);
        } catch (Exception e) { throw new AssertionError(e); }
        sync = new ProjectObjectSyncService(repos, provider, new ObjectMapper());
    }

    @Test
    void submitWithoutBackupIsAnActionableKindNamingTheFile() {
        doThrow(VersionException.userFacing("generic")).when(relay).requireVersionObjectCloudConsent();
        VersionException e = assertThrows(VersionException.class, () -> sync.upload(7L, "https://t.invalid/git/5.git", "u", "t"));
        assertEquals(VersionException.LARGE_FILES_NEED_BACKUP, e.getKind());
        assertTrue(e.getMessage().contains("庭审录像.mp4"), e.getMessage());
        assertTrue(e.getMessage().contains("删掉这个文件也不行") || e.getMessage().contains("Deleting the file won't help"), e.getMessage());
    }

    @Test
    void statusWarnsBeforeSubmitOnlyWhenBlocked() {
        doThrow(VersionException.userFacing("generic")).when(relay).requireVersionObjectCloudConsent();
        assertEquals(List.of("证据/庭审录像.mp4"), sync.largeFilesBlockingSubmit(7L));
        doNothing().when(relay).requireVersionObjectCloudConsent();
        assertEquals(List.of(), sync.largeFilesBlockingSubmit(7L), "backup on: nothing to warn about");
        when(repos.objectPointersAt(eq(7L), anyString(), eq(true))).thenReturn(List.of());
        doThrow(VersionException.userFacing("generic")).when(relay).requireVersionObjectCloudConsent();
        assertEquals(List.of(), sync.largeFilesBlockingSubmit(7L), "no large files: no warning, no network");
    }
}
