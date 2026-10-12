// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class MobileVersionObjectServiceTest {
    @TempDir Path root;
    UserRepository users=mock(UserRepository.class);
    MobileProjectDirRepository dirs=mock(MobileProjectDirRepository.class);
    MobileVersionObjectRepository repo=mock(MobileVersionObjectRepository.class);
    CloudStorageQuotaService quota=mock(CloudStorageQuotaService.class);
    List<MobileVersionObject> rows=new ArrayList<>();
    User owner=new User();
    MobileRelayBlobStore blobs;
    MobileVersionObjectService service;
    long seq;
    @BeforeEach void setup() {
        owner.setId(1L);owner.setFileCloudBackupEnabled(true);
        when(users.findById(1L)).thenReturn(Optional.of(owner));when(users.lockStorageOwner(1L)).thenReturn(Optional.of(owner));
        when(quota.persistentQuota(1L)).thenReturn(CloudStorageQuotaService.PRO_BYTES);
        var dir=new MobileProjectDir();dir.setDeviceId("device");dir.setProjectKey("42");
        when(dirs.findByUserIdOrderByUpdatedAtDesc(1L)).thenReturn(List.of(dir));
        when(repo.save(any())).thenAnswer(inv->{MobileVersionObject r=inv.getArgument(0);if(r.getId()==null){r.setId(++seq);rows.add(r);}return r;});
        doAnswer(inv->{rows.remove(inv.getArgument(0));return null;}).when(repo).delete(any());
        when(repo.findByUserId(anyLong())).thenAnswer(inv->rows.stream().filter(r->r.getUserId().equals(inv.getArgument(0))).toList());
        when(repo.findById(anyLong())).thenAnswer(inv->rows.stream().filter(r->r.getId().equals(inv.getArgument(0))).findFirst());
        when(repo.findByPendingDeletionTrue()).thenAnswer(inv->rows.stream().filter(MobileVersionObject::isPendingDeletion).toList());
        when(repo.findByUserIdAndDeviceIdAndProjectKeyAndObjectShaOrderByPartIndex(anyLong(),anyString(),anyString(),anyString()))
                .thenAnswer(inv->matching(inv.getArgument(0),inv.getArgument(1),inv.getArgument(2),inv.getArgument(3)));
        when(repo.findByUserIdAndDeviceIdAndProjectKeyAndObjectShaAndPartIndex(anyLong(),anyString(),anyString(),anyString(),anyInt()))
                .thenAnswer(inv->matching(inv.getArgument(0),inv.getArgument(1),inv.getArgument(2),inv.getArgument(3)).stream()
                    .filter(r->r.getPartIndex()==(int)inv.getArgument(4)).findFirst());
        blobs=spy(new MobileRelayLocalBlobStore(root.toString()));
        service=new MobileVersionObjectService(users,dirs,repo,quota,blobs);
    }
    List<MobileVersionObject> matching(Long user,String device,String project,String sha) {
        return rows.stream().filter(r->r.getUserId().equals(user) && r.getDeviceId().equals(device)
                && r.getProjectKey().equals(project) && r.getObjectSha().equals(sha)).sorted(Comparator.comparingInt(MobileVersionObject::getPartIndex)).toList();
    }
    static String hash(byte[] bytes) throws Exception {return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));}
    void part(byte[] all,int index) throws Exception {
        int start=(int)(index*MobileVersionObjectService.PART_BYTES);
        byte[] bytes=Arrays.copyOfRange(all,start,(int)Math.min(all.length,start+MobileVersionObjectService.PART_BYTES));
        service.put(1L,"device","42",hash(all),all.length,index,hash(bytes),new ByteArrayInputStream(bytes),bytes.length);
    }
    @Test void multiPartResumePublishesOnlyAfterCompleteAndPreservesExactBytes() throws Exception {
        byte[] bytes=new byte[(int)MobileVersionObjectService.PART_BYTES+7];new Random(42).nextBytes(bytes);String sha=hash(bytes);
        part(bytes,0);
        assertEquals(List.of(0),service.status(1L,"device","42",sha,bytes.length).get("parts"));
        assertThrows(IllegalArgumentException.class,()->service.complete(1L,"device","42",sha,bytes.length));
        assertThrows(IllegalArgumentException.class,()->service.content(1L,"device","42",sha,0));
        part(bytes,0);assertEquals(1,rows.size()); // idempotency retains one physical object/quota charge
        part(bytes,1);assertEquals(true,service.complete(1L,"device","42",sha,bytes.length).get("complete"));
        ByteArrayOutputStream restored=new ByteArrayOutputStream();
        for(int index=0;index<2;index++) try(var stream=service.content(1L,"device","42",sha,index).stream()){stream.transferTo(restored);}
        assertArrayEquals(bytes,restored.toByteArray());
        verify(quota,times(1)).requirePersistentCapacity(1L,bytes.length);
    }
    @Test void disabledOrWrongScopeCannotReadWriteOrProbeObjects() throws Exception {
        byte[] bytes={1,2};String sha=hash(bytes);owner.setFileCloudBackupEnabled(false);
        assertThrows(IllegalArgumentException.class,()->part(bytes,0));
        assertThrows(IllegalArgumentException.class,()->service.status(1L,"device","42",sha,2));
        owner.setFileCloudBackupEnabled(true);
        assertThrows(IllegalArgumentException.class,()->service.status(1L,"other-device","42",sha,2));
        assertThrows(IllegalArgumentException.class,()->service.status(1L,"device","other-project",sha,2));
        assertThrows(IllegalArgumentException.class,()->service.status(2L,"device","42",sha,2));
        verifyNoInteractions(blobs);
    }
    @Test void hashMismatchRetainsDeletionReceiptIfPhysicalCleanupFails() throws Exception {
        doNothing().when(blobs).deleteQuietly(anyString());
        byte[] bytes={1,2};
        assertThrows(IllegalArgumentException.class,()->service.put(1L,"device","42",hash(bytes),2,0,"0".repeat(64),new ByteArrayInputStream(bytes),2));
        assertEquals(1,rows.size());assertTrue(rows.get(0).isPendingDeletion());assertEquals(2,rows.get(0).getSize());
        service.cleanDeleted();assertEquals(1,rows.size());
        doCallRealMethod().when(blobs).deleteQuietly(anyString());service.cleanDeleted();assertTrue(rows.isEmpty());
    }
    @Test void revocationImmediatelyDeniesReadsAndDoesNotDestroyLocalSource() throws Exception {
        byte[] bytes={3,4};part(bytes,0);service.complete(1L,"device","42",hash(bytes),2);
        owner.setFileCloudBackupEnabled(false);service.revoke(1L);
        assertTrue(service.cleanupPending(1L));assertThrows(IllegalArgumentException.class,()->service.content(1L,"device","42",hash(bytes),0));
        service.cleanDeleted();assertTrue(rows.isEmpty());assertArrayEquals(new byte[]{3,4},bytes);
    }
    @Test void corruptOrMissingStoredPartNeverLooksComplete() throws Exception {
        byte[] bytes={5,6};part(bytes,0);String sha=hash(bytes);
        Path stored=Path.of(rows.get(0).getStoragePath());Files.write(stored,new byte[]{8,9});
        assertThrows(IOException.class,()->service.complete(1L,"device","42",sha,2));
        Files.write(stored,bytes);service.complete(1L,"device","42",sha,2);Files.delete(stored);
        assertEquals(false,service.status(1L,"device","42",sha,2).get("complete"));
        part(bytes,0);assertEquals(true,service.complete(1L,"device","42",sha,2).get("complete"));
    }
    @Test void invalidPartOrExhaustedQuotaNeverReadsInput() throws Exception {
        byte[] bytes={1,2};String sha=hash(bytes);InputStream input=mock(InputStream.class);
        assertThrows(IllegalArgumentException.class,()->service.put(1L,"device","42",sha,2,1,sha,input,2));
        doThrow(new IllegalArgumentException("quota")).when(quota).requirePersistentCapacity(1L,2);
        assertThrows(IllegalArgumentException.class,()->service.put(1L,"device","42",sha,2,0,sha,input,2));
        verifyNoInteractions(input,blobs);
    }
    @Test void fullObjectDigestCannotBeForgedWithIndividuallyValidParts() throws Exception {
        byte[] bytes={1,2};String sha="f".repeat(64);
        service.put(1L,"device","42",sha,2,0,hash(bytes),new ByteArrayInputStream(bytes),2);
        assertThrows(IllegalArgumentException.class,()->service.complete(1L,"device","42",sha,2));
        assertFalse(rows.stream().anyMatch(r->r.getPartIndex()==-1));
    }
    @Test void zeroByteObjectHasVerifiedCompletionWithoutChunkOrQuota() throws Exception {
        String sha=hash(new byte[0]);service.complete(1L,"device","42",sha,0);
        assertEquals(true,service.status(1L,"device","42",sha,0).get("complete"));verifyNoInteractions(blobs);
        verify(quota,never()).requirePersistentCapacity(anyLong(),anyLong());
    }

    @Test void transactionRollbackRetainsCleanupReceiptWhenDeletionFails() throws Exception {
        byte[] bytes={1,2};doNothing().when(blobs).deleteQuietly(anyString());
        org.springframework.transaction.support.TransactionSynchronizationManager.initSynchronization();
        try {
            part(bytes,0);
            // The real transaction rolls this normal row back; model that before afterCompletion.
            rows.clear();
            for(var callback:org.springframework.transaction.support.TransactionSynchronizationManager.getSynchronizations())
                callback.afterCompletion(org.springframework.transaction.support.TransactionSynchronization.STATUS_ROLLED_BACK);
        } finally {org.springframework.transaction.support.TransactionSynchronizationManager.clearSynchronization();}
        assertEquals(1,rows.size());assertTrue(rows.get(0).isPendingDeletion());assertEquals(2,rows.get(0).getSize());
    }

    @Test void consentRevokedDuringWholeObjectVerificationCannotPublishCompletion() throws Exception {
        byte[] bytes={1,2};part(bytes,0);
        String locator=rows.get(0).getStoragePath();
        doAnswer(inv->{owner.setFileCloudBackupEnabled(false);return new ByteArrayInputStream(bytes);}).when(blobs).open(locator);
        assertThrows(IllegalArgumentException.class,()->service.complete(1L,"device","42",hash(bytes),2));
        assertFalse(rows.stream().anyMatch(r->r.getPartIndex()==-1));
    }
    @Test void partialPersistentWriteKeepsAChargedDeletionReceipt() throws Exception {
        doThrow(new MobileRelayBlobStore.PersistentWriteException(new MobileRelayBlobStore.StoredBlob("partial",1),new IOException("lost connection")))
                .when(blobs).putPersistent(eq(1L),anyString(),any(),eq(2L));
        doNothing().when(blobs).deleteQuietly("partial");doReturn(true).when(blobs).exists("partial");
        assertThrows(MobileRelayBlobStore.PersistentWriteException.class,()->part(new byte[]{1,2},0));
        assertEquals(1,rows.size());assertTrue(rows.get(0).isPendingDeletion());assertEquals(1,rows.get(0).getSize());
    }

    @Test void objectLargerThanPlanIsRejectedBeforeFirstPartFillsCloudWithIncompleteBytes() {
        long total=4L*1024*1024*1024;
        doThrow(new IllegalArgumentException("quota")).when(quota).requirePersistentCapacity(1L,total);
        InputStream input=mock(InputStream.class);
        assertThrows(IllegalArgumentException.class,()->service.put(1L,"device","42","a".repeat(64),total,0,"b".repeat(64),input,MobileVersionObjectService.PART_BYTES));
        verifyNoInteractions(input,blobs);assertTrue(rows.isEmpty());
    }
}
