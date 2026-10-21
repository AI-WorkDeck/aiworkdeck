// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service;

import com.checkba.controller.AuthController;
import com.checkba.service.ai.tools.WebTools;
import com.checkba.service.ai.PluginRevocationService;
import com.checkba.service.telemetry.TelemetryService;
import com.checkba.version.WorkSessionService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zaxxer.hikari.HikariDataSource;
import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.store.embedding.EmbeddingStore;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.util.ReflectionTestUtils;

import javax.sql.DataSource;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 真 Tomcat + Hikari + 本机权限查库 + 真实目录监听；没有替换鉴权、对账或通知服务。
 * 单独运行时可用 Surefire -DargLine=-Duser.home=<临时目录> 隔离所有非业务缓存。
 * 版本工作段、向量存储、浏览器预热和遥测不属于本验收链，替身禁止其无关外部副作用。
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "spring.datasource.url=jdbc:h2:mem:local-file-change-http;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
        "spring.jpa.open-in-view=true",
        "spring.datasource.hikari.maximum-pool-size=6",
        "security.local-mode=true"
})
@ActiveProfiles("desktop")
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class LocalProjectFileChangeHttpTest {
    private static final Path SANDBOX = temporaryDirectory();

    @DynamicPropertySource
    static void isolateStorage(DynamicPropertyRegistry properties) {
        properties.add("storage.local.root-path", () -> SANDBOX.resolve("storage").toString());
        properties.add("security.license.dir", () -> SANDBOX.resolve("license").toString());
    }

    private static Path temporaryDirectory() {
        try { return Files.createTempDirectory("awd-file-change-http-"); }
        catch (IOException e) { throw new IllegalStateException(e); }
    }

    @MockBean private WebTools webTools;
    @MockBean private WorkSessionService workSessions;
    @MockBean private TelemetryService telemetry;
    @MockBean private PluginRevocationService revocations;
    @MockBean(name = "memoryEmbeddingStore") private EmbeddingStore<TextSegment> memoryStore;
    @MockBean(name = "projectDocEmbeddingStore") private EmbeddingStore<TextSegment> projectStore;

    @Autowired private LocalIdentityService identity;
    @Autowired private LocalProjectService projects;
    @Autowired private LocalRootWatchService watcher;
    @Autowired private LocalProjectFileChangeService changes;
    @Autowired private DataSource dataSource;
    @Autowired private ObjectMapper json;
    @LocalServerPort private int port;

    @AfterAll
    static void clearOwnAuthRegistration() {
        // DirtiesContext 会关闭仓储；四个静态入口都不能继续指向本次上下文。
        AuthController.registerLocalIdentityService(null);
        AuthController.registerUserSessionService(null);
        AuthController.registerDeviceTokenService(null);
        ReflectionTestUtils.setField(AuthController.class, "staticUserService", null);
    }

    @Test
    void openStreamsReleaseConnectionsAndExternalMoveArrivesAfterCommittedTreeUpdate() throws Exception {
        Path root = Files.createDirectory(SANDBOX.resolve("project"));
        Path target = Files.createDirectory(root.resolve("target"));
        Path source = Files.writeString(root.resolve("original.txt"), "synthetic external move");
        Long projectId = projects.openLocalFolder(root.toString(), false, "synthetic", null,
                identity.localUserId()).project().getId();
        assertTrue(watcher.isWatching(projectId), "真实目录监听必须已建立");
        List<Stream> streams = new ArrayList<>();
        try {
            JsonNode initial = readTree(projectId);
            long fileId = rowByName(initial, "original.txt").path("id").asLong();
            long targetId = rowByName(initial, "target").path("id").asLong();
            assertTrue(fileId > 0 && targetId > 0, "HTTP 初始文件树必须含真实导入条目");
            awaitPoolIdle();

            for (int i = 0; i < 4; i++) {
                Stream stream = openStream(projectId);
                streams.add(stream);
                assertEquals(projectId.longValue(), stream.await("ready").path("projectId").asLong());
            }
            // 上面每次握手都真查项目成员和用户表；四条未关闭的 HTTP 流不能各霸占一条连接。
            awaitPoolIdle();

            Files.move(source, target.resolve("original.txt"));
            for (Stream stream : streams) {
                JsonNode notification = stream.await("files_changed");
                assertEquals(1, notification.size(), "通知不能夹带文件路径或文件名");
                assertEquals(projectId.longValue(), notification.path("projectId").asLong());
            }
            // 收到完成通知之后立即走真实 HTTP 请求；不能靠再轮询数据库掩盖提交顺序错误。
            JsonNode moved = rowByName(readTree(projectId), "original.txt");
            assertEquals(fileId, moved.path("id").asLong(), "外部移动保留文件身份");
            assertEquals(targetId, moved.path("parentId").asLong(), "收到通知时新父目录已提交");
            assertFalse(Files.exists(source));
            assertEquals("synthetic external move", Files.readString(target.resolve("original.txt")));
            awaitPoolIdle();
        } finally {
            for (Stream stream : streams) {
                try { stream.close(); } catch (IOException ignored) { }
            }
            changes.shutdown();
            watcher.stopWatch(projectId);
        }
    }

    private JsonNode rowByName(JsonNode rows, String name) {
        assertTrue(rows.isArray(), "文件树 HTTP 响应必须是数组：" + rows);
        for (JsonNode row : rows) if (name.equals(row.path("name").asText())) return row;
        fail("文件树没有预期条目 " + name);
        return null;
    }

    private HttpURLConnection request(String path) throws IOException {
        var connection = (HttpURLConnection) URI.create("http://127.0.0.1:" + port + path).toURL().openConnection();
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(10000);
        return connection;
    }

    private JsonNode readTree(Long projectId) throws IOException {
        var connection = request("/api/projects/" + projectId + "/files?tree=true");
        try {
            assertEquals(200, connection.getResponseCode());
            try (var input = connection.getInputStream()) { return json.readTree(input); }
        } finally { connection.disconnect(); }
    }

    private Stream openStream(Long projectId) throws IOException {
        var connection = request("/api/projects/" + projectId + "/files/changes");
        connection.setRequestProperty("Accept", "text/event-stream");
        assertEquals(200, connection.getResponseCode(), "流必须通过真实鉴权返回 200，401/403 不能作无占池证据");
        assertTrue(connection.getContentType().startsWith("text/event-stream"));
        return new Stream(connection);
    }

    private void awaitPoolIdle() throws Exception {
        var pool = dataSource.unwrap(HikariDataSource.class).getHikariPoolMXBean();
        long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(5);
        while (pool.getActiveConnections() != 0 && System.nanoTime() < deadline) Thread.sleep(25);
        assertEquals(0, pool.getActiveConnections(), "打开的 SSE 流不应持续占住 Hikari 连接");
    }

    private final class Stream implements AutoCloseable {
        private final HttpURLConnection connection;
        private final BufferedReader reader;

        Stream(HttpURLConnection connection) throws IOException {
            this.connection = connection;
            reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8));
        }

        JsonNode await(String expected) throws IOException {
            String event = "", data = "";
            for (String line; (line = reader.readLine()) != null;) {
                if (line.startsWith("event:")) event = line.substring(6).trim();
                else if (line.startsWith("data:")) data += line.substring(5).trim();
                else if (line.isEmpty()) {
                    if (expected.equals(event)) return json.readTree(data);
                    event = ""; data = "";
                }
            }
            throw new IOException("SSE closed before " + expected);
        }

        @Override public void close() throws IOException {
            connection.disconnect();
            reader.close();
        }
    }
}
