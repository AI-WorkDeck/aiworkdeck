// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;

import com.checkba.service.DdClientConnectionService;
import jakarta.servlet.http.HttpServletRequest;
import okhttp3.MultipartBody;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;
import java.io.IOException;
import java.util.*;

@RestController
@RequestMapping("/api/dd-client/connections")
public class DdClientConnectionController {
    private final DdClientConnectionService service;
    public DdClientConnectionController(DdClientConnectionService service) { this.service = service; }
    private Long user(String session) {
        Long id = AuthController.getUserIdFromSession(session);
        if (id == null) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "请先打开 AI WorkDeck");
        return id;
    }
    public record Connect(String code, Long cloudConnectionId) {}
    @GetMapping public List<Map<String, Object>> list(@RequestHeader(value="X-Session-Id", required=false) String session) { return service.list(user(session)); }
    @PostMapping public Map<String, Object> connect(@RequestHeader(value="X-Session-Id", required=false) String session, @RequestBody Connect body) {
        return service.connect(user(session), body.code(), body.cloudConnectionId());
    }
    @DeleteMapping("/{id}") public Map<String, Boolean> disconnect(@PathVariable String id, @RequestHeader(value="X-Session-Id", required=false) String session) {
        service.disconnect(user(session), id); return Map.of("removed", true);
    }
    @RequestMapping(value="/{id}/dd/**", method={RequestMethod.GET, RequestMethod.POST}, consumes={"application/json", "*/*"})
    public ResponseEntity<byte[]> proxy(@PathVariable String id, @RequestHeader(value="X-Session-Id", required=false) String session,
            @RequestParam(required=false) Long requestId, @RequestBody(required=false) byte[] body, HttpServletRequest request) {
        String prefix = request.getContextPath() + "/api/dd-client/connections/" + id + "/dd";
        String path = request.getRequestURI().substring(prefix.length());
        okhttp3.RequestBody payload = body == null ? null : okhttp3.RequestBody.create(body, okhttp3.MediaType.get("application/json"));
        return response(service.proxy(user(session), id, request.getMethod(), path, requestId, payload));
    }
    @PostMapping(value="/{id}/dd/items/{itemId}/submissions", consumes="multipart/form-data")
    public ResponseEntity<byte[]> upload(@PathVariable String id, @PathVariable long itemId,
            @RequestHeader(value="X-Session-Id", required=false) String session, @RequestParam Long requestId,
            @RequestParam("files") List<MultipartFile> files, @RequestParam String idempotencyKey,
            @RequestParam(defaultValue="false") boolean aiConsent) throws IOException {
        Long userId = user(session);
        MultipartBody.Builder body = new MultipartBody.Builder().setType(MultipartBody.FORM)
                .addFormDataPart("idempotencyKey", idempotencyKey).addFormDataPart("aiConsent", String.valueOf(aiConsent));
        for (MultipartFile file : files) body.addFormDataPart("files", Objects.toString(file.getOriginalFilename(), "file"),
                okhttp3.RequestBody.create(file.getBytes(), okhttp3.MediaType.parse(Objects.toString(file.getContentType(), "application/octet-stream"))));
        return response(service.proxy(userId, id, "POST", "/items/" + itemId + "/submissions", requestId, body.build()));
    }
    private ResponseEntity<byte[]> response(DdClientConnectionService.Reply reply) {
        var builder = ResponseEntity.status(reply.status());
        if (reply.contentType() != null) builder.header("Content-Type", reply.contentType());
        if (reply.disposition() != null) builder.header("Content-Disposition", reply.disposition());
        return builder.body(reply.body());
    }
    @ExceptionHandler(ResponseStatusException.class) public ResponseEntity<Map<String, Object>> failure(ResponseStatusException error) {
        return ResponseEntity.status(error.getStatusCode()).body(Map.of("code", error.getStatusCode().value(), "message", Objects.toString(error.getReason(), "请求失败")));
    }
}
