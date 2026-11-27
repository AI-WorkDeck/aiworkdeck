// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;

import com.checkba.model.entity.Project;
import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.*;
import com.checkba.storage.StorageService;
import com.checkba.storage.StorageServiceFactory;
import com.checkba.version.ProjectRepoService;
import com.checkba.version.cloud.ProjectObjectPlanService;
import com.checkba.version.objects.LocalVersionObjectStore;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * C12 (lane W review): free objects never count towards the owner's storage quota or bill, in either scope,
 * including the server working-copy file the ingest materializes from them; paid storage counts as before.
 */
class CloudFreeObjectQuotaTest {
    static final long MB = 1024 * 1024;
    ProjectFileRepository files = mock(ProjectFileRepository.class);
    ProjectRepository projects = mock(ProjectRepository.class);
    CloudStorageQuotaService quota;
    LocalVersionObjectStore store = mock(LocalVersionObjectStore.class);
    ProjectObjectPlanService plans = mock(ProjectObjectPlanService.class);
    ProjectRepoService repos = mock(ProjectRepoService.class);

    @SuppressWarnings("unchecked")
    static <T> ObjectProvider<T> provider(T value) {
        ObjectProvider<T> p = mock(ObjectProvider.class);
        when(p.getIfAvailable()).thenReturn(value);
        return p;
    }

    static ProjectFile file(String path, long size) {
        ProjectFile f = new ProjectFile();
        f.setProjectId(7L); f.setFilePath(path); f.setFileSize(size); f.setIsDeleted(false);
        return f;
    }

    @BeforeEach void setup() throws Exception {
        StorageServiceFactory storage = mock(StorageServiceFactory.class);
        when(storage.getStorageService()).thenReturn(mock(StorageService.class)); // exists() false: row sizes count
        quota = new CloudStorageQuotaService(mock(MobileBillingService.class), files, projects, mock(UserRepository.class), storage, true);
        ReflectionTestUtils.setField(quota, "localVersionObjects", provider(store));
        ReflectionTestUtils.setField(quota, "objectPlans", provider(plans));
        ReflectionTestUtils.setField(quota, "cloudRepos", provider(repos));
        Project project = new Project(); project.setId(7L); project.setUserId(1L);
        project.setCloudOwnership("PERSONAL"); project.setCloudBillingOwnerId(1L);
        when(projects.findById(7L)).thenReturn(Optional.of(project));
        when(projects.findByUserIdOrderByCreatedAtDesc(1L)).thenReturn(List.of(project));
        // After push + server ingest: the free 30 MB recording is in the object store AND in the working copy.
        when(files.findCloudFilesByOwner(1L)).thenReturn(List.of(file("projects/7/证据/庭审录像.mp4", 30 * MB), file("projects/7/说明.txt", 10)));
        when(store.usageBytes(7L)).thenReturn(30 * MB + 5 * MB); // 30 MB free + 5 MB paid
        when(plans.completedFreeBytes(7L)).thenReturn(30 * MB);
        when(plans.completedFreeShas(7L)).thenReturn(Set.of("a".repeat(64)));
        when(repos.headPathsPointingTo(eq(7L), eq(Set.of("a".repeat(64))))).thenReturn(Set.of("证据/庭审录像.mp4"));
        when(repos.gitDir(7L)).thenReturn(java.nio.file.Files.createTempDirectory("c12-git")); // metered scope: empty git dir
    }

    @Test void aFreeRecordingLeavesUsageUnchangedInBothScopes() {
        long expected = 10 + 5 * MB; // the text file and the paid object only
        assertEquals(expected, quota.usedBytes(1L, false), "subscription scope");
        assertEquals(expected, quota.usedBytes(1L, true), "metered (postpaid) scope");
    }

    @Test void withoutFreeObjectsEverythingCountsAsBefore() {
        when(plans.completedFreeBytes(7L)).thenReturn(0L);
        when(plans.completedFreeShas(7L)).thenReturn(Set.of());
        assertEquals(30 * MB + 10 + 35 * MB, quota.usedBytes(1L, false));
    }
}
