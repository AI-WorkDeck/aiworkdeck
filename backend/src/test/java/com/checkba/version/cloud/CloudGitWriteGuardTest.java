// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version.cloud;
import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.service.mobile.*;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.*;
import java.util.*;
import static org.mockito.Mockito.*;
import static org.junit.jupiter.api.Assertions.*;
class CloudGitWriteGuardTest {
 final ProjectRepository projects=mock(ProjectRepository.class);final UserRepository users=mock(UserRepository.class);
 final CloudStorageQuotaService quota=mock(CloudStorageQuotaService.class);final MobileBillingService billing=mock(MobileBillingService.class);
 CloudGitWriteGuard guard() {
  when(quota.isEnabled()).thenReturn(true);when(quota.postpaidEnabled()).thenReturn(true);
  when(users.lockStorageOwner(7L)).thenReturn(Optional.of(new User()));
  var project=new Project();project.setUserId(7L);project.setCloudBillingOwnerId(7L);project.setCloudOwnership("PERSONAL");
  when(projects.findById(42L)).thenReturn(Optional.of(project));when(projects.lockForImWrite(42L)).thenReturn(Optional.of(project));
  var manager=new AbstractPlatformTransactionManager(){protected Object doGetTransaction(){return new Object();}protected void doBegin(Object t,org.springframework.transaction.TransactionDefinition d){}protected void doCommit(DefaultTransactionStatus s){}protected void doRollback(DefaultTransactionStatus s){}};
  return new CloudGitWriteGuard(projects,users,quota,billing,manager);
 }
 @Test void repositoryStateExposesOnlyPayerCapability() {
  var g=guard();when(billing.cloudState(7L)).thenReturn(Map.of("cloudAccess",Map.of("epoch",4,"canWrite",true),"billing",Map.of("debtCents",123)));
  assertEquals(Map.of("cloudAccess",Map.of("epoch",4,"canWrite",true)),g.state(42L,null));
 }
 @Test void publicationUsesOwnerLockAndEpochBeforeAnyBytes() {
  var g=guard();var write=mock(Runnable.class);g.write(42L,null,write);
  var order=inOrder(users,quota,write);order.verify(users).lockStorageOwner(7L);order.verify(quota).requireCloudWrite(7L);order.verify(quota).storageChanging(7L);order.verify(write).run();
  doThrow(new IllegalArgumentException("stale")).when(quota).requireCloudWrite(7L);
  assertThrows(IllegalArgumentException.class,()->g.write(42L,null,write));verify(write,times(1)).run();
 }
 @Test void unknownOrRemovedOwnerCannotPublish() {
  var g=guard();var write=mock(Runnable.class);
  var legacy=new Project();legacy.setUserId(7L);when(projects.findById(42L)).thenReturn(Optional.of(legacy));
  assertThrows(GitAccessDeniedException.class,()->g.write(42L,null,write));
  when(projects.findById(42L)).thenReturn(Optional.empty());assertThrows(GitAccessDeniedException.class,()->g.write(42L,null,write));verifyNoInteractions(write);
 }
 @Test void localAndSelfHostedWritesKeepTheirExistingBehavior() {
  var g=guard();when(quota.isEnabled()).thenReturn(false);var write=mock(Runnable.class);g.write(42L,null,write);verify(write).run();verify(users,never()).lockStorageOwner(anyLong());
 }
 @Test void projectDeletedWhileWaitingCannotReuseCachedOwnership() {
  var g=guard();when(projects.lockForImWrite(42L)).thenReturn(Optional.empty());var write=mock(Runnable.class);
  assertThrows(GitAccessDeniedException.class,()->g.write(42L,null,write));verifyNoInteractions(write);
 }
}
