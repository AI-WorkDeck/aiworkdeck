package com.checkba.service;

import cn.hutool.crypto.SecureUtil;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * WPS WebOffice 服务
 * 负责生成编辑链接、会话 token 等
 */
@Slf4j
@Service
public class WpsService {

    @Value("${external.wps.app-id}")
    private String appId;

    @Value("${external.wps.app-secret}")
    private String appSecret;

    @Value("${external.wps.callback-base-url}")
    private String callbackBaseUrl;

    /**
     * 生成 WPS 在线编辑链接（URL 直连方案预留）
     */
    public String generateEditUrl(String fileId, String fileName, String mode) {
        long timestamp = System.currentTimeMillis() / 1000;
        String signature = generateSignature(fileId, timestamp, mode);

        try {
            String encodedFileName = fileName != null
                    ? java.net.URLEncoder.encode(fileName, "UTF-8")
                    : "document";

            String baseUrl = "https://wwo.wps.cn/office/v1/" + appId + "/new";
            String url = String.format(
                    "%s?file_id=%s&_w_tokentype=1&_w_appid=%s&_w_signature=%s&_w_timestamp=%d&_w_file_name=%s&_w_file_type=%s",
                    baseUrl,
                    fileId,
                    appId,
                    signature,
                    timestamp,
                    encodedFileName,
                    getFileType(fileName)
            );

            log.info("Generated WPS edit URL for fileId: {}, mode: {}, signature: {}", fileId, mode, signature);
            return url;
        } catch (java.io.UnsupportedEncodingException e) {
            log.error("Failed to encode fileName: {}", fileName, e);
            String baseUrl = "https://wwo.wps.cn/office/v1/" + appId + "/new";
            return String.format(
                    "%s?file_id=%s&_w_tokentype=1&_w_appid=%s&_w_signature=%s&_w_timestamp=%d&_w_file_name=%s&_w_file_type=%s",
                    baseUrl,
                    fileId,
                    appId,
                    signature,
                    timestamp,
                    fileName != null ? fileName : "document",
                    getFileType(fileName)
            );
        }
    }

    /**
     * 根据文件名获取文件类型
     */
    private String getFileType(String fileName) {
        if (fileName == null) {
            return "docx";
        }
        String lower = fileName.toLowerCase();
        if (lower.endsWith(".doc") || lower.endsWith(".docx")) {
            return "docx";
        } else if (lower.endsWith(".xls") || lower.endsWith(".xlsx")) {
            return "xlsx";
        } else if (lower.endsWith(".ppt") || lower.endsWith(".pptx")) {
            return "pptx";
        } else if (lower.endsWith(".pdf")) {
            return "pdf";
        }
        return "docx";
    }

    /**
     * 生成签名（URL 直连方案使用）
     * 签名算法：MD5(app_id + file_id + timestamp + app_secret)
     */
    private String generateSignature(String fileId, long timestamp, String mode) {
        String signStr = appId + fileId + timestamp + appSecret;
        return SecureUtil.md5(signStr).toUpperCase();
    }

    /**
     * 生成前端 JS SDK 使用的会话 token
     * 说明：token 完全由业务方自定义，这里采用简单的 MD5(appId|fileId|userId|timestamp|appSecret)
     */
    public String generateSessionToken(String fileId, String userId, long timestamp) {
        String uid = (userId != null && !userId.trim().isEmpty()) ? userId.trim() : "1780305141";
        String raw = appId + "|" + fileId + "|" + uid + "|" + timestamp + "|" + appSecret;
        return SecureUtil.md5(raw).toUpperCase();
    }

    /**
     * 验证回调签名（回调 URL 方案预留）
     */
    public boolean verifyCallbackSignature(String fileId, long timestamp, String signature) {
        String expectedSignature = generateSignature(fileId, timestamp, "callback");
        return expectedSignature.equalsIgnoreCase(signature);
    }

    /**
     * 获取回调网关地址
     */
    public String getCallbackBaseUrl() {
        return callbackBaseUrl;
    }
}
