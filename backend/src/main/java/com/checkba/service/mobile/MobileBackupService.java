// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.scheduling.annotation.Scheduled;
import java.io.*;
import java.security.*;
import java.time.LocalDateTime;
import java.util.*;

@Service
public class MobileBackupService {
    private static final org.slf4j.Logger log=org.slf4j.LoggerFactory.getLogger(MobileBackupService.class);
    public static final String CONSENT_VERSION = "2026-10-11";
    public static String offlineMessage() { return com.checkba.service.LangText.of(
            "仅当桌面端在线时才可调取；离线访问需要有效订阅并明确开启文件云端备份",
            "Files are available while the desktop is online. Offline access requires an active subscription and explicit cloud backup consent"); }
    private final UserRepository users;
    private final MobileFileBackupRepository backups;
    private final MobileProjectDirRepository directories;
    private final MobileProjectManifestRepository manifests;
    private final CloudStorageQuotaService quota;
    private final MobileRelayBlobStore blobs;
    private final MobileTransferService transfers;
    private final ObjectMapper mapper;
    @org.springframework.beans.factory.annotation.Autowired(required=false) private MobileVersionObjectService versionObjects;
    @jakarta.persistence.PersistenceContext private jakarta.persistence.EntityManager entityManager;
    @org.springframework.beans.factory.annotation.Autowired private org.springframework.transaction.PlatformTransactionManager transactions;
    public MobileBackupService(UserRepository users, MobileFileBackupRepository backups,
            MobileProjectDirRepository directories, MobileProjectManifestRepository manifests,
            CloudStorageQuotaService quota, MobileRelayBlobStore blobs, MobileTransferService transfers, ObjectMapper mapper) {
        this.users=users; this.backups=backups; this.directories=directories; this.manifests=manifests;
        this.quota=quota; this.blobs=blobs; this.transfers=transfers; this.mapper=mapper;
    }
    private User user(Long id) { return users.findById(id).orElseThrow(() -> new IllegalArgumentException(com.checkba.service.LangText.of("用户不存在", "User not found"))); }
    public boolean enabled(Long id) { return user(id).isFileCloudBackupEnabled(); }
    public boolean eligible(Long id) { return enabled(id) && quota.persistentQuota(id)>0; }
    public Map<String,Object> consent(Long id) {
        User u=user(id);
        Map<String,Object> out=new LinkedHashMap<>();
        out.put("enabled",u.isFileCloudBackupEnabled()); out.put("decided",u.getFileCloudBackupDecidedAt()!=null);
        try { out.put("subscriptionActive",quota.persistentQuota(id)>0);out.put("subscriptionAvailable",true); }
        catch (MobileBillingFailureException e) { out.put("subscriptionActive",false);out.put("subscriptionAvailable",false); }
        out.put("consentVersion",CONSENT_VERSION);
        out.put("cleanupPending",backups.findByUserId(id).stream().anyMatch(MobileFileBackup::isPendingDeletion)
                || (versionObjects!=null && versionObjects.cleanupPending(id)));
        return out;
    }
    @Transactional
    public Map<String,Object> consent(Long id, boolean enabled, String version) {
        if (!CONSENT_VERSION.equals(version)) throw new IllegalArgumentException(com.checkba.service.LangText.of("请阅读并确认当前文件云端备份说明", "Please review and confirm the current cloud backup notice"));
        User u=users.lockStorageOwner(id).orElseThrow(() -> new IllegalArgumentException(com.checkba.service.LangText.of("用户不存在", "User not found")));
        if (enabled && quota.persistentQuota(id)<=0) throw new IllegalArgumentException(com.checkba.service.LangText.of("文件云端备份需要有效订阅", "Cloud file backup requires an active subscription"));
        u.setFileCloudBackupEnabled(enabled); u.setFileCloudBackupDecidedAt(LocalDateTime.now());
        u.setFileCloudBackupConsentVersion(version); users.save(u);
        if (!enabled) for (MobileFileBackup row:backups.findByUserId(id)) { row.setPendingDeletion(true); backups.save(row); }
        if (!enabled && versionObjects!=null) versionObjects.revoke(id);
        return consent(id);
    }
    public void requireEligible(Long id) { if (!eligible(id)) throw new IllegalArgumentException(offlineMessage()); }
    private void requireProject(Long id,String device,String key) {
        if (device==null || device.isBlank() || device.length()>64 || key==null || key.isBlank() || key.length()>64
                || directories.findByUserIdOrderByUpdatedAtDesc(id).stream().noneMatch(d -> device.equals(d.getDeviceId()) && key.equals(d.getProjectKey())))
            throw new IllegalArgumentException(com.checkba.service.LangText.of("项目不存在", "Project not found"));
    }
    public List<Map<String,Object>> list(Long id,String device,String key) {
        if (device==null || device.isBlank()) throw new IllegalArgumentException(com.checkba.service.LangText.of("缺少设备编号", "Missing device id"));
        return backups.findByUserId(id).stream().filter(row -> device.equals(row.getDeviceId()) && (key==null || key.equals(row.getProjectKey())))
                .filter(row -> !row.isPendingDeletion()).map(this::entry).toList();
    }
    @Transactional
    public void manifest(Long id,String device,String key,List<Map<String,Object>> entries,Integer totalCount) {
        requireEligible(id);requireProject(id,device,key);
        List<Map<String,Object>> clean=new ArrayList<>();
        if (entries!=null) for (Map<String,Object> f:entries.stream().limit(2000).toList()) {
            if (f==null) continue;
            Map<String,Object> e=new LinkedHashMap<>();
            for (String field:List.of("id","name","path")) {
                Object value=f.get(field);
                if (!(value instanceof String) || ((String)value).length()>1024) throw new IllegalArgumentException(com.checkba.service.LangText.of("文件清单格式无效", "Invalid file manifest"));
                e.put(field,value);
            }
            String uid=ProjectCatalogService.validUid(String.valueOf(f.get("uid")));if(uid!=null)e.put("uid",uid);
            e.put("parentId",f.get("parentId")==null ? null : String.valueOf(f.get("parentId")));
            e.put("isFolder",Boolean.TRUE.equals(f.get("isFolder")));
            e.put("size",f.get("size") instanceof Number n ? Math.max(0,n.longValue()) : 0L);clean.add(e);
        }
        int total=Math.max(totalCount==null?clean.size():totalCount,entries==null?0:entries.size());
        var row=manifests.findByUserIdAndDeviceIdAndProjectKey(id,device,key).orElseGet(MobileProjectManifest::new);
        row.setUserId(id);row.setDeviceId(device);row.setProjectKey(key);row.setUpdatedAt(LocalDateTime.now());
        try { row.setPayloadJson(mapper.writeValueAsString(Map.of("files",clean,"totalCount",total,"truncated",total>clean.size()))); }
        catch (IOException e) { throw new IllegalStateException(e); }manifests.save(row);
    }
    public Map<String,Object> entry(MobileFileBackup row) {
        Map<String,Object> out=new LinkedHashMap<>();
        out.put("id",row.getFileId());out.put("uid",row.getUid());out.put("name",row.getName());out.put("path",row.getPath());
        out.put("parentId",row.getParentId());out.put("isFolder",false);out.put("size",row.getSize());out.put("sha256",row.getSha256());
        out.put("source","backup");out.put("deviceId",row.getDeviceId());out.put("projectKey",row.getProjectKey());out.put("online",true);
        return out;
    }
    @Transactional
    public Map<String,Object> put(Long id,String device,String key,String fileId,String uid,String name,String path,
            String parentId,String sha256,InputStream content,long size) throws IOException {
        users.lockStorageOwner(id).orElseThrow(() -> new IllegalArgumentException(com.checkba.service.LangText.of("用户不存在", "User not found")));
        requireEligible(id);requireProject(id,device,key);MobilePreviewPolicy.requireSupported(name);
        if (fileId==null || fileId.isBlank() || fileId.length()>128 || ProjectCatalogService.validUid(uid)==null
                || name.length()>512 || name.contains("/") || name.contains("\\") || path==null || path.isBlank() || path.length()>1024
                || path.startsWith("/") || Arrays.asList(path.split("/")).contains("..") || (parentId!=null && parentId.length()>128)
                || sha256==null || !sha256.matches("[a-fA-F0-9]{64}") || size<0 || size>MobileTransferService.MAX_TRANSFER_BYTES)
            throw new IllegalArgumentException(com.checkba.service.LangText.of("备份文件信息无效", "Invalid backup metadata"));
        MobileFileBackup row=backups.findByUserIdAndDeviceIdAndProjectKeyAndFileId(id,device,key,fileId).orElseGet(MobileFileBackup::new);
        quota.requirePersistentCapacity(id,size);
        String old=row.getStoragePath();
        MessageDigest digest;
        try { digest=MessageDigest.getInstance("SHA-256"); } catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
        MobileRelayBlobStore.StoredBlob saved;
        try { saved=blobs.putPersistent(id,UUID.randomUUID().toString(),new DigestInputStream(content,digest),size); }
        catch (MobileRelayBlobStore.PersistentWriteException e) { discardBlob(id,e.partial());throw e; }
        if (saved.size()!=size || !HexFormat.of().formatHex(digest.digest()).equalsIgnoreCase(sha256)) {
            discardBlob(id,saved);throw new IllegalArgumentException(com.checkba.service.LangText.of("备份文件校验失败", "Backup content hash or size mismatch"));
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override public void afterCompletion(int status) {
                if (status!=STATUS_COMMITTED) discardBlob(id,saved);
            }
        });
        if (old!=null) {
            // Retain failed deletions for the retry worker; persistent objects have no expiration safety net.
            MobileFileBackup obsolete=new MobileFileBackup();
            obsolete.setUserId(id);obsolete.setDeviceId(device);obsolete.setProjectKey(key);
            obsolete.setFileId("deleted-"+UUID.randomUUID());obsolete.setUid(row.getUid());obsolete.setName(row.getName());
            obsolete.setPath(row.getPath());obsolete.setParentId(row.getParentId());obsolete.setSha256(row.getSha256());
            obsolete.setSize(row.getSize());obsolete.setStoragePath(old);obsolete.setPendingDeletion(true);obsolete.setUpdatedAt(LocalDateTime.now());
            backups.save(obsolete);
        }
        row.setUserId(id);row.setDeviceId(device);row.setProjectKey(key);row.setFileId(fileId);row.setUid(uid);
        row.setName(name);row.setPath(path);row.setParentId(parentId);row.setSha256(sha256.toLowerCase(Locale.ROOT));
        row.setSize(saved.size());row.setStoragePath(saved.locator());row.setPendingDeletion(false);row.setUpdatedAt(LocalDateTime.now());
        backups.save(row);return entry(row);
    }
    @Transactional
    public void delete(Long id,String device,String key,String fileId) {
        users.lockStorageOwner(id).orElseThrow(() -> new IllegalArgumentException(com.checkba.service.LangText.of("用户不存在", "User not found")));
        backups.findByUserIdAndDeviceIdAndProjectKeyAndFileId(id,device,key,fileId).ifPresent(row -> {
            row.setPendingDeletion(true);backups.save(row);
        });
    }
    private void independentTransaction(Runnable action) {
        if (transactions==null) { action.run();return; } // Pure unit tests have no Spring transaction manager.
        var transaction=new org.springframework.transaction.support.TransactionTemplate(transactions);
        transaction.setPropagationBehavior(org.springframework.transaction.TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        transaction.executeWithoutResult(status -> action.run());
    }
    private void discardBlob(Long userId,MobileRelayBlobStore.StoredBlob saved) {
        independentTransaction(() -> {
            // Persist the deletion receipt before touching the object; if deletion is unavailable it remains retryable.
            MobileFileBackup obsolete=new MobileFileBackup();
            obsolete.setUserId(userId);obsolete.setDeviceId("deleted");obsolete.setProjectKey("deleted");
            obsolete.setFileId(UUID.randomUUID().toString());obsolete.setUid(UUID.randomUUID().toString());
            obsolete.setName("discarded");obsolete.setPath("discarded");obsolete.setSha256("0".repeat(64));
            obsolete.setSize(saved.size());obsolete.setStoragePath(saved.locator());obsolete.setPendingDeletion(true);
            obsolete.setUpdatedAt(LocalDateTime.now());backups.save(obsolete);
            if (deleteConfirmed(saved.locator())) backups.delete(obsolete);
        });
    }
    private boolean deleteConfirmed(String locator) {
        try { blobs.deleteQuietly(locator);return !blobs.exists(locator); }
        catch (RuntimeException e) { log.warn("Persistent backup cleanup deferred; deletion receipt retained",e);return false; }
    }
    @Scheduled(fixedDelay=60000)
    public void cleanDeleted() {
        for (MobileFileBackup candidate:backups.findByPendingDeletionTrue()) independentTransaction(() -> {
            users.lockStorageOwner(candidate.getUserId()); // Deleted accounts still need physical deletion retries.
            MobileFileBackup current=backups.findById(candidate.getId()).orElse(null);
            if (current!=null && entityManager!=null) entityManager.refresh(current);
            if (current==null || !current.isPendingDeletion()) return;
            if (deleteConfirmed(current.getStoragePath())) backups.delete(current);
        });
    }
    public ProjectCatalogService.Content content(Long id,String device,String key,String uid) throws IOException {
        requireEligible(id);requireProject(id,device,key);
        MobileFileBackup row=backups.findByUserIdAndDeviceIdAndProjectKey(id,device,key).stream()
                .filter(f -> !f.isPendingDeletion() && uid.equals(f.getUid())).findFirst()
                .orElseThrow(() -> new IllegalArgumentException(offlineMessage()));
        MobilePreviewPolicy.requireSupported(row.getName());
        return new ProjectCatalogService.Content(blobs.open(row.getStoragePath()),row.getSize());
    }
    public MobileTransferRequest pull(Long id,String device,String key,String fileId,String requestId) {
        requireProject(id,device,key);
        var snapshot=manifests.findByUserIdAndDeviceIdAndProjectKey(id,device,key)
                .orElseThrow(() -> new IllegalArgumentException(com.checkba.service.LangText.of("请先刷新桌面文件列表", "Refresh the desktop file list first")));
        try {
            for (var file:mapper.readTree(snapshot.getPayloadJson()).path("files")) {
                if (!fileId.equals(file.path("id").asText())) continue;
                if (file.path("isFolder").asBoolean()) throw new IllegalArgumentException(MobilePreviewPolicy.unsupported());
                String name=file.path("name").asText();MobilePreviewPolicy.requireSupported(name);
                return transfers.pull(id,device,key,fileId,name,file.path("size").asLong(),requestId,true);
            }
        } catch (IOException e) { throw new IllegalStateException(com.checkba.service.LangText.of("文件清单格式无效", "Invalid file manifest"),e); }
        throw new IllegalArgumentException(com.checkba.service.LangText.of("请先刷新桌面文件列表", "Refresh the desktop file list first"));
    }
}
