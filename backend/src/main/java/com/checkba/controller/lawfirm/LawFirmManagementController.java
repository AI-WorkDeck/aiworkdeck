// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller.lawfirm;

import com.checkba.controller.AuthController;
import com.checkba.repository.UserRepository;
import com.checkba.service.AdminAccessService;
import com.checkba.service.lawfirm.LawFirmBundledPluginInstaller;
import com.checkba.service.lawfirm.LawFirmManagementService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.Map;

/**
 * 律所管理宿主接口（dev-board#1282）：个人中心「收案与利冲」、团队看板直接调用。
 * 插件 iframe 走 {@link com.checkba.controller.ai.PluginLawFirmController}，两条路落到同一个 service。
 */
@RestController
@RequestMapping("/api/lawfirm")
@RequiredArgsConstructor
public class LawFirmManagementController {

    private final LawFirmManagementService service;
    private final LawFirmBundledPluginInstaller installer;
    private final UserRepository userRepository;
    private final AdminAccessService adminAccessService;

    @GetMapping("/overview")
    public Map<String, Object> overview(@RequestParam(value = "scope", required = false) String scope,
                                        @RequestParam(value = "projectId", required = false) String projectId,
                                        @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = requireUser(sessionId);
        return run(() -> service.execute(userId, parseProjectId(projectId), "overview",
                Map.of("scope", scope == null || scope.isBlank() ? "all" : scope)));
    }

    @PostMapping("/action")
    public Map<String, Object> action(@RequestBody(required = false) Map<String, Object> body,
                                      @RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = requireUser(sessionId);
        Map<String, Object> b = body == null ? Map.of() : body;
        String action = b.get("action") == null ? "" : String.valueOf(b.get("action")).trim();
        Long projectId = parseProjectId(b.get("projectId"));
        @SuppressWarnings("unchecked")
        Map<String, Object> params = b.get("params") instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of();
        return run(() -> service.execute(userId, projectId, action, params));
    }

    /** 一键装好并启用内置的律所管理插件（个人中心「在工作台打开」按钮）。改插件目录，仅管理员。 */
    @PostMapping("/ensure-plugin")
    public Map<String, Object> ensurePlugin(@RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        Long userId = requireUser(sessionId);
        boolean admin = userRepository.findById(userId).map(adminAccessService::isAdmin).orElse(false);
        if (!admin) {
            return Map.of("code", 1, "message", com.checkba.service.LangText.of("仅管理员可安装插件，请联系管理员在插件中心启用「律所管理」",
                    "Only administrators can install plugins; please contact an administrator to enable 'Law Firm Management' in the Plugin Center"));
        }
        return run(installer::ensureInstalledAndEnabled);
    }

    @GetMapping("/finance/export-csv")
    public ResponseEntity<byte[]> exportCsv(@RequestHeader(value = "X-Session-Id", required = false) String sessionId) {
        requireUser(sessionId);
        byte[] bytes = service.exportFinanceCsv().getBytes(StandardCharsets.UTF_8);
        String filename = "lawfirm-finance-ledger-" + LocalDate.now() + ".csv";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .body(bytes);
    }

    public static Long requireUser(String sessionId) {
        Long userId = AuthController.getUserIdFromSession(sessionId);
        if (userId == null) throw new IllegalArgumentException("请先登录");
        return userId;
    }

    public static Long parseProjectId(Object value) {
        if (value == null || "".equals(value)) return null;
        String raw = String.valueOf(value);
        if (!raw.matches("[1-9][0-9]{0,18}")) throw new IllegalArgumentException(com.checkba.service.LangText.of("项目编号无效", "Invalid project ID"));
        return Long.parseLong(raw);
    }

    public interface Body { Map<String, Object> get() throws Exception; }

    /**
     * 业务校验（IllegalStateException：未放行就终审、超额核销……）要原样回给律师看；
     * 全局异常处理器会把它吞成「服务器内部错误」，所以在这里接住。
     */
    public static Map<String, Object> run(Body body) {
        try {
            Map<String, Object> out = new HashMap<>();
            out.put("code", 0);
            out.put("data", body.get());
            return out;
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (IllegalStateException e) {
            return Map.of("code", 1, "message", e.getMessage() == null ? com.checkba.service.LangText.of("操作未完成", "Operation not completed") : e.getMessage());
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
