// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version;

import com.checkba.localcore.LocalCoreContentService;
import com.checkba.localcore.LocalCoreContentService.BeforeImage;
import com.checkba.model.entity.Project;
import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.repository.ProjectRepository;
import com.checkba.storage.ProjectStorageResolver;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Objects;
import java.util.TreeMap;

/** Synchronous version admission only: no change signals, timers or background writers are started. */
@Service
public final class LocalCoreVersionHandoff {
    private final ProjectRepoService repos;
    private final WorkSessionService sessions;
    private final ProjectTreeManifestService manifests;
    private final VersionLifecycleService lifecycle;
    private final ProjectRepository projects;
    private final ProjectFileRepository files;
    private final ProjectStorageResolver storage;

    public LocalCoreVersionHandoff(ProjectRepoService repos, WorkSessionService sessions,
                                   ProjectTreeManifestService manifests, VersionLifecycleService lifecycle,
                                   ProjectRepository projects, ProjectFileRepository files, ProjectStorageResolver storage) {
        this.repos = repos; this.sessions = sessions; this.manifests = manifests; this.lifecycle = lifecycle;
        this.projects = projects; this.files = files; this.storage = storage;
    }

    /** Startup only, after core leases drain and before any legacy business writers are admitted. */
    public void handoff(LocalCoreContentService content) throws IOException, SQLException {
        handoff(content, null);
    }

    /** A normal save already holds this project's lock; never acquire another project's lock here. */
    public void handoffProject(LocalCoreContentService content, long projectId) throws IOException, SQLException {
        handoff(content, projectId);
    }

    private void handoff(LocalCoreContentService content, Long onlyProject) throws IOException, SQLException {
        if (TransactionSynchronizationManager.isActualTransactionActive())
            throw new IllegalStateException("Version handoff cannot wait for a repository lock inside a database transaction");
        // The content API still scans manifest metadata; filtering here limits lock scope, not scan cost.
        var grouped = new TreeMap<Long, List<BeforeImage>>();
        for (BeforeImage image : content.beforeImagesForHandoff()) {
            long projectId = image.request().projectId();
            if (onlyProject == null || onlyProject == projectId)
                grouped.computeIfAbsent(projectId, ignored -> new ArrayList<>()).add(image);
        }
        for (var group : grouped.entrySet()) {
            group.getValue().sort(Comparator.comparingLong(BeforeImage::receiptSequence));
            sessions.runLocked(group.getKey(), () -> {
                try { handoffLocked(content, group.getKey(), group.getValue()); }
                catch (IOException | SQLException error) { throw new VersionException("修改前版本交接失败", error); }
            });
        }
    }

    private void handoffLocked(LocalCoreContentService content, long projectId, List<BeforeImage> images)
            throws IOException, SQLException {
        Project project = projects.findById(projectId).orElseThrow(() -> new VersionException("版本交接项目已不可用"));
        Path work = project.getLocalRoot() == null || project.getLocalRoot().isBlank()
                ? storage.globalRoot().resolve("projects").resolve(Long.toString(projectId)) : Path.of(project.getLocalRoot());
        if (!work.isAbsolute()) throw new VersionException("版本交接项目路径无效");
        work = work.normalize();
        if (!work.equals(repos.workTree(projectId).toAbsolutePath().normalize()))
            throw new VersionException("版本交接项目路径已变化");
        var byId = new HashMap<Long, ProjectFile>();
        var uidCounts = new HashMap<String, Integer>();
        for (ProjectFile file : files.findByProjectId(projectId)) {
            byId.put(file.getId(), file);
            uidCounts.merge(file.getUid(), 1, Integer::sum);
        }
        var firstByUid = new LinkedHashMap<String, BeforeImage>();
        var relativeByUid = new HashMap<String, String>();
        var pathOwners = new HashMap<String, String>();
        for (BeforeImage image : images) {
            var request = image.request();
            ProjectFile file = byId.get(request.fileId());
            if (file == null || !Objects.equals(file.getProjectId(), projectId)
                    || !Objects.equals(file.getUid(), request.uid()) || uidCounts.getOrDefault(request.uid(), 0) != 1
                    || Boolean.TRUE.equals(file.getIsFolder()) || Boolean.TRUE.equals(file.getIsDeleted())
                    || !Objects.equals(file.getFilePath(), image.storageKey())
                    || !Objects.equals(file.getExternalPath(), image.externalPath()))
                throw new VersionException("版本交接文件身份或路径已变化");
            String relative = relativePath(project, image, work);
            String previous = relativeByUid.putIfAbsent(request.uid(), relative);
            String owner = pathOwners.putIfAbsent(relative, request.uid());
            if ((previous != null && !previous.equals(relative)) || (owner != null && !owner.equals(request.uid())))
                throw new VersionException("版本交接文件路径存在冲突");
            firstByUid.putIfAbsent(request.uid(), image);
        }
        // Even an existing HEAD cannot acknowledge a receipt after its numeric file ID was reused.
        String head = repos.coreBaselineHead(projectId);
        if (head != null) {
            acknowledge(content, images, "EXISTING_HEAD:" + head);
            return;
        }
        var paths = new LinkedHashMap<String, Path>();
        var sizes = new LinkedHashMap<String, Long>();
        for (var first : firstByUid.entrySet()) {
            String relative = relativeByUid.get(first.getKey());
            paths.put(relative, first.getValue().image()); sizes.put(relative, first.getValue().beforeSize());
        }
        var last = images.get(images.size() - 1);
        var policy = lifecycle.coreBaselinePolicy(project, last.request().actorId(), sizes);
        if (policy.skipReason() != null) {
            acknowledge(content, images, "SKIP:" + policy.skipReason());
            return;
        }
        TreeManifest tree = manifests.capture(projectId);
        head = repos.initWithCoreBaseline(projectId, policy.authorName(), policy.authorEmail(), batchId(projectId, images), paths,
                () -> manifests.writeToWorkTree(projectId, tree));
        acknowledge(content, images, "CREATED:" + head);
    }

    private static String relativePath(Project project, BeforeImage image, Path work) {
        String key = image.storageKey(), prefix = "projects/" + project.getId() + "/";
        if (key == null || !key.startsWith(prefix) || key.indexOf('\\') >= 0 || key.indexOf('\0') >= 0)
            throw new VersionException("版本交接文件路径无效");
        String relative = key.substring(prefix.length());
        if (Path.of(relative).isAbsolute() || relative.startsWith(".awd/")) throw new VersionException("版本交接文件路径无效");
        for (String part : relative.split("/", -1)) {
            if (part.isEmpty() || part.equals(".") || part.equals("..") || part.equalsIgnoreCase(".git"))
                throw new VersionException("版本交接文件路径无效");
        }
        Path target;
        if (project.isLooseFileWorkspace() && relative.startsWith("loose/")) {
            if (image.externalPath() == null || image.externalPath().isBlank()) throw new VersionException("独立文件路径无效");
            target = Path.of(image.externalPath());
        } else {
            if (image.externalPath() != null) throw new VersionException("版本交接文件路径已变化");
            target = work.resolve(relative);
        }
        if (!target.isAbsolute() || !target.equals(target.normalize()) || !target.toString().equals(image.targetPath()))
            throw new VersionException("版本交接文件实际路径已变化");
        return relative;
    }

    private static String batchId(long projectId, List<BeforeImage> images) {
        StringBuilder input = new StringBuilder().append(projectId).append('\n');
        for (BeforeImage image : images) input.append(image.receiptSequence()).append(':').append(image.request().operationId()).append('\n');
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(input.toString().getBytes(StandardCharsets.UTF_8))); }
        catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }

    private static void acknowledge(LocalCoreContentService content, List<BeforeImage> images, String outcome)
            throws IOException, SQLException {
        for (int start = 0; start < images.size(); start += 200)
            content.acknowledgeHandoff(images.subList(start, Math.min(start + 200, images.size())), outcome);
    }
}
