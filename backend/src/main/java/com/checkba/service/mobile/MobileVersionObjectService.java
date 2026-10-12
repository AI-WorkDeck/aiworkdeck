// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;

import com.checkba.model.entity.MobileVersionObject;
import com.checkba.repository.*;
import com.checkba.service.LangText;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.*;
import org.springframework.scheduling.annotation.Scheduled;
import java.io.*;
import java.security.*;
import java.time.LocalDateTime;
import java.util.*;

/** Durable history objects; unrelated to latest-file mobile preview replacement/TTL. */
@Service
public class MobileVersionObjectService {
    public static final long PART_BYTES=32L*1024*1024;
    private final UserRepository users;
    private final MobileProjectDirRepository directories;
    private final MobileVersionObjectRepository objects;
    private final CloudStorageQuotaService quota;
    private final MobileRelayBlobStore blobs;
    @org.springframework.beans.factory.annotation.Autowired(required=false)
    private org.springframework.transaction.PlatformTransactionManager transactions;
    @jakarta.persistence.PersistenceContext private jakarta.persistence.EntityManager entityManager;

    public MobileVersionObjectService(UserRepository users,MobileProjectDirRepository directories,
            MobileVersionObjectRepository objects,CloudStorageQuotaService quota,MobileRelayBlobStore blobs) {
        this.users=users;this.directories=directories;this.objects=objects;this.quota=quota;this.blobs=blobs;
    }
    private void authorize(Long user,String device,String project) {
        var owner=users.findById(user).orElseThrow(()->new IllegalArgumentException("User not found"));
        if(entityManager!=null && TransactionSynchronizationManager.isActualTransactionActive() && entityManager.contains(owner))
            entityManager.refresh(owner);
        if (!owner.isFileCloudBackupEnabled() || quota.persistentQuota(user)<=0)
            throw new IllegalArgumentException(MobileBackupService.offlineMessage());
        if (device==null || device.isBlank() || device.length()>64 || project==null || project.isBlank() || project.length()>64
                || directories.findByUserIdOrderByUpdatedAtDesc(user).stream().noneMatch(
                    d->device.equals(d.getDeviceId()) && project.equals(d.getProjectKey())))
            throw new IllegalArgumentException(LangText.of("项目不存在","Project not found"));
    }
    private static void validate(String sha,long size) {
        if (sha==null || !sha.matches("[a-f0-9]{64}") || size<0 || size>20L*1024*1024*1024)
            throw new IllegalArgumentException("Invalid version object");
    }
    public static int partCount(long size) { return Math.toIntExact((size+PART_BYTES-1)/PART_BYTES); }
    private List<MobileVersionObject> rows(Long user,String device,String project,String sha) {
        return objects.findByUserIdAndDeviceIdAndProjectKeyAndObjectShaOrderByPartIndex(user,device,project,sha);
    }
    private void lock(Long user) {
        users.lockStorageOwner(user).orElseThrow(()->new IllegalArgumentException("User not found"));
    }
    private static void sameObject(MobileVersionObject row,long size) {
        if (row.isPendingDeletion()) throw new IllegalArgumentException(LangText.of(
                "旧备份正在清理，请稍后重试；本地版本已保留","Previous backup cleanup is pending; local versions are safe"));
        if(row.getObjectSize()!=size) throw new IllegalArgumentException("Version object size mismatch");
    }
    public List<Map<String,Object>> list(Long user,String device,String project) {
        authorize(user,device,project);
        return objects.findByUserIdAndDeviceIdAndProjectKeyAndPartIndex(user,device,project,-1).stream()
                .filter(row->!row.isPendingDeletion()).map(row->Map.<String,Object>of(
                        "sha256",row.getObjectSha(),"size",row.getObjectSize())).toList();
    }
    public Map<String,Object> status(Long user,String device,String project,String sha,long size) {
        authorize(user,device,project);validate(sha,size);
        List<Integer> parts=new ArrayList<>();boolean complete=false;long stored=0;
        for(var row:rows(user,device,project,sha)) {
            sameObject(row,size);stored=Math.addExact(stored,row.getSize());
            if(row.getPartIndex()==-1) complete=true;
            else if(blobs.exists(row.getStoragePath())) parts.add(row.getPartIndex());
        }
        // A completed receipt must never disguise missing physical bytes.
        complete=complete && parts.size()==partCount(size);
        if(!complete) quota.requirePersistentCapacity(user,Math.max(0,size-stored));
        return Map.of("sha256",sha,"size",size,"parts",parts,"complete",complete);
    }
    @Transactional
    public Map<String,Object> put(Long user,String device,String project,String sha,long objectSize,
            int index,String partSha,InputStream content,long size) throws IOException {
        lock(user);authorize(user,device,project);validate(sha,objectSize);validate(partSha,size);
        long expected=index<0 || index>=partCount(objectSize) ? -1 : Math.min(PART_BYTES,objectSize-index*PART_BYTES);
        if(size!=expected) throw new IllegalArgumentException("Invalid version object part size");
        var old=objects.findByUserIdAndDeviceIdAndProjectKeyAndObjectShaAndPartIndex(user,device,project,sha,index);
        if(old.isPresent()) {
            sameObject(old.get(),objectSize);
            if(!partSha.equals(old.get().getPartSha()) || size!=old.get().getSize())
                throw new IllegalArgumentException("Immutable version object conflict");
            if(blobs.exists(old.get().getStoragePath())) return Map.of("sha256",partSha,"size",size,"part",index);
            // Keep the receipt if the storage service is unavailable; only confirmed absence permits repair.
            objects.delete(old.get());objects.flush();
        }
        long stored=0;
        for(var row:rows(user,device,project,sha)) {
            sameObject(row,objectSize);stored=Math.addExact(stored,row.getSize());
        }
        // Reject an object that cannot fit before sending its first part (e.g. 4GiB on a 3GiB plan).
        quota.requirePersistentCapacity(user,Math.max(size,objectSize-stored));
        MessageDigest digest=digest();
        MobileRelayBlobStore.StoredBlob saved;
        try { saved=blobs.putPersistent(user,UUID.randomUUID().toString(),new DigestInputStream(content,digest),size); }
        catch(MobileRelayBlobStore.PersistentWriteException e) { discard(user,e.partial());throw e; }
        if(saved.size()!=size || !partSha.equals(HexFormat.of().formatHex(digest.digest()))) {
            discard(user,saved);throw new IllegalArgumentException("Version object content hash or size mismatch");
        }
        if(TransactionSynchronizationManager.isSynchronizationActive())
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCompletion(int state) { if(state!=STATUS_COMMITTED) discard(user,saved); }
            });
        MobileVersionObject row=newRow(user,device,project,sha,objectSize,index);
        row.setPartSha(partSha);row.setSize(size);row.setStoragePath(saved.locator());objects.save(row);
        return Map.of("sha256",partSha,"size",size,"part",index);
    }
    public Map<String,Object> complete(Long user,String device,String project,String sha,long size) throws IOException {
        // Hashing a multi-gigabyte object must not occupy a database transaction or user lock.
        authorize(user,device,project);validate(sha,size);
        List<MobileVersionObject> rows=rows(user,device,project,sha);
        Map<Integer,MobileVersionObject> parts=new HashMap<>();
        for(var row:rows) { sameObject(row,size);if(row.getPartIndex()!=-1) parts.put(row.getPartIndex(),row); }
        if(parts.size()!=partCount(size)) throw new IllegalArgumentException("Version object upload incomplete");
        MessageDigest digest=digest();byte[] buffer=new byte[65536];long total=0;
        for(int index=0;index<partCount(size);index++) {
            var part=parts.get(index);
            if(part==null) throw new IllegalArgumentException("Version object upload incomplete");
            long actual=0;MessageDigest partDigest=digest();
            try(InputStream input=blobs.open(part.getStoragePath())) {
                int n;while((n=input.read(buffer))!=-1) {
                    actual+=n;if(actual>part.getSize()) {
                        quarantine(user,device,project,sha,Map.of(index,part));
                        throw new IOException("Version object part size mismatch");
                    }
                    digest.update(buffer,0,n);partDigest.update(buffer,0,n);
                }
            }
            if(actual!=part.getSize() || !part.getPartSha().equals(HexFormat.of().formatHex(partDigest.digest()))) {
                quarantine(user,device,project,sha,Map.of(index,part));
                throw new IOException("Version object part verification failed");
            }
            total+=actual;
        }
        if(total!=size || !sha.equals(HexFormat.of().formatHex(digest.digest()))) {
            quarantine(user,device,project,sha,parts);
            throw new IllegalArgumentException("Version object verification failed");
        }
        independent(()->{
            lock(user);authorize(user,device,project);
            List<MobileVersionObject> current=rows(user,device,project,sha);
            boolean published=false;int verified=0;
            for(var row:current) {
                sameObject(row,size);
                if(row.getPartIndex()==-1) {published=true;continue;}
                var checked=parts.get(row.getPartIndex());
                if(checked==null || !Objects.equals(checked.getId(),row.getId())
                        || !Objects.equals(checked.getStoragePath(),row.getStoragePath()))
                    throw new IllegalArgumentException("Version object changed during verification");
                verified++;
            }
            if(verified!=parts.size()) throw new IllegalArgumentException("Version object changed during verification");
            if(!published) objects.save(newRow(user,device,project,sha,size,-1));
        });
        return Map.of("sha256",sha,"size",size,"complete",true);
    }
    /** Confirmed corruption must become a missing part after cleanup, not an endless resume loop. */
    private void quarantine(Long user,String device,String project,String sha,Map<Integer,MobileVersionObject> failed) {
        independent(()->{
            users.lockStorageOwner(user);
            List<MobileVersionObject> current=rows(user,device,project,sha);
            boolean invalidated=false;
            for(var row:current) {
                var checked=failed.get(row.getPartIndex());
                if(checked!=null && Objects.equals(checked.getId(),row.getId())
                        && Objects.equals(checked.getStoragePath(),row.getStoragePath())) {
                    row.setPendingDeletion(true);objects.save(row);invalidated=true;
                }
            }
            if(invalidated) for(var row:current) if(row.getPartIndex()==-1) {
                row.setPendingDeletion(true);objects.save(row);
            }
        });
    }
    public ProjectCatalogService.Content content(Long user,String device,String project,String sha,int index) throws IOException {
        authorize(user,device,project);validate(sha,0);
        var receipt=objects.findByUserIdAndDeviceIdAndProjectKeyAndObjectShaAndPartIndex(user,device,project,sha,-1)
                .filter(row->!row.isPendingDeletion()).orElseThrow(()->new IllegalArgumentException("Version object unavailable"));
        var part=objects.findByUserIdAndDeviceIdAndProjectKeyAndObjectShaAndPartIndex(user,device,project,sha,index)
                .filter(row->index>=0 && !row.isPendingDeletion() && row.getObjectSize()==receipt.getObjectSize())
                .orElseThrow(()->new IllegalArgumentException("Version object part unavailable"));
        return new ProjectCatalogService.Content(blobs.open(part.getStoragePath()),part.getSize());
    }
    private static MessageDigest digest() {
        try{return MessageDigest.getInstance("SHA-256");}catch(NoSuchAlgorithmException e){throw new IllegalStateException(e);}
    }
    private static MobileVersionObject newRow(Long user,String device,String project,String sha,long size,int index) {
        var row=new MobileVersionObject();row.setUserId(user);row.setDeviceId(device);row.setProjectKey(project);
        row.setObjectSha(sha);row.setObjectSize(size);row.setPartIndex(index);row.setUpdatedAt(LocalDateTime.now());return row;
    }
    @Transactional
    public void revoke(Long user) { for(var row:objects.findByUserId(user)) {row.setPendingDeletion(true);objects.save(row);} }
    public boolean cleanupPending(Long user) {return objects.findByUserId(user).stream().anyMatch(MobileVersionObject::isPendingDeletion);}
    private void independent(Runnable action) {
        if(transactions==null){action.run();return;}
        var transaction=new TransactionTemplate(transactions);
        transaction.setPropagationBehavior(org.springframework.transaction.TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        transaction.executeWithoutResult(status->action.run());
    }
    private void discard(Long user,MobileRelayBlobStore.StoredBlob saved) {
        independent(()->{
            var row=newRow(user,"deleted","deleted",UUID.randomUUID().toString(),saved.size(),0);
            row.setSize(saved.size());row.setStoragePath(saved.locator());row.setPendingDeletion(true);objects.save(row);
            if(deleteConfirmed(saved.locator())) objects.delete(row);
        });
    }
    private boolean deleteConfirmed(String locator) {
        if(locator==null) return true;
        try {blobs.deleteQuietly(locator);return !blobs.exists(locator);}catch(RuntimeException e){return false;}
    }
    @Scheduled(fixedDelay=60000)
    public void cleanDeleted() {
        for(var candidate:objects.findByPendingDeletionTrue()) independent(()->{
            users.lockStorageOwner(candidate.getUserId());
            var current=objects.findById(candidate.getId()).orElse(null);
            if(current!=null && entityManager!=null) entityManager.refresh(current);
            if(current!=null && current.isPendingDeletion() && deleteConfirmed(current.getStoragePath())) objects.delete(current);
        });
    }
}
