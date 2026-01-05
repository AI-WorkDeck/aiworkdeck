package com.checkba.controller;

import com.checkba.service.WpsService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

/**
 * WPS 公开 API 控制器
 * 提供前端需要的 WPS 配置信息（不需要管理员权限）
 */
@RestController
@RequestMapping("/api/wps")
@CrossOrigin(origins = "*")
@Slf4j
public class WpsPublicController {

    @Autowired
    private WpsService wpsService;

    /**
     * 获取 WPS 公开配置（供前端 SDK 初始化使用）
     * GET /api/wps/config
     *
     * 说明：此接口返回 WPS appId，供前端 WPS SDK 初始化使用。
     * 不返回 appSecret，因为 secret 仅在后端用于签名。
     */
    @GetMapping("/config")
    public ResponseEntity<Map<String, Object>> getWpsPublicConfig() {
        log.info("API: getWpsPublicConfig");

        Map<String, Object> config = new HashMap<>();
        config.put("appId", wpsService.getPublicAppId());

        Map<String, Object> result = new HashMap<>();
        result.put("code", 0);
        result.put("message", "success");
        result.put("data", config);

        return ResponseEntity.ok(result);
    }
}
