// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.config;

import com.checkba.service.ai.tools.WebTools;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.availability.AvailabilityChangeEvent;
import org.springframework.boot.availability.ReadinessState;
import org.springframework.boot.test.autoconfigure.actuate.observability.AutoConfigureObservability;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.boot.test.web.server.LocalManagementPort;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.ApplicationContext;
import org.springframework.core.env.Environment;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import javax.sql.DataSource;
import java.io.IOException;
import java.net.ConnectException;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.sql.SQLException;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.reset;

/**
 * Server-profile readiness probe and loopback-only metrics (application-ops.yml).
 * Uses the zero-dependency desktop environment plus the ops profile, i.e. exactly what
 * cloud/case/prod get through spring.profiles.group, with server (non local-mode) semantics.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "security.local-mode=false",
        "management.server.port=0",
        "security.license.dir=${java.io.tmpdir}/awd-ops-health-license"
})
@ActiveProfiles({"desktop", "ops"})
// Spring Boot tests swap in a no-export registry by default; we need the real Prometheus one.
@AutoConfigureObservability(tracing = false)
// No other test shares this configuration; close it (two Tomcats + a real registry) instead of caching it.
@DirtiesContext
class OpsHealthMetricsTest {

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry registry) throws IOException {
        String root = Files.createTempDirectory("ops-health-test").toAbsolutePath().toString();
        registry.add("storage.local.root-path", () -> root);
        registry.add("spring.datasource.url", () -> "jdbc:h2:mem:ops-health-" + System.nanoTime()
                + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;NON_KEYWORDS=VALUE");
    }

    @MockBean
    WebTools webTools;

    @SpyBean
    DataSource dataSource;

    @LocalServerPort
    int port;

    @LocalManagementPort
    int managementPort;

    @Autowired
    ApplicationContext context;

    @Autowired
    Environment environment;

    private final HttpClient http = HttpClient.newHttpClient();

    @AfterEach
    void restore() {
        reset(dataSource);
        AvailabilityChangeEvent.publish(context, ReadinessState.ACCEPTING_TRAFFIC);
    }

    @Test
    void readyIsUpWithoutLeakingDetails() throws Exception {
        HttpResponse<String> r = get(port, "/api/health/ready");
        assertEquals(200, r.statusCode());
        assertEquals("{\"status\":\"UP\"}", r.body());
    }

    @Test
    void readyIsDownWhenDatabaseUnreachable() throws Exception {
        // Fails every new borrow; the health indicator must surface it as 503, with no JDBC detail.
        doThrow(new SQLException("boom jdbc:secret")).when(dataSource).getConnection();
        HttpResponse<String> r = get(port, "/api/health/ready");
        assertEquals(503, r.statusCode());
        assertEquals("{\"status\":\"DOWN\"}", r.body());

        // The loopback endpoint does show which component failed (operators only).
        HttpResponse<String> detail = get(managementPort, "/actuator/health");
        assertEquals(503, detail.statusCode());
        assertTrue(detail.body().contains("\"db\":{\"status\":\"DOWN\""), detail.body());
    }

    @Test
    void readyIsNotUpWhileRefusingTraffic() throws Exception {
        AvailabilityChangeEvent.publish(context, ReadinessState.REFUSING_TRAFFIC);
        HttpResponse<String> r = get(port, "/api/health/ready");
        assertEquals(503, r.statusCode());
        assertFalse(r.body().contains("readinessState"), r.body());
    }

    @Test
    void actuatorIsNotServedOnThePublicPort() throws Exception {
        // "Not served" means: a plain 404, indistinguishable from a path that never existed.
        HttpResponse<String> unknown = get(port, "/no-such-path-" + System.nanoTime());
        assertEquals(404, unknown.statusCode());
        for (String path : new String[]{"/actuator/prometheus", "/actuator/health", "/actuator", "/actuator/env"}) {
            HttpResponse<String> r = get(port, path);
            assertEquals(404, r.statusCode(), path);
            assertEquals(unknown.body(), r.body(), path);
            assertFalse(r.body().contains("jvm_"), path);
        }
        assertNotEquals(port, managementPort);
    }

    @Test
    @org.junit.jupiter.api.extension.ExtendWith(org.springframework.boot.test.system.OutputCaptureExtension.class)
    void unmappedApiPathsGetRealStatusCodesWithoutErrorLogs(
            org.springframework.boot.test.system.CapturedOutput output) throws Exception {
        // QA QO-office bug 10: these used to be HTTP 200 {"code":1,"message":"服务器内部错误"} plus an ERROR stack.
        HttpResponse<String> missing = get(port, "/api/no-such-endpoint-" + System.nanoTime());
        assertEquals(404, missing.statusCode());
        assertTrue(missing.body().contains("\"code\":1"), missing.body());
        assertTrue(missing.body().contains("API endpoint not found") || missing.body().contains("接口不存在"),
                missing.body());

        HttpResponse<String> wrongMethod = get(port, "/api/projects"); // only POST is mapped
        assertEquals(405, wrongMethod.statusCode());
        assertTrue(wrongMethod.headers().firstValue("Allow").orElse("").contains("POST"));

        HttpResponse<String> badId = get(port, "/api/projects/list"); // falls on /{id} with a Long id
        assertEquals(400, badId.statusCode());

        HttpResponse<String> english = http.send(HttpRequest.newBuilder(
                URI.create("http://127.0.0.1:" + port + "/api/no-such-endpoint"))
                .header("X-App-Language", "en").build(), HttpResponse.BodyHandlers.ofString());
        assertTrue(english.body().contains("API endpoint not found"), english.body());

        for (HttpResponse<String> r : java.util.List.of(missing, wrongMethod, badId)) {
            assertFalse(r.body().contains("服务器内部错误"), r.body());
        }
        assertFalse(output.getAll().contains("GlobalExceptionHandler caught Exception"), "no ERROR log for unmapped paths");
    }

    @Test
    void metricsServedOnLoopbackManagementPort() throws Exception {
        get(port, "/api/health/ready"); // produce at least one http.server.requests sample
        HttpResponse<String> r = get(managementPort, "/actuator/prometheus");
        assertEquals(200, r.statusCode());
        for (String metric : new String[]{"jvm_memory_used_bytes", "jvm_threads_live_threads",
                "http_server_requests_seconds_count", "hikaricp_connections_pending",
                "awd_sse_connections{", "awd_agent_runs_active"}) {
            assertTrue(r.body().contains(metric), metric);
        }
        // Only health and prometheus are exposed even on loopback.
        assertFalse(get(managementPort, "/actuator/env").body().contains("propertySources"));
        assertNotEquals("application/octet-stream",
                get(managementPort, "/actuator/heapdump").headers().firstValue("content-type").orElse(""));
    }

    @Test
    void managementPortIsBoundToLoopbackOnly() throws Exception {
        assertEquals("127.0.0.1", environment.getProperty("management.server.address"));
        InetAddress external = Collections.list(NetworkInterface.getNetworkInterfaces()).stream()
                .flatMap(i -> Collections.list(i.getInetAddresses()).stream())
                .filter(a -> a instanceof Inet4Address && !a.isLoopbackAddress() && !a.isLinkLocalAddress())
                .findFirst().orElse(null);
        if (external == null) return; // no non-loopback interface on this runner
        try (Socket s = new Socket()) {
            assertThrows(ConnectException.class, () -> s.connect(new InetSocketAddress(external, managementPort), 2000));
        }
    }

    @Test
    void serverProfilesPullInOps() {
        for (String profile : new String[]{"cloud", "case", "prod"}) {
            assertEquals("ops", environment.getProperty("spring.profiles.group." + profile), profile);
        }
    }

    private HttpResponse<String> get(int p, String path) throws Exception {
        return http.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + p + path)).build(),
                HttpResponse.BodyHandlers.ofString());
    }
}
