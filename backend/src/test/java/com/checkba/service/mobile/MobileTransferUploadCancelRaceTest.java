// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.mobile;

import com.checkba.model.entity.AccountBinding;
import com.checkba.model.entity.MobileTransferRequest;
import com.checkba.repository.AccountBindingRepository;
import com.checkba.repository.MobileTransferRequestRepository;
import com.checkba.service.ai.tools.WebTools;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.test.context.ActiveProfiles;

import java.io.ByteArrayInputStream;
import java.time.LocalDateTime;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * upload() 与 cancel() 的竞态：upload 流式写 blob 期间用户取消（已退款置 FAILED），
 * upload 不能再用陈旧实体把行"复活"成 STAGED。
 */
@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:mobile-transfer-race-test;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
        "security.local-mode=false",
        "storage.local.root-path=${java.io.tmpdir}/mobile-transfer-race-test-store",
        "mobile.transfer.billing.base-url=http://127.0.0.1:1",
        "mobile.transfer.billing.secret=test-secret"
})
@ActiveProfiles("desktop")
class MobileTransferUploadCancelRaceTest {

    private static final Long USER = 9101L;

    @Autowired
    private MobileTransferService service;
    @Autowired
    private MobileTransferRequestRepository repository;
    @Autowired
    private AccountBindingRepository accountBindingRepository;

    @MockBean
    private TransferBillingClient billing;
    @MockBean
    private WebTools webTools;
    @SpyBean
    private MobileRelayBlobStore blobStore;

    @AfterEach
    void tearDown() {
        repository.deleteAll();
    }

    @Test
    @DisplayName("upload 写 blob 期间 cancel 已提交：行保持 FAILED 且已退款，blob 被清理")
    void cancelDuringUploadIsNotResurrected() throws Exception {
        if (accountBindingRepository.findByUserId(USER).isEmpty()) {
            AccountBinding b = new AccountBinding();
            b.setUserId(USER);
            b.setExternalAccountId("acct-race");
            b.setCreatedAt(LocalDateTime.now());
            accountBindingRepository.save(b);
        }
        MobileTransferRequest row = new MobileTransferRequest();
        row.setUserId(USER);
        row.setRequestId(UUID.randomUUID().toString());
        row.setKind("PULL");
        row.setStatus("PENDING");
        row.setDeviceId("dev-a");
        row.setProjectKey("1");
        row.setFileName("a.txt");
        row.setChargedCredits(2);
        row.setChargeLedgerId("ledger-race");
        row.setCreatedAt(LocalDateTime.now());
        row.setUpdatedAt(LocalDateTime.now());
        Long id = repository.saveAndFlush(row).getId();

        doAnswer(inv -> {
            // 另一线程里 cancel（自己的事务，join 返回前已提交）
            CompletableFuture.runAsync(() -> service.cancel(USER, id)).join();
            return inv.callRealMethod();
        }).when(blobStore).put(any(), anyString(), any(), anyLong());

        byte[] bytes = "hello".getBytes();
        assertThrows(IllegalArgumentException.class,
                () -> service.upload(USER, id, new ByteArrayInputStream(bytes), bytes.length));

        MobileTransferRequest after = repository.findById(id).orElseThrow();
        assertEquals("FAILED", after.getStatus());
        assertNotNull(after.getRefundedAt());
        assertNull(after.getStoragePath());
        verify(blobStore).deleteQuietly(anyString());
    }
}
