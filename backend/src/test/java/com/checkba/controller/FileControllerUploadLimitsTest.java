// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller;

import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.UserRateLimiter;
import com.checkba.service.ai.AutoTaggingService;
import com.checkba.service.ai.ProjectRagService;
import com.checkba.storage.StorageService;
import com.checkba.storage.StorageServiceFactory;
import com.checkba.version.WorkSessionService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.MockedStatic;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.util.unit.DataSize;

import java.io.InputStream;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/** Server-profile upload limits on POST /api/files/{id}/upload: per-user rate (429) and per-request size (413). */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class FileControllerUploadLimitsTest {

    @Mock private ProjectFileRepository projectFileRepository;
    @Mock private ProjectMemberService projectMemberService;
    @Mock private StorageServiceFactory storageServiceFactory;
    @Mock private ProjectRagService projectRagService;
    @Mock private AutoTaggingService autoTaggingService;
    @Mock private StorageService storageService;
    @Mock private WorkSessionService workSessionService;
    @Mock private com.checkba.storage.ProjectStorageResolver storageResolver;
    @Mock private com.checkba.service.ProjectFileAccessService fileAccess;

    @InjectMocks private FileController controller;

    private static final String FILE_PATH = "projects/4/a.pdf";

    @BeforeEach
    void wire() throws Exception {
        ReflectionTestUtils.setField(controller, "contentService",
                com.checkba.service.ContentServiceTestSupport.create(projectFileRepository, storageServiceFactory,
                        projectMemberService, fileAccess, storageResolver, workSessionService));
        ProjectFile pf = new ProjectFile();
        pf.setId(16L);
        pf.setProjectId(4L);
        pf.setName("a.pdf");
        pf.setFileType("pdf");
        pf.setFilePath(FILE_PATH);
        when(projectFileRepository.findById(16L)).thenReturn(Optional.of(pf));
        when(projectFileRepository.sumSizeByProjectId(4L)).thenReturn(0L);
        when(storageServiceFactory.getStorageService()).thenReturn(storageService);
        when(storageService.save(any(), any())).thenReturn(FILE_PATH);
        when(storageService.append(any(), any())).thenReturn(FILE_PATH);
        when(storageService.getSize(FILE_PATH)).thenReturn(3L);
        when(projectMemberService.hasWritePermission(4L, 7L)).thenReturn(true);
    }

    private static MockHttpServletRequest body(int bytes) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setContentType("application/octet-stream");
        request.setContent(new byte[bytes]);
        return request;
    }

    private ResponseEntity<Map<String, Object>> upload(Long offset, int bytes) {
        try (MockedStatic<AuthController> auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("sess")).thenReturn(7L);
            return controller.uploadFile("16", null, offset, "sess", null, body(bytes));
        }
    }

    private void limiter(boolean localMode) {
        // upload-per-minute = 1: the second upload start inside a minute is over the limit
        ReflectionTestUtils.setField(controller, "rateLimiter", new UserRateLimiter(localMode, 30, 1, 20, 120));
    }

    @Test
    void serverModeRejectsUploadStartsOverTheLimitWith429() {
        limiter(false);
        assertEquals(200, upload(null, 3).getStatusCode().value());
        ResponseEntity<Map<String, Object>> second = upload(0L, 3);
        assertEquals(429, second.getStatusCode().value());
        assertEquals("RATE_LIMITED", second.getBody().get("reason"));
        assertNotNull(second.getHeaders().getFirst("Retry-After"));
        assertTrue(String.valueOf(second.getBody().get("message")).length() > 0);
        verify(storageService, times(1)).save(any(), any(InputStream.class));
    }

    @Test
    void appendedChunksOfTheSameUploadAreNotCounted() {
        limiter(false);
        assertEquals(200, upload(0L, 3).getStatusCode().value());
        assertEquals(200, upload(3L, 3).getStatusCode().value(), "offset>0 continues the same file");
    }

    @Test
    void localModeIsNeverRateLimited() {
        limiter(true);
        for (int i = 0; i < 5; i++) assertEquals(200, upload(0L, 3).getStatusCode().value());
    }

    @Test
    void octetStreamOverMaxUploadSizeIsRejectedBeforeWriting() {
        ReflectionTestUtils.setField(controller, "maxUploadSize", DataSize.ofBytes(2));
        ResponseEntity<Map<String, Object>> resp = upload(null, 3);
        assertEquals(413, resp.getStatusCode().value());
        assertEquals("UPLOAD_TOO_LARGE", resp.getBody().get("reason"));
        verify(storageService, never()).save(any(), any(InputStream.class));
        ReflectionTestUtils.setField(controller, "maxUploadSize", DataSize.ofBytes(3));
        assertEquals(200, upload(null, 3).getStatusCode().value(), "exactly at the cap is allowed");
    }
}
