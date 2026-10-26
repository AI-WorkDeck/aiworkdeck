// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.localcore;

import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.ai.AutoTaggingService;
import com.checkba.service.ai.ProjectRagService;
import com.checkba.version.WorkSessionService;
import com.checkba.version.VersionAuthorResolver;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;
import java.util.Objects;
import java.util.concurrent.Executor;

/** Existing upload side effects, after publication/repository locks and after full startup. */
@Service
public class LocalCoreContentEffects {
    private static final Logger log = LoggerFactory.getLogger(LocalCoreContentEffects.class);
    private final ProjectFileRepository files;
    private final WorkSessionService sessions;
    private final VersionAuthorResolver authors;
    private final ProjectRagService rag;
    private final AutoTaggingService tags;
    private final Executor executor;

    public LocalCoreContentEffects(ProjectFileRepository files, WorkSessionService sessions, VersionAuthorResolver authors, ProjectRagService rag,
                                   AutoTaggingService tags, @Qualifier("taskExecutor") Executor executor) {
        this.files = files; this.sessions = sessions; this.authors = authors; this.rag = rag; this.tags = tags; this.executor = executor;
    }

    public void saved(LocalCoreContentService.SaveRequest request) {
        var file = files.findById(request.fileId()).orElse(null);
        if (file == null || !Objects.equals(file.getUid(), request.uid())
                || !Objects.equals(file.getProjectId(), request.projectId()) || Boolean.TRUE.equals(file.getIsDeleted())) return;
        sessions.onChangeSignal(request.projectId(), request.actorId(), authors.resolve(request.projectId(), request.actorId()).name());
        try {
            executor.execute(() -> {
                try {
                    rag.refreshProjectKnowledgeIncremental(Long.toString(request.projectId()), file.getFilePath());
                    tags.autoTagFile(request.projectId(), request.fileId(), file.getFilePath(), file.getUserId());
                } catch (Exception failure) { log.warn("Saved local content post-processing failed: fileId={}", request.fileId()); }
            });
        } catch (Exception failure) {
            // As with the ordinary upload path, a rejected optional task cannot undo saved bytes.
            log.warn("Saved local content optional task was rejected: fileId={}", request.fileId());
        }
    }
}
