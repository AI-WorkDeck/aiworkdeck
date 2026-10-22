// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service;

import com.checkba.model.entity.CloudConnection;
import com.checkba.repository.CloudConnectionRepository;
import com.checkba.service.account.AccountEndpoint;
import com.checkba.service.account.AccountService;
import com.checkba.service.plugin.PluginCredentialStore;
import com.checkba.version.OfficialCloudService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.*;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;
import java.io.IOException;
import java.time.Duration;
import java.util.*;

/** Invitation sessions belong to this workspace connection, never to the global desktop login. */
@Service
public class DdClientConnectionService {
    private static final ObjectMapper JSON = new ObjectMapper();
    private final PluginCredentialStore credentials;
    private final AccountService account;
    private final CloudConnectionRepository cloudConnections;
    private final OfficialCloudService official;
    private final OkHttpClient http = new OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
            .connectTimeout(Duration.ofSeconds(10)).readTimeout(Duration.ofSeconds(90)).callTimeout(Duration.ofSeconds(120)).build();

    public DdClientConnectionService(PluginCredentialStore credentials, AccountService account,
                                    CloudConnectionRepository cloudConnections, OfficialCloudService official) {
        this.credentials = credentials; this.account = account; this.cloudConnections = cloudConnections; this.official = official;
    }

    public record Connection(String id, String serverUrl, long projectId, String name, String session) {}
    public record Reply(int status, String contentType, String disposition, byte[] body) {}

    public synchronized List<Map<String, Object>> list(Long userId) {
        return read(scope(userId)).stream().map(this::publicView).toList();
    }

    public Map<String, Object> connect(Long userId, String code, Long cloudConnectionId) {
        String owner = scope(userId);
        if (code == null || code.isBlank() || code.length() > 256) throw bad("请输入有效的邀请码");
        String base;
        if (cloudConnectionId == null) {
            base = official.officialBaseUrl();
            if (base == null) throw bad("本站暂未提供案件库，请选择已连接的团队案件库");
        } else {
            CloudConnection connection = cloudConnections.findById(cloudConnectionId).orElseThrow(() -> denied());
            if (!Objects.equals(userId, connection.getUserId()) || (connection.getAccountFingerprint() != null
                    && !Objects.equals(connection.getAccountFingerprint(), account.accountFingerprintOrNull()))) throw denied();
            base = connection.getServerUrl();
        }
        base = AccountEndpoint.requireSecure(base).replaceAll("/+$", "");
        Map<String, Object> response = object(send(base, "", "POST", "/api/auth/client-login", jsonBody(Map.of("accessCode", code.trim()))));
        if (!(response.get("code") instanceof Number n) || n.intValue() != 0) throw bad("邀请码无效、已过期或已撤销，请核对后重试");
        Map<String, Object> data = map(response.get("data"));
        String session = Objects.toString(data.get("sessionId"), "");
        long projectId = number(data.get("projectId"));
        if (session.isBlank() || projectId <= 0) throw bad("案件库返回的信息不完整，请稍后重试");
        String projectName = Objects.toString(data.get("projectName"), "");
        if (projectName.isBlank()) {
            requireCurrent(userId, owner);
            Map<String, Object> project = object(send(base, session, "GET", "/api/projects/" + projectId, null));
            if (project.get("data") instanceof Map<?, ?>) project = map(project.get("data"));
            projectName = Objects.toString(project.get("name"), "受邀项目 " + projectId);
        }
        Connection added = new Connection(UUID.randomUUID().toString(), base, projectId,
                projectName, session);
        synchronized (this) {
            requireCurrent(userId, owner);
            List<Connection> rows = new ArrayList<>(read(owner));
            rows.removeIf(c -> c.serverUrl().equals(added.serverUrl()) && c.projectId() == added.projectId());
            rows.add(added);
            write(owner, rows);
        }
        return publicView(added);
    }

    public synchronized void disconnect(Long userId, String id) {
        String owner = scope(userId);
        List<Connection> rows = new ArrayList<>(read(owner));
        if (!rows.removeIf(c -> c.id().equals(id))) throw denied();
        write(owner, rows);
    }

    /** A closed operation set: callers cannot choose an origin, query, method or arbitrary file API. */
    public Reply proxy(Long userId, String id, String method, String path, Long requestId, RequestBody body) {
        String owner = scope(userId);
        Connection connection;
        synchronized (this) {
            connection = read(owner).stream().filter(c -> c.id().equals(id)).findFirst().orElseThrow(() -> denied());
        }
        if (!allowed(method, path)) throw denied();
        if (path.equals("/projects")) path = "/projects/" + connection.projectId();
        else if (path.startsWith("/requests/")) {
            Map<String, Object> detail = object(send(connection.serverUrl(), connection.session(), "GET", "/api/dd" + path, null));
            requireProject(detail, connection.projectId());
            requireConnected(userId, owner, id);
            return new Reply(200, "application/json", null, bytes(detail));
        } else if (path.startsWith("/items/")) {
            if (requestId == null) throw denied();
            Map<String, Object> detail = object(send(connection.serverUrl(), connection.session(), "GET", "/api/dd/requests/" + requestId, null));
            requireProject(detail, connection.projectId());
            long itemId = Long.parseLong(path.split("/")[2]);
            Object items = detail.get("items");
            if (!(items instanceof List<?> list) || list.stream().noneMatch(item -> number(map(item).get("id")) == itemId)) throw denied();
        }
        if (path.matches("/notifications/[0-9]+/read")) {
            Reply notifications = send(connection.serverUrl(), connection.session(), "GET", "/api/dd/notifications?projectId=" + connection.projectId(), null);
            try {
                List<Map<String, Object>> rows = JSON.readValue(notifications.body(), new TypeReference<>() {});
                long notificationId = Long.parseLong(path.split("/")[2]);
                if (rows.stream().noneMatch(row -> number(row.get("id")) == notificationId)) throw denied();
            } catch (IOException e) { throw denied(); }
        }
        requireConnected(userId, owner, id);
        String query = path.equals("/notifications") ? "?projectId=" + connection.projectId() : "";
        Reply result = send(connection.serverUrl(), connection.session(), method, "/api/dd" + path + query, body);
        requireConnected(userId, owner, id);
        return result;
    }

    static boolean allowed(String method, String path) {
        if ("GET".equals(method)) return path.equals("/projects") || path.equals("/notifications")
                || path.matches("/requests/[0-9]+")
                || path.matches("/items/[0-9]+/(submissions|comments|file|examples)")
                || path.matches("/items/[0-9]+/submissions/[0-9]+/files/[0-9]+")
                || path.matches("/items/[0-9]+/example/file");
        return "POST".equals(method) && (path.matches("/items/[0-9]+/(submissions|explanation|appeal|comments|verify)")
                || path.matches("/notifications/[0-9]+/read"));
    }

    protected Reply send(String base, String session, String method, String path, RequestBody body) {
        Request.Builder request = new Request.Builder().url(base + path).method(method,
                "GET".equals(method) ? null : body == null ? jsonBody(Map.of()) : body);
        if (!session.isBlank()) request.header("X-Session-Id", session);
        try (Response response = http.newCall(request.build()).execute()) {
            byte[] bytes = response.body() == null ? new byte[0] : response.body().bytes();
            if (response.code() == 401 || response.code() == 403) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "邀请已失效，请重新输入邀请码");
            if (response.isRedirect()) throw bad("案件库地址已变更，请重新连接");
            return new Reply(response.code(), response.header("Content-Type"), response.header("Content-Disposition"), bytes);
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "暂时无法连接案件库，请稍后重试");
        }
    }

    private synchronized String scope(Long userId) {
        if (userId == null) throw denied();
        String fingerprint = account.accountFingerprintOrNull();
        return "dd-client." + userId + "." + (fingerprint == null ? "local" : fingerprint);
    }
    private synchronized void requireConnected(Long userId, String owner, String id) {
        requireCurrent(userId, owner);
        if (read(owner).stream().noneMatch(c -> c.id().equals(id))) throw denied();
    }
    private void requireCurrent(Long userId, String owner) {
        if (!owner.equals(scope(userId))) throw denied();
    }
    private List<Connection> read(String owner) {
        String stored = credentials.get(owner);
        if (stored.isBlank()) return List.of();
        try { return JSON.readValue(stored, new TypeReference<List<Connection>>() {}); }
        catch (IOException e) { throw bad("受邀项目连接不可用，请重新输入邀请码"); }
    }
    private void write(String owner, List<Connection> rows) { credentials.put(owner, new String(bytes(rows), java.nio.charset.StandardCharsets.UTF_8)); }
    private Map<String, Object> publicView(Connection c) {
        return Map.of("id", c.id(), "projectId", c.projectId(), "name", c.name(), "serverUrl", c.serverUrl());
    }
    private static void requireProject(Map<String, Object> detail, long projectId) {
        if (number(map(detail.get("request")).get("projectId")) != projectId) throw denied();
    }
    static Map<String, Object> object(Reply response) {
        if (response.status() < 200 || response.status() >= 300) throw bad("案件库未能完成请求，请稍后重试");
        try { return JSON.readValue(response.body(), new TypeReference<Map<String, Object>>() {}); }
        catch (IOException e) { throw bad("案件库返回的信息无法读取"); }
    }
    @SuppressWarnings("unchecked") private static Map<String, Object> map(Object o) { return o instanceof Map<?, ?> ? (Map<String, Object>) o : Map.of(); }
    private static long number(Object n) { return n instanceof Number number ? number.longValue() : -1; }
    public static RequestBody jsonBody(Object data) { return RequestBody.create(bytes(data), MediaType.get("application/json")); }
    private static byte[] bytes(Object value) {
        try { return JSON.writeValueAsBytes(value); } catch (IOException e) { throw bad("请求内容无法处理"); }
    }
    private static ResponseStatusException denied() { return new ResponseStatusException(HttpStatus.FORBIDDEN, "无权访问该受邀项目"); }
    private static ResponseStatusException bad(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
}
