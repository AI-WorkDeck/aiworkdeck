package com.checkba.service.ocr;

import lombok.RequiredArgsConstructor;
import com.aliyun.ocr_api20210707.Client;
import com.aliyun.ocr_api20210707.models.RecognizeGeneralRequest;
import com.aliyun.ocr_api20210707.models.RecognizeGeneralResponse;
import com.aliyun.teaopenapi.models.Config;
import com.aliyun.teautil.models.RuntimeOptions;

import java.io.InputStream;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * 阿里云 OCR 封装（仅暴露本项目需要的能力）
 */
@RequiredArgsConstructor
public class AliyunOcrClient {

    private final Client client;
    private static final ObjectMapper MAPPER = new ObjectMapper();

    public AliyunOcrClient(Config config) {
        Client c;
        try {
            c = new Client(config);
        } catch (Exception e) {
            throw new RuntimeException("初始化阿里云 OCR Client 失败: " + e.getMessage(), e);
        }
        this.client = c;
    }

    /**
     * 通用文字识别（ocr-api 2021-07-07 / RecognizeGeneral）
     * 直接上传图片流（避免对公网 URL 的依赖，也避免旧版 SDK Version 报错）
     */
    public OcrResult recognizeGeneral(InputStream imageStream) throws Exception {
        RecognizeGeneralRequest req = new RecognizeGeneralRequest()
                .setBody(imageStream);
        RuntimeOptions runtime = new RuntimeOptions();
        RecognizeGeneralResponse resp = client.recognizeGeneralWithOptions(req, runtime);

        if (resp == null || resp.getBody() == null) {
            return new OcrResult("", "");
        }

        // 返回结构里 data 是 JSON 字符串（TeaModel 里是 String）
        String raw = resp.getBody().getData() == null ? "" : resp.getBody().getData();
        String text = "";
        if (!raw.isBlank()) {
            try {
                JsonNode root = MAPPER.readTree(raw);
                // 尽量兼容不同返回：content / data.content / data.data.content
                JsonNode content = root.get("content");
                if (content == null) {
                    JsonNode data = root.get("data");
                    if (data != null) {
                        content = data.get("content");
                        if (content == null && data.get("data") != null) {
                            content = data.get("data").get("content");
                        }
                    }
                }
                if (content != null && !content.isNull()) {
                    text = content.asText("");
                } else {
                    // 兜底：直接返回 raw（至少可见）
                    text = raw;
                }
            } catch (Exception ignore) {
                // raw 不是合法 JSON 时，直接作为文本返回
                text = raw;
            }
        }
        return new OcrResult(text, raw);
    }
}


