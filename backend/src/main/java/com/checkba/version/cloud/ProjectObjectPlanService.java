// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version.cloud;

import com.checkba.model.entity.ProjectObjectLocalOnly;
import com.checkba.model.entity.ProjectObjectPlan;
import com.checkba.repository.ProjectObjectLocalOnlyRepository;
import com.checkba.repository.ProjectObjectPlanRepository;
import com.checkba.repository.ProjectRepository;
import com.checkba.version.objects.LocalVersionObjectStore.ObjectRef;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * C12 (owner decision 2026-11-26; spec readiness/specs/C12-large-files.md): large and audio/video files never
 * block 交稿. Up to {@code free-per-file-bytes} per file and {@code free-per-project-bytes} per matter (lifetime)
 * they are shared for free; beyond that, without paid backup, they stay on the sharer's computer and the push is
 * accepted with a local-only declaration.
 */
@Service
public class ProjectObjectPlanService {
    static final long RESERVATION_TTL_HOURS = 24;
    static final int MAX_OPEN_DECLARATIONS = 10_000;

    private final ProjectObjectPlanRepository plans;
    private final ProjectObjectLocalOnlyRepository localOnly;
    private final ProjectRepository projects;
    private final long freePerFileBytes;
    private final long freePerProjectBytes;

    public ProjectObjectPlanService(ProjectObjectPlanRepository plans, ProjectObjectLocalOnlyRepository localOnly,
                                    ProjectRepository projects,
                                    @Value("${collab.objects.free-per-file-bytes:52428800}") long freePerFileBytes,
                                    @Value("${collab.objects.free-per-project-bytes:524288000}") long freePerProjectBytes) {
        this.plans = plans; this.localOnly = localOnly; this.projects = projects;
        this.freePerFileBytes = freePerFileBytes; this.freePerProjectBytes = freePerProjectBytes;
    }

    /** Refused free upload: answered as HTTP 409 {@code {"code":"FREE_LIMIT",...}}, nothing stored. */
    public static final class FreeLimitException extends RuntimeException {
        private final long freePerFileBytes, freePerProjectBytes, projectFreeUsedBytes;
        FreeLimitException(long perFile, long perProject, long used) {
            super("FREE_LIMIT");
            this.freePerFileBytes = perFile; this.freePerProjectBytes = perProject; this.projectFreeUsedBytes = used;
        }
        public Map<String, Object> body() {
            return Map.of("code", "FREE_LIMIT", "freePerFileBytes", freePerFileBytes,
                    "freePerProjectBytes", freePerProjectBytes, "projectFreeUsedBytes", projectFreeUsedBytes);
        }
    }

    public long freePerFileBytes() { return freePerFileBytes; }
    public long freePerProjectBytes() { return freePerProjectBytes; }

    /** Free bytes counted against the matter (reserved and complete). Sweeps expired reservations first. */
    @Transactional
    public long projectFreeUsedBytes(long projectId) {
        plans.releaseExpired(projectId, LocalDateTime.now().minusHours(RESERVATION_TTL_HOURS));
        return plans.freeBytes(projectId);
    }

    /** Completed free bytes only: what the storage quota and the bill must leave out. */
    public long completedFreeBytes(long projectId) { return plans.completedFreeBytes(projectId); }

    /** Completed free objects of the case (sha256), for excluding the server's working copies from the bill. */
    public java.util.Set<String> completedFreeShas(long projectId) {
        java.util.Set<String> out = new java.util.HashSet<>();
        for (var row : plans.findByProjectIdAndPlanAndState(projectId, ProjectObjectPlan.FREE, ProjectObjectPlan.COMPLETE))
            out.add(row.getObjectSha());
        return out;
    }

    /**
     * Reserve {@code object} on the free plan. Serialized per matter by a row lock on the project and made
     * idempotent by the unique (project, sha) row, so concurrent or repeated uploads count once. The caller runs
     * this in the same transaction as the write-permission (epoch) fence, so a refused write leaves no reservation.
     */
    @Transactional
    public void reserveFree(long projectId, ObjectRef object) {
        projects.lockForImWrite(projectId).orElseThrow(() -> new IllegalArgumentException("Project not found"));
        var existing = plans.findByProjectIdAndObjectSha(projectId, object.sha256());
        if (existing.isPresent()) {
            ProjectObjectPlan row = existing.get();
            if (row.getObjectSize() != object.size()) throw new IllegalArgumentException("Object size mismatch");
            if (ProjectObjectPlan.FREE.equals(row.getPlan())) return;
        }
        plans.releaseExpired(projectId, LocalDateTime.now().minusHours(RESERVATION_TTL_HOURS));
        long used = plans.freeBytes(projectId);
        if (object.size() > freePerFileBytes || used + object.size() > freePerProjectBytes)
            throw new FreeLimitException(freePerFileBytes, freePerProjectBytes, used);
        ProjectObjectPlan row = existing.orElseGet(ProjectObjectPlan::new);
        row.setProjectId(projectId);
        row.setObjectSha(object.sha256());
        row.setObjectSize(object.size());
        row.setPlan(ProjectObjectPlan.FREE);
        row.setState(ProjectObjectPlan.RESERVED);
        row.setReservedAt(LocalDateTime.now());
        plans.save(row);
    }

    /** The object is now on the library: its reservation becomes permanent and any local-only declaration ends. */
    @Transactional
    public void markComplete(long projectId, ObjectRef object) {
        plans.findByProjectIdAndObjectSha(projectId, object.sha256()).ifPresent(row -> {
            if (!ProjectObjectPlan.COMPLETE.equals(row.getState())) {
                row.setState(ProjectObjectPlan.COMPLETE);
                row.setCompletedAt(LocalDateTime.now());
                plans.save(row);
            }
        });
        localOnly.deleteByProjectIdAndObjectSha(projectId, object.sha256());
    }

    /** Idempotent per (project, sha). nameHint is reduced to a sanitised basename of at most 200 chars. */
    @Transactional
    public void declareLocalOnly(long projectId, ObjectRef object, long userId, String pathHint) {
        projects.lockForImWrite(projectId).orElseThrow(() -> new IllegalArgumentException("Project not found"));
        var existing = localOnly.findByProjectIdAndObjectSha(projectId, object.sha256());
        if (existing.isPresent()) {
            if (existing.get().getObjectSize() != object.size()) throw new IllegalArgumentException("Object size mismatch");
            return;
        }
        if (localOnly.countByProjectId(projectId) >= MAX_OPEN_DECLARATIONS)
            throw new IllegalArgumentException("Too many local-only files in this case");
        ProjectObjectLocalOnly row = new ProjectObjectLocalOnly();
        row.setProjectId(projectId);
        row.setObjectSha(object.sha256());
        row.setObjectSize(object.size());
        row.setDeclaredBy(userId);
        row.setDeclaredAt(LocalDateTime.now());
        row.setNameHint(nameHint(pathHint));
        localOnly.save(row);
    }

    /** Pre-receive and ingest: the object may be absent because its sharer declared it local-only (same size). */
    public boolean isDeclaredLocalOnly(long projectId, ObjectRef object) {
        return localOnly.findByProjectIdAndObjectSha(projectId, object.sha256())
                .map(row -> row.getObjectSize() == object.size()).orElse(false);
    }

    public List<ProjectObjectLocalOnly> localOnly(long projectId) { return localOnly.findByProjectId(projectId); }

    /** Cheap guard: most cases have no local-only files, so their git paths skip the per-file lookups. */
    public boolean hasLocalOnly(long projectId) { return localOnly.countByProjectId(projectId) > 0; }

    static String nameHint(String pathHint) {
        if (pathHint == null) return null;
        String name = pathHint.replace('\\', '/');
        name = name.substring(name.lastIndexOf('/') + 1).replaceAll("\\p{Cntrl}", "").trim();
        if (name.isEmpty() || ".".equals(name) || "..".equals(name)) return null;
        return name.length() > 200 ? name.substring(0, 200) : name;
    }
}
