// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller;

import com.checkba.service.im.ImGatewayService;
import com.checkba.service.im.ImService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.util.Map;

@RestController
@RequestMapping("/api/im")
@ConditionalOnProperty(name="security.local-mode", havingValue="false", matchIfMissing=true)
@lombok.RequiredArgsConstructor
public class ImController {
    private final ImService service;
    private final ObjectMapper mapper;

    @PostMapping("/action")
    public Map<String,Object> action(HttpServletRequest request,
            @RequestHeader(value="X-Session-Id",required=false) String sessionId) throws IOException {
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) throw new IllegalArgumentException("请先登录");
        Map<String,Object> body = readBody(request, mapper, service.maxRequestBytes());
        return Map.of("code", 0, "data", service.executeRequest(userId, ImService.string(body, "action"), params(body)));
    }

    /** Bound raw JSON before parsing, including requests using chunked transfer encoding. */
    public static Map<String,Object> readBody(HttpServletRequest request, ObjectMapper mapper) throws IOException {
        return readBody(request, mapper, ImGatewayService.MAX_JSON_BYTES);
    }

    /** {@code maxBytes}: client uploads (scanned evidence) may be larger than staff files; see {@link ImService#maxRequestBytes()}. */
    public static Map<String,Object> readBody(HttpServletRequest request, ObjectMapper mapper, long maxBytes) throws IOException {
        int cap = (int) Math.min(Integer.MAX_VALUE - 1, maxBytes);
        if (request.getContentLengthLong() > cap) throw new IllegalArgumentException(com.checkba.service.LangText.of("请求过大，文件超出上传上限", "Request too large; the file exceeds the upload limit"));
        byte[] bytes = request.getInputStream().readNBytes(cap + 1);
        if (bytes.length > cap) throw new IllegalArgumentException(com.checkba.service.LangText.of("请求过大，文件超出上传上限", "Request too large; the file exceeds the upload limit"));
        try {
            Map<String,Object> body = mapper.readValue(bytes, new TypeReference<Map<String,Object>>() {});
            if (body == null) throw new IllegalArgumentException(com.checkba.service.LangText.of("请求格式无效", "Invalid request format"));
            return body;
        }
        catch (com.fasterxml.jackson.core.JsonProcessingException e) { throw new IllegalArgumentException(com.checkba.service.LangText.of("请求格式无效", "Invalid request format")); }
    }

    @SuppressWarnings("unchecked")
    public static Map<String,Object> params(Map<String,Object> body) {
        if (body == null) throw new IllegalArgumentException(com.checkba.service.LangText.of("请求格式无效", "Invalid request format"));
        Object params = body.get("params");
        if (params == null) return Map.of();
        if (!(params instanceof Map<?,?>)) throw new IllegalArgumentException(com.checkba.service.LangText.of("params必须是对象", "params must be an object"));
        return (Map<String,Object>) params;
    }
}
