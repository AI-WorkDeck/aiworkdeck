// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;
import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.service.messagecenter.MessageCenterService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.*;
import org.springframework.transaction.support.TransactionTemplate;
import java.time.*;
import java.nio.file.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
@DataJpaTest(showSql=false)
@AutoConfigureTestDatabase(replace=AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties={"spring.datasource.url=jdbc:h2:mem:cloud-lifecycle;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000","spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa","spring.datasource.password=","spring.jpa.database-platform=org.hibernate.dialect.H2Dialect","spring.jpa.hibernate.ddl-auto=create-drop"})
@Transactional(propagation=Propagation.NOT_SUPPORTED)
class CloudBillingLifecyclePersistenceTest {
 @Autowired UserRepository users;@Autowired AccountBindingRepository bindings;@Autowired CloudCleanupJobRepository jobs;
 @Autowired MobileFileBackupRepository backups;@Autowired MobileVersionObjectRepository versions;@Autowired MobileAssistantConsentRepository consents;
 @Autowired MobileProjectSummaryRepository summaries;@Autowired MobileAssistantTurnRepository turns;@Autowired MobileCalendarSnapshotRepository calendar;
 @Autowired MobileMediaInboxRepository media;@Autowired MobileTransferRequestRepository transfers;@Autowired MobileProjectManifestRepository manifests;
 @Autowired MobileProjectDirRepository directories;@Autowired MobileCalendarPushDeviceRepository pushDevices;@Autowired MobileCalendarDeliveryRepository deliveries;
 @Autowired PlatformTransactionManager manager;
 @TempDir Path root;
 MobileBillingService billing;CloudStorageQuotaService quota;MobileRelayLocalBlobStore blobs;CloudBillingLifecycleService service;Long user;
 String locator;AtomicBoolean frozen;AtomicBoolean completedBackup;String caseId;
 @BeforeEach void setup() {
  User row=new User();row.setUsername("postpaid-"+UUID.randomUUID());row.setDisplayName("synthetic");row.setPassword("synthetic");row.setRole("USER");row.setSubscriptionType("FREE");row.setCreatedAt(LocalDateTime.now());row.setUpdatedAt(LocalDateTime.now());row.setFileCloudBackupEnabled(true);user=users.saveAndFlush(row).getId();
  caseId=UUID.randomUUID().toString();billing=mock(MobileBillingService.class);quota=mock(CloudStorageQuotaService.class);frozen=new AtomicBoolean();completedBackup=new AtomicBoolean();blobs=new MobileRelayLocalBlobStore(root.resolve("cloud").toString());
  doAnswer(c->{if(frozen.get()) throw new IllegalArgumentException("frozen");return null;}).when(quota).requireCloudWrite(user);
  when(quota.isEnabled()).thenReturn(true);when(quota.postpaidEnabled()).thenReturn(true);when(quota.canRead(user)).thenReturn(true);
  MessageCenterService messages=mock(MessageCenterService.class);when(messages.publishAuthorizedBusiness(anyString(),anyString(),eq(user),anyList(),isNull(),anyString(),anyString(),anyString(),anyString(),anyString(),anyMap())).thenReturn(List.of(Map.of("id","notice")));
  service=new CloudBillingLifecycleService(bindings,users,billing,quota,messages,jobs,backups,versions,blobs,consents,summaries,turns,calendar,new ObjectMapper(),manager,false,true);
  var projects=mock(CloudProjectCleanupService.class);doAnswer(c->{c.<Runnable>getArgument(1).run();return null;}).when(projects).withUserMemoryLock(anyLong(),any());
  ReflectionTestUtils.setField(service,"projects",projects);ReflectionTestUtils.setField(service,"media",media);ReflectionTestUtils.setField(service,"transfers",transfers);ReflectionTestUtils.setField(service,"manifests",manifests);ReflectionTestUtils.setField(service,"directories",directories);ReflectionTestUtils.setField(service,"pushDevices",pushDevices);ReflectionTestUtils.setField(service,"deliveries",deliveries);
  when(billing.cloudState(user)).thenAnswer(c->Map.of("billing",Map.of("remindAt",Instant.now().minusSeconds(1).toString(),"cleanupAt",Instant.now().minusSeconds(1).toString()),"cloudAccess",Map.of("caseId",caseId,"epoch",frozen.get()?2L:1L,"cleanupEligible",true,"cleanupState",frozen.get()?"deleting":"none")));
  when(billing.cloudOperation(eq(user),eq("cleanup-claim"),anyMap())).thenAnswer(c->{frozen.set(true);Map<?,?> request=c.getArgument(2);
   if(completedBackup.get() && String.valueOf(request.get("itemId")).startsWith("backup:")) return Map.of("allowed",false,"completed",true,"claimId","claim","epoch",2L,"expiresAt",Instant.now().plusSeconds(60).toString());
   return permit();});
  locator=blobs.putPersistent(user,UUID.randomUUID().toString(),new ByteArrayInputStream(new byte[]{1,2,3}),3).locator();
  MobileFileBackup b=new MobileFileBackup();b.setUserId(user);b.setDeviceId("desktop");b.setProjectKey("42");b.setFileId("1");b.setUid(UUID.randomUUID().toString());b.setName("sample.pdf");b.setPath("sample.pdf");b.setSha256("a".repeat(64));b.setSize(3L);b.setStoragePath(locator);b.setUpdatedAt(LocalDateTime.now());backups.saveAndFlush(b);
 }
 Map<String,Object> permit(){return Map.of("allowed",true,"claimId","claim","epoch",2L,"expiresAt",Instant.now().plusSeconds(60).toString());}
 @Test void remoteReceiptThenLocalRollbackReplaysExactMissingBlobWithoutTouchingLocalFiles() throws Exception {
  Path local=root.resolve("local.docx");Files.writeString(local,"local original");byte[] before=Files.readAllBytes(local);
  AtomicBoolean fail=new AtomicBoolean(true);
  when(billing.cloudOperation(eq(user),eq("cleanup-complete"),anyMap())).thenAnswer(c->{if(fail.getAndSet(false)){completedBackup.set(true);throw new IllegalStateException("response lost after remote receipt");}return Map.of();});
  assertThrows(IllegalStateException.class,()->service.process(user));
  assertFalse(Files.exists(Path.of(locator)));assertEquals(1,backups.findByUserId(user).size(),"DB rollback retains the exact object receipt");
  service.process(user);assertTrue(backups.findByUserId(user).isEmpty());assertEquals("complete",jobs.findByUserIdAndCaseId(user,caseId).orElseThrow().getState());assertArrayEquals(before,Files.readAllBytes(local));
 }
 @Test void paymentAfterLostCompletionRecoversMetadataWithoutNewDeletePermit() {
  when(billing.cloudOperation(eq(user),eq("cleanup-complete"),anyMap())).thenAnswer(c->{completedBackup.set(true);throw new IllegalStateException("lost response");});
  assertThrows(IllegalStateException.class,()->service.process(user));
  assertFalse(Files.exists(Path.of(locator)));assertEquals(1,backups.findByUserId(user).size());
  when(billing.cloudState(user)).thenReturn(Map.of("billing",Map.of(),"cloudAccess",Map.of("epoch",2,"frozen",true)));
  clearInvocations(billing);
  when(billing.cloudOperation(eq(user),eq("cleanup-claim"),anyMap())).thenAnswer(c->{
   Map<?,?> input=c.getArgument(2);assertEquals(true,input.get("receiptOnly"));
   return String.valueOf(input.get("itemId")).startsWith("backup:")?Map.of("allowed",false,"completed",true,"epoch",2):Map.of("allowed",false,"issued",false);
  });
  service.process(user);assertTrue(backups.findByUserId(user).isEmpty());
  verify(billing).cloudOperation(eq(user),eq("cleanup-reconciled"),anyMap());
  verify(billing,never()).cloudOperation(eq(user),eq("cleanup-complete"),anyMap());
  verify(billing,never()).cloudOperation(eq(user),eq("cleanup-finish"),anyMap());
 }
 @Test void unresolvedIssuedReceiptCannotAuthorizeResumeAfterPayment() {
  when(billing.cloudOperation(eq(user),eq("cleanup-complete"),anyMap())).thenThrow(new IllegalStateException("unknown completion"));
  assertThrows(IllegalStateException.class,()->service.process(user));
  when(billing.cloudState(user)).thenReturn(Map.of("billing",Map.of(),"cloudAccess",Map.of("epoch",2,"frozen",true)));
  when(billing.cloudOperation(eq(user),eq("cleanup-claim"),anyMap())).thenReturn(Map.of("allowed",false,"issued",true,"completed",false));
  clearInvocations(billing);service.process(user);
  verify(billing,never()).cloudOperation(eq(user),eq("cleanup-reconciled"),anyMap());assertEquals(1,backups.findByUserId(user).size());
 }
 @Test void uploadWaitsForFrozenManifestOwnerLockAndCannotPublishAfterIt() throws Exception {
  CountDownLatch claiming=new CountDownLatch(1),release=new CountDownLatch(1),uploadAttempt=new CountDownLatch(1);AtomicBoolean first=new AtomicBoolean(true);
  when(billing.cloudOperation(eq(user),eq("cleanup-claim"),anyMap())).thenAnswer(c->{if(first.getAndSet(false)){claiming.countDown();assertTrue(release.await(5,TimeUnit.SECONDS));}frozen.set(true);return permit();});
  var uploader=new MobileBackupService(users,backups,directories,manifests,quota,blobs,mock(MobileTransferService.class),new ObjectMapper());
  ExecutorService pool=Executors.newFixedThreadPool(2);
  try {
   Future<?> clean=pool.submit(()->service.process(user));assertTrue(claiming.await(5,TimeUnit.SECONDS));
   Future<?> upload=pool.submit(()->new TransactionTemplate(manager).executeWithoutResult(s->{uploadAttempt.countDown();assertEquals("frozen",assertThrows(IllegalArgumentException.class,()->uploader.put(user,"desktop","42","2",UUID.randomUUID().toString(),"new.pdf","new.pdf",null,"b".repeat(64),new ByteArrayInputStream(new byte[]{4}),1)).getMessage());}));
   assertTrue(uploadAttempt.await(5,TimeUnit.SECONDS));assertFalse(upload.isDone(),"upload must actually wait on the same owner lock");release.countDown();clean.get(10,TimeUnit.SECONDS);upload.get(10,TimeUnit.SECONDS);assertTrue(backups.findByUserId(user).isEmpty());
  } finally {release.countDown();pool.shutdownNow();}
 }
}
