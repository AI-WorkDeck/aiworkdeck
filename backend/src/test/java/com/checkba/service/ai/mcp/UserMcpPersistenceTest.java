// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.mcp;

import com.checkba.service.SystemSettingService;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.account.AccountService;
import com.checkba.service.plugin.PluginCredentialStore;
import com.checkba.repository.SystemSettingRepository;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

@DataJpaTest(showSql = false)
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:user-mcp-tx;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
    "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
    "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect", "spring.jpa.hibernate.ddl-auto=create-drop"
})
@Import({UserMcpConnectionService.class, SystemSettingService.class, PluginCredentialStore.class})
class UserMcpPersistenceTest {
    static final Path KEY = Path.of(System.getProperty("java.io.tmpdir"), "mcp-transaction-test-" + UUID.randomUUID(), "key");
    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        registry.add("ai.plugins.credential-key-file", () -> KEY.toString());
    }
    @AfterAll static void cleanup() throws Exception { Files.deleteIfExists(KEY); Files.deleteIfExists(KEY.getParent()); }
    @Autowired UserMcpConnectionService service;
    @Autowired PluginCredentialStore credentials;
    @Autowired SystemSettingRepository repository;
    @SpyBean SystemSettingService settings;
    @MockBean AccountService account;
    @MockBean ProjectMemberService members;
    @MockBean PluginMcpHttpClient client;

    @Test
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    void metadataFailureRollsBackCredentialUpdateAndFailedDeletePreservesBoth() {
        when(account.accountFingerprintOrNull()).thenReturn("synthetic-account");
        service.save(8L, "qichacha", new UserMcpConnectionService.Update(null, null, null, "original-token"));
        Map<String, String> before = snapshot();
        doThrow(new IllegalStateException("synthetic metadata failure")).when(settings).set(startsWith("mcp.user."), anyString());
        assertThrows(IllegalStateException.class, () -> service.save(8L, "qichacha", new UserMcpConnectionService.Update(null, null, null, "replacement-token")));
        assertEquals(before, snapshot(), "encrypted credential and connection metadata must roll back together");
        doCallRealMethod().when(settings).set(startsWith("mcp.user."), anyString());
        doThrow(new IllegalStateException("synthetic credential delete failure")).when(settings).set(startsWith("plugin.credentials.mcp."), eq(""));
        assertThrows(IllegalStateException.class, () -> service.delete(8L, "qichacha"));
        assertEquals(before, snapshot(), "failed credential deletion must restore the connection metadata too");
    }
    @Test
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    void batchImportMetadataFailureRollsBackAllSelectedSecretsAndRows() {
        when(account.accountFingerprintOrNull()).thenReturn("batch-import-account");
        String scope = (String) service.snapshot(8L).get("scopeToken");
        Map<String, String> before = snapshot();
        String config = """
            {"mcpServers":{"A":{"url":"https://example.com/a","token":"first-secret"},
            "B":{"command":"python3","env":{"KEY":"second-secret"}}}}
            """;
        doThrow(new IllegalStateException("synthetic import metadata failure")).when(settings).set(startsWith("mcp.user."), anyString());
        assertThrows(IllegalStateException.class, () -> service.importConnections(8L, config, List.of(0, 1), scope));
        assertEquals(before, snapshot(), "all imported metadata and encrypted secrets must roll back atomically");
    }
    private Map<String, String> snapshot() {
        Map<String, String> result = new TreeMap<>();
        repository.findAll().forEach(row -> result.put(row.getKey(), row.getValue()));
        return result;
    }
}
