package com.checkba.controller;

import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.WpsService;
import com.checkba.storage.StorageService;
import com.checkba.storage.StorageServiceFactory;
import cn.hutool.crypto.digest.DigestUtil;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.Resource;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.*;

import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

/**
 * WPS WebOffice 回调接口控制器
 * 实现 WPS 要求的回调接口
 */
@RestController
@RequestMapping("/v3/3rd")
@CrossOrigin(origins = "*")
public class WpsController {

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(WpsController.class);

    /**
     * 默认用户ID（需与 WPS 控制台"人员配置"中的账号ID保持一致）
     */
    private static final String DEFAULT_USER_ID = "1780305141";

    @Autowired
    private WpsService wpsService;

    @Autowired
    private ProjectFileRepository projectFileRepository;

    @Autowired
    private StorageServiceFactory storageServiceFactory;

    private StorageService getStorageService() {
        return storageServiceFactory.getStorageService();
    }

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
        
        // 根据 wpsFileId 查询真实的文件信息
        ProjectFile projectFile = projectFileRepository.findByWpsFileId(idValue).orElse(null);
        
        // 根据 WPS 官方文档《回调概述》：
        // 回调接口统一返回格式为 { code, message, data }，
        // 其中 data 才是真正的文件信息对象，WPS 会在 data.id 上做校验。
        //
        // 1. 先构建 data 对象（文件元信息）
        Map<String, Object> data = new java.util.LinkedHashMap<>();
        data.put("id", idValue);                 // 文档ID，必须与 file_id 一致
        
        // 使用真实的文件名，如果查询不到则使用默认值
        String fileName = "文档.docx";
        Long fileSize = 1024L;
        int createTime = (int) currentTime;
        int modifyTime = (int) currentTime;
        String creatorId = DEFAULT_USER_ID;
        String modifierId = DEFAULT_USER_ID;
        
        if (projectFile != null) {
            fileName = projectFile.getName();
            fileSize = projectFile.getFileSize() != null ? projectFile.getFileSize() : 1024L;
            if (projectFile.getCreatedAt() != null) {
                createTime = (int) (projectFile.getCreatedAt().atZone(java.time.ZoneId.systemDefault()).toEpochSecond());
            }
            if (projectFile.getUpdatedAt() != null) {
                modifyTime = (int) (projectFile.getUpdatedAt().atZone(java.time.ZoneId.systemDefault()).toEpochSecond());
            } else if (projectFile.getCreatedAt() != null) {
                modifyTime = (int) (projectFile.getCreatedAt().atZone(java.time.ZoneId.systemDefault()).toEpochSecond());
            }
            creatorId = projectFile.getUserId() != null ? projectFile.getUserId().toString() : DEFAULT_USER_ID;
            modifierId = projectFile.getUserId() != null ? projectFile.getUserId().toString() : DEFAULT_USER_ID;
            log.info("WPS callback: found file in database, name: {}, size: {}", fileName, fileSize);
        } else {
            log.warn("WPS callback: file not found in database for wpsFileId: {}, using default values", idValue);
        }
        
        data.put("name", fileName);              // 文件名（从数据库查询）
        data.put("size", fileSize.intValue());   // 文件大小（字节），使用 Integer
        data.put("version", 1);                  // 版本号（Integer）
        data.put("create_time", createTime);     // 创建时间（秒级时间戳，Integer）
        data.put("modify_time", modifyTime);     // 修改时间（秒级时间戳，Integer）
        data.put("creator_id", creatorId);        // 创建者ID
        data.put("modifier_id", modifierId);     // 修改者ID
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

        // 计算文件 SHA1 以启用 WPS 加速
        try {
            // 确定文件存储路径（逻辑同 FileController）
            String path = fileId;
            Optional<ProjectFile> projectFileOpt = projectFileRepository.findByWpsFileId(fileId);
            if (projectFileOpt.isPresent()) {
                ProjectFile pf = projectFileOpt.get();
                if (StringUtils.hasText(pf.getFilePath())) {
                    path = pf.getFilePath();
                }
            }

            // 读取文件流计算 SHA1
            Resource resource = getStorageService().load(path);
            if (resource.exists() && resource.isReadable()) {
                try (InputStream is = resource.getInputStream()) {
                    String sha1 = DigestUtil.sha1Hex(is);
                    data.put("digest", sha1);
                    data.put("digest_type", "sha1");
                    log.info("Calculated SHA1 for fileId {}: {}", fileId, sha1);
                }
            } else {
                log.warn("File resource not found or unreadable for SHA1 calculation: {}", path);
            }
        } catch (Exception e) {
            log.error("Failed to calculate SHA1 for fileId: " + fileId, e);
            // 不阻断流程，仅记录错误，不返回 digest
        }

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
     * 
     * 根据 WPS 官方文档：
     * - 预览模式：read=1, update=0（只读）
     * - 编辑模式：read=1, update=1（可编辑）
     * 
     * 注意：WPS SDK 初始化时如果 mode='view'，WPS 会检查权限，如果 update=1 会进入编辑模式
     * 因此预览模式必须返回 update=0
     */
    @GetMapping("/files/{file_id}/permission")
    public ResponseEntity<Map<String, Object>> getFilePermission(
            @PathVariable("file_id") String fileId,
            @RequestParam(value = "user_id", required = false) String userId,
            @RequestHeader(value = "X-Weboffice-Token", required = false) String token) {
        log.info("WPS callback: getFilePermission, fileId: {}, userId: {}, token: {}", fileId, userId, token);

        // 根据 WPS 官方文档，回调统一返回格式为 { code, message, data }
        // data 中才是具体的权限字段
        //
        // 权限字段推荐使用 0/1 数值形式（而不是 true/false），
        // 当前错误提示为"在在线预览权限必须read=1"，说明它在检查 data.read == 1。

        // 1. 从 token 中解析 mode 信息
        // token 格式可能是：session_token|mode=view 或 mode=view
        boolean isViewMode = false;
        if (token != null && token.contains("mode=")) {
            String modePart = token.substring(token.indexOf("mode=") + 5);
            if (modePart.contains("|")) {
                modePart = modePart.substring(0, modePart.indexOf("|"));
            }
            isViewMode = "view".equalsIgnoreCase(modePart.trim());
            log.info("WPS permission: parsed mode from token: {}", modePart);
        }

        // 2. 具体权限数据
        Map<String, Object> data = new java.util.LinkedHashMap<>();
        
        String effectiveUserId = (userId != null && !userId.trim().isEmpty())
                ? userId.trim()
                : DEFAULT_USER_ID;

        data.put("read", 1);       // 允许预览/读取（预览和编辑都需要）
        
        if (isViewMode) {
            // 预览模式：只读权限
            data.put("write", 0);      // 不允许编辑
            data.put("update", 0);     // 不允许更新编辑
            data.put("rename", 0);     // 不允许重命名
            log.info("WPS permission: view mode (read-only) for fileId: {}", fileId);
        } else {
            // 编辑模式：完整权限
            data.put("write", 1);      // 允许编辑
            data.put("update", 1);     // 允许更新编辑
            data.put("rename", 1);     // 允许重命名
            data.put("user_id", effectiveUserId); // 当前编辑者 user_id（编辑模式必须返回）
            log.info("WPS permission: edit mode (full access) for fileId: {}, userId: {}", fileId, effectiveUserId);
        }
        
        // 以下权限预览和编辑都可以有
        data.put("history", 1);    // 允许查看历史
        data.put("copy", 1);       // 允许复制
        data.put("print", 1);      // 允许打印
        data.put("download", 1);   // 允许下载
        data.put("saveas", 1);     // 允许另存为
        data.put("comment", 1);    // 允许评论

        // 3. 外层统一结构
        Map<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("code", 0);
        result.put("message", "");
        result.put("data", data);

        log.info("WPS permission response: fileId={}, userId={}, isViewMode={}, data={}", fileId, userId, isViewMode, data);

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
        
        // 根据 WPS 官方文档，返回格式为 { code, message, data }
        // 注意：
        // 1. data 中的字段名必须是 url（不是 upload_url）
        // 2. data 中必须包含 method 字段，值为 "PUT" 或 "POST"
        Map<String, Object> data = new HashMap<>();
        String uploadUrl = wpsService.getCallbackBaseUrl() + "/api/files/" + fileId + "/upload";
        data.put("url", uploadUrl);  // 关键：字段名必须是 url
        data.put("method", "POST");   // 关键：必须指定上传方法，与 FileController 中的 @PostMapping 保持一致
        data.put("expires_in", 3600);
        
        Map<String, Object> result = new HashMap<>();
        result.put("code", 0);
        result.put("message", "");
        result.put("data", data);
        
        log.info("WPS prepare upload response: fileId={}, url={}, method=POST", fileId, uploadUrl);
        
        return ResponseEntity.ok(result);
    }

    /**
     * 获取上传地址（WPS 保存时调用）
     * POST /v3/3rd/files/{file_id}/upload/address
     * 
     * 说明：根据 WPS 官方文档，此接口使用 POST 方法
     * WPS 在保存文件时会调用此接口获取上传地址
     * 返回格式与 prepare 接口类似
     */
    @PostMapping("/files/{file_id}/upload/address")
    public ResponseEntity<Map<String, Object>> getUploadAddress(@PathVariable("file_id") String fileId) {
        log.info("WPS callback: getUploadAddress (POST), fileId: {}", fileId);
        
        // 根据 WPS 官方文档，返回格式为 { code, message, data }
        // 注意：
        // 1. data 中的字段名必须是 url（不是 upload_url），否则会出现"字段:url 不能为空"的错误
        // 2. data 中必须包含 method 字段，值为 "PUT" 或 "POST"，否则会出现"字段method 错误"的错误
        Map<String, Object> data = new HashMap<>();
        String uploadUrl = wpsService.getCallbackBaseUrl() + "/api/files/" + fileId + "/upload";
        data.put("url", uploadUrl);  // 关键：字段名必须是 url，不是 upload_url
        data.put("method", "POST");   // 关键：必须指定上传方法，与 FileController 中的 @PostMapping 保持一致
        data.put("expires_in", 3600);
        
        Map<String, Object> result = new HashMap<>();
        result.put("code", 0);
        result.put("message", "");
        result.put("data", data);
        
        log.info("WPS upload address response: fileId={}, url={}, method=POST", fileId, uploadUrl);
        
        return ResponseEntity.ok(result);
    }
    
    /**
     * 获取上传地址（兼容 GET 方法，部分版本可能使用）
     * GET /v3/3rd/files/{file_id}/upload/address
     */
    @GetMapping("/files/{file_id}/upload/address")
    public ResponseEntity<Map<String, Object>> getUploadAddressGet(@PathVariable("file_id") String fileId) {
        log.info("WPS callback: getUploadAddress (GET), fileId: {}", fileId);
        // 复用 POST 方法的逻辑
        return getUploadAddress(fileId);
    }

    /**
     * 三阶段保存文件—完成上传阶段
     * POST /v3/3rd/files/{file_id}/upload/complete
     * 
     * 说明：根据 WPS 官方文档，三段式保存流程包括：
     * 1. prepare - 准备上传（可选）
     * 2. upload - 实际上传文件（PUT /api/files/{fileId}/upload）
     * 3. complete - 完成上传（必须）
     * 
     * 此接口在文件上传完成后被调用，用于确认上传完成
     * 必须返回包含文件完整元信息的 data 对象（与 getFileInfo 类似）
     */
    @PostMapping("/files/{file_id}/upload/complete")
    public ResponseEntity<Map<String, Object>> completeUpload(@PathVariable("file_id") String fileId) {
        log.info("WPS callback: completeUpload, fileId: {}", fileId);
        
        // 构造文件元信息（必须包含 id 等字段）
        String idValue = fileId.trim();
        long currentTime = System.currentTimeMillis() / 1000;
        
        // 根据 wpsFileId 查询真实的文件信息
        ProjectFile projectFile = projectFileRepository.findByWpsFileId(idValue).orElse(null);
        
        // 使用真实的文件名，如果查询不到则使用默认值
        String fileName = "文档.docx";
        Long fileSize = 1024L;
        int createTime = (int) currentTime;
        int modifyTime = (int) currentTime;
        String creatorId = DEFAULT_USER_ID;
        String modifierId = DEFAULT_USER_ID;
        
        if (projectFile != null) {
            fileName = projectFile.getName();
            fileSize = projectFile.getFileSize() != null ? projectFile.getFileSize() : 1024L;
            if (projectFile.getCreatedAt() != null) {
                createTime = (int) (projectFile.getCreatedAt().atZone(java.time.ZoneId.systemDefault()).toEpochSecond());
            }
            if (projectFile.getUpdatedAt() != null) {
                modifyTime = (int) (projectFile.getUpdatedAt().atZone(java.time.ZoneId.systemDefault()).toEpochSecond());
            } else if (projectFile.getCreatedAt() != null) {
                modifyTime = (int) (projectFile.getCreatedAt().atZone(java.time.ZoneId.systemDefault()).toEpochSecond());
            }
            creatorId = projectFile.getUserId() != null ? projectFile.getUserId().toString() : DEFAULT_USER_ID;
            modifierId = projectFile.getUserId() != null ? projectFile.getUserId().toString() : DEFAULT_USER_ID;
        }
        
        Map<String, Object> data = new java.util.LinkedHashMap<>();
        data.put("id", idValue);                 // 文档ID，必须与 file_id 一致
        data.put("name", fileName);              // 文件名（从数据库查询）
        data.put("size", fileSize.intValue());   // 文件大小（字节）
        data.put("version", 1);                   // 版本号
        data.put("create_time", createTime);     // 创建时间
        data.put("modify_time", modifyTime);     // 修改时间
        data.put("creator_id", creatorId);       // 创建者ID
        data.put("modifier_id", modifierId);     // 修改者ID
        // 可选字段：下载地址
        data.put("download_url", wpsService.getCallbackBaseUrl() + "/v3/3rd/files/" + fileId + "/download");

        // 根据 WPS 官方文档，返回格式为 { code, message, data }
        Map<String, Object> result = new HashMap<>();
        result.put("code", 0);
        result.put("message", "");
        result.put("data", data);
        
        log.info("WPS upload complete: fileId={}, data={}", fileId, data);
        
        return ResponseEntity.ok(result);
    }

    // ===================== 扩展能力相关接口 =====================

    /**
     * 文档重命名
     * PUT /v3/3rd/files/{file_id}/name
     *
     * 说明：接收 WPS 重命名回调，更新数据库中的文件名。
     * 官方文档：https://solution.wps.cn/docs/callback/extend.html#文档重命名
     */
    @PutMapping("/files/{file_id}/name")
    public ResponseEntity<Map<String, Object>> renameFile(
            @PathVariable("file_id") String fileId,
            @RequestBody Map<String, Object> body) {

        String newName = body != null ? (String) body.get("name") : null;
        log.info("WPS callback: rename file, fileId: {}, newName: {}", fileId, newName);

        if (fileId != null && newName != null && !newName.trim().isEmpty()) {
            String idValue = fileId.trim();
            ProjectFile projectFile = projectFileRepository.findByWpsFileId(idValue).orElse(null);
            
            if (projectFile != null) {
                String oldName = projectFile.getName();
                projectFile.setName(newName.trim());
                projectFileRepository.save(projectFile);
                log.info("WPS callback: successfully renamed file from '{}' to '{}' (id={})", oldName, newName, projectFile.getId());
            } else {
                log.warn("WPS callback: file not found for rename, wpsFileId: {}", idValue);
            }
        }

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

        // 根据 wpsFileId 查询真实的文件信息
        ProjectFile projectFile = projectFileRepository.findByWpsFileId(fileId).orElse(null);
        
        String fileName = "文档.docx";
        Long fileSize = 1024L;
        int createTime = (int) now;
        int modifyTime = (int) now;
        String creatorId = DEFAULT_USER_ID;
        String modifierId = DEFAULT_USER_ID;
        
        if (projectFile != null) {
            fileName = projectFile.getName();
            fileSize = projectFile.getFileSize() != null ? projectFile.getFileSize() : 1024L;
            if (projectFile.getCreatedAt() != null) {
                createTime = (int) (projectFile.getCreatedAt().atZone(java.time.ZoneId.systemDefault()).toEpochSecond());
            }
            if (projectFile.getUpdatedAt() != null) {
                modifyTime = (int) (projectFile.getUpdatedAt().atZone(java.time.ZoneId.systemDefault()).toEpochSecond());
            } else if (projectFile.getCreatedAt() != null) {
                modifyTime = (int) (projectFile.getCreatedAt().atZone(java.time.ZoneId.systemDefault()).toEpochSecond());
            }
            creatorId = projectFile.getUserId() != null ? projectFile.getUserId().toString() : DEFAULT_USER_ID;
            modifierId = projectFile.getUserId() != null ? projectFile.getUserId().toString() : DEFAULT_USER_ID;
        }
        
        Map<String, Object> version = new java.util.LinkedHashMap<>();
        version.put("id", fileId);
        version.put("name", fileName);           // 使用真实文件名
        version.put("version", 1);
        version.put("size", fileSize.intValue());
        version.put("create_time", createTime);
        version.put("modify_time", modifyTime);
        version.put("creator_id", creatorId);
        version.put("modifier_id", modifierId);

        java.util.List<Map<String, Object>> list = new java.util.ArrayList<>();
        list.add(version);

        Map<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("code", 0);
        result.put("data", list);

        return ResponseEntity.ok(result);
    }
}

