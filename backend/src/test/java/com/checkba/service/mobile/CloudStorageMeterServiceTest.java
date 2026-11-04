// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;
import com.checkba.model.entity.*;
import com.checkba.repository.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import java.time.Instant;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class CloudStorageMeterServiceTest {
 CloudStorageSampleRepository samples=mock(CloudStorageSampleRepository.class);
 UserRepository users=mock(UserRepository.class); MobileBillingService billing=mock(MobileBillingService.class);
 CloudStorageQuotaService quota=mock(CloudStorageQuotaService.class); PlatformTransactionManager manager=mock(PlatformTransactionManager.class);
 AccountBindingRepository bindings=mock(AccountBindingRepository.class);
 CloudStorageMeterService service;
 Instant start=Instant.parse("2026-11-04T00:00:00Z");
 @BeforeEach @SuppressWarnings("unchecked") void init(){ObjectProvider<CloudStorageQuotaService> provider=mock(ObjectProvider.class);when(provider.getObject()).thenReturn(quota);when(quota.postpaidEnabled()).thenReturn(true);when(manager.getTransaction(any())).thenReturn(new SimpleTransactionStatus());when(users.lockStorageOwner(1L)).thenReturn(Optional.of(new User()));service=new CloudStorageMeterService(samples,users,bindings,provider,billing,manager);when(billing.cloudState(1L)).thenReturn(Map.of("billing",Map.of("accepted",true,"storageMeteredThrough",start.toString()),"cloudAccess",Map.of("epoch",1L)));}
 CloudStorageSample sample(Instant time,long bytes){var row=new CloudStorageSample();row.setObservedAt(time);row.setUserId(1L);row.setStoredBytes(bytes);return row;}
 @Test void settlesOnlyConstantIntervalAndLeavesFreeEntitlementToAuthority(){when(samples.findByUserIdOrderByObservedAtAscIdAsc(1L)).thenReturn(List.of(sample(start.minusSeconds(2),100),sample(start.plusSeconds(10),200)));service.settle(1L);verify(billing).cloudOperation(eq(1L),eq("storage-usage"),argThat(p->p.get("storedBytes").equals("100")&&p.get("from").equals("2026-11-04T00:00:00.000Z")&&p.get("to").equals("2026-11-04T00:00:10.000Z")&&!p.containsKey("includedByteSeconds")));}
 @Test void neverInventsHistoricalCapacityWhenFirstObservationIsLate(){when(samples.findByUserIdOrderByObservedAtAscIdAsc(1L)).thenReturn(List.of(sample(start.plusSeconds(10),200)));service.settle(1L);verify(billing).cloudOperation(eq(1L),eq("storage-baseline"),anyMap());verify(billing,never()).cloudOperation(eq(1L),eq("storage-usage"),anyMap());}
 @Test void unknownAuthorityNeverEmitsUsage(){when(billing.cloudState(1L)).thenThrow(new IllegalStateException("offline"));assertThrows(IllegalStateException.class,()->service.settle(1L));verify(billing,never()).cloudOperation(anyLong(),anyString(),anyMap());}
 @Test void timestampTiesUseLastCommittedSampleAndBatchDrainsBacklog(){
  var binding=new AccountBinding();binding.setUserId(1L);when(bindings.findAll()).thenReturn(List.of(binding));
  var through=new java.util.concurrent.atomic.AtomicReference<>(start);
  when(billing.cloudState(1L)).thenAnswer(c->Map.of("billing",Map.of("accepted",true,"storageMeteredThrough",through.get().toString()),"cloudAccess",Map.of("epoch",1)));
  when(samples.findByUserIdOrderByObservedAtAscIdAsc(1L)).thenReturn(List.of(sample(start,10),sample(start,20),sample(start.plusSeconds(1),30),sample(start.plusSeconds(2),40)));
  when(billing.cloudOperation(eq(1L),eq("storage-usage"),anyMap())).thenAnswer(c->{Map<String,Object> input=c.getArgument(2);through.set(Instant.parse((String)input.get("to")));return Map.of("billing",Map.of("storageMeteredThrough",through.get().toString()));});
  service.settle();
  verify(billing).cloudOperation(eq(1L),eq("storage-usage"),argThat(p->p.get("storedBytes").equals("20")&&p.get("to").equals("2026-11-04T00:00:01.000Z")));
  verify(billing).cloudOperation(eq(1L),eq("storage-usage"),argThat(p->p.get("storedBytes").equals("30")&&p.get("to").equals("2026-11-04T00:00:02.000Z")));
  verify(billing,times(3)).cloudOperation(eq(1L),eq("storage-usage"),anyMap());
 }

}
