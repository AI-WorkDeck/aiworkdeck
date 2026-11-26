// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version.cloud;

import com.checkba.model.entity.User;
import com.checkba.repository.UserRepository;
import com.checkba.service.DeviceTokenService;
import com.checkba.service.UserService;
import com.checkba.version.ProjectRepoService;
import com.checkba.version.objects.LocalVersionObjectStore;
import com.checkba.version.objects.LocalVersionObjectStore.ObjectRef;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.io.ByteArrayInputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;

import static org.junit.jupiter.api.Assertions.*;

/** C12 server over HTTP: capabilities, free plan with FREE_LIMIT, local-only declarations, pre-receive rule. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "security.local-mode=false",
        "collab.objects.free-per-file-bytes=1000",
        "collab.objects.free-per-project-bytes=1500"})
@ActiveProfiles("desktop")
class ProjectObjectFreePlanHttpTest {
    static Path root;
    private static final String DB_URL = "jdbc:h2:mem:object-free-plan-" + System.nanoTime()
            + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;NON_KEYWORDS=VALUE";

    @DynamicPropertySource
    static void storage(DynamicPropertyRegistry registry) throws Exception {
        root = Files.createTempDirectory("object-free-plan");
        registry.add("storage.local.root-path", () -> root.toAbsolutePath().toString());
        registry.add("spring.datasource.url", () -> DB_URL);
    }

    @LocalServerPort int port;
    @Autowired ProjectRepoService repos;
    @Autowired GitHttpController git;
    @Autowired UserRepository users;
    @Autowired JdbcTemplate jdbc;
    @Autowired DeviceTokenService tokens;
    final HttpClient http = HttpClient.newHttpClient();
    final ObjectMapper json = new ObjectMapper();
    String auth;

    long seed(long projectId) throws Exception {
        Files.createDirectories(root.resolve("projects/" + projectId));
        Files.writeString(root.resolve("projects/" + projectId + "/合同.txt"), "初稿");
        repos.init(projectId, "Synthetic", "test@example.com");
        User user = new User();
        user.setUsername("c12_" + projectId); user.setDisplayName("c12"); user.setPassword(UserService.encodePassword("x"));
        user = users.save(user);
        jdbc.update("insert into project (id, name, project_type, listed_company_name, target_company_name, user_id) values (?, ?, ?, ?, ?, ?)",
                projectId, "c12-" + projectId, "BLANK", "", "", user.getId());
        String token = tokens.issue(user.getId(), "c12-test").plaintext();
        auth = "Basic " + Base64.getEncoder().encodeToString(("u:" + token).getBytes(StandardCharsets.UTF_8));
        return projectId;
    }

    String base(long p) { return "http://localhost:" + port + "/git/" + p + ".git/awd-objects"; }

    HttpResponse<String> send(HttpRequest.Builder b) throws Exception {
        return http.send(b.header("Authorization", auth).build(), HttpResponse.BodyHandlers.ofString());
    }

    static byte[] bytes(int n, int seed) { byte[] b = new byte[n]; new java.util.Random(seed).nextBytes(b); return b; }

    HttpResponse<String> putFree(long p, byte[] content, String plan) throws Exception {
        ObjectRef ref = LocalVersionObjectStore.fingerprint(new ByteArrayInputStream(content));
        var b = HttpRequest.newBuilder(URI.create(base(p) + "/" + ref.sha256() + "/parts/0?size=" + ref.size()))
                .header("Content-Type", "application/octet-stream").header("X-AWD-Part-Sha256", ref.sha256())
                .PUT(HttpRequest.BodyPublishers.ofByteArray(content));
        if (plan != null) b.header("X-AWD-Object-Plan", plan);
        return send(b);
    }

    @Test
    void freeSharingUpToTheLimitThenFreeLimitThenLocalOnlyDeclarationPassesPreReceive() throws Exception {
        long p = seed(12001L);
        JsonNode caps = json.readTree(send(HttpRequest.newBuilder(URI.create(base(p) + "/capabilities")).GET()).body());
        assertEquals(1, caps.path("version").asInt(), "capabilities stay version 1 for 0.91 desktops");
        assertEquals(1000, caps.path("freePerFileBytes").asLong());
        assertEquals(1500, caps.path("freePerProjectBytes").asLong());
        assertEquals(0, caps.path("projectFreeUsedBytes").asLong());

        byte[] first = bytes(800, 1);
        ObjectRef firstRef = LocalVersionObjectStore.fingerprint(new ByteArrayInputStream(first));
        assertEquals(200, putFree(p, first, "free").statusCode());
        assertEquals(200, send(HttpRequest.newBuilder(URI.create(base(p) + "/" + firstRef.sha256() + "/complete?size=800"))
                .POST(HttpRequest.BodyPublishers.noBody())).statusCode());
        caps = json.readTree(send(HttpRequest.newBuilder(URI.create(base(p) + "/capabilities")).GET()).body());
        assertEquals(800, caps.path("projectFreeUsedBytes").asLong());

        byte[] second = bytes(900, 2);
        ObjectRef secondRef = LocalVersionObjectStore.fingerprint(new ByteArrayInputStream(second));
        HttpResponse<String> refused = putFree(p, second, "free");
        assertEquals(409, refused.statusCode());
        JsonNode body = json.readTree(refused.body());
        assertEquals("FREE_LIMIT", body.path("code").asText());
        assertEquals(800, body.path("projectFreeUsedBytes").asLong());
        JsonNode status = json.readTree(send(HttpRequest.newBuilder(URI.create(base(p) + "/" + secondRef.sha256() + "?size=900")).GET()).body());
        assertFalse(status.path("complete").asBoolean());
        assertEquals(0, status.path("parts").size(), "nothing stored on FREE_LIMIT");

        assertThrows(java.io.IOException.class, () -> git.requireObjectOrDeclared(p, secondRef), "undeclared missing object still rejects");
        assertEquals(200, send(HttpRequest.newBuilder(URI.create(base(p) + "/" + secondRef.sha256() + "/local-only?size=900"))
                .header("Content-Type", "application/json")
                .PUT(HttpRequest.BodyPublishers.ofString("{\"pathHint\":\"证据/庭审录像.mp4\"}"))).statusCode());
        git.requireObjectOrDeclared(p, secondRef); // declared: pre-receive accepts it
        assertThrows(java.io.IOException.class, () -> git.requireObjectOrDeclared(p, new ObjectRef(secondRef.sha256(), 901)),
                "a declaration covers its exact size only");
        git.requireObjectOrDeclared(p, firstRef); // present: as before
    }

    @Test
    void billingRefusalsHaveNamedCodes() {
        assertEquals("STORAGE_LIMIT", ProjectObjectController.billingCode(com.checkba.service.mobile.CloudBillingText.get("storageLimit")));
        assertEquals("WRITES_PAUSED", ProjectObjectController.billingCode(com.checkba.service.mobile.CloudBillingText.get("writesPaused")));
        assertNull(ProjectObjectController.billingCode("Invalid part length"));
        assertNull(ProjectObjectController.billingCode(null));
    }
}
