// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;
import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import java.io.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class MobileBackupServiceTest {
    UserRepository users=mock(UserRepository.class);
    MobileFileBackupRepository backups=mock(MobileFileBackupRepository.class);
    MobileProjectDirRepository dirs=mock(MobileProjectDirRepository.class);
    MobileProjectManifestRepository manifests=mock(MobileProjectManifestRepository.class);
    CloudStorageQuotaService quota=mock(CloudStorageQuotaService.class);
    MobileRelayBlobStore blobs=mock(MobileRelayBlobStore.class);
    MobileTransferService transfers=mock(MobileTransferService.class);
    MobileBackupService service=new MobileBackupService(users,backups,dirs,manifests,quota,blobs,transfers,new ObjectMapper());
    User user=new User();
    @BeforeEach void setup() {
        user.setId(1L);when(users.findById(1L)).thenReturn(Optional.of(user));when(users.lockStorageOwner(1L)).thenReturn(Optional.of(user));
        MobileProjectDir dir=new MobileProjectDir();dir.setDeviceId("desktop");dir.setProjectKey("42");
        when(dirs.findByUserIdOrderByUpdatedAtDesc(1L)).thenReturn(List.of(dir));
        when(quota.persistentQuota(1L)).thenReturn(1000L);
    }
    @Test void legacyUserIsUndecidedAndNeverEnabledBySubscription() {
        var state=service.consent(1L);assertEquals(false,state.get("enabled"));assertEquals(false,state.get("decided"));
        assertThrows(IllegalArgumentException.class,()->service.requireEligible(1L));
        verifyNoInteractions(blobs);
    }
    @Test void enablingRequiresExplicitCurrentConsentAndSubscription() {
        assertThrows(IllegalArgumentException.class,()->service.consent(1L,true,null));
        when(quota.persistentQuota(1L)).thenReturn(0L);
        assertThrows(IllegalArgumentException.class,()->service.consent(1L,true,MobileBackupService.CONSENT_VERSION));
        assertFalse(user.isFileCloudBackupEnabled());
        var declined=service.consent(1L,false,MobileBackupService.CONSENT_VERSION);
        assertEquals(true,declined.get("decided"));assertEquals(false,declined.get("enabled"));
    }
    @Test void unsupportedNeverReachesStorageOrBillingAndUsesActualManifestName() throws Exception {
        user.setFileCloudBackupEnabled(true);
        assertThrows(IllegalArgumentException.class,()->service.put(1L,"desktop","42","2",UUID.randomUUID().toString(),
                "secret.zip","secret.zip",null,"a".repeat(64),new ByteArrayInputStream(new byte[2]),2));
        MobileProjectManifest manifest=new MobileProjectManifest();
        manifest.setPayloadJson("{\"files\":[{\"id\":\"2\",\"name\":\"actual.zip\",\"size\":2}]}");
        when(manifests.findByUserIdAndDeviceIdAndProjectKey(1L,"desktop","42")).thenReturn(Optional.of(manifest));
        assertThrows(IllegalArgumentException.class,()->service.pull(1L,"desktop","42","2",UUID.randomUUID().toString()));
        verifyNoInteractions(blobs,transfers);
        verify(quota,never()).requirePersistentCapacity(anyLong(),anyLong());
    }
    @Test void previewUsesManifestSizeAndDoesNotChangeGeneralTransfers() {
        MobileProjectManifest manifest=new MobileProjectManifest();
        manifest.setPayloadJson("{\"files\":[{\"id\":\"2\",\"name\":\"actual.pdf\",\"size\":42}]}");
        when(manifests.findByUserIdAndDeviceIdAndProjectKey(1L,"desktop","42")).thenReturn(Optional.of(manifest));
        String request=UUID.randomUUID().toString();service.pull(1L,"desktop","42","2",request);
        verify(transfers).pull(1L,"desktop","42","2","actual.pdf",42,request,true);
    }
    @Test void hashMismatchDeletesNewBlobAndNeverSavesMetadata() throws Exception {
        user.setFileCloudBackupEnabled(true);
        when(blobs.putPersistent(eq(1L),anyString(),any(),eq(2L))).thenAnswer(inv -> {
            ((InputStream)inv.getArgument(2)).readAllBytes();return new MobileRelayBlobStore.StoredBlob("new-blob",2);
        });
        assertThrows(IllegalArgumentException.class,()->service.put(1L,"desktop","42","2",UUID.randomUUID().toString(),
                "sample.pdf","sample.pdf",null,"a".repeat(64),new ByteArrayInputStream(new byte[2]),2));
        verify(blobs).deleteQuietly("new-blob");
        verify(backups).save(argThat(MobileFileBackup::isPendingDeletion));
        verify(backups).delete(argThat(MobileFileBackup::isPendingDeletion));
    }
    @Test void revokeKeepsFailedPhysicalDeletionForRetryAndImmediatelyDeniesReads() {
        user.setFileCloudBackupEnabled(true);MobileFileBackup row=new MobileFileBackup();row.setId(9L);row.setUserId(1L);row.setStoragePath("backup-object");
        when(backups.findByUserId(1L)).thenReturn(List.of(row));
        service.consent(1L,false,MobileBackupService.CONSENT_VERSION);
        assertTrue(row.isPendingDeletion());assertThrows(IllegalArgumentException.class,()->service.requireEligible(1L));
        when(backups.findByPendingDeletionTrue()).thenReturn(List.of(row));when(backups.findById(9L)).thenReturn(Optional.of(row));
        when(blobs.exists("backup-object")).thenReturn(true);service.cleanDeleted();verify(backups,never()).delete(row);
        when(blobs.exists("backup-object")).thenReturn(false);service.cleanDeleted();verify(backups).delete(row);
    }
    @Test void revocationSucceedsEvenWhenSubscriptionCannotBeVerified() {
        user.setFileCloudBackupEnabled(true);
        when(quota.persistentQuota(1L)).thenThrow(new MobileBillingFailureException(MobileBillingKind.UNAVAILABLE,"offline"));
        var result=service.consent(1L,false,MobileBackupService.CONSENT_VERSION);
        assertEquals(false,result.get("enabled"));assertEquals(false,result.get("subscriptionAvailable"));
        verify(users).save(user);
    }
    @Test void exhaustedQuotaDoesNotReadOrCreateAnyBackupObject() {
        user.setFileCloudBackupEnabled(true);
        doThrow(new IllegalArgumentException("quota")).when(quota).requirePersistentCapacity(1L,2);
        assertThrows(IllegalArgumentException.class,()->service.put(1L,"desktop","42","2",UUID.randomUUID().toString(),
                "sample.pdf","sample.pdf",null,"a".repeat(64),new ByteArrayInputStream(new byte[2]),2));
        verifyNoInteractions(blobs);
    }

    @Test void rollbackAndPartialWriteKeepDeletionReceiptsWhenStorageIsUnavailable() throws Exception {
        user.setFileCloudBackupEnabled(true);
        byte[] bytes={1,2};
        String sha=java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes));
        when(blobs.putPersistent(eq(1L),anyString(),any(),eq(2L))).thenAnswer(inv -> {
            ((InputStream)inv.getArgument(2)).readAllBytes();return new MobileRelayBlobStore.StoredBlob("new-blob",2);
        });
        when(blobs.exists("new-blob")).thenThrow(new IllegalStateException("object storage unavailable"));
        org.springframework.transaction.support.TransactionSynchronizationManager.initSynchronization();
        try {
            service.put(1L,"desktop","42","2",UUID.randomUUID().toString(),"sample.pdf","sample.pdf",null,sha,new ByteArrayInputStream(bytes),2);
            for(var callback:org.springframework.transaction.support.TransactionSynchronizationManager.getSynchronizations())
                callback.afterCompletion(org.springframework.transaction.support.TransactionSynchronization.STATUS_ROLLED_BACK);
        } finally { org.springframework.transaction.support.TransactionSynchronizationManager.clearSynchronization(); }
        verify(backups).save(argThat(MobileFileBackup::isPendingDeletion));
        verify(backups,never()).delete(any());
        reset(backups);
        when(blobs.putPersistent(eq(1L),anyString(),any(),eq(2L))).thenThrow(
                new MobileRelayBlobStore.PersistentWriteException(new MobileRelayBlobStore.StoredBlob("new-blob",1),new IOException("partial")));
        assertThrows(MobileRelayBlobStore.PersistentWriteException.class,()->service.put(1L,"desktop","42","2",UUID.randomUUID().toString(),
                "sample.pdf","sample.pdf",null,sha,new ByteArrayInputStream(bytes),2));
        verify(backups).save(argThat(row -> row.isPendingDeletion() && row.getSize()==1));
    }

    @Test void supportedTypesAreAnExplicitPreviewAllowlist() {
        for(String extension:List.of("jpg","jpeg","png","gif","webp","heic","heif","bmp","tif","tiff","docx","pptx","xlsx","pdf","m4a","mp3","wav","aac","caf","aif","aiff","mp4","mov","m4v"))
            assertTrue(MobilePreviewPolicy.supports("fixture."+extension.toUpperCase(Locale.ROOT)));
        for(String name:List.of("file.zip","file.exe","file.doc","file.xls","file.ppt","file.txt","file.md","noextension","file.pdf.zip"))
            assertFalse(MobilePreviewPolicy.supports(name),name);
    }
}
