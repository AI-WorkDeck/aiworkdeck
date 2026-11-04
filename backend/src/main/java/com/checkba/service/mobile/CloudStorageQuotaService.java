// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;

import com.checkba.repository.ProjectFileRepository;
import com.checkba.model.entity.ProjectFile;
import com.checkba.storage.StorageServiceFactory;
import org.springframework.util.StringUtils;
import com.checkba.repository.ProjectRepository;
import com.checkba.repository.UserRepository;
import com.checkba.service.LangText;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Instant;
import java.util.Map;

/** Persistent cloud storage is distinct from disposable relay storage. */
@Service
public class CloudStorageQuotaService {
    @org.springframework.beans.factory.annotation.Autowired private com.checkba.repository.MobileMediaInboxRepository cloudMedia;
    @org.springframework.beans.factory.annotation.Autowired private com.checkba.repository.MobileTransferRequestRepository cloudTransfers;
    @org.springframework.beans.factory.annotation.Autowired private org.springframework.beans.factory.ObjectProvider<com.checkba.version.ProjectRepoService> cloudRepos;
    @org.springframework.beans.factory.annotation.Autowired private org.springframework.beans.factory.ObjectProvider<com.checkba.version.memory.MemoryRepoService> cloudMemory;
    @org.springframework.beans.factory.annotation.Autowired private com.checkba.repository.MemoryDocumentRepository cloudMemoryDocuments;
    @org.springframework.beans.factory.annotation.Autowired private com.checkba.repository.MemoryDocumentSpaceRepository cloudMemorySpaces;
    @org.springframework.beans.factory.annotation.Autowired private com.checkba.repository.MemoryEntryRepository cloudMemoryEntries;
    @org.springframework.beans.factory.annotation.Autowired private org.springframework.beans.factory.ObjectProvider<com.checkba.service.ProjectMemberService> cloudMembers;
    public static final long RELAY_BYTES = 200L * 1024 * 1024;
    public static final long PRO_BYTES = 3L * 1024 * 1024 * 1024;
    @org.springframework.beans.factory.annotation.Autowired
    private com.checkba.repository.MobileFileBackupRepository mobileBackups;
    @org.springframework.beans.factory.annotation.Autowired
    private com.checkba.repository.MobileVersionObjectRepository versionObjects;
    @org.springframework.beans.factory.annotation.Autowired
    private org.springframework.beans.factory.ObjectProvider<com.checkba.version.objects.LocalVersionObjectStore> localVersionObjects;
    @Value("${storage.postpaid.enabled:false}") private boolean postpaidEnabled;
    @Value("${storage.postpaid.safety-limit-bytes:107374182400}") private long safetyLimitBytes;
    @org.springframework.beans.factory.annotation.Autowired private org.springframework.beans.factory.ObjectProvider<CloudStorageMeterService> meters;
    private final MobileBillingService billing;
    private final ProjectFileRepository files;
    private final ProjectRepository projects;
    private final UserRepository users;
    private final boolean enabled;
    private final StorageServiceFactory storage;
    @jakarta.persistence.PersistenceContext
    private jakarta.persistence.EntityManager entityManager;

    public CloudStorageQuotaService(MobileBillingService billing, ProjectFileRepository files,
            ProjectRepository projects, UserRepository users, StorageServiceFactory storage,
            @Value("${storage.subscription-quota.enabled:false}") boolean enabled) {
        this.billing = billing;
        this.files = files;
        this.projects = projects;
        this.users = users;
        this.enabled = enabled;
        this.storage = storage;
    }

    public Map<String, Object> usage(Long userId) {
        Map<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("persistentUsedBytes", usedBytes(userId));
        try { result.put("persistentQuotaBytes", persistentQuota(userId)); }
        catch (MobileBillingFailureException e) {
            result.put("persistentQuotaBytes", null);
            result.put("persistentQuotaAvailable", false);
        }
        return result;
    }

    public boolean postpaidEnabled() { return postpaidEnabled; }

    public void resumeCloud(Long userId) { billing.cloudOperation(userId,"resume-cloud",Map.of("policyVersion","2026-11-04")); }
    public Map<String, Object> cloudState(Long userId) { return billing.cloudState(userId); }

    @SuppressWarnings("unchecked")
    public Map<String, Object> cloudAccess(Long userId) {
        Object access = cloudState(userId).get("cloudAccess");
        if (!(access instanceof Map<?, ?>)) throw new MobileBillingFailureException(MobileBillingKind.UNAVAILABLE,
                CloudBillingText.get("stateUnavailable"));
        return (Map<String, Object>) access;
    }
    public void requireCloudWrite(Long userId) {
        if(!postpaidEnabled) return;
        var access=cloudAccess(userId);
        if(!Boolean.TRUE.equals(access.get("canWrite"))) throw new IllegalArgumentException(CloudBillingText.get("writesPaused"));
        requireEpoch(access);
    }
    private void requireEpoch(Map<String,Object> access) {
        var attributes=org.springframework.web.context.request.RequestContextHolder.getRequestAttributes();
        if(attributes instanceof org.springframework.web.context.request.ServletRequestAttributes request) {
            String epoch=request.getRequest().getHeader("X-Cloud-Epoch");
            if(epoch==null || !epoch.equals(String.valueOf(access.get("epoch")))) throw new IllegalArgumentException(CloudBillingText.get("epochChanged"));
        }
    }
    public void storageChanging(Long userId) {
        if(postpaidEnabled && meters!=null) meters.getObject().changing(userId);
    }
    public boolean canWrite(Long userId) {
        return postpaidEnabled ? Boolean.TRUE.equals(cloudAccess(userId).get("canWrite")) : subscriptionQuota(userId)>0;
    }
    public boolean canRead(Long userId) {
        return postpaidEnabled ? Boolean.TRUE.equals(cloudAccess(userId).get("canRead")) : subscriptionQuota(userId)>0;
    }
    public boolean canUse(Long userId) {
        return postpaidEnabled ? Boolean.TRUE.equals(cloudAccess(userId).get("canUse")) : subscriptionQuota(userId)>0;
    }
    public void appendCloudState(Long userId, Map<String,Object> output) {
        if (postpaidEnabled) try { output.putAll(cloudState(userId)); }
        catch(MobileBillingFailureException unavailable) { output.put("cloudAccess", Map.of(
                "canUse",false,"canWrite",false,"canRead",false,"reason","billing_unavailable")); }
    }
    public long persistentQuota(Long userId) {
        return postpaidEnabled ? (canWrite(userId) ? safetyLimitBytes : 0) : subscriptionQuota(userId);
    }

    public long subscriptionQuota(Long userId) {
        Map<String, Object> subscription;
        try {
            subscription = billing.balance(userId).subscription();
        } catch (MobileBillingFailureException e) {
            if (e.getKind() == MobileBillingKind.NOT_CONNECTED || e.getKind() == MobileBillingKind.NOT_FOUND
                    || e.getKind() == MobileBillingKind.DISABLED) return 0;
            throw e; // An unavailable account service is not evidence of a free account.
        }
        if (subscription == null || !Boolean.TRUE.equals(subscription.get("active"))) return 0;
        try {
            if (!Instant.parse(String.valueOf(subscription.get("expiresAt"))).isAfter(Instant.now())) return 0;
        } catch (RuntimeException e) { return 0; }
        return subscription.get("cloudStorageBytes") instanceof Number n
                ? Math.max(0, Math.min(PRO_BYTES, n.longValue())) : 0;
    }

    public boolean isEnabled() { return enabled; }

    /** Rollback callbacks run after the old lock is released; never delete a replacement's bytes. */
    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.REQUIRES_NEW)
    public void removeRolledBackFile(Long projectId, String path) {
        var project = projects.findById(projectId);
        if (project.isPresent()) {
            users.lockStorageOwner(project.get().getUserId()).orElseThrow(() -> new IllegalArgumentException("User not found"));
            if (files.findByProjectId(projectId).stream().anyMatch(file ->
                    path.equals(file.getFilePath()) || path.equals(file.getWpsFileId()))) return;
        }
        storage.getStorageService().delete(path);
    }

    /** Physical bytes outrank editable metadata. Missing live uploads retain their reservation. */
    public long measuredBytes(ProjectFile file) {
        String key = StringUtils.hasText(file.getFilePath()) ? file.getFilePath() : file.getWpsFileId();
        if (StringUtils.hasText(key) && storage.getStorageService().exists(key)) {
            return Math.max(0, storage.getStorageService().getSize(key));
        }
        return Boolean.TRUE.equals(file.getIsDeleted()) ? 0 : Math.max(0, file.getFileSize() == null ? 0 : file.getFileSize());
    }

    public long usedBytes(Long userId) {
        long total = 0;
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (ProjectFile file : files.findCloudFilesByOwner(userId)) {
            if(postpaidEnabled() && !projects.findById(file.getProjectId()).map(p->isBillableProject(p,userId)).orElse(false))continue;
            // A row loaded for authorization before acquiring the lock may still have its old path.
            if (entityManager != null && org.springframework.transaction.support.TransactionSynchronizationManager.isActualTransactionActive()
                    && entityManager.contains(file)) entityManager.refresh(file);
            String key = StringUtils.hasText(file.getFilePath()) ? file.getFilePath() : file.getWpsFileId();
            if (StringUtils.hasText(key) && !seen.add(key)) continue;
            total = Math.addExact(total, measuredBytes(file));
        }
        if (mobileBackups != null) for (var backup : mobileBackups.findByUserId(userId)) {
            total = Math.addExact(total, backup.getSize());
        }
        if (versionObjects != null) for (var object : versionObjects.findByUserId(userId)) {
            total = Math.addExact(total, object.getSize());
        }
        if(postpaidEnabled()) {
            if(cloudMedia!=null)for(var item:cloudMedia.findByUserId(userId)) if(item.getStoragePath()!=null && seen.add(item.getStoragePath()))
                total=Math.addExact(total,Math.max(0,item.getFileSize()==null?0:item.getFileSize()));
            if(cloudTransfers!=null)for(var item:cloudTransfers.findByUserId(userId)) if(item.getStoragePath()!=null && seen.add(item.getStoragePath()))
                total=Math.addExact(total,Math.max(0,item.getFileSize()==null?0:item.getFileSize()));
        }
        var localObjects = localVersionObjects == null ? null : localVersionObjects.getIfAvailable();
        if (localObjects != null) for (var project : projects.findByUserIdOrderByCreatedAtDesc(userId)) {
            if(postpaidEnabled() && !isBillableProject(project,userId))continue;
            try { total = Math.addExact(total, localObjects.usageBytes(project.getId())); }
            catch (java.io.IOException e) { throw new IllegalStateException("Version object usage unavailable", e); }
        }
        if(postpaidEnabled()) {
            var repo=cloudRepos==null?null:cloudRepos.getIfAvailable();var memory=cloudMemory==null?null:cloudMemory.getIfAvailable();
            for(var project:projects.findByUserIdOrderByCreatedAtDesc(userId)) {
                if(!isBillableProject(project,userId))continue;
                if(repo!=null)total=Math.addExact(total,directoryBytes(repo.gitDir(project.getId())));
                if(memory!=null) {
                    String key=com.checkba.version.memory.MemoryRealm.project(project.getId()).repoKey();
                    total=Math.addExact(total,directoryBytes(memory.gitDir(key)));
                }
            }
            if(memory!=null) {
                String key=com.checkba.version.memory.MemoryRealm.user(userId).repoKey();
                total=Math.addExact(total,directoryBytes(memory.gitDir(key)));
            }
        }
        if(postpaidEnabled())total=Math.addExact(total,memoryContentBytes(userId));
        return total;
    }
    private long memoryContentBytes(Long user) {
        if(cloudMemoryDocuments==null || cloudMemorySpaces==null || cloudMemoryEntries==null)return 0;
        long total=0;java.util.Set<String> represented=new java.util.HashSet<>();
        java.util.List<com.checkba.model.entity.MemoryEntry> legacy=new java.util.ArrayList<>(cloudMemoryEntries.findByUserIdAndScopeIn(user,com.checkba.version.memory.MemoryRealm.USER_SCOPES));
        var spaces=new java.util.ArrayList<com.checkba.model.entity.MemoryDocumentSpace>();
        cloudMemorySpaces.findByScopeAndOwnerKey("user",user.toString()).ifPresent(spaces::add);
        for(var project:projects.findByUserIdOrderByCreatedAtDesc(user))if(isBillableProject(project,user)) {
            cloudMemorySpaces.findByScopeAndOwnerKey("project",project.getId().toString()).ifPresent(spaces::add);
            legacy.addAll(cloudMemoryEntries.findByProjectIdOrderByCreatedAtDesc(project.getId()));
        }
        for(var space:spaces)for(var document:cloudMemoryDocuments.findBySpaceIdOrderByPathAsc(space.getId())) {
            total=Math.addExact(total,utf8Bytes(document.getContent()));
            if(document.getSourceMemoryUid()!=null)represented.add(document.getSourceMemoryUid());
        }
        for(var entry:legacy)if(entry.getUid()==null || !represented.contains(entry.getUid()))total=Math.addExact(total,utf8Bytes(entry.getMemoryValue()));
        return total;
    }
    private long utf8Bytes(String content){return content==null?0:content.getBytes(java.nio.charset.StandardCharsets.UTF_8).length;}

    private long directoryBytes(java.nio.file.Path root) {
        if(!java.nio.file.Files.exists(root,java.nio.file.LinkOption.NOFOLLOW_LINKS))return 0;
        if(java.nio.file.Files.isSymbolicLink(root))throw new IllegalStateException(CloudBillingText.get("unavailable"));
        try(var paths=java.nio.file.Files.walk(root)) {
            long total=0;
            for(var path:paths.toList()) {
                if(java.nio.file.Files.isSymbolicLink(path))throw new IllegalStateException(CloudBillingText.get("unavailable"));
                if(java.nio.file.Files.isRegularFile(path,java.nio.file.LinkOption.NOFOLLOW_LINKS))total=Math.addExact(total,java.nio.file.Files.size(path));
            }
            return total;
        }catch(java.io.IOException failure){throw new IllegalStateException(CloudBillingText.get("unavailable"),failure);}
    }

    /** Must share the caller's write transaction; refresh occurs after the owner lock, not before it. */
    @Transactional
    public void lockProjectForWrite(Long projectId) {
        if (!enabled) return;
        var project = projects.findById(projectId).orElseThrow(() -> new IllegalArgumentException("Project not found"));
        users.lockStorageOwner(project.getUserId()).orElseThrow(() -> new IllegalArgumentException("User not found"));
        storageChanging(project.getUserId());
    }

    @Transactional
    public void lockFileForWrite(ProjectFile file) {
        if (!enabled) return;
        lockProjectForWrite(file.getProjectId());
        if (entityManager != null && entityManager.contains(file)) entityManager.refresh(file);
    }

    /** Replacements only require their actual growth; append always requires every incoming byte. */
    @Transactional
    public void requireFileCapacity(ProjectFile file, long incomingBytes, boolean append) {
        if (!enabled) return;
        if (incomingBytes < 0) throw new IllegalArgumentException("Invalid upload size");
        lockFileForWrite(file);
        requireProjectCapacity(file.getProjectId(), append ? incomingBytes : Math.max(0, incomingBytes - measuredBytes(file)));
    }

    /** Explicit persistent publication, also used by the cloud catalogue. */
    @Transactional
    public void requirePersistentCapacity(Long userId, long additionalBytes) {
        if(additionalBytes<=0 && !postpaidEnabled) return;
        users.lockStorageOwner(userId).orElseThrow(() -> new IllegalArgumentException("User not found"));
        requireCloudWrite(userId);
        storageChanging(userId);
        if(additionalBytes<=0) return;
        checkCapacity(userId, additionalBytes);
    }

    @Transactional
    public void requireCurrentPersistentUsage(Long userId) {
        users.lockStorageOwner(userId).orElseThrow();requireCloudWrite(userId);checkCapacity(userId,0);
    }

    private void checkCapacity(Long userId, long additionalBytes) {
        long quota = persistentQuota(userId);
        long used = usedBytes(userId);
        if (used > quota || additionalBytes > quota - used) {
            throw new IllegalArgumentException(CloudBillingText.get("storageLimit"));
        }
    }

    private boolean isBillableProject(com.checkba.model.entity.Project project,Long user) {
        return "PERSONAL".equals(project.getCloudOwnership()) && java.util.Objects.equals(user,project.getCloudBillingOwnerId())
                && java.util.Objects.equals(user,project.getUserId()) && (project.getLocalRoot()==null || project.getLocalRoot().isBlank());
    }
    private Long billingOwnerForWrite(com.checkba.model.entity.Project project) {
        if(!postpaidEnabled())return project.getUserId();
        if(!"PERSONAL".equals(project.getCloudOwnership()) || project.getCloudBillingOwnerId()==null
                || !java.util.Objects.equals(project.getUserId(),project.getCloudBillingOwnerId())
                || (project.getLocalRoot()!=null && !project.getLocalRoot().isBlank()))
            throw new IllegalArgumentException(CloudBillingText.get("writesPaused"));
        return project.getCloudBillingOwnerId();
    }

    /** Project charges use the registered owner; ordinary authenticated collaborators fence their own generation. */
    public void requireProjectEpoch(Long projectId) {
        if(!postpaidEnabled())return;
        var project=projects.lockForImWrite(projectId).orElseThrow(()->new IllegalArgumentException(CloudBillingText.get("writesPaused")));
        Long owner=billingOwnerForWrite(project), actor=null;
        var attributes=org.springframework.web.context.request.RequestContextHolder.getRequestAttributes();
        if(attributes instanceof org.springframework.web.context.request.ServletRequestAttributes request) {
            String session=request.getRequest().getHeader("X-Session-Id");
            if(session==null || session.isBlank())session=request.getRequest().getParameter("token");
            if(session!=null && !session.isBlank())actor=com.checkba.controller.AuthController.getUserIdFromSession(session);
        }
        if(actor!=null && !actor.equals(owner)) {
            if(cloudMembers==null || !cloudMembers.getObject().hasWritePermission(projectId,actor))
                throw new IllegalArgumentException(CloudBillingText.get("writesPaused"));
            requireEpoch(cloudAccess(actor));
        } else requireEpoch(cloudAccess(owner));
    }
    private com.checkba.model.entity.Project lockedWriteProject(Long projectId) {
        var before=projects.findById(projectId).orElseThrow();Long owner=billingOwnerForWrite(before);
        lockProjectForWrite(projectId);
        var project=postpaidEnabled()?projects.lockForImWrite(projectId).orElseThrow(()->new IllegalArgumentException(CloudBillingText.get("writesPaused"))):before;
        if(!java.util.Objects.equals(owner,billingOwnerForWrite(project)))throw new IllegalArgumentException(CloudBillingText.get("writesPaused"));
        return project;
    }

    /** Only the official cloud profile applies subscription quotas to ordinary project writes. */
    @Transactional
    public void requireProjectCapacity(Long projectId, long additionalBytes) {
        if (!enabled) return;
        var project=lockedWriteProject(projectId);Long owner=billingOwnerForWrite(project);
        if(postpaidEnabled()) {if(!canWrite(owner))throw new IllegalArgumentException(CloudBillingText.get("writesPaused"));requireProjectEpoch(projectId);}
        if (additionalBytes <= 0) return;
        checkCapacity(owner, additionalBytes);
    }

    /** Template materialization has no client-declared size: verify actual bytes before commit. */
    @Transactional
    public void requireCurrentProjectUsage(Long projectId) {
        if (!enabled) return;
        var project=lockedWriteProject(projectId);Long owner=billingOwnerForWrite(project);
        if(postpaidEnabled()) {if(!canWrite(owner))throw new IllegalArgumentException(CloudBillingText.get("writesPaused"));requireProjectEpoch(projectId);}
        checkCapacity(owner, 0);
    }
}
