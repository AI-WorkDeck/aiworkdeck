package com.checkba.controller;

import com.checkba.service.WpsService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

/**
 * WPS WebOffice 回调接口控制器
 * 实现 WPS 要求的回调接口
 */
@Slf4j
@RestController
@RequestMapping("/v3/3rd")
@CrossOrigin(origins = "*")
public class WpsController {

    /**
     * 默认用户ID（需与 WPS 控制台“人员配置”中的账号ID保持一致）
     */
    private static final String DEFAULT_USER_ID = "1780305141";

    @Autowired
    private WpsService wpsService;

    /**
     * 获取文件信息
     * GET /v3/3rd/files/{file_id}
     * WPS 要求的响应格式：直接返回文件信息对象，不需要包装在 code/data 中
     */
    @GetMapping("/files/{file_id}")
    public ResponseEntity<Map<String, Object>> getFileInfo(
            @PathVariable("file_id") String fileId,
            @RequestHeader(value = "X-Request-Id", required = false) String requestId,
            @RequestHeader(value = "X-Weboffice-Token", required = false) String token,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        
        // 生成请求ID（用于WPS日志追踪）
        String xRequestId = requestId != null ? requestId : java.util.UUID.randomUUID().toString();
        
        log.info("WPS callback: getFileInfo, fileId: {}, X-Request-Id: {}, X-Weboffice-Token: {}, Authorization: {}", 
                fileId, xRequestId, token != null ? token : "missing", authorization != null ? "present" : "missing");
        
        // 确保 fileId 不为空且去除空格
        if (fileId == null || fileId.trim().isEmpty()) {
            log.error("WPS callback: fileId is null or empty!");
            Map<String, Object> error = new HashMap<>();
            error.put("error", "file_id cannot be empty");
            return ResponseEntity.badRequest()
                    .header("X-Request-Id", xRequestId)
                    .body(error);
        }
        
        String idValue = fileId.trim();
        long currentTime = System.currentTimeMillis() / 1000;
        
        // 根据 WPS 官方文档《回调概述》：
        // 回调接口统一返回格式为 { code, message, data }，
        // 其中 data 才是真正的文件信息对象，WPS 会在 data.id 上做校验。
        //
        // 1. 先构建 data 对象（文件元信息）
        Map<String, Object> data = new java.util.LinkedHashMap<>();
        data.put("id", idValue);                 // 文档ID，必须与 file_id 一致
        data.put("name", "文档.docx");           // 文件名
        data.put("size", 1024);                  // 文件大小（字节），使用 Integer
        data.put("version", 1);                  // 版本号（Integer）
        data.put("create_time", (int) currentTime); // 创建时间（秒级时间戳，Integer）
        data.put("modify_time", (int) currentTime); // 修改时间（秒级时间戳，Integer）
        data.put("creator_id", DEFAULT_USER_ID);        // 创建者ID
        data.put("modifier_id", DEFAULT_USER_ID);       // 修改者ID
        // 可选字段：下载地址
        data.put("download_url", wpsService.getCallbackBaseUrl() + "/v3/3rd/files/" + fileId + "/download");

        // 2. 再构建外层统一返回结构 { code, message, data }
        Map<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("code", 0);
        result.put("message", "");
        result.put("data", data);

        // 记录返回的 JSON 内容（用于调试）
        log.info("WPS callback response: fileId={}, id={}, body={}", fileId, idValue, result);

        // 添加响应头：X-Request-Id（用于 WPS 日志追踪）
        return ResponseEntity.ok()
                .header("X-Request-Id", xRequestId)
                .header("Content-Type", "application/json; charset=utf-8")
                .body(result);
    }

    /**
     * 获取文件下载地址
     * GET /v3/3rd/files/{file_id}/download
     */
    @GetMapping("/files/{file_id}/download")
    public ResponseEntity<Map<String, Object>> getFileDownloadUrl(@PathVariable("file_id") String fileId) {
        log.info("WPS callback: getFileDownloadUrl, fileId: {}", fileId);
        
        // 根据 WPS 官方文档，下载地址接口同样使用统一返回格式 { code, message, data }
        // data 中的字段名为 url（不是 download_url），否则会出现“字段:url 不能为空”的错误。

        // 1. data：真正的下载信息
        Map<String, Object> data = new java.util.LinkedHashMap<>();
        data.put("url", wpsService.getCallbackBaseUrl() + "/api/files/" + fileId + "/download");
        data.put("expires_in", 3600); // 有效期，秒
        // 预留 headers 字段，若后续需要自定义下载请求头，可在此填充
        data.put("headers", new HashMap<String, String>());

        // 2. 外层统一结构
        Map<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("code", 0);
        result.put("message", "");
        result.put("data", data);

        log.info("WPS download response: fileId={}, data={}", fileId, data);

        return ResponseEntity.ok(result);
    }

    /**
     * 获取文档用户权限
     * GET /v3/3rd/files/{file_id}/permission
     */
    @GetMapping("/files/{file_id}/permission")
    public ResponseEntity<Map<String, Object>> getFilePermission(
            @PathVariable("file_id") String fileId,
            @RequestParam(value = "user_id", required = false) String userId) {
        log.info("WPS callback: getFilePermission, fileId: {}, userId: {}", fileId, userId);

        // 根据 WPS 官方文档，回调统一返回格式为 { code, message, data }
        // data 中才是具体的权限字段
        //
        // 权限字段推荐使用 0/1 数值形式（而不是 true/false），
        // 当前错误提示为“在在线预览权限必须read=1”，说明它在检查 data.read == 1。

        // 1. 具体权限数据
        Map<String, Object> data = new java.util.LinkedHashMap<>();
        // WPS 要求：当权限集中 update=1（或 write=1）时，必须返回当前编辑者 user_id
        String effectiveUserId = (userId != null && !userId.trim().isEmpty())
                ? userId.trim()
                : DEFAULT_USER_ID;

        data.put("read", 1);       // 允许预览/读取
        data.put("write", 1);      // 允许编辑
        data.put("update", 1);     // 允许更新编辑
        data.put("rename", 1);     // 允许重命名
        data.put("history", 1);    // 允许查看历史
        data.put("copy", 1);       // 允许复制
        data.put("print", 1);      // 允许打印
        data.put("download", 1);   // 允许下载
        data.put("saveas", 1);     // 允许另存为
        data.put("user_id", effectiveUserId); // 当前编辑者 user_id

        // 2. 外层统一结构
        Map<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("code", 0);
        result.put("message", "");
        result.put("data", data);

        log.info("WPS permission response: fileId={}, userId={}, data={}", fileId, userId, data);

        return ResponseEntity.ok(result);
    }

    /**
     * 获取文档水印
     * GET /v3/3rd/files/{file_id}/watermark
     * WPS 要求的响应格式：返回水印配置对象
     */
    @GetMapping("/files/{file_id}/watermark")
    public ResponseEntity<Map<String, Object>> getFileWatermark(@PathVariable("file_id") String fileId) {
        log.info("WPS callback: getFileWatermark, fileId: {}", fileId);
        
        // 返回空水印配置（不显示水印）
        // WPS 可能要求返回 null 或空对象表示无水印
        Map<String, Object> result = new HashMap<>();
        result.put("type", "none");
        // 或者返回 null 表示无水印
        // return ResponseEntity.ok(null);
        
        return ResponseEntity.ok(result);
    }

    /**
     * 获取用户信息（批量）
     * GET /v3/3rd/users
     *
     * 官方文档：https://solution.wps.cn/docs/callback/user.html#用户信息
     *
     * - 请求：/v3/3rd/users?user_ids=1&user_ids=2&user_ids=3
     * - 返回：
     *   {
     *     "code": 0,
     *     "data": [
     *       { "id": "1", "name": "user name1" },
     *       { "id": "2", "name": "user name2" }
     *     ]
     *   }
     */
    @GetMapping("/users")
    public ResponseEntity<Map<String, Object>> getUsers(
            @RequestParam(value = "user_ids", required = false) java.util.List<String> userIds,
            @RequestHeader(value = "X-User-Query", required = false) String userQuery,
            @RequestHeader(value = "X-Request-Id", required = false) String requestId) {

        String xRequestId = requestId != null ? requestId : java.util.UUID.randomUUID().toString();
        log.info("WPS callback: getUsers, userIds: {}, X-User-Query: {}, X-Request-Id: {}",
                userIds, userQuery, xRequestId);

        java.util.List<Map<String, Object>> dataList = new java.util.ArrayList<>();

        // 如果没有传 user_ids，则默认返回当前应用所有者（即控制台人员配置中的账号）
        if (userIds == null || userIds.isEmpty()) {
            userIds = java.util.Collections.singletonList(DEFAULT_USER_ID);
        }

        for (String rawId : userIds) {
            String uid = (rawId != null && !rawId.trim().isEmpty())
                    ? rawId.trim()
                    : DEFAULT_USER_ID;

            Map<String, Object> user = new java.util.LinkedHashMap<>();
            user.put("id", uid);
            // 这里只返回简单名称，实际可从数据库/人员表中查真实姓名
            user.put("name", "用户" + uid);
            dataList.add(user);
        }

        Map<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("code", 0);
        result.put("data", dataList);

        log.info("WPS users response: body={}", result);

        return ResponseEntity.ok()
                .header("X-Request-Id", xRequestId)
                .header("Content-Type", "application/json; charset=utf-8")
                .body(result);
    }

    /**
     * 事件通知
     * POST /v3/3rd/notify
     */
    @PostMapping("/notify")
    public ResponseEntity<Map<String, Object>> notify(@RequestBody Map<String, Object> body) {
        log.info("WPS callback: notify, body: {}", body);
        
        // 处理 WPS 事件通知（保存、关闭等）
        String event = (String) body.get("event");
        String fileId = (String) body.get("file_id");
        
        log.info("WPS event: {}, fileId: {}", event, fileId);
        
        // TODO: 根据事件类型处理（保存文件、记录操作日志等）
        if ("file.save".equals(event)) {
            // 文件保存事件
            log.info("File saved: {}", fileId);
        } else if ("file.close".equals(event)) {
            // 文件关闭事件
            log.info("File closed: {}", fileId);
        }
        
        Map<String, Object> result = new HashMap<>();
        result.put("code", 0);
        result.put("message", "success");
        
        return ResponseEntity.ok(result);
    }

    /**
     * 三阶段保存文件—准备上传阶段
     * GET /v3/3rd/files/{file_id}/upload/prepare
     */
    @GetMapping("/files/{file_id}/upload/prepare")
    public ResponseEntity<Map<String, Object>> prepareUpload(@PathVariable("file_id") String fileId) {
        log.info("WPS callback: prepareUpload, fileId: {}", fileId);
        
        // TODO: 准备文件上传，返回上传地址
        Map<String, Object> result = new HashMap<>();
        result.put("upload_url", wpsService.getCallbackBaseUrl() + "/api/files/" + fileId + "/upload");
        result.put("expires_in", 3600);
        
        return ResponseEntity.ok(result);
    }

    // ===================== 扩展能力相关接口 =====================

    /**
     * 文档重命名
     * PUT /v3/3rd/files/{file_id}/name
     *
     * 说明：目前先作为占位实现，只记录日志并返回 code=0，后续可接数据库真正更新名称。
     * 官方文档：https://solution.wps.cn/docs/callback/extend.html#文档重命名
     */
    @PutMapping("/files/{file_id}/name")
    public ResponseEntity<Map<String, Object>> renameFile(
            @PathVariable("file_id") String fileId,
            @RequestBody Map<String, Object> body) {

        String newName = body != null ? (String) body.get("name") : null;
        log.info("WPS callback: rename file, fileId: {}, newName: {}", fileId, newName);

        Map<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("code", 0);
        result.put("data", new java.util.LinkedHashMap<>()); // 占位 data

        return ResponseEntity.ok(result);
    }

    /**
     * 文档历史版本列表
     * GET /v3/3rd/files/{file_id}/versions
     *
     * 目前先返回一个仅包含当前版本的占位列表，满足 WPS 对接口存在性的检查。
     * 官方文档：https://solution.wps.cn/docs/callback/extend.html#文档历史版本列表
     */
    @GetMapping("/files/{file_id}/versions")
    public ResponseEntity<Map<String, Object>> getFileVersions(
            @PathVariable("file_id") String fileId,
            @RequestParam(value = "offset", required = false) Integer offset,
            @RequestParam(value = "limit", required = false) Integer limit) {

        log.info("WPS callback: getFileVersions, fileId: {}, offset: {}, limit: {}", fileId, offset, limit);

        long now = System.currentTimeMillis() / 1000;

        Map<String, Object> version = new java.util.LinkedHashMap<>();
        version.put("id", fileId);
        version.put("name", "文档.docx");
        version.put("version", 1);
        version.put("size", 1024);
        version.put("create_time", (int) now);
        version.put("modify_time", (int) now);
        version.put("creator_id", DEFAULT_USER_ID);
        version.put("modifier_id", DEFAULT_USER_ID);

        java.util.List<Map<String, Object>> list = new java.util.ArrayList<>();
        list.add(version);

        Map<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("code", 0);
        result.put("data", list);

        return ResponseEntity.ok(result);
    }
}

