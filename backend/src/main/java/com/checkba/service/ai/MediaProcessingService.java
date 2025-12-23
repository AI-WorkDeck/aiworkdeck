package com.checkba.service.ai;

import lombok.extern.slf4j.Slf4j;
import org.bytedeco.javacv.FFmpegFrameGrabber;
import org.bytedeco.javacv.Frame;
import org.bytedeco.javacv.Java2DFrameConverter;
import org.springframework.stereotype.Service;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.List;

@Service
public class MediaProcessingService {

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(MediaProcessingService.class);

    /**
     * 从视频文件中提取关键帧
     * @param videoFile 视频文件
     * @param maxFrames 最大提取帧数
     * @return base64 编码的图片列表 (JPEG格式)
     */
    public List<String> extractKeyframes(File videoFile, int maxFrames) {
        if (videoFile == null || !videoFile.exists()) {
            log.warn("视频文件不存在: {}", videoFile);
            return Collections.emptyList();
        }

        List<String> base64Images = new ArrayList<>();
        
        try (FFmpegFrameGrabber grabber = new FFmpegFrameGrabber(videoFile)) {
            grabber.start();

            int lengthInSchemas = grabber.getLengthInFrames();
            if (lengthInSchemas == 0) {
                // 如果没有帧数信息，尝试用时间计算 (备用)
                log.info("未获取到帧数，尝试直接读取");
            }
            
            // 简单策略：均匀采样
            // 如果总帧数 < maxFrames，则取所有
            // 否则步长 = length / maxFrames
            
            int step = 1;
            if (lengthInSchemas > maxFrames) {
                step = lengthInSchemas / maxFrames;
            }

            Java2DFrameConverter converter = new Java2DFrameConverter();
            
            for (int i = 0; i < lengthInSchemas; i += step) {
                if (base64Images.size() >= maxFrames) break;
                
                grabber.setFrameNumber(i);
                Frame frame = grabber.grabImage(); // 只抓取图像帧
                if (frame != null) {
                    BufferedImage bi = converter.convert(frame);
                    if (bi != null) {
                        try (ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
                            ImageIO.write(bi, "jpg", baos);
                            String base64 = Base64.getEncoder().encodeToString(baos.toByteArray());
                            // Add data prefix
                            // base64Images.add("data:image/jpeg;base64," + base64); 
                            // LangChain4j implementation details may vary, usually raw base64 or ImageContent
                            // ImageContent.from(base64, "image/jpeg") expects raw base64 or full?
                            // Usually plain base64 string is better for flexibility.
                            base64Images.add(base64);
                        }
                    }
                }
            }
            
            grabber.stop();
            
        } catch (Exception e) {
            log.error("视频帧提取失败: {}", videoFile.getAbsolutePath(), e);
        }

        return base64Images;
    }
}
