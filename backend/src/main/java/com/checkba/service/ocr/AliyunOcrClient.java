// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ocr;

import lombok.RequiredArgsConstructor;
import com.aliyun.ocr_api20210707.Client;
import com.aliyun.ocr_api20210707.models.RecognizeAllTextRequest;
import com.aliyun.ocr_api20210707.models.RecognizeAllTextResponse;
import com.aliyun.teaopenapi.models.Config;
import com.aliyun.teautil.models.RuntimeOptions;

import java.io.InputStream;
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
     * 通用文字识别（ocr-api 2021-07-07 / RecognizeAllText）
     * 直接上传图片流（避免对公网 URL 的依赖）
     * 使用 RecognizeAllText + Type="Advanced" 替代原 RecognizeGeneral
     */
    /**
     * layout=true 打开坐标（四点）、印章、表格、段落四项，与官网网关 {@code buildOcrRequest} 同一白名单；
     * 同一动作同一 Type，仍按一次计费。false 时请求与之前完全一致。
     */
    static RecognizeAllTextRequest buildRequest(InputStream imageStream, boolean layout) {
        RecognizeAllTextRequest req = new RecognizeAllTextRequest()
                .setBody(imageStream)
                .setType("Advanced"); // 通用文字识别高精版
        if (layout) {
            req.setOutputCoordinate("points")
                    .setOutputStamp(true)
                    .setAdvancedConfig(new RecognizeAllTextRequest.RecognizeAllTextRequestAdvancedConfig()
                            .setOutputTable(true)
                            .setOutputParagraph(true));
        }
        return req;
    }

    public OcrResult recognizeGeneral(InputStream imageStream) throws Exception {
        return recognizeGeneral(imageStream, false);
    }

    public OcrResult recognizeGeneral(InputStream imageStream, boolean layout) throws Exception {
        // 使用 OCR 统一识别接口
        RecognizeAllTextRequest req = buildRequest(imageStream, layout);

        RuntimeOptions runtime = new RuntimeOptions();
        // 显式超时：此前无超时，网络卡死会无限期挂起并占用请求线程
        runtime.setConnectTimeout(10000);
        runtime.setReadTimeout(30000);
        RecognizeAllTextResponse resp = client.recognizeAllTextWithOptions(req, runtime);

        // 响应缺体/缺 data 是**调用失败**，不是「这张图没有文字」。返回空 OcrResult 会让
        // 调用方（OcrService → 前端/AI 工具）把它当成识别成功但内容为空，用户于是认定
        // 这份扫描件没有文字。上抛由 OcrService 统一包成「OCR 识别失败: …」。
        if (resp == null || resp.getBody() == null || resp.getBody().getData() == null) {
            throw new IllegalStateException("阿里云 OCR 返回了空响应体（requestId="
                    + (resp != null && resp.getBody() != null ? resp.getBody().getRequestId() : "-")
                    + "），本次识别未完成");
        }

        // 提取全文本
        String text = resp.getBody().getData().getContent();
        if (text == null) {
            text = "";
        }

        // 将整个 Data 对象转为 JSON 字符串作为 raw 返回，方便后续如果有需要提取详细坐标等信息
        String raw = "";
        try {
            raw = MAPPER.writeValueAsString(resp.getBody().getData());
        } catch (Exception e) {
            raw = resp.getBody().getData().toString();
        }

        return new OcrResult(OcrResult.lines(raw, text), raw);
    }
}


