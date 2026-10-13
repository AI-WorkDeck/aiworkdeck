// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.im;

import com.checkba.model.entity.CloudConnection;
import com.checkba.service.account.AccountService;
import com.checkba.version.OfficialCloudService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.Map;

/** Only a fixed IM endpoint is reachable; credentials never cross the plugin boundary. */
@Service
public class ImGatewayService {
    public static final int MAX_JSON_BYTES = 12 * 1024 * 1024;
    private final boolean localMode;
    private final OfficialCloudService cloud;
    private final AccountService account;
    private final ImService service;
    private final ObjectMapper mapper;
    private final HttpClient http = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER)
            .connectTimeout(Duration.ofSeconds(10)).version(HttpClient.Version.HTTP_1_1).build();

    public ImGatewayService(@Value("${security.local-mode:false}") boolean localMode,
                            OfficialCloudService cloud, AccountService account, ImService service, ObjectMapper mapper) {
        this.localMode = localMode; this.cloud = cloud; this.account = account; this.service = service; this.mapper = mapper;
    }

    public String captureAccountScope() {
        if (!localMode) return "server";
        String scope = account.accountFingerprintOrNull();
        if (scope == null) throw new IllegalArgumentException("请先连接AI WorkDeck账户");
        return scope;
    }

    public void assertAccountScope(String scope) {
        if (scope == null || !scope.equals(captureAccountScope()))
            throw new IllegalArgumentException("账户已变化，本次操作已停止");
    }

    /** Override only for bounded loopback timeout tests. */
    protected Duration bodyDeadline() { return Duration.ofSeconds(30); }

    public Object execute(Long userId, String action, Map<String,Object> params) {
        return executeWithinScope(userId, captureAccountScope(), action, params);
    }

    public Object executeWithinScope(Long userId, String expectedScope, String action, Map<String,Object> params) {
        if (!ImService.ACTIONS.contains(action)) throw new IllegalArgumentException("不支持的沟通操作");
        assertAccountScope(expectedScope);
        if (!localMode) return service.execute(userId, action, params);
        CloudConnection connection = cloud.connectOfficial(userId);
        String fingerprint = connection.getAccountFingerprint();
        if (fingerprint == null || !fingerprint.equals(expectedScope) || !fingerprint.equals(account.accountFingerprintOrNull()))
            throw new IllegalArgumentException("账户已变化，请重新打开沟通面板");
        try {
            byte[] payload = mapper.writeValueAsBytes(Map.of("action", action, "params", params == null ? Map.of() : params));
            if (payload.length > MAX_JSON_BYTES) throw new IllegalArgumentException("请求过大，文件不能超过8MiB");
            HttpRequest request = HttpRequest.newBuilder(URI.create(connection.getServerUrl() + "/api/im/action"))
                    .timeout(Duration.ofSeconds(30)).header("Content-Type", "application/json")
                    .header("X-Session-Id", connection.getDeviceToken()).POST(HttpRequest.BodyPublishers.ofByteArray(payload)).build();
            HttpResponse<java.io.InputStream> response = http.send(request, HttpResponse.BodyHandlers.ofInputStream());
            byte[] bytes;
            try (var body = new com.checkba.util.DeadlineInputStream(response.body(), bodyDeadline())) {
                bytes = body.readNBytes(MAX_JSON_BYTES + 1);
            }
            assertAccountScope(fingerprint);
            if (response.statusCode() == 404) throw new IllegalArgumentException("云端尚未开通沟通服务，请稍后再试");
            if (response.statusCode() == 401) throw new IllegalArgumentException("云端账户凭据已失效，请重新连接账户");
            if (response.statusCode() != 200 || bytes.length > MAX_JSON_BYTES)
                throw new IllegalArgumentException("云端沟通服务暂不可用");
            Map<String,Object> result = mapper.readValue(bytes, new TypeReference<>() {});
            if (!(result.get("code") instanceof Number code) || code.intValue() != 0)
                throw new IllegalArgumentException(result.get("message") instanceof String message ? message : "沟通操作失败");
            return result.get("data");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt(); throw new IllegalArgumentException("沟通请求已取消");
        } catch (java.io.IOException e) {
            throw new IllegalArgumentException("云端沟通服务暂时无法连接，请稍后重试");
        }
    }
}
