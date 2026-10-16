// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.meeting;

import org.bytedeco.javacv.FFmpegFrameGrabber;
import org.bytedeco.javacv.FrameGrabber;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

/** 合成 MOV/QTA：第一轨是标为 apac 的 PCM 占位，第二轨 AAC；不代表真实 APAC 验证。 */
class MeetingAudioTranscoderQtaTest {
    @TempDir Path workDir;

    private File fixture() throws Exception {
        Path input = workDir.resolve("空间录音.QTA");
        try (var stream = getClass().getResourceAsStream("/fixtures/media/two-track-audio.qta")) {
            assertNotNull(stream);
            Files.copy(stream, input);
        }
        return input.toFile();
    }

    private void replaceSampleEntry(File input, String from, String to) throws Exception {
        byte[] bytes = Files.readAllBytes(input.toPath());
        String binary = new String(bytes, StandardCharsets.ISO_8859_1);
        int position = binary.indexOf(from);
        assertTrue(position >= 0);
        assertEquals("stsd", binary.substring(position - 16, position - 12));
        // 未知 fourcc 仅模拟不可解码的音轨；字节仍为合成 PCM/AAC，不是假称真实 APAC。
        // MOV 的 AAC wave 子块还会重复 mp4a、用 esds 标识 codec，需一起遮去。
        for (String token : from.equals("mp4a") ? new String[]{"mp4a", "esds"} : new String[]{from}) {
            for (int at = binary.indexOf(token); at >= 0; at = binary.indexOf(token, at + 4)) {
                System.arraycopy(to.getBytes(StandardCharsets.US_ASCII), 0, bytes, at, 4);
            }
        }
        Files.write(input.toPath(), bytes);
    }

    private void assertConverted(File input, int expectedStream) throws Exception {
        byte[] original = Files.readAllBytes(input.toPath());
        assertEquals(expectedStream, MeetingAudioTranscoder.qtaAudioStream(input));
        File result = new MeetingAudioTranscoder().toMp3(input, workDir);
        assertNotEquals(input, result, "必须真正转码，不能改后缀或回传原容器");
        assertTrue(result.getName().endsWith(".mp3"));
        try (var decoded = new FFmpegFrameGrabber(result)) {
            decoded.setSampleMode(FrameGrabber.SampleMode.SHORT);
            decoded.start();
            assertEquals(1, decoded.getAudioChannels());
            assertEquals(16000, decoded.getSampleRate());
            assertTrue(decoded.getLengthInTime() > 800_000);
            int sample = 0;
            int crossings = 0;
            short previous = 0;
            org.bytedeco.javacv.Frame frame;
            while ((frame = decoded.grabSamples()) != null) {
                var pcm = (java.nio.ShortBuffer) frame.samples[0];
                while (pcm.hasRemaining()) {
                    short current = pcm.get();
                    if (sample >= 3200 && sample < 11200 && previous <= 0 && current > 0) crossings++;
                    previous = current;
                    sample++;
                }
            }
            assertTrue(sample >= 11200, "mp3 必须实际含有音频，不能只有头部");
            // 中段半秒的正向过零频率证明实际输出了指定音轨，防止只设置 index 却仍取第一轨。
            assertEquals(expectedStream == 1 ? 880 : 220, crossings * 2, 20);
        }
        assertArrayEquals(original, Files.readAllBytes(input.toPath()));
    }

    @Test void prefersAacCompatibilityTrackOverFirstAudioTrack() throws Exception {
        assertConverted(fixture(), 1);
    }

    @Test void unknownTrackAlongsideAacIsNotSilentlyDropped() throws Exception {
        File input = fixture();
        replaceSampleEntry(input, "apac", "zzzz");
        assertEquals(input, new MeetingAudioTranscoder().toMp3(input, workDir));
    }

    @Test void independentPcmTrackAlongsideAacIsNotSilentlyDropped() throws Exception {
        File input = fixture();
        replaceSampleEntry(input, "apac", "sowt");
        assertEquals(input, new MeetingAudioTranscoder().toMp3(input, workDir));
    }

    @Test void decodesSingleTrackWithoutRequiringAac() throws Exception {
        File input = workDir.resolve("单层录音.qta").toFile();
        try (var in = getClass().getResourceAsStream("/fixtures/media/single-track-audio.qta")) {
            assertNotNull(in);
            Files.copy(in, input.toPath());
        }
        assertConverted(input, 0);
    }

    @Test void noDecodableTrackReturnsOriginalWithoutChangingIt() throws Exception {
        File input = fixture();
        replaceSampleEntry(input, "apac", "zzzz");
        replaceSampleEntry(input, "mp4a", "zzzz");
        byte[] original = Files.readAllBytes(input.toPath());
        assertEquals(input, new MeetingAudioTranscoder().toMp3(input, workDir));
        assertArrayEquals(original, Files.readAllBytes(input.toPath()));
    }

    @Test void corruptContainerReturnsOriginalWithoutChangingIt() throws Exception {
        File input = workDir.resolve("broken.qta").toFile();
        byte[] original = "not a QuickTime container".getBytes(StandardCharsets.UTF_8);
        Files.write(input.toPath(), original);
        assertEquals(input, new MeetingAudioTranscoder().toMp3(input, workDir));
        assertArrayEquals(original, Files.readAllBytes(input.toPath()));
    }

    @Test void layeredAacTracksAreNotSilentlyReducedToOne() throws Exception {
        File input = workDir.resolve("分层录音.qta").toFile();
        try (var in = getClass().getResourceAsStream("/fixtures/media/layered-audio.qta")) {
            assertNotNull(in);
            Files.copy(in, input.toPath());
        }
        byte[] original = Files.readAllBytes(input.toPath());
        assertTrue(assertThrows(IllegalStateException.class,
                () -> MeetingAudioTranscoder.qtaAudioStream(input)).getMessage().contains("多条 AAC"));
        assertEquals(input, new MeetingAudioTranscoder().toMp3(input, workDir));
        assertArrayEquals(original, Files.readAllBytes(input.toPath()));
    }
}
