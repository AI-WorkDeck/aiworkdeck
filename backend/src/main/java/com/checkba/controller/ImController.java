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
        Map<String,Object> body = readBody(request, mapper);
        return Map.of("code", 0, "data", service.execute(userId, ImService.string(body, "action"), params(body)));
    }

    /** Bound raw JSON before parsing, including requests using chunked transfer encoding. */
    public static Map<String,Object> readBody(HttpServletRequest request, ObjectMapper mapper) throws IOException {
        if (request.getContentLengthLong() > ImGatewayService.MAX_JSON_BYTES) throw new IllegalArgumentException("请求过大，文件不能超过8MiB");
        byte[] bytes = request.getInputStream().readNBytes(ImGatewayService.MAX_JSON_BYTES + 1);
        if (bytes.length > ImGatewayService.MAX_JSON_BYTES) throw new IllegalArgumentException("请求过大，文件不能超过8MiB");
        try {
            Map<String,Object> body = mapper.readValue(bytes, new TypeReference<Map<String,Object>>() {});
            if (body == null) throw new IllegalArgumentException("请求格式无效");
            return body;
        }
        catch (com.fasterxml.jackson.core.JsonProcessingException e) { throw new IllegalArgumentException("请求格式无效"); }
    }

    @SuppressWarnings("unchecked")
    public static Map<String,Object> params(Map<String,Object> body) {
        if (body == null) throw new IllegalArgumentException("请求格式无效");
        Object params = body.get("params");
        if (params == null) return Map.of();
        if (!(params instanceof Map<?,?>)) throw new IllegalArgumentException("params必须是对象");
        return (Map<String,Object>) params;
    }
}
