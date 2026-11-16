// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;
import com.checkba.model.entity.*;
import com.checkba.repository.*;
import org.junit.jupiter.api.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class CloudPostpaidShadowServiceTest {
 final CloudStorageQuotaService quota=mock(CloudStorageQuotaService.class);
 final MobileBillingService billing=mock(MobileBillingService.class);
 final AccountBindingRepository bindings=mock(AccountBindingRepository.class);
 final UserRepository users=mock(UserRepository.class);
 final CloudEgressReceiptRepository receipts=mock(CloudEgressReceiptRepository.class);
 final Map<String,CloudEgressReceipt> rows=new LinkedHashMap<>();
 CloudPostpaidShadowService service(boolean shadow){return new CloudPostpaidShadowService(shadow,quota,billing,bindings,users,receipts);}
 @BeforeEach void init(){
  when(quota.isEnabled()).thenReturn(true);
  var binding=new AccountBinding();binding.setUserId(1L);when(bindings.findAll()).thenReturn(List.of(binding));
  when(quota.usedBytes(1L,true)).thenReturn(4096L);
  when(receipts.save(any())).thenAnswer(i->{var r=i.<CloudEgressReceipt>getArgument(0);rows.put(r.getId(),r);return r;});
  when(receipts.findByState(anyString())).thenAnswer(i->rows.values().stream().filter(r->r.getState().equals(i.getArgument(0))).toList());
 }
 @Test void defaultOffAndLiveModeTakesPrecedence(){
  service(false).report();service(false).egress(1L,"r",10,true);
  when(quota.postpaidEnabled()).thenReturn(true);
  var both=service(true);assertFalse(both.active(),"live and shadow never both meter");
  both.report();both.reportUnmapped();both.egress(1L,"r",10,true);
  verifyNoInteractions(billing);assertTrue(rows.isEmpty());
 }
 @Test void reportsOnlyShadowActionsNeverBillingOrLifecycle(){
  var svc=service(true);assertTrue(svc.active());
  svc.egress(1L,"file:a",2048,true);
  svc.report();
  verify(billing).cloudOperation(eq(1L),eq("shadow-storage"),argThat(p->p.get("storedBytes").equals("4096")&&String.valueOf(p.get("eventId")).startsWith("shadow-storage:1:")));
  verify(billing).cloudOperation(eq(1L),eq("shadow-egress"),argThat(p->p.get("bytes").equals("2048")&&p.get("completed").equals(true)));
  verify(billing,never()).cloudOperation(anyLong(),argThat(a->!a.startsWith("shadow-")),anyMap());
  verify(billing,never()).cloudState(anyLong());
  assertEquals(CloudPostpaidShadowService.SENT,rows.values().iterator().next().getState());
  svc.report();verify(billing,times(1)).cloudOperation(eq(1L),eq("shadow-egress"),anyMap());
 }
 @Test void unreachableCentreRetriesRejectedReportStopsAndFailuresNeverEscape(){
  var svc=service(true);svc.egress(1L,"a",1,false);
  when(billing.cloudOperation(eq(1L),anyString(),anyMap())).thenThrow(new MobileBillingFailureException(MobileBillingKind.UNAVAILABLE,"down"));
  assertDoesNotThrow(svc::report);assertEquals(CloudPostpaidShadowService.PENDING,rows.values().iterator().next().getState());
  reset(billing);when(billing.cloudOperation(eq(1L),anyString(),anyMap())).thenThrow(new MobileBillingFailureException(MobileBillingKind.REJECTED,"postpaid_shadow_disabled"));
  assertDoesNotThrow(svc::report);assertEquals(CloudPostpaidShadowService.FAILED,rows.values().iterator().next().getState());
  doThrow(new IllegalStateException("db")).when(receipts).save(any());
  assertDoesNotThrow(()->svc.egress(1L,"b",1,true),"download path is never affected");
  doThrow(new IllegalStateException("walk")).when(quota).usedBytes(1L,true);assertDoesNotThrow(svc::report);
 }
 @Test void reportsUnmappedCloudUsersWithData(){
  var mapped=new User();mapped.setId(1L);var unmapped=new User();unmapped.setId(2L);var empty=new User();empty.setId(3L);
  when(users.findAll()).thenReturn(List.of(mapped,unmapped,empty));when(quota.usedBytes(2L,true)).thenReturn(10L);
  service(true).reportUnmapped();
  verify(billing).shadowUnmapped(argThat(p->p.get("users").equals(1L)&&p.get("bytes").equals("10")&&p.get("sample").equals(List.of(2L))));
 }
}
