// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.mobile;

import com.checkba.model.entity.AccountBinding;
import com.checkba.model.entity.Project;
import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.AccountBindingRepository;
import com.checkba.repository.MobileTransferRequestRepository;
import com.checkba.repository.ProjectRepository;
import com.checkba.service.DeviceTokenService;
import com.checkba.service.LocalIdentityService;
import com.checkba.service.ProjectAiMessageService;
import com.checkba.service.ProjectFileService;
import com.checkba.service.account.AccountService;
import com.checkba.service.ai.tools.WebTools;
import com.checkba.service.ai.PluginRevocationService;
import com.checkba.storage.StorageServiceFactory;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.langchain4j.model.embedding.EmbeddingModel;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.config.BeanFactoryPostProcessor;
import org.springframework.beans.factory.support.BeanDefinitionRegistry;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.ApplicationContext;
import org.springframework.scheduling.config.TaskManagementConfigUtils;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.Map;
import java.util.HexFormat;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Synthetic loopback integration, not an iOS E2E test. A Java HTTP client plays the phone;
 * the actual desktop relay client, Spring controller/service, H2 repositories, multipart
 * handling and local blob storage run together. Billing is a counting mock; external AI,
 * web and plugin-revocation integrations are mocked, scheduled jobs are disabled, and the
 * desktop account/identity collaborators use synthetic fixtures. No production account,
 * project, relay state, billing endpoint or OSS is used.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "server.address=127.0.0.1",
        "security.local-mode=false",
        "mobile.relay.enabled=false",
        "mobile.relay.oss.enabled=false",
        "mobile.transfer.billing.base-url=http://127.0.0.1:1",
        "mobile.transfer.billing.secret=synthetic-test-only",
        "ai.account.base-url=http://127.0.0.1:1",
        "mobile.billing.base-url=http://127.0.0.1:1",
        "mobile.billing.secret=",
        "mobile.billing.recharge-enabled=false",
        "ai.packs.enabled=false",
        "ai.packs.auto-upgrade=false",
        "ai.plugins.registry-url=http://127.0.0.1:1/plugins",
        "ai.skills.registry-url=http://127.0.0.1:1/skills",
        "telemetry.enabled=false"
})
@ActiveProfiles("desktop")
@Import(MobileTransferLoopbackIntegrationTest.NoScheduledJobs.class)
class MobileTransferLoopbackIntegrationTest {
    private static final Path ROOT = temporaryRoot();

    @DynamicPropertySource
    static void isolatedStorage(DynamicPropertyRegistry properties) {
        properties.add("spring.datasource.url", () -> "jdbc:h2:mem:duo-loopback-" + ROOT.getFileName()
                + ";MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1");
        properties.add("storage.local.root-path", () -> ROOT.resolve("storage").toString());
        properties.add("security.license.dir", () -> ROOT.resolve("license").toString());
        properties.add("ai.plugins.dir", () -> ROOT.resolve("plugins").toString());
        properties.add("ai.packs.dir", () -> ROOT.resolve("packs").toString());
        properties.add("ai.skills.dir", () -> ROOT.resolve("skills").toString());
        properties.add("ai.skills.builtin-dir", () -> ROOT.resolve("builtin-skills").toString());
        properties.add("ai.models.dir", () -> ROOT.resolve("models").toString());
    }

    @LocalServerPort int port;
    @Autowired ObjectMapper mapper;
    @Autowired AccountBindingRepository bindings;
    @Autowired ProjectRepository projects;
    @Autowired ProjectFileService files;
    @Autowired StorageServiceFactory storage;
    @Autowired DeviceTokenService tokens;
    @Autowired MobileTransferRequestRepository transfers;
    @Autowired MobileRelayBlobStore blobs;
    @Autowired ApplicationContext context;
    @MockBean TransferBillingClient billing;
    @MockBean MobileBillingClient mobileBilling;
    @Autowired MobileBillingService mobileBillingService;
    @Autowired MobileBackupService backupService;
    @Autowired com.checkba.repository.MobileFileBackupRepository backupRepository;
    @Autowired com.checkba.repository.MobileDeviceStateRepository deviceStates;
    @MockBean WebTools webTools;
    @MockBean EmbeddingModel embeddingModel;
    @MockBean PluginRevocationService pluginRevocation;

    private final HttpClient phone = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    @TestConfiguration(proxyBeanMethods = false)
    static class NoScheduledJobs {
        @Bean
        static BeanFactoryPostProcessor disableScheduledJobs() {
            return factory -> {
                if (factory instanceof BeanDefinitionRegistry registry
                        && registry.containsBeanDefinition(TaskManagementConfigUtils.SCHEDULED_ANNOTATION_PROCESSOR_BEAN_NAME)) {
                    registry.removeBeanDefinition(TaskManagementConfigUtils.SCHEDULED_ANNOTATION_PROCESSOR_BEAN_NAME);
                }
            };
        }
    }

    @Test
    void realBackupWorkerConsentUploadOfflinePreviewAndRevocationRoundTrip() throws Exception {
        String suffix=UUID.randomUUID().toString();
        String session=json("POST","/api/auth/register",null,Map.of("username","backup-loop-"+suffix,
                "password","synthetic-only","displayName","Backup fixture")).path("data").path("sessionId").asText();
        long userId=json("GET","/api/auth/me",session,null).path("data").path("id").asLong();
        AccountBinding binding=new AccountBinding();binding.setUserId(userId);binding.setExternalAccountId("backup-loop-"+suffix);
        binding.setCreatedAt(LocalDateTime.now());bindings.save(binding);
        when(mobileBilling.balance(anyString())).thenReturn(new MobileBillingClient.BalanceResult(0L,"CNY","paid",
                Map.of("active",true,"expiresAt","2030-01-01T00:00:00Z","cloudStorageBytes",3L*1024*1024*1024)));
        Project project=new Project();project.setId(42000L);project.setUid(UUID.randomUUID().toString());
        project.setUserId(userId);project.setName("Synthetic desktop-only backup");
        ProjectFile document=new ProjectFile();document.setId(2L);document.setUid(UUID.randomUUID().toString());document.setProjectId(project.getId());
        document.setName("sample.pdf");document.setFilePath("desktop-only.pdf");document.setParentId(1L);document.setIsFolder(false);
        ProjectFile folder=new ProjectFile();folder.setId(1L);folder.setUid(UUID.randomUUID().toString());folder.setName("empty-and-file-folder");folder.setIsFolder(true);
        ProjectFile unsupported=new ProjectFile();unsupported.setId(3L);unsupported.setUid(UUID.randomUUID().toString());unsupported.setName("never-upload.zip");unsupported.setIsFolder(false);
        byte[] expected="%PDF-synthetic-private-fixture".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        document.setFileSize((long)expected.length);
        Path localFile=ROOT.resolve("synthetic-desktop-original.pdf");Files.write(localFile,expected);
        ProjectRepository desktopProjects=mock(ProjectRepository.class);when(desktopProjects.findByUserIdOrderByCreatedAtDesc(userId)).thenReturn(java.util.List.of(project));
        when(desktopProjects.findById(project.getId())).thenReturn(java.util.Optional.of(project));
        ProjectFileService desktopFiles=mock(ProjectFileService.class);when(desktopFiles.getFileTree(project.getId())).thenReturn(java.util.List.of(folder,document,unsupported));
        StorageServiceFactory desktopStorage=mock(StorageServiceFactory.class);com.checkba.storage.StorageService desktopBytes=mock(com.checkba.storage.StorageService.class);
        when(desktopStorage.getStorageService()).thenReturn(desktopBytes);when(desktopBytes.load("desktop-only.pdf")).thenReturn(new org.springframework.core.io.FileSystemResource(localFile));
        String device="backup-"+suffix;Path stateDirectory=ROOT.resolve(device);Files.createDirectories(stateDirectory);
        mapper.writeValue(stateDirectory.resolve("mobile-relay.json").toFile(),Map.of("deviceId",device,
                "token",tokens.issue(userId,"Backup synthetic desktop").plaintext(),"accountFingerprint","backup-fixture"));
        AccountService account=mock(AccountService.class);when(account.currentKeyOrNull()).thenReturn("awdk_synthetic_unused");
        when(account.accountFingerprintOrNull()).thenReturn("backup-fixture");
        LocalIdentityService identity=mock(LocalIdentityService.class);when(identity.localUserId()).thenReturn(userId);
        MobileRelayClientService desktop=new MobileRelayClientService(true,true,baseURL(),baseURL(),stateDirectory.toString(),
                account,identity,desktopProjects,desktopFiles,desktopStorage,mock(ProjectAiMessageService.class),mock(DesktopRefHandler.class));
        ProjectCatalogService desktopCatalog=mock(ProjectCatalogService.class);
        when(desktopCatalog.ensureProjectUid(project)).thenReturn(project.getUid());
        when(desktopCatalog.ensureFileUid(any())).thenAnswer(inv -> ((ProjectFile)inv.getArgument(0)).getUid());
        org.springframework.test.util.ReflectionTestUtils.setField(desktop,"projectCatalog",desktopCatalog);
        desktop.syncFileBackups();assertTrue(backupRepository.findByUserId(userId).isEmpty());verifyNoInteractions(desktopBytes);
        assertFalse(json("GET","/api/mobile/backup-consent",session,null).path("enabled").asBoolean());
        assertTrue(json("PUT","/api/mobile/backup-consent",session,Map.of("enabled",true,"consentVersion",MobileBackupService.CONSENT_VERSION)).path("enabled").asBoolean());
        desktop.syncFileBackups();desktop.syncFileBackups();
        var saved=backupRepository.findByUserId(userId);assertEquals(1,saved.size());
        assertEquals(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(expected)),saved.get(0).getSha256());
        assertTrue(saved.get(0).getStoragePath().contains("mobile-backup"));
        assertTrue(Files.exists(Path.of(saved.get(0).getStoragePath())));
        var heartbeat=deviceStates.findByUserIdAndDeviceId(userId,device).orElseThrow();heartbeat.setLastSeenAt(LocalDateTime.now().minusHours(1));deviceStates.save(heartbeat);
        JsonNode catalog=json("GET","/api/mobile/catalog/"+project.getUid()+"/files",session,null);
        assertEquals(3,catalog.path("files").size());
        assertTrue(catalog.path("files").get(0).path("isFolder").asBoolean());
        assertEquals("backup",catalog.path("files").get(1).path("source").asText());
        String preview="/api/mobile/preview/catalog/"+project.getUid()+"/files/"+document.getUid()+"/content";
        HttpResponse<byte[]> content=request("GET",preview,session,null);
        assertEquals(200,content.statusCode());assertEquals("application/octet-stream",content.headers().firstValue("Content-Type").orElse(""));
        assertArrayEquals(expected,content.body());
        when(mobileBilling.balance(anyString())).thenReturn(new MobileBillingClient.BalanceResult(0L,"CNY","free",Map.of()));
        mobileBillingService.invalidateBalance(userId);
        assertEquals(1,json("GET",preview,session,null).path("code").asInt());
        assertFalse(json("PUT","/api/mobile/backup-consent",session,Map.of("enabled",false,"consentVersion",MobileBackupService.CONSENT_VERSION)).path("enabled").asBoolean());
        assertEquals(1,json("GET",preview,session,null).path("code").asInt());
        backupService.cleanDeleted();assertTrue(backupRepository.findByUserId(userId).isEmpty());
        assertFalse(Files.exists(Path.of(saved.get(0).getStoragePath())));assertArrayEquals(expected,Files.readAllBytes(localFile));
    }

    @Test
    void realDesktopAndCloudRoundTripPreservesBytesChargesOnceAndDeletesOnlyOnAck() throws Exception {
        assertInstanceOf(MobileRelayLocalBlobStore.class, blobs);
        assertFalse(context.containsBean(TaskManagementConfigUtils.SCHEDULED_ANNOTATION_PROCESSOR_BEAN_NAME));
        for (String property : new String[] { "storage.local.root-path", "security.license.dir", "ai.plugins.dir",
                "ai.packs.dir", "ai.skills.dir", "ai.skills.builtin-dir", "ai.models.dir" }) {
            assertTrue(Path.of(context.getEnvironment().getRequiredProperty(property)).startsWith(ROOT), property);
        }
        String suffix = UUID.randomUUID().toString();
        JsonNode registration = json("POST", "/api/auth/register", null,
                Map.of("username", "loopback-" + suffix, "password", "synthetic-test-only", "displayName", "Loopback fixture"));
        String session = registration.path("data").path("sessionId").asText();
        assertFalse(session.isBlank());
        long userId = json("GET", "/api/auth/me", session, null).path("data").path("id").asLong();
        assertTrue(userId > 0);
        AccountBinding binding = new AccountBinding();
        binding.setUserId(userId);
        binding.setExternalAccountId("synthetic-loopback-account");
        binding.setCreatedAt(LocalDateTime.now());
        bindings.save(binding);
        when(billing.quote(anyString(), anyLong())).thenReturn(new TransferBillingClient.QuoteResult(2, 500L));
        when(billing.charge(anyString(), anyLong(), anyString(), anyString()))
                .thenAnswer(invocation -> new TransferBillingClient.ChargeResult(2, "fixture-" + invocation.getArgument(3)));

        Project project = project(userId, "Synthetic matter A");
        Project otherProject = project(userId, "Synthetic matter B");
        byte[] expected = new byte[65_539];
        for (int i = 0; i < expected.length; i++) expected[i] = (byte) (i * 31);
        ProjectFile document = file(project, userId, "现场资料.txt", expected);
        ProjectFile otherFile = file(otherProject, userId, "private-fixture.txt", new byte[] { 9, 8, 7 });

        String deviceId = "loopback-" + UUID.randomUUID();
        Path stateDirectory = ROOT.resolve("desktop-state");
        Files.createDirectories(stateDirectory);
        mapper.writeValue(stateDirectory.resolve("mobile-relay.json").toFile(), Map.of(
                "deviceId", deviceId, "token", tokens.issue(userId, "Synthetic desktop").plaintext(),
                "accountFingerprint", "synthetic-fingerprint"));
        AccountService account = mock(AccountService.class);
        when(account.currentKeyOrNull()).thenReturn("awdk_synthetic_unused");
        when(account.accountFingerprintOrNull()).thenReturn("synthetic-fingerprint");
        LocalIdentityService identity = mock(LocalIdentityService.class);
        when(identity.localUserId()).thenReturn(userId);
        MobileRelayClientService desktop = new MobileRelayClientService(true, true, baseURL(), baseURL(),
                stateDirectory.toString(), account, identity, projects, files, storage,
                mock(ProjectAiMessageService.class), mock(DesktopRefHandler.class));
        long oldWindow = MobileRelayClientService.TRANSFER_HOT_WINDOW_MS;
        long oldInterval = MobileRelayClientService.TRANSFER_HOT_POLL_INTERVAL_MS;
        MobileRelayClientService.TRANSFER_HOT_WINDOW_MS = 0;
        MobileRelayClientService.TRANSFER_HOT_POLL_INTERVAL_MS = 1;
        try {
            desktop.pushDirectory();
            JsonNode directory = json("GET", "/api/mobile/projects", session, null);
            assertTrue(directory.isArray());
            assertEquals(2, directory.size());
            assertEquals(deviceId, directory.get(0).path("deviceId").asText());

            JsonNode listingCreated = json("POST", "/api/mobile/transfer/list", session,
                    Map.of("deviceId", deviceId, "projectKey", project.getId().toString(), "requestId", UUID.randomUUID().toString()));
            long listId = listingCreated.path("id").asLong();
            assertTrue(listId > 0);
            desktop.pollTransferCommands();
            JsonNode listing = status(listId, session);
            assertEquals("DONE", listing.path("status").asText());
            assertEquals(1, listing.path("files").size());
            assertEquals(document.getId().toString(), listing.path("files").get(0).path("id").asText());
            assertEquals(1, listing.path("totalCount").asInt());
            assertFalse(listing.path("truncated").asBoolean());

            JsonNode quote = json("GET", "/api/mobile/transfer/quote?bytes=" + expected.length, session, null);
            assertEquals(2, quote.path("credits").asInt());
            verify(billing, times(1)).quote("synthetic-loopback-account", expected.length);
            verify(billing, never()).charge(anyString(), anyLong(), anyString(), anyString());

            String requestId = UUID.randomUUID().toString();
            Map<String, Object> pullBody = pull(deviceId, project, document, requestId);
            long pullId = json("POST", "/api/mobile/transfer/pull", session, pullBody).path("id").asLong();
            assertEquals(pullId, json("POST", "/api/mobile/transfer/pull", session, pullBody).path("id").asLong());
            verify(billing, times(1)).charge("synthetic-loopback-account", expected.length, "xfer-" + requestId, requestId);
            desktop.pollTransferCommands();
            JsonNode staged = status(pullId, session);
            assertEquals("STAGED", staged.path("status").asText());
            assertEquals(expected.length, staged.path("fileSize").asLong());
            String blobPath = transfers.findById(pullId).orElseThrow().getStoragePath();
            assertTrue(Path.of(blobPath).startsWith(ROOT));
            assertTrue(Files.exists(Path.of(blobPath)));
            HttpResponse<byte[]> downloaded = request("GET", "/api/mobile/transfer/" + pullId + "/content", session, null);
            assertEquals(200, downloaded.statusCode());
            assertEquals("application/octet-stream", downloaded.headers().firstValue("Content-Type").orElseThrow());
            assertEquals(expected.length, downloaded.headers().firstValueAsLong("Content-Length").orElseThrow());
            assertArrayEquals(expected, downloaded.body());
            assertArrayEquals(MessageDigest.getInstance("SHA-256").digest(expected),
                    MessageDigest.getInstance("SHA-256").digest(downloaded.body()));
            assertTrue(Files.exists(Path.of(blobPath)), "Reading content alone must not delete the relay blob");
            Path phoneCopy = ROOT.resolve("phone-copy.bin");
            Files.write(phoneCopy, downloaded.body());
            assertArrayEquals(expected, Files.readAllBytes(phoneCopy));
            assertEquals(0, json("POST", "/api/mobile/transfer/" + pullId + "/ack", session, null).path("code").asInt(-1));
            assertEquals("DELIVERED", status(pullId, session).path("status").asText());
            assertFalse(Files.exists(Path.of(blobPath)));
            assertNull(transfers.findById(pullId).orElseThrow().getStoragePath());
            assertNotEquals(0, json("GET", "/api/mobile/transfer/" + pullId + "/content", session, null).path("code").asInt());
            assertEquals(0, json("POST", "/api/mobile/transfer/" + pullId + "/ack", session, null).path("code").asInt(-1));
            try (var original = storage.getStorageService().load(document.getFilePath()).getInputStream()) {
                assertArrayEquals(expected, original.readAllBytes());
            }

            // A valid file ID from another project must not cross the command's project boundary.
            String wrongRequestId = UUID.randomUUID().toString();
            long rejectedId = json("POST", "/api/mobile/transfer/pull", session,
                    pull(deviceId, project, otherFile, wrongRequestId)).path("id").asLong();
            desktop.pollTransferCommands();
            assertEquals("FAILED", status(rejectedId, session).path("status").asText());
            assertNull(transfers.findById(rejectedId).orElseThrow().getStoragePath());
            verify(billing, times(1)).refund("synthetic-loopback-account", "fixture-" + wrongRequestId, "xferrf-" + wrongRequestId);
            assertNotEquals(0, json("GET", "/api/mobile/transfer/" + rejectedId + "/content", session, null).path("code").asInt());
            holdForOptionalSwiftFixture(desktop, session, deviceId, project, document, expected);
        } finally {
            desktop.stopDoorbell();
            MobileRelayClientService.TRANSFER_HOT_WINDOW_MS = oldWindow;
            MobileRelayClientService.TRANSFER_HOT_POLL_INTERVAL_MS = oldInterval;
        }
    }

    private void holdForOptionalSwiftFixture(MobileRelayClientService desktop, String session, String deviceId,
                                            Project project, ProjectFile file, byte[] expected) throws Exception {
        String configuredPath = System.getProperty("awd.loopback.fixture");
        if (configuredPath == null || configuredPath.isBlank()) return;
        Path manifest = Path.of(configuredPath).toAbsolutePath();
        Path done = Path.of(manifest + ".done");
        var existingPulls = transfers.findAll().stream().filter(row -> "PULL".equals(row.getKind()))
                .map(row -> row.getId()).collect(Collectors.toSet());
        Files.createDirectories(manifest.getParent());
        Path staging = Files.createTempFile(manifest.getParent(), ".loopback-", ".json",
                PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
        try {
            mapper.writeValue(staging.toFile(), Map.of(
                    "baseURL", baseURL(), "sessionID", session, "deviceId", deviceId,
                    "projectKey", project.getId().toString(), "fileID", file.getId().toString(),
                    "fileName", file.getName(), "size", expected.length,
                    "sha256", HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(expected))));
            Files.move(staging, manifest, StandardCopyOption.ATOMIC_MOVE);
            long deadline = System.nanoTime() + Duration.ofMinutes(8).toNanos();
            while (!Files.exists(done) && System.nanoTime() < deadline) {
                desktop.pollTransferCommands();
                Thread.sleep(100);
            }
            assertTrue(Files.exists(done), "Swift fixture was not completed within eight minutes");
            assertEquals("passed", Files.readString(done).trim());
            // The opt-in consumer must have delivered one additional transfer, without extra charges.
            verify(billing, times(3)).charge(anyString(), anyLong(), anyString(), anyString());
            assertEquals(2, transfers.findAll().stream().filter(row -> "DELIVERED".equals(row.getStatus())).count());
            var swiftPulls = transfers.findAll().stream().filter(row -> "PULL".equals(row.getKind())
                    && !existingPulls.contains(row.getId())).toList();
            assertEquals(1, swiftPulls.size());
            var swiftPull = swiftPulls.get(0);
            assertEquals("DELIVERED", swiftPull.getStatus());
            assertNull(swiftPull.getStoragePath());
            assertFalse(Files.exists(ROOT.resolve("storage/mobile-relay/" + swiftPull.getUserId() + "/" + swiftPull.getRequestId())));
            try (var original = storage.getStorageService().load(file.getFilePath()).getInputStream()) {
                assertArrayEquals(expected, original.readAllBytes());
            }
        } finally {
            Files.deleteIfExists(staging);
            Files.deleteIfExists(manifest);
            Files.deleteIfExists(done);
        }
    }

    private Project project(long userId, String name) {
        Project project = new Project();
        project.setName(name);
        project.setProjectType("MAJOR_ASSET_RESTRUCTURING");
        project.setListedCompanyName("Synthetic listed company");
        project.setTargetCompanyName("Synthetic target company");
        project.setUserId(userId);
        project.setCreatedAt(LocalDateTime.now());
        project.setUpdatedAt(LocalDateTime.now());
        return projects.save(project);
    }

    private ProjectFile file(Project project, long userId, String name, byte[] contents) {
        String path = "projects/" + project.getId() + "/" + name;
        storage.getStorageService().save(path, new ByteArrayInputStream(contents));
        return files.createFile(project.getId(), null, name, "txt", (long) contents.length, path, null, userId);
    }

    private Map<String, Object> pull(String deviceId, Project project, ProjectFile file, String requestId) {
        return Map.of("deviceId", deviceId, "projectKey", project.getId().toString(),
                "remoteFileId", file.getId().toString(), "fileName", file.getName(),
                "fileSize", file.getFileSize(), "requestId", requestId);
    }

    private JsonNode status(long id, String session) throws Exception {
        return json("GET", "/api/mobile/transfer/" + id, session, null).path("transfer");
    }

    private JsonNode json(String method, String path, String session, Map<String, ?> body) throws Exception {
        HttpResponse<byte[]> response = request(method, path, session, body);
        assertEquals(200, response.statusCode());
        return mapper.readTree(response.body());
    }

    private HttpResponse<byte[]> request(String method, String path, String session, Map<String, ?> body) throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(baseURL() + path))
                .timeout(Duration.ofSeconds(15)).header("X-App-Language", "en-US");
        if (session != null) builder.header("X-Session-Id", session);
        if (body == null) builder.method(method, HttpRequest.BodyPublishers.noBody());
        else builder.header("Content-Type", "application/json").method(method,
                HttpRequest.BodyPublishers.ofByteArray(mapper.writeValueAsBytes(body)));
        return phone.send(builder.build(), HttpResponse.BodyHandlers.ofByteArray());
    }

    private String baseURL() { return "http://127.0.0.1:" + port; }

    private static Path temporaryRoot() {
        try { return Files.createTempDirectory("awd-duo-loopback-"); }
        catch (IOException exception) { throw new java.io.UncheckedIOException(exception); }
    }
}
