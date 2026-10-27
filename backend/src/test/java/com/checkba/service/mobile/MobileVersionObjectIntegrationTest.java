// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.storage.StorageServiceFactory;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** Real H2 transactions, row locks and physical blobs; no HTTP server, schedules, OSS or personal paths. */
@DataJpaTest(showSql=false, properties={"spring.jpa.hibernate.ddl-auto=create-drop","spring.jpa.show-sql=false",
        "spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa","spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect","storage.subscription-quota.enabled=true"})
@AutoConfigureTestDatabase(replace=AutoConfigureTestDatabase.Replace.NONE)
@Transactional(propagation=Propagation.NOT_SUPPORTED)
@Import({MobileVersionObjectService.class,MobileBackupService.class,CloudStorageQuotaService.class,
        MobileVersionObjectIntegrationTest.BlobConfiguration.class})
class MobileVersionObjectIntegrationTest {
    static final Path ROOT=temporaryRoot();
    static Path temporaryRoot() {try{return Files.createTempDirectory("awd-version-h2-");}catch(IOException e){throw new UncheckedIOException(e);}}
    @DynamicPropertySource static void isolated(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url",()->"jdbc:h2:mem:"+ROOT.getFileName()+";MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=5000");
        registry.add("storage.local.root-path",()->ROOT.toString());
    }
    @TestConfiguration(proxyBeanMethods=false) static class BlobConfiguration {
        @Bean static org.springframework.beans.factory.config.BeanFactoryPostProcessor disableScheduledJobs() {
            return factory->{
                if(factory instanceof org.springframework.beans.factory.support.BeanDefinitionRegistry registry
                        && registry.containsBeanDefinition(org.springframework.scheduling.config.TaskManagementConfigUtils.SCHEDULED_ANNOTATION_PROCESSOR_BEAN_NAME))
                    registry.removeBeanDefinition(org.springframework.scheduling.config.TaskManagementConfigUtils.SCHEDULED_ANNOTATION_PROCESSOR_BEAN_NAME);
            };
        }
        @Bean MobileRelayBlobStore mobileRelayBlobStore(){return new MobileRelayLocalBlobStore(ROOT.toString());}
        @Bean ObjectMapper objectMapper(){return new ObjectMapper();}
    }
    @Autowired MobileVersionObjectService service;
    @Autowired MobileBackupService backup;
    @Autowired MobileVersionObjectRepository objects;
    @Autowired MobileProjectDirRepository directories;
    @Autowired UserRepository users;
    @Autowired CloudStorageQuotaService quota;
    @Autowired PlatformTransactionManager transactions;
    @SpyBean MobileRelayBlobStore blobs;
    @MockBean MobileBillingService billing;
    @MockBean MobileTransferService transfers;
    @MockBean StorageServiceFactory storage;
    long user;
    @BeforeEach void fixture() {
        User owner=new User();owner.setUsername("object-"+UUID.randomUUID());owner.setDisplayName("Synthetic fixture");
        owner.setPassword("not-a-login-secret");owner.setCreatedAt(LocalDateTime.now());user=users.saveAndFlush(owner).getId();
        MobileProjectDir directory=new MobileProjectDir();directory.setUserId(user);directory.setDeviceId("device");
        directory.setProjectKey("42");directory.setName("Synthetic history");directory.setUpdatedAt(LocalDateTime.now());directories.saveAndFlush(directory);
        plan(CloudStorageQuotaService.PRO_BYTES);
    }
    void plan(long capacity) {when(billing.balance(user)).thenReturn(new MobileBillingClient.BalanceResult(0,"CNY","paid",
            Map.of("active",true,"expiresAt",Instant.now().plusSeconds(600).toString(),"cloudStorageBytes",capacity)));}
    void consent(boolean enabled){backup.consent(user,enabled,MobileBackupService.CONSENT_VERSION);}
    static String hash(byte[] bytes) throws Exception{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));}
    void put(byte[] bytes) throws Exception {service.put(user,"device","42",hash(bytes),bytes.length,0,hash(bytes),new ByteArrayInputStream(bytes),bytes.length);}
    void putParts(byte[] bytes) throws Exception {
        String sha=hash(bytes);
        for(int index=0;index<MobileVersionObjectService.partCount(bytes.length);index++) {
            int start=(int)(index*MobileVersionObjectService.PART_BYTES);
            byte[] part=Arrays.copyOfRange(bytes,start,(int)Math.min(bytes.length,start+MobileVersionObjectService.PART_BYTES));
            service.put(user,"device","42",sha,bytes.length,index,hash(part),new ByteArrayInputStream(part),part.length);
        }
    }

    @Test void actualConsentChunkCompletionDownloadRevokeAndCleanupRoundTrip() throws Exception {
        byte[] bytes=new byte[(int)MobileVersionObjectService.PART_BYTES+17];new Random(1223).nextBytes(bytes);String sha=hash(bytes);
        assertThrows(IllegalArgumentException.class,()->putParts(bytes));consent(true);putParts(bytes);
        assertThrows(IllegalArgumentException.class,()->service.content(user,"device","42",sha,0));
        service.complete(user,"device","42",sha,bytes.length);
        assertEquals(1,service.list(user,"device","42").size());
        ByteArrayOutputStream restored=new ByteArrayOutputStream();
        for(int index=0;index<2;index++) try(InputStream input=service.content(user,"device","42",sha,index).stream()){input.transferTo(restored);}
        assertArrayEquals(bytes,restored.toByteArray());
        assertEquals((long)bytes.length,quota.usage(user).get("persistentUsedBytes"));
        consent(false);assertThrows(IllegalArgumentException.class,()->service.content(user,"device","42",sha,0));
        assertTrue(service.cleanupPending(user));assertEquals((long)bytes.length,quota.usage(user).get("persistentUsedBytes"));
        service.cleanDeleted();assertTrue(objects.findByUserId(user).isEmpty());
        assertEquals(0L,quota.usage(user).get("persistentUsedBytes"));
    }

    @Test void concurrentTransactionsCannotSpendSameRemainingQuotaTwice() throws Exception {
        plan(3);consent(true);ExecutorService pool=Executors.newFixedThreadPool(2);CountDownLatch ready=new CountDownLatch(2),start=new CountDownLatch(1);
        try {
            List<Future<Boolean>> results=new ArrayList<>();
            for(byte n:new byte[]{1,2}) results.add(pool.submit(()->{
                ready.countDown();assertTrue(start.await(5,TimeUnit.SECONDS));
                try{put(new byte[]{n,n});return true;}catch(IllegalArgumentException e){return false;}
            }));
            assertTrue(ready.await(5,TimeUnit.SECONDS));start.countDown();
            int accepted=0;for(var result:results)if(result.get(10,TimeUnit.SECONDS))accepted++;
            assertEquals(1,accepted);assertEquals(2L,quota.usage(user).get("persistentUsedBytes"));
            assertEquals(1,objects.findByUserId(user).size());
        } finally {start.countDown();pool.shutdownNow();}
    }

    @Test void transactionRollbackCommitsIndependentDeletionReceiptUntilPhysicalCleanupSucceeds() throws Exception {
        consent(true);byte[] bytes={4,5};doNothing().when(blobs).deleteQuietly(anyString());
        TransactionTemplate transaction=new TransactionTemplate(transactions);
        assertThrows(IllegalStateException.class,()->transaction.executeWithoutResult(status->{
            try{put(bytes);}catch(Exception e){throw new IllegalStateException(e);}throw new IllegalStateException("synthetic rollback");
        }));
        var retained=objects.findByUserId(user);assertEquals(1,retained.size());assertTrue(retained.get(0).isPendingDeletion());
        assertTrue(Files.exists(Path.of(retained.get(0).getStoragePath())));assertEquals(2L,quota.usage(user).get("persistentUsedBytes"));
        service.cleanDeleted();assertEquals(1,objects.findByUserId(user).size());
        doCallRealMethod().when(blobs).deleteQuietly(anyString());service.cleanDeleted();assertTrue(objects.findByUserId(user).isEmpty());
    }

    @Test void reenableCannotRevivePendingDeletionAndCanRetryAfterCleanup() throws Exception {
        consent(true);byte[] bytes={6,7};put(bytes);service.complete(user,"device","42",hash(bytes),2);
        consent(false);consent(true);
        assertThrows(IllegalArgumentException.class,()->service.content(user,"device","42",hash(bytes),0));
        assertThrows(IllegalArgumentException.class,()->put(bytes));
        service.cleanDeleted();put(bytes);service.complete(user,"device","42",hash(bytes),2);
        assertEquals(true,service.status(user,"device","42",hash(bytes),2).get("complete"));
    }

    @Test void revokeCanCommitWhileLargeObjectVerificationIsBlockedAndCompletionStaysDenied() throws Exception {
        consent(true);byte[] bytes={8,9};put(bytes);String locator=objects.findByUserId(user).get(0).getStoragePath();
        CountDownLatch verifying=new CountDownLatch(1),release=new CountDownLatch(1);ExecutorService pool=Executors.newFixedThreadPool(2);
        doAnswer(inv->{InputStream input=(InputStream)inv.callRealMethod();verifying.countDown();
            if(!release.await(10,TimeUnit.SECONDS)){input.close();throw new IOException("verification test timed out");}return input;}).when(blobs).open(locator);
        try {
            var completing=pool.submit(()->assertThrows(IllegalArgumentException.class,()->service.complete(user,"device","42",hash(bytes),2)));
            assertTrue(verifying.await(5,TimeUnit.SECONDS));
            pool.submit(()->consent(false)).get(5,TimeUnit.SECONDS); // proves verification is outside the database/user lock
            release.countDown();completing.get(5,TimeUnit.SECONDS);
            assertFalse(objects.findByUserId(user).stream().anyMatch(row->row.getPartIndex()==-1));
            assertTrue(objects.findByUserId(user).stream().allMatch(MobileVersionObject::isPendingDeletion));
        } finally {release.countDown();pool.shutdownNow();}
    }

    @Test void corruptCloudPartIsQuarantinedThenReuploadedInsteadOfRetryingItForever() throws Exception {
        consent(true);byte[] bytes={10,11};put(bytes);
        Files.write(Path.of(objects.findByUserId(user).get(0).getStoragePath()),new byte[]{12,13});
        assertThrows(IOException.class,()->service.complete(user,"device","42",hash(bytes),2));
        assertTrue(service.cleanupPending(user));
        service.cleanDeleted();put(bytes);service.complete(user,"device","42",hash(bytes),2);
        try(InputStream input=service.content(user,"device","42",hash(bytes),0).stream()){assertArrayEquals(bytes,input.readAllBytes());}
    }
}
