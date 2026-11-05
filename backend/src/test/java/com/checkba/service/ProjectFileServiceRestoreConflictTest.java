// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service;

import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.ai.ProjectRagService;
import com.checkba.service.evidence.EvidenceLinkService;
import com.checkba.storage.StorageServiceFactory;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 还原回收站条目时，原位置已有同名活行则拒绝，避免出现两条同名同父的活行。 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ProjectFileServiceRestoreConflictTest {

    @Mock private ProjectFileRepository repo;
    @Mock private ProjectRagService projectRagService;
    @Mock private StorageServiceFactory storageServiceFactory;
    @Mock private EvidenceLinkService evidenceLinkService;
    @Mock private com.checkba.version.WorkSessionService workSessionService;
    @Mock private com.checkba.service.telemetry.TelemetryService telemetryService;
    @Mock private UserService userService;

    @InjectMocks private ProjectFileService service;

    private ProjectFile deleted;

    @BeforeEach
    void setUp() {
        deleted = new ProjectFile();
        deleted.setId(1L);
        deleted.setProjectId(7L);
        deleted.setName("A");
        deleted.setIsFolder(false);
        deleted.setIsDeleted(true);
        when(repo.findById(1L)).thenReturn(Optional.of(deleted));
    }

    @Test
    void restoreIsRejectedWhenLiveRowWithSameNameExists() {
        when(repo.existsByProjectIdAndParentIdAndNameAndIdNot(7L, null, "A", 1L)).thenReturn(true);
        assertThrows(IllegalArgumentException.class, () -> service.restore(1L, 9L));
        verify(repo, never()).save(any());
        assertFalse(!Boolean.TRUE.equals(deleted.getIsDeleted()));
    }

    @Test
    void restoreSucceedsWhenNoNameConflict() {
        when(repo.existsByProjectIdAndParentIdAndNameAndIdNot(7L, null, "A", 1L)).thenReturn(false);
        service.restore(1L, 9L);
        assertFalse(Boolean.TRUE.equals(deleted.getIsDeleted()));
    }
}
