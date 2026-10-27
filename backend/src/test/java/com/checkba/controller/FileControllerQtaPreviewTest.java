// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;

import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.ProjectFileAccessService;
import com.checkba.service.meeting.MeetingAudioTranscoder;
import com.checkba.storage.StorageService;
import com.checkba.storage.StorageServiceFactory;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.core.io.FileSystemResource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

@ExtendWith(MockitoExtension.class)
class FileControllerQtaPreviewTest {
    @Mock ProjectFileRepository projectFileRepository;
    @Mock ProjectFileAccessService fileAccess;
    @Mock StorageServiceFactory storageServiceFactory;
    @Mock StorageService storageService;
    @Mock MeetingAudioTranscoder audioTranscoder;
    @InjectMocks FileController controller;
    @TempDir Path dir;
    MockMvc mvc;
    ProjectFile file;
    AtomicReference<Path> conversionDir = new AtomicReference<>();

    @BeforeEach void setUp() {
        file = new ProjectFile();
        file.setId(5L);
        file.setProjectId(42L);
        file.setFileType("QTA");
        file.setName("recording.QTA");
        file.setFilePath("projects/42/recording.QTA");
        when(projectFileRepository.findById(5L)).thenReturn(Optional.of(file));
        mvc = MockMvcBuilders.standaloneSetup(controller).build();
    }

    Path fixture(String name) throws Exception {
        Path input = dir.resolve("original.QTA");
        try (var stream = getClass().getResourceAsStream("/fixtures/media/" + name)) {
            assertNotNull(stream);
            Files.copy(stream, input);
        }
        when(storageServiceFactory.getStorageService()).thenReturn(storageService);
        when(storageService.load(file.getFilePath())).thenReturn(new FileSystemResource(input));
        return input;
    }

    MvcResult request(boolean allowed) throws Exception {
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("sess")).thenReturn(7L);
            when(fileAccess.canRead(file, 7L)).thenReturn(allowed);
            return mvc.perform(get("/api/files/5/audio-preview").header("X-Session-Id", "sess")).andReturn();
        }
    }

    void realConverter() throws Exception {
        when(audioTranscoder.toPreviewMp3(any(), any())).thenAnswer(invocation -> {
            Path work = invocation.getArgument(1);
            conversionDir.set(work);
            return new MeetingAudioTranscoder().toPreviewMp3(invocation.getArgument(0), work);
        });
    }

    @Test void convertsCompatibleTrackWithoutChangingOriginalAndRemovesTemporaryFiles() throws Exception {
        Path input = fixture("two-track-audio.qta");
        byte[] original = Files.readAllBytes(input);
        realConverter();
        var response = request(true).getResponse();
        assertEquals(200, response.getStatus());
        assertEquals("audio/mpeg", response.getContentType());
        assertEquals("no-store", response.getHeader("Cache-Control"));
        Path mp3 = dir.resolve("preview.mp3");
        Files.write(mp3, response.getContentAsByteArray());
        try (var decoded = new org.bytedeco.javacv.FFmpegFrameGrabber(mp3.toFile())) {
            decoded.start();
            assertEquals(44100, decoded.getSampleRate());
            assertTrue(decoded.getLengthInTime() > 800000);
            assertNotNull(decoded.grabSamples());
        }
        assertArrayEquals(original, Files.readAllBytes(input));
        assertFalse(Files.exists(conversionDir.get()));
    }

    @Test void layeredAudioFailsWithInstructionsAndNeverReturnsOriginal() throws Exception {
        Path input = fixture("layered-audio.qta");
        byte[] original = Files.readAllBytes(input);
        realConverter();
        var response = request(true).getResponse();
        assertEquals(422, response.getStatus());
        assertTrue(response.getContentAsString().contains("M4A"));
        assertFalse(Files.exists(conversionDir.get()));
        assertArrayEquals(original, Files.readAllBytes(input));
    }

    @Test void missingNativeLibraryShowsRepairInstructionsAndCleansUp() throws Exception {
        fixture("single-track-audio.qta");
        when(audioTranscoder.toPreviewMp3(any(), any())).thenAnswer(invocation -> {
            conversionDir.set(invocation.getArgument(1));
            throw new UnsatisfiedLinkError("test missing native library");
        });
        var response = request(true).getResponse();
        assertEquals(503, response.getStatus());
        assertTrue(response.getContentAsString().contains("AI WorkDeck"));
        assertFalse(Files.exists(conversionDir.get()));
    }

    @Test void wrappedNativeLoaderFailureShowsRepairInstructions() throws Exception {
        fixture("single-track-audio.qta");
        when(audioTranscoder.toPreviewMp3(any(), any())).thenAnswer(invocation -> {
            conversionDir.set(invocation.getArgument(1));
            // JavaCV tryLoad wraps Loader errors in FFmpegFrameGrabber.Exception (an IOException).
            throw new org.bytedeco.javacv.FFmpegFrameGrabber.Exception("Failed to load FFmpeg",
                    new UnsatisfiedLinkError("test incompatible native architecture"));
        });
        var response = request(true).getResponse();
        assertEquals(503, response.getStatus());
        assertTrue(response.getContentAsString().contains("AI WorkDeck"));
        assertFalse(Files.exists(conversionDir.get()));
    }

    @Test void decoderFailureWithoutNativeLoadingCauseIsNotTreatedAsMissingComponent() throws Exception {
        fixture("single-track-audio.qta");
        when(audioTranscoder.toPreviewMp3(any(), any())).thenAnswer(invocation -> {
            conversionDir.set(invocation.getArgument(1));
            throw new org.bytedeco.javacv.FFmpegFrameGrabber.Exception("Could not open input");
        });
        var response = request(true).getResponse();
        assertEquals(422, response.getStatus());
        assertTrue(response.getContentAsString().contains("M4A"));
        assertFalse(Files.exists(conversionDir.get()));
    }

    @Test void encoderFailureWithoutNativeLoadingCauseIsNotTreatedAsDiskFailure() throws Exception {
        fixture("single-track-audio.qta");
        when(audioTranscoder.toPreviewMp3(any(), any())).thenAnswer(invocation -> {
            conversionDir.set(invocation.getArgument(1));
            throw new org.bytedeco.javacv.FFmpegFrameRecorder.Exception("Could not encode audio");
        });
        var response = request(true).getResponse();
        assertEquals(422, response.getStatus());
        assertFalse(Files.exists(conversionDir.get()));
    }

    @Test void oversizedFileRejectedBeforeCopyOrConversion() throws Exception {
        Path input = fixture("single-track-audio.qta");
        try (var sparse = new java.io.RandomAccessFile(input.toFile(), "rw")) {
            sparse.setLength(512L * 1024 * 1024 + 1);
        }
        var response = request(true).getResponse();
        assertEquals(413, response.getStatus());
        assertTrue(response.getContentAsString().contains("512 MB"));
        verifyNoInteractions(audioTranscoder);
        assertEquals(512L * 1024 * 1024 + 1, Files.size(input));
    }

    @Test void storageFailureHasFileAndDiskGuidance() throws Exception {
        when(storageServiceFactory.getStorageService()).thenReturn(storageService);
        when(storageService.load(file.getFilePath())).thenThrow(new com.checkba.storage.StorageException("missing"));
        var response = request(true).getResponse();
        assertEquals(500, response.getStatus());
        verifyNoInteractions(audioTranscoder);
        assertFalse(response.getContentAsString().contains("M4A"));
    }

    @Test void conversionTimeoutShowsGuidanceAndCleansUp() throws Exception {
        fixture("single-track-audio.qta");
        when(audioTranscoder.toPreviewMp3(any(), any())).thenAnswer(invocation -> {
            conversionDir.set(invocation.getArgument(1));
            throw new java.util.concurrent.TimeoutException("test timeout");
        });
        var response = request(true).getResponse();
        assertEquals(504, response.getStatus());
        assertTrue(response.getContentAsString().contains("M4A"));
        assertFalse(Files.exists(conversionDir.get()));
    }

    @Test void permissionDeniedBeforeStorageOrConversion() throws Exception {
        assertEquals(403, request(false).getResponse().getStatus());
        verifyNoInteractions(storageServiceFactory, storageService, audioTranscoder);
    }

    @Test void rejectsNonQtaBeforeReadingStorage() throws Exception {
        file.setFileType("docx");
        assertEquals(400, request(true).getResponse().getStatus());
        verifyNoInteractions(storageServiceFactory, storageService, audioTranscoder);
    }
}
