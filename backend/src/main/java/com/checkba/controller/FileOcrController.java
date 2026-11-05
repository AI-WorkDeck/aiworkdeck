// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;

import com.checkba.exception.UnauthorizedException;
import com.checkba.service.LangText;
import com.checkba.service.ocr.FileOcrService;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Explorer right-click「识别文字（OCR）」(tutorial-series#155). One file per request so the
 * frontend owns batch progress, cancellation between files and the failure summary.
 * Access, consent and billing gates live in {@link FileOcrService}.
 */
@RestController
@RequestMapping("/api/projects/{projectId}/files")
public class FileOcrController {
    private final FileOcrService service;

    public FileOcrController(FileOcrService service) { this.service = service; }

    private static Long user(String session) {
        Long user = AuthController.getUserIdFromSession(session);
        if (user == null) throw new UnauthorizedException("请先登录");
        return user;
    }

    private static String str(Map<String, Object> body, String key) {
        Object value = body == null ? null : body.get(key);
        return value == null ? null : String.valueOf(value);
    }

    /** POST /api/projects/{projectId}/files/{fileId}/ocr {jobId, output: text|txt|docx, name, consentVersion} */
    @PostMapping("/{fileId}/ocr")
    public Map<String, Object> recognize(@PathVariable Long projectId, @PathVariable Long fileId,
                                         @RequestBody(required = false) Map<String, Object> body,
                                         @RequestHeader(value = "X-Session-Id", required = false) String session) throws Exception {
        Long user = user(session);
        String outputName = str(body, "output");
        FileOcrService.Output output;
        try {
            output = outputName == null ? FileOcrService.Output.TEXT
                    : FileOcrService.Output.valueOf(outputName.toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException(LangText.of("不支持的输出格式", "Unsupported output format"));
        }
        FileOcrService.Outcome outcome = service.run(projectId, fileId, user, new FileOcrService.Request(
                str(body, "jobId"), output, str(body, "name"), str(body, "consentVersion")));
        Map<String, Object> data = new HashMap<>();
        data.put("status", outcome.status());
        data.put("text", outcome.text());
        data.put("file", outcome.file());
        data.put("source", outcome.source());
        data.put("pages", outcome.pages());
        data.put("notice", outcome.notice());
        data.put("version", outcome.version());
        Map<String, Object> result = new HashMap<>();
        result.put("code", 0);
        result.put("data", data);
        return result;
    }

    /** POST /api/projects/{projectId}/files/ocr/cancel {jobId}: stops before the next page upload. */
    @PostMapping("/ocr/cancel")
    public Map<String, Object> cancel(@PathVariable Long projectId, @RequestBody(required = false) Map<String, Object> body,
                                      @RequestHeader(value = "X-Session-Id", required = false) String session) {
        service.cancel(user(session), str(body, "jobId"));
        return Map.of("code", 0, "data", Map.of("cancelled", true));
    }
}
