// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.meeting;

import com.checkba.model.entity.MeetingRecording;
import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.MeetingRecordingRepository;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.SystemSettingService;
import com.checkba.service.platform.ExternalProviderResolver;
import com.checkba.service.platform.ExternalServiceProvider;
import com.checkba.service.platform.PlatformGatewayClient;
import com.checkba.storage.ProjectStorageResolver;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.bytedeco.javacv.FFmpegFrameGrabber;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** 真转码 + 三档编排，所有上传与 ASR 均为本机 mock，不使用真实凭证或产生云调用。 */
class MeetingQtaTranscriptionTest {
    @TempDir Path tempDir;
    private final MeetingRecordingRepository meetings = mock(MeetingRecordingRepository.class);
    private final ProjectFileRepository files = mock(ProjectFileRepository.class);
    private final ProjectStorageResolver storage = mock(ProjectStorageResolver.class);
    private final SystemSettingService settings = mock(SystemSettingService.class);
    private final ExternalProviderResolver resolver = mock(ExternalProviderResolver.class);
    private final PlatformGatewayClient gateway = mock(PlatformGatewayClient.class);
    private final MeetingOssClient oss = mock(MeetingOssClient.class);
    private final TingwuClient tingwu = mock(TingwuClient.class);
    private final LocalAsrClient local = mock(LocalAsrClient.class);
    private final MeetingTranscriptionService.BinaryUploader uploader = mock(MeetingTranscriptionService.BinaryUploader.class);
    private final MeetingRecording meeting = new MeetingRecording();
    private final CountDownLatch completed = new CountDownLatch(1);
    private final AtomicReference<File> delivered = new AtomicReference<>();

    @BeforeEach void setUp() throws Exception {
        meeting.setId(7L);
        meeting.setProjectId(1L);
        meeting.setAudioFileId(11L);
        meeting.setCreatedBy(10001L);
        meeting.setDurationMs(1000L);
        meeting.setStatus(MeetingRecording.STATUS_RECORDED);
        when(meetings.findById(7L)).thenReturn(Optional.of(meeting));
        when(meetings.save(any())).thenAnswer(inv -> {
            if (MeetingRecording.STATUS_FAILED.equals(meeting.getStatus())
                    || MeetingRecording.STATUS_TRANSCRIBED.equals(meeting.getStatus())
                    || meeting.getGatewayTaskId() != null || meeting.getTingwuTaskId() != null) completed.countDown();
            return inv.getArgument(0);
        });
        ProjectFile file = new ProjectFile();
        file.setFilePath("projects/1/空间录音.QTA");
        when(files.findById(11L)).thenReturn(Optional.of(file));
        when(storage.resolve(anyString())).thenReturn(tempDir.resolve("空间录音.QTA"));
        when(settings.get(anyString(), anyString())).thenReturn("test-only-placeholder");
        when(settings.get(eq(MeetingRecordingNotice.KEY_ACKNOWLEDGED_AT), anyString())).thenReturn("2026-10-16T00:00:00Z");
        when(settings.get(eq(MeetingRecordingNotice.KEY_VERSION), anyString())).thenReturn(MeetingRecordingNotice.VERSION);
        when(gateway.connected()).thenReturn(true);
        when(local.probe()).thenReturn(new LocalAsrClient.ProbeResult(
                LocalAsrClient.Status.READY, "http://127.0.0.1:8890", "test", false, "ready", ""));
    }

    private void run(ExternalServiceProvider tier) throws Exception {
        when(resolver.resolve(ExternalServiceProvider.ASR)).thenReturn(tier);
        new MeetingTranscriptionService(meetings, files, storage, settings, new MeetingAudioTranscoder(),
                tingwu, oss, resolver, gateway, local, mock(MeetingTranscriptionService.UrlFetcher.class),
                uploader, MeetingTranscriptionService.DEFAULT_TRANSCODE_TIMEOUT, "", "", "", "", "")
                .startTranscription(7L);
        assertTrue(completed.await(15, TimeUnit.SECONDS), "转写编排未完成");
    }

    private void capture(File audio) throws Exception {
        delivered.set(audio);
        Files.copy(audio.toPath(), tempDir.resolve("delivered.mp3"));
    }

    @ParameterizedTest @EnumSource(ExternalServiceProvider.class)
    void failedQtaConversionNeverUploadsOrStartsAsr(ExternalServiceProvider tier) throws Exception {
        Path source = tempDir.resolve("空间录音.QTA");
        byte[] original = "invalid QuickTime audio".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        Files.write(source, original);
        assertRejectedWithoutUpload(tier, source);
    }

    @ParameterizedTest @EnumSource(ExternalServiceProvider.class)
    void layeredQtaNeverLosesOneTrackOrUploadsOriginal(ExternalServiceProvider tier) throws Exception {
        Path source = tempDir.resolve("空间录音.QTA");
        try (var in = getClass().getResourceAsStream("/fixtures/media/layered-audio.qta")) {
            assertNotNull(in);
            Files.copy(in, source);
        }
        assertRejectedWithoutUpload(tier, source);
        assertTrue(meeting.getError().contains("M4A"), meeting.getError());
    }

    private void assertRejectedWithoutUpload(ExternalServiceProvider tier, Path source) throws Exception {
        byte[] original = Files.readAllBytes(source);
        run(tier);
        assertEquals(MeetingRecording.STATUS_FAILED, meeting.getStatus());
        assertTrue(meeting.getError().contains("QTA"), meeting.getError());
        assertTrue(meeting.getError().contains("M4A"), meeting.getError());
        verify(gateway, never()).postJson(anyString(), anyMap(), anyBoolean(), anyInt());
        verifyNoInteractions(uploader, oss, tingwu);
        verify(local, never()).transcribe(any());
        assertArrayEquals(original, Files.readAllBytes(source));
    }

    @ParameterizedTest @EnumSource(ExternalServiceProvider.class)
    void successfulQtaConversionDeliversRealMp3AndPreservesSource(ExternalServiceProvider tier) throws Exception {
        Path source = tempDir.resolve("空间录音.QTA");
        try (var in = getClass().getResourceAsStream("/fixtures/media/two-track-audio.qta")) {
            assertNotNull(in);
            Files.copy(in, source);
        }
        byte[] original = Files.readAllBytes(source);
        when(local.transcribe(any())).thenAnswer(inv -> {
            capture(inv.getArgument(0));
            return "{\"segments\":[{\"start\":0,\"end\":1,\"text\":\"测试\"}]}";
        });
        when(oss.uploadAndSign(any(), anyString(), any(), any())).thenAnswer(inv -> {
            capture(inv.getArgument(2));
            return "https://example.invalid/audio.mp3";
        });
        when(tingwu.submitTask(any(), anyString())).thenReturn("test-tingwu-task");
        var mapper = new ObjectMapper();
        when(gateway.postJson(eq("/api/gateway/asr/ticket"), anyMap(), eq(false), anyInt()))
                .thenReturn(mapper.readTree("{\"objectKey\":\"test.mp3\",\"uploadUrl\":\"https://example.invalid/upload\",\"contentType\":\"audio/mpeg\"}"));
        when(gateway.postJson(eq("/api/gateway/asr/submit"), anyMap(), eq(true), anyInt()))
                .thenReturn(mapper.readTree("{\"taskId\":\"test-platform-task\"}"));
        doAnswer(inv -> { capture(inv.getArgument(1)); return null; })
                .when(uploader).put(anyString(), any(), anyString());
        run(tier);
        assertNotEquals(MeetingRecording.STATUS_FAILED, meeting.getStatus(), meeting.getError());
        assertNotNull(delivered.get());
        assertTrue(delivered.get().getName().endsWith(".mp3"));
        assertNotEquals(source.toFile(), delivered.get());
        try (var decoded = new FFmpegFrameGrabber(tempDir.resolve("delivered.mp3").toFile())) {
            decoded.start();
            assertEquals(16000, decoded.getSampleRate());
            assertEquals(1, decoded.getAudioChannels());
            assertNotNull(decoded.grabSamples());
        }
        assertArrayEquals(original, Files.readAllBytes(source));
    }
}
