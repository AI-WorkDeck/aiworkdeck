// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;
import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.service.messagecenter.MessageCenterService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import java.time.Instant;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class CloudBillingLifecycleServiceTest {
 UserRepository users=mock(UserRepository.class); MobileBillingService billing=mock(MobileBillingService.class);
 CloudStorageQuotaService quota=mock(CloudStorageQuotaService.class);MessageCenterService messages=mock(MessageCenterService.class);
 CloudCleanupJobRepository jobs=mock(CloudCleanupJobRepository.class);MobileFileBackupRepository backups=mock(MobileFileBackupRepository.class);
 MobileVersionObjectRepository versions=mock(MobileVersionObjectRepository.class);MobileRelayBlobStore blobs=mock(MobileRelayBlobStore.class);
 MobileAssistantConsentRepository consents=mock(MobileAssistantConsentRepository.class);MobileProjectSummaryRepository summaries=mock(MobileProjectSummaryRepository.class);
 MobileAssistantTurnRepository turns=mock(MobileAssistantTurnRepository.class);MobileCalendarSnapshotRepository calendar=mock(MobileCalendarSnapshotRepository.class);
 CloudProjectCleanupService projects=mock(CloudProjectCleanupService.class);PlatformTransactionManager manager=mock(PlatformTransactionManager.class);
 CloudBillingLifecycleService service;Map<String,CloudCleanupJob> stored=new HashMap<>();MobileFileBackup backup;User user=new User();
 @TempDir Path temp;
 @BeforeEach void init(){
  doAnswer(c->{c.<Runnable>getArgument(1).run();return null;}).when(projects).withUserMemoryLock(anyLong(),any());
  when(quota.isEnabled()).thenReturn(true);when(quota.postpaidEnabled()).thenReturn(true);when(users.lockStorageOwner(1L)).thenReturn(Optional.of(user));when(users.findById(1L)).thenReturn(Optional.of(user));
  when(manager.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
  service=new CloudBillingLifecycleService(mock(AccountBindingRepository.class),users,billing,quota,messages,jobs,backups,versions,blobs,consents,summaries,turns,calendar,new ObjectMapper(),manager,false,true);
  ReflectionTestUtils.setField(service,"projects",projects);
  for(var pair:Map.of("media",mock(MobileMediaInboxRepository.class),"transfers",mock(MobileTransferRequestRepository.class),"manifests",mock(MobileProjectManifestRepository.class),"directories",mock(MobileProjectDirRepository.class),"pushDevices",mock(MobileCalendarPushDeviceRepository.class),"deliveries",mock(MobileCalendarDeliveryRepository.class)).entrySet()) ReflectionTestUtils.setField(service,pair.getKey(),pair.getValue());
  when(billing.cloudState(1L)).thenReturn(Map.of("billing",Map.of("remindAt",Instant.now().minusSeconds(1).toString(),"cleanupAt","2026-11-04T00:00:00Z"),"cloudAccess",Map.of("caseId","case-1","epoch",1L,"cleanupEligible",true,"cleanupState","none")));
  when(messages.publishAuthorizedBusiness(anyString(),anyString(),eq(1L),eq(List.of(1L)),isNull(),anyString(),anyString(),anyString(),anyString(),anyString(),anyMap())).thenReturn(List.of(Map.of("id","notice-1")));
  when(jobs.saveAndFlush(any())).thenAnswer(c->{var j=(CloudCleanupJob)c.getArgument(0);stored.put(j.getId(),j);return j;});when(jobs.save(any())).thenAnswer(c->c.getArgument(0));
  when(jobs.findById(anyString())).thenAnswer(c->Optional.ofNullable(stored.get(c.getArgument(0))));when(jobs.findByUserIdAndCaseId(1L,"case-1")).thenAnswer(c->stored.values().stream().findFirst());
  when(billing.cloudOperation(eq(1L),eq("cleanup-claim"),anyMap())).thenReturn(Map.of("allowed",true,"claimId","claim-1","epoch",2L,"expiresAt",Instant.now().plusSeconds(60).toString()));
  when(blobs.ownedLocator(1L,"cloud/object")).thenReturn(true);
  backup=new MobileFileBackup();backup.setId(9L);backup.setUserId(1L);backup.setStoragePath("cloud/object");backup.setSha256("a".repeat(64));
  when(backups.findByUserId(1L)).thenReturn(List.of(backup));when(backups.findById(9L)).thenReturn(Optional.of(backup));
 }
 @Test void writesNoticeBeforeAckAndClaimBeforeDeletingOnlyCloudBytes() throws Exception {
  Path local=temp.resolve("local-contract.txt");Files.writeString(local,"original local version");byte[] before=Files.readAllBytes(local);
  service.process(1L);
  var order=inOrder(messages,billing,blobs);order.verify(messages).publishAuthorizedBusiness(anyString(),anyString(),eq(1L),anyList(),isNull(),anyString(),anyString(),anyString(),anyString(),anyString(),anyMap());
  order.verify(billing).cloudOperation(eq(1L),eq("notification-ack"),anyMap());order.verify(billing,times(2)).cloudState(1L);
  order.verify(billing,times(2)).cloudOperation(eq(1L),eq("cleanup-claim"),argThat(p->"backup:9".equals(p.get("itemId"))));order.verify(blobs).deleteQuietly("cloud/object");
  assertArrayEquals(before,Files.readAllBytes(local));assertEquals("complete",stored.values().iterator().next().getState());
  service.process(1L);verify(blobs,times(1)).deleteQuietly("cloud/object");
 }
 @Test void paymentWinsBeforeFirstClaimAndNothingIsDeleted(){when(billing.cloudOperation(eq(1L),eq("cleanup-claim"),anyMap())).thenReturn(Map.of("allowed",false));service.process(1L);verify(blobs,never()).deleteQuietly(anyString());verify(summaries,never()).deleteByUserId(anyLong());}
 @Test void failedNotificationNeverAcknowledgesOrDeletes(){when(messages.publishAuthorizedBusiness(anyString(),anyString(),anyLong(),anyList(),isNull(),anyString(),anyString(),anyString(),anyString(),anyString(),anyMap())).thenThrow(new IllegalStateException("db unavailable"));assertThrows(IllegalStateException.class,()->service.process(1L));verify(billing,never()).cloudOperation(eq(1L),eq("notification-ack"),anyMap());verify(blobs,never()).deleteQuietly(anyString());}
 @Test void ambiguousOwnershipStopsBeforeAnyIrreversibleClaim(){when(projects.needsReview(1L)).thenReturn(true);service.process(1L);verify(billing,never()).cloudOperation(eq(1L),eq("cleanup-claim"),anyMap());assertEquals("review",stored.values().iterator().next().getState());}
 @Test void changedOwnerCannotBeDeletedUnderAnotherAccountsClaim(){backup.setUserId(2L);assertThrows(IllegalStateException.class,()->service.process(1L));verify(blobs,never()).deleteQuietly(anyString());}
 @Test void expiryBetweenClaimAndExecutionNeverDeletes(){when(billing.cloudOperation(eq(1L),eq("cleanup-claim"),anyMap())).thenReturn(Map.of("allowed",true,"claimId","claim-1","epoch",2L,"expiresAt",Instant.now().minusSeconds(1).toString()));assertThrows(IllegalStateException.class,()->service.process(1L));verify(blobs,never()).deleteQuietly(anyString());}
}
