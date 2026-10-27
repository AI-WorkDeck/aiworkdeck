// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;

import com.checkba.model.entity.User;
import com.checkba.model.entity.ProjectFile;
import com.checkba.model.entity.Project;
import com.checkba.storage.StorageService;
import com.checkba.storage.StorageServiceFactory;
import java.util.List;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.repository.ProjectRepository;
import com.checkba.repository.UserRepository;
import org.junit.jupiter.api.Test;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class CloudStorageQuotaServiceTest {
    private final MobileBillingService billing = mock(MobileBillingService.class);
    private final ProjectFileRepository files = mock(ProjectFileRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final ProjectRepository projects = mock(ProjectRepository.class);
    private final StorageService storage = mock(StorageService.class);
    private final StorageServiceFactory factory = mock(StorageServiceFactory.class);
    private final CloudStorageQuotaService service = new CloudStorageQuotaService(billing, files,
            projects, users, factory, true);

    @org.junit.jupiter.api.BeforeEach void storage() {
        when(factory.getStorageService()).thenReturn(storage);
        Project project = new Project(); project.setId(1L); project.setUserId(7L);
        when(projects.findById(1L)).thenReturn(Optional.of(project));
    }

    private ProjectFile physical(long declared, long actual, boolean deleted) {
        ProjectFile f = new ProjectFile();
        f.setId(1L); f.setProjectId(1L); f.setFilePath("projects/1/a.pdf");
        f.setFileSize(declared); f.setIsDeleted(deleted); f.setIsFolder(false);
        when(files.findCloudFilesByOwner(7L)).thenReturn(List.of(f));
        when(storage.exists(f.getFilePath())).thenReturn(true);
        when(storage.getSize(f.getFilePath())).thenReturn(actual);
        return f;
    }

    private void pro(Instant expiresAt) {
        when(users.lockStorageOwner(7L)).thenReturn(Optional.of(new User()));
        when(billing.balance(7L)).thenReturn(new MobileBillingClient.BalanceResult(0, "CNY", "paid",
                Map.of("active", true, "expiresAt", expiresAt.toString(), "cloudStorageBytes", CloudStorageQuotaService.PRO_BYTES)));
    }

    @Test void paidCloudSpaceIsIndependentOfWalletAndCountsAllOwnedProjects() {
        pro(Instant.now().plusSeconds(60));
        physical(1, CloudStorageQuotaService.PRO_BYTES - 10, false);
        assertDoesNotThrow(() -> service.requirePersistentCapacity(7L, 10));
        assertThrows(IllegalArgumentException.class, () -> service.requirePersistentCapacity(7L, 11));
        verify(users, times(2)).lockStorageOwner(7L);
    }

    @Test void expiryBlocksNewBytesButDoesNotBlockReadsOrShrink() {
        pro(Instant.now().minusSeconds(1));
        physical(1, 42, false);
        assertEquals(0L, service.persistentQuota(7L));
        assertEquals(42L, service.usage(7L).get("persistentUsedBytes"));
        assertThrows(IllegalArgumentException.class, () -> service.requirePersistentCapacity(7L, 1));
        assertDoesNotThrow(() -> service.requirePersistentCapacity(7L, 0));
    }

    @Test void unavailableEntitlementsRemainUnknownAndNeverGrantStorage() {
        when(billing.balance(7L)).thenThrow(new MobileBillingFailureException(MobileBillingKind.UNAVAILABLE, "offline"));
        assertNull(service.usage(7L).get("persistentQuotaBytes"));
        assertEquals(false, service.usage(7L).get("persistentQuotaAvailable"));
        assertThrows(MobileBillingFailureException.class, () -> service.persistentQuota(7L));
    }

    @Test void unconnectedAccountHasNoPersistentSpace() {
        when(billing.balance(7L)).thenThrow(new MobileBillingFailureException(MobileBillingKind.NOT_CONNECTED, "none"));
        assertEquals(0L, service.persistentQuota(7L));
        verify(billing).balance(7L);
    }
    @Test void softDeletionDoesNotReleaseBytesAndMetadataCannotUnderreport() {
        pro(Instant.now().plusSeconds(60));
        ProjectFile f = physical(0, CloudStorageQuotaService.PRO_BYTES, true);
        assertEquals(CloudStorageQuotaService.PRO_BYTES, service.usage(7L).get("persistentUsedBytes"));
        assertThrows(IllegalArgumentException.class, () -> service.requireProjectCapacity(1L, 1));
        when(storage.exists(f.getFilePath())).thenReturn(false);
        assertEquals(0L, service.usage(7L).get("persistentUsedBytes"));
    }

    @Test void appendChecksEveryIncomingByteAgainstFreshPhysicalSize() {
        pro(Instant.now().plusSeconds(60));
        ProjectFile f = physical(0, CloudStorageQuotaService.PRO_BYTES - 10, false);
        java.util.concurrent.atomic.AtomicBoolean locked = new java.util.concurrent.atomic.AtomicBoolean();
        when(users.lockStorageOwner(7L)).thenAnswer(call -> { locked.set(true); return Optional.of(new User()); });
        when(storage.exists(f.getFilePath())).thenAnswer(call -> { assertTrue(locked.get(), "size must be read after owner lock"); return true; });
        assertThrows(IllegalArgumentException.class, () -> service.requireFileCapacity(f, 11, true));
        assertDoesNotThrow(() -> service.requireFileCapacity(f, 5, false)); // replacing with a smaller file
    }

    @Test void rollbackCleanupPreservesAReplacementCreatedAfterTheOldTransaction() {
        when(users.lockStorageOwner(7L)).thenReturn(Optional.of(new User()));
        var replacement = physical(1, 1, false);
        when(files.findByProjectId(1L)).thenReturn(List.of(replacement));
        service.removeRolledBackFile(1L, replacement.getFilePath());
        verify(users).lockStorageOwner(7L);
        verify(storage, never()).delete(anyString());
        when(files.findByProjectId(1L)).thenReturn(List.of());
        service.removeRolledBackFile(1L, replacement.getFilePath());
        verify(storage).delete(replacement.getFilePath());
    }

    @Test void independentDeploymentsDoNotAcquireLocksOrQuerySubscription() {
        CloudStorageQuotaService local = new CloudStorageQuotaService(billing, files, projects, users, factory, false);
        ProjectFile file = new ProjectFile(); file.setProjectId(1L);
        local.requireProjectCapacity(1L, Long.MAX_VALUE);
        local.requireFileCapacity(file, Long.MAX_VALUE, true);
        verifyNoInteractions(billing, users);
    }


    @Test void historicalObjectsAndPendingDeletionStayInPersistentQuota() {
        pro(Instant.now().plusSeconds(60));
        var objects=mock(com.checkba.repository.MobileVersionObjectRepository.class);
        var current=new com.checkba.model.entity.MobileVersionObject();current.setSize(12);
        var pending=new com.checkba.model.entity.MobileVersionObject();pending.setSize(23);pending.setPendingDeletion(true);
        when(objects.findByUserId(7L)).thenReturn(List.of(current,pending));
        org.springframework.test.util.ReflectionTestUtils.setField(service,"versionObjects",objects);
        assertEquals(35L,service.usage(7L).get("persistentUsedBytes"));
        physical(0,CloudStorageQuotaService.PRO_BYTES-35,false);
        assertThrows(IllegalArgumentException.class,()->service.requirePersistentCapacity(7L,1));
    }

    @Test void collaborationObjectsAndIncompleteTransfersCountEvenWithoutFileRows() throws Exception {
        pro(Instant.now().plusSeconds(60));
        var provider=mock(org.springframework.beans.factory.ObjectProvider.class);
        var store=mock(com.checkba.version.objects.LocalVersionObjectStore.class);
        when(provider.getIfAvailable()).thenReturn(store);
        org.springframework.test.util.ReflectionTestUtils.setField(service,"localVersionObjects",provider);
        Project project=new Project();project.setId(42L);project.setUserId(7L);
        when(projects.findByUserIdOrderByCreatedAtDesc(7L)).thenReturn(List.of(project));
        when(store.usageBytes(42L)).thenReturn(CloudStorageQuotaService.PRO_BYTES);
        assertThrows(IllegalArgumentException.class,()->service.requirePersistentCapacity(7L,1));
        when(store.usageBytes(42L)).thenThrow(new java.io.IOException("unreadable"));
        assertThrows(IllegalStateException.class,()->service.requirePersistentCapacity(7L,1));
    }
}
