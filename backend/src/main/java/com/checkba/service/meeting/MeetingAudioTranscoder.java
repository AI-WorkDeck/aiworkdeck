// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.meeting;

import lombok.extern.slf4j.Slf4j;
import org.bytedeco.ffmpeg.avformat.AVFormatContext;
import org.bytedeco.ffmpeg.avformat.AVInputFormat;
import org.bytedeco.ffmpeg.avutil.AVDictionary;
import org.bytedeco.ffmpeg.global.avcodec;
import org.bytedeco.ffmpeg.global.avformat;
import org.bytedeco.ffmpeg.global.avutil;
import org.bytedeco.javacv.FFmpegFrameGrabber;
import org.bytedeco.javacv.FFmpegFrameRecorder;
import org.bytedeco.javacv.Frame;
import org.springframework.stereotype.Component;

import java.io.File;
import java.nio.file.Path;
import java.util.Locale;

/**
 * 录音转码：MediaRecorder 产出的 webm/opus 转成 16kHz 单声道 mp3 再送听悟。
 * 两个理由：mp3 是听悟明确支持的格式（webm 容器未在支持清单里），
 * 且 48kbps 单声道把上传体积压到 wav 的二十分之一。
 * 转码失败返回原文件；调用方必须拦下视频与 QTA，不能将未转换的容器交给转写服务。
 */
@Slf4j
@Component
public class MeetingAudioTranscoder {

    private static final int SAMPLE_RATE = 16000;
    /** 包内可见：平台档在前端没回报时长时按这个码率从产物体积反推时长。 */
    static final int BITRATE = 48_000;

    /** 转成 mp3；失败时返回原文件（调用方按返回文件的扩展名决定 OSS objectKey）。 */
    public File toMp3(File input, Path workDir) {
        File output = workDir.resolve("meeting-audio.mp3").toFile();
        try (FFmpegFrameGrabber grabber = new FFmpegFrameGrabber(input)) {
            if (isQuickTimeAudio(input.getName())) {
                grabber.setAudioStream(qtaAudioStream(input));
            }
            grabber.start();
            boolean recordedSamples = false;
            try (FFmpegFrameRecorder recorder = new FFmpegFrameRecorder(output, 1)) {
                recorder.setFormat("mp3");
                recorder.setAudioCodec(avcodec.AV_CODEC_ID_MP3);
                recorder.setSampleRate(SAMPLE_RATE);
                recorder.setAudioBitrate(BITRATE);
                recorder.setAudioChannels(1);
                recorder.start();
                Frame frame;
                while ((frame = grabber.grabSamples()) != null) {
                    recorder.record(frame);
                    recordedSamples = true;
                }
                recorder.stop();
            }
            grabber.stop();
            if (recordedSamples && output.length() > 0) {
                return output;
            }
            log.warn("转码产物为空，回退原始音频: {}", input.getName());
            return input;
        } catch (Throwable t) {
            // Throwable：bytedeco 原生库缺失时抛 UnsatisfiedLinkError，不能让它穿透
            log.warn("音频转码失败，回退原始音频: {}", t.toString());
            return input;
        }
    }

    static boolean isQuickTimeAudio(String name) {
        return name != null && name.toLowerCase(Locale.ROOT).endsWith(".qta");
    }

    /** QTA 可同时有空间音轨和 AAC 兼容音轨，不能让抓取器盲选第一条音轨。 */
    static int qtaAudioStream(File input) throws Exception {
        FFmpegFrameGrabber.tryLoad();
        AVFormatContext context = new AVFormatContext(null);
        try {
            if (avformat.avformat_open_input(context, input.getAbsolutePath(),
                    (AVInputFormat) null, (AVDictionary) null) < 0
                    || avformat.avformat_find_stream_info(context, (org.bytedeco.javacpp.PointerPointer) null) < 0) {
                throw new IllegalStateException("无法读取 QTA 音轨");
            }
            int fallback = -1;
            int aac = -1;
            int audioTracks = 0;
            boolean otherTracksAreApac = true;
            for (int i = 0; i < context.nb_streams(); i++) {
                var codec = context.streams(i).codecpar();
                if (codec.codec_type() != avutil.AVMEDIA_TYPE_AUDIO) continue;
                audioTracks++;
                var decoder = avcodec.avcodec_find_decoder(codec.codec_id());
                boolean canDecode = decoder != null && !decoder.isNull();
                if (codec.codec_id() == avcodec.AV_CODEC_ID_AAC && canDecode) {
                    if (aac >= 0) throw new IllegalStateException("QTA 含多条 AAC 音轨，需要先分离录音层导出");
                    aac = i;
                } else {
                    // APAC 是 AAC 兼容轨之外的空间音轨；其他轨可能是独立人声，不能丢弃。
                    otherTracksAreApac &= codec.codec_tag() == ('a' | 'p' << 8 | 'a' << 16 | 'c' << 24);
                }
                if (canDecode && fallback < 0) fallback = i;
            }
            if (audioTracks == 1 && fallback >= 0) return fallback;
            if (aac >= 0 && otherTracksAreApac) return aac;
            throw new IllegalStateException("QTA 音轨不可解码或包含无法安全选择的多层音轨");
        } finally {
            avformat.avformat_close_input(context);
        }
    }
}
