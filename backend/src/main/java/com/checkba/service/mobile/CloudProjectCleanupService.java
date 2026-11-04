// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;

import com.checkba.model.entity.Project;
import com.checkba.repository.ProjectRepository;
import com.checkba.repository.ProjectMemberRepository;
import com.checkba.repository.ProjectRemoteRepository;
import com.checkba.service.ProjectService;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Value;
import java.util.List;
import java.util.Objects;

/** Conservative ownership adapter; unknown legacy/shared projects require review, never inference. */
@Service
public class CloudProjectCleanupService {
    public record Target(Long userId, Long projectId, String projectUid) {}
    private final ProjectRepository projects;
    private final ProjectMemberRepository members;
    private final ProjectRemoteRepository remotes;
    private final ProjectService service;
    private final boolean cloud;
    public CloudProjectCleanupService(ProjectRepository projects, ProjectMemberRepository members,
            ProjectRemoteRepository remotes, ProjectService service,
            @Value("${storage.subscription-quota.enabled:false}") boolean enabled,
            @Value("${security.local-mode:false}") boolean localMode) {
        this.projects=projects;this.members=members;this.remotes=remotes;this.service=service;
        this.cloud=enabled && !localMode;
    }
    private boolean eligible(Project p, Long userId) {
        return cloud && Objects.equals(userId,p.getUserId()) && Objects.equals(userId,p.getCloudBillingOwnerId())
            && "PERSONAL".equals(p.getCloudOwnership()) && p.getUid()!=null && !p.getUid().isBlank()
            && (p.getLocalRoot()==null || p.getLocalRoot().isBlank())
            && remotes.findByProjectId(p.getId()).isEmpty()
            && members.findByProjectId(p.getId()).stream().allMatch(m -> userId.equals(m.getUserId()));
    }
    public List<Target> listOwnedCleanupTargets(Long userId) {
        if (!cloud) return List.of();
        return projects.findByUserIdOrderByCreatedAtDesc(userId).stream().filter(p -> eligible(p,userId))
            .map(p -> new Target(userId,p.getId(),p.getUid())).toList();
    }
    public boolean needsReview(Long userId) {
        return !cloud || projects.findByUserIdOrderByCreatedAtDesc(userId).stream().anyMatch(p -> !eligible(p,userId));
    }
    @org.springframework.beans.factory.annotation.Autowired
    private com.checkba.version.WorkSessionService workSessions;
    /** Take repo lock before the lifecycle acquires account/DB locks. */
    public void withProjectLock(Target target, Runnable action) {
        if (!cloud) throw new IllegalStateException("Cloud cleanup is unavailable on this deployment");
        workSessions.runLocked(target.projectId(), () -> memorySync.runLocked(
                com.checkba.version.memory.MemoryRealm.project(target.projectId()).repoKey(), action));
    }
    public void deleteExact(Target target) {
        if (!cloud) throw new IllegalStateException("Cloud cleanup is unavailable on this deployment");
        service.deleteOwnedCloudProject(target.projectId(),target.userId(),target.projectUid());
    }
    public void reconcileCompleted(Target target) {
        if (!cloud) throw new IllegalStateException("Cloud cleanup is unavailable on this deployment");
        service.reconcileCompletedCloudProject(target.projectId(),target.userId(),target.projectUid());
    }
    @org.springframework.beans.factory.annotation.Autowired private com.checkba.version.memory.MemoryRepoService memoryRepos;
    @org.springframework.beans.factory.annotation.Autowired private com.checkba.version.memory.MemorySyncService memorySync;
    @org.springframework.beans.factory.annotation.Autowired private com.checkba.storage.ProjectStorageResolver storage;
    @org.springframework.beans.factory.annotation.Autowired private com.checkba.repository.UserRepository users;
    @org.springframework.beans.factory.annotation.Autowired private com.checkba.repository.MemoryEntryRepository memories;
    @org.springframework.beans.factory.annotation.Autowired private com.checkba.repository.MemoryRemoteRepository memoryRemotes;
    @jakarta.persistence.PersistenceContext private jakarta.persistence.EntityManager memoryDb;
    public void withUserMemoryLock(Long user, Runnable action) {
        if(!cloud)throw new IllegalStateException("Cloud cleanup is unavailable on this deployment");
        memorySync.runLocked(com.checkba.version.memory.MemoryRealm.user(user).repoKey(), action);
    }
    /** Exact owner realm only; caller holds its repository lock and owner transaction. */
    public void deleteUserMemory(Long user, boolean completedReceipt) {
        if(!cloud)throw new IllegalStateException("Cloud cleanup is unavailable on this deployment");
        users.lockStorageOwner(user).orElseThrow();
        var realm=com.checkba.version.memory.MemoryRealm.user(user);
        var paths=java.util.List.of(memoryRepos.gitDir(realm.repoKey()),memoryRepos.workTree(realm.repoKey()));
        java.nio.file.Path root=storage.globalRoot().toAbsolutePath().normalize();
        for(var path:paths) {
            var normalized=path.toAbsolutePath().normalize();
            if(normalized.equals(root)||!normalized.startsWith(root))throw new IllegalStateException("Memory cleanup escapes cloud root");
            for(var cursor=normalized;cursor!=null&&cursor.startsWith(root);cursor=cursor.getParent())
                if(java.nio.file.Files.isSymbolicLink(cursor))throw new IllegalStateException("Memory cleanup does not follow symbolic links");
            if(completedReceipt && java.nio.file.Files.exists(normalized,java.nio.file.LinkOption.NOFOLLOW_LINKS))
                throw new IllegalStateException("Completed memory cleanup still has bytes; requires review");
        }
        if(!completedReceipt)for(var path:paths) {
            if(!java.nio.file.Files.exists(path))continue;
            try(var walk=java.nio.file.Files.walk(path)) {
                for(var entry:walk.sorted(java.util.Comparator.reverseOrder()).toList())java.nio.file.Files.deleteIfExists(entry);
            } catch(java.io.IOException failure) {throw new java.io.UncheckedIOException(failure);}
        }
        memories.deleteAll(memories.findByUserIdAndScopeIn(user,realm.scopes()));
        memoryRemotes.findByRepoKey(realm.repoKey()).ifPresent(memoryRemotes::delete);
        memoryDb.createQuery("delete from MemoryDocument d where d.spaceId in (select s.id from MemoryDocumentSpace s where s.scope = 'user' and s.ownerKey = :owner)")
                .setParameter("owner",String.valueOf(user)).executeUpdate();
        memoryDb.createQuery("delete from MemoryDocumentSpace s where s.scope = 'user' and s.ownerKey = :owner")
                .setParameter("owner",String.valueOf(user)).executeUpdate();
    }
}
