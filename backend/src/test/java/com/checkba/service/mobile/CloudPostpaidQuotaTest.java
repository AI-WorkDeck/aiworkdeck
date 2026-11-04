// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;
import com.checkba.repository.*;
import com.checkba.storage.StorageServiceFactory;
import org.junit.jupiter.api.*;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class CloudPostpaidQuotaTest {
 MobileBillingService billing=mock(MobileBillingService.class);
 ProjectFileRepository files=mock(ProjectFileRepository.class);ProjectRepository projects=mock(ProjectRepository.class);UserRepository users=mock(UserRepository.class);
 CloudStorageQuotaService quota=new CloudStorageQuotaService(billing,files,projects,users,mock(StorageServiceFactory.class),true);
 @BeforeEach void init(){ReflectionTestUtils.setField(quota,"postpaidEnabled",true);ReflectionTestUtils.setField(quota,"safetyLimitBytes",100L);}
 @AfterEach void clear(){RequestContextHolder.resetRequestAttributes();}
 void state(long owner,boolean write,long epoch){when(billing.cloudState(owner)).thenReturn(Map.of("cloudAccess",Map.of("canWrite",write,"canUse",write,"canRead",true,"epoch",epoch)));}
 void request(String epoch){var request=new MockHttpServletRequest();if(epoch!=null)request.addHeader("X-Cloud-Epoch",epoch);RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));}
 @Test void prepaidOrCreditNonSubscriberCanWriteWithoutFakingSubscription(){state(1,true,1);when(billing.balance(1L)).thenReturn(new MobileBillingClient.BalanceResult(10,"CNY","free"));assertEquals(100,quota.persistentQuota(1L));assertEquals(0,quota.subscriptionQuota(1L));request("1");assertDoesNotThrow(()->quota.requireCloudWrite(1L));}
 @Test void overLimitStopsWritesButKeepsRead(){state(1,false,2);assertFalse(quota.canWrite(1L));assertTrue(quota.canRead(1L));request("2");assertThrows(IllegalArgumentException.class,()->quota.requireCloudWrite(1L));}
 @Test void staleOrAbsentEpochCannotPublishAfterCleanupEvenAfterPayment(){state(1,true,3);request("1");assertThrows(IllegalArgumentException.class,()->quota.requireCloudWrite(1L));request(null);assertThrows(IllegalArgumentException.class,()->quota.requireCloudWrite(1L));request("3");assertDoesNotThrow(()->quota.requireCloudWrite(1L));}
 @Test void oneAccountCannotBorrowAnotherAccountsCapability(){state(1,true,1);state(2,false,1);request("1");assertThrows(IllegalArgumentException.class,()->quota.requireCloudWrite(2L));verify(billing).cloudState(2L);verify(billing,never()).cloudState(1L);}
 @Test void unavailableAuthorityCannotBecomePaidOrWritable(){when(billing.cloudState(1L)).thenThrow(new MobileBillingFailureException(MobileBillingKind.UNAVAILABLE,"offline"));assertThrows(MobileBillingFailureException.class,()->quota.canWrite(1L));Map<String,Object> out=new HashMap<>();quota.appendCloudState(1L,out);assertEquals(false,((Map<?,?>)out.get("cloudAccess")).get("canWrite"));assertFalse(out.containsKey("billing"));}
 @Test void unknownProjectCannotChargeCreatorOrPublishWhileKnownPersonalCan(){
  var project=new com.checkba.model.entity.Project();project.setId(7L);project.setUserId(1L);
  when(projects.findById(7L)).thenReturn(Optional.of(project));when(projects.lockForImWrite(7L)).thenReturn(Optional.of(project));when(users.lockStorageOwner(1L)).thenReturn(Optional.of(new com.checkba.model.entity.User()));
  var file=new com.checkba.model.entity.ProjectFile();file.setProjectId(7L);file.setFileSize(9L);file.setIsDeleted(false);
  when(files.findCloudFilesByOwner(1L)).thenReturn(List.of(file));
  state(1,true,1);request("1");assertEquals(0,quota.usedBytes(1L));assertThrows(IllegalArgumentException.class,()->quota.requireProjectCapacity(7L,0));
  project.setCloudOwnership("PERSONAL");project.setCloudBillingOwnerId(1L);
  assertEquals(9,quota.usedBytes(1L));assertDoesNotThrow(()->quota.requireProjectCapacity(7L,0));
 }

 @Test void memoryUtf8CountsRetainedTrashButDeduplicatesLegacyMigration(){
  var documents=mock(MemoryDocumentRepository.class);var spaces=mock(MemoryDocumentSpaceRepository.class);var entries=mock(MemoryEntryRepository.class);
  ReflectionTestUtils.setField(quota,"cloudMemoryDocuments",documents);ReflectionTestUtils.setField(quota,"cloudMemorySpaces",spaces);ReflectionTestUtils.setField(quota,"cloudMemoryEntries",entries);
  var space=new com.checkba.model.entity.MemoryDocumentSpace();space.setId("private");when(spaces.findByScopeAndOwnerKey("user","1")).thenReturn(Optional.of(space));
  var document=new com.checkba.model.entity.MemoryDocument();document.setContent("中文");document.setDeleted(true);document.setSourceMemoryUid("migrated");
  when(documents.findBySpaceIdOrderByPathAsc("private")).thenReturn(List.of(document));
  var migrated=new com.checkba.model.entity.MemoryEntry();migrated.setUid("migrated");migrated.setMemoryValue("中文");
  var original=new com.checkba.model.entity.MemoryEntry();original.setUid("original");original.setMemoryValue("x");
  when(entries.findByUserIdAndScopeIn(eq(1L),any())).thenReturn(List.of(migrated,original));
  assertEquals(7,quota.usedBytes(1L),"six UTF8 bytes plus one legacy byte, with no migration double charge");
 }

 @Test void collaboratorEpochDoesNotReplaceOwnerBillingAndMustBeAuthorized(){
  var project=new com.checkba.model.entity.Project();project.setId(7L);project.setUserId(1L);project.setCloudBillingOwnerId(1L);project.setCloudOwnership("PERSONAL");
  when(projects.findById(7L)).thenReturn(Optional.of(project));when(projects.lockForImWrite(7L)).thenReturn(Optional.of(project));when(users.lockStorageOwner(1L)).thenReturn(Optional.of(new com.checkba.model.entity.User()));
  var members=mock(com.checkba.service.ProjectMemberService.class);org.springframework.beans.factory.ObjectProvider<com.checkba.service.ProjectMemberService> provider=mock(org.springframework.beans.factory.ObjectProvider.class);when(provider.getObject()).thenReturn(members);ReflectionTestUtils.setField(quota,"cloudMembers",provider);
  state(1,true,9);state(2,false,3);request("3");((MockHttpServletRequest)((ServletRequestAttributes)RequestContextHolder.getRequestAttributes()).getRequest()).addHeader("X-Session-Id","member");
  try(var auth=mockStatic(com.checkba.controller.AuthController.class)) {
   auth.when(()->com.checkba.controller.AuthController.getUserIdFromSession("member")).thenReturn(2L);
   assertThrows(IllegalArgumentException.class,()->quota.requireProjectCapacity(7L,0));
   when(members.hasWritePermission(7L,2L)).thenReturn(true);assertDoesNotThrow(()->quota.requireProjectCapacity(7L,0));
   state(1,false,9);assertThrows(IllegalArgumentException.class,()->quota.requireProjectCapacity(7L,0));
  }
 }

}
