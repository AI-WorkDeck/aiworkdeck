// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;
import com.checkba.model.entity.*;
import com.checkba.repository.*;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class CloudEgressServiceTest {
 final ProjectCatalogService catalog=mock(ProjectCatalogService.class);
 final MobileBackupService backup=mock(MobileBackupService.class);
 final MobileBillingService billing=mock(MobileBillingService.class);
 final CloudStorageQuotaService quota=mock(CloudStorageQuotaService.class);
 final CloudEgressReceiptRepository receipts=mock(CloudEgressReceiptRepository.class);
 final UserRepository users=mock(UserRepository.class);
 final Map<String,CloudEgressReceipt> rows=new HashMap<>();
 final byte[] bytes="real snapshot".getBytes();
 CloudEgressService service() {
  var manager=new AbstractPlatformTransactionManager(){
   protected Object doGetTransaction(){return new Object();}
   protected void doBegin(Object t,org.springframework.transaction.TransactionDefinition d){}
   protected void doCommit(DefaultTransactionStatus s){}
   protected void doRollback(DefaultTransactionStatus s){}
  };
  when(quota.postpaidEnabled()).thenReturn(true);
  when(quota.canRead(anyLong())).thenReturn(true);
  when(users.lockStorageOwner(7L)).thenReturn(Optional.of(new User()));
  when(catalog.fileList(7L,"p")).thenReturn(Map.of("files",List.of(Map.of("uid","f","source","cloud","size",999999))));
  when(catalog.content(7L,"p","f")).thenAnswer(i->new ProjectCatalogService.Content(new ByteArrayInputStream(bytes),bytes.length));
  when(billing.cloudState(7L)).thenReturn(Map.of("cloudAccess",Map.of("epoch",2)));
  when(billing.cloudOperation(eq(7L),anyString(),anyMap())).thenReturn(Map.of("quoteCents",1,"cashCurrency","CNY"));
  when(receipts.saveAndFlush(any())).thenAnswer(i->{var r=i.<CloudEgressReceipt>getArgument(0);rows.put(r.getId(),r);return r;});
  when(receipts.save(any())).thenAnswer(i->{var r=i.<CloudEgressReceipt>getArgument(0);rows.put(r.getId(),r);return r;});
  when(receipts.findById(anyString())).thenAnswer(i->Optional.ofNullable(rows.get(i.getArgument(0))));
  when(receipts.existsById(anyString())).thenAnswer(i->rows.containsKey(i.getArgument(0)));
  return new CloudEgressService(catalog,backup,billing,quota,receipts,users,manager);
 }
 @Test void realBytesAreAuthorizedAndSettledOnce() throws Exception {
  var svc=service();var quote=svc.quote(7L,"p","f");assertEquals(1,quote.get("credits"));
  verify(billing).cloudOperation(eq(7L),eq("egress-quote"),argThat(m->m.get("bytes").equals("13")));
  var download=svc.prepare(7L,"p","f","abcdefghijklmnop");Path path=download.snapshot().path();
  var output=new ByteArrayOutputStream();svc.write(download,output);
  assertArrayEquals(bytes,output.toByteArray());assertFalse(Files.exists(path));
  var receipt=rows.values().iterator().next();assertEquals(13,receipt.getDeliveredBytes());assertTrue(receipt.isCompleted());assertEquals("settled",receipt.getState());
  verify(billing).cloudOperation(eq(7L),eq("egress-settle"),argThat(m->m.get("deliveredBytes").equals("13")&&Boolean.TRUE.equals(m.get("completed"))));
  assertThrows(IllegalArgumentException.class,()->svc.prepare(7L,"p","f","abcdefghijklmnop"));
 }
 @Test void failedOutputPersistsZeroReceiptAndReleasesReservationWithoutReplay() throws Exception {
  var svc=service();var download=svc.prepare(7L,"p","f","abcdefghijklmnop");
  assertThrows(IOException.class,()->svc.write(download,new OutputStream(){public void write(int b)throws IOException{throw new IOException("disconnected");}public void write(byte[] b,int off,int len)throws IOException{throw new IOException("disconnected");}}));
  var receipt=rows.values().iterator().next();assertEquals(0,receipt.getDeliveredBytes());assertFalse(receipt.isCompleted());assertEquals("settled",receipt.getState());
 }
 @Test void unpaidAccountCannotReachAnotherOwnersFileOrSupplySize() throws Exception {
  var svc=service();when(catalog.fileList(8L,"p")).thenReturn(Map.of("files",List.of()));
  assertThrows(IllegalArgumentException.class,()->svc.prepare(8L,"p","f","abcdefghijklmnop"));
  verify(billing,never()).cloudOperation(eq(8L),anyString(),anyMap());
 }
 @Test void uncertainSettlementIsRetriedFromPersistedReceiptOnly() throws Exception {
  var svc=service();var download=svc.prepare(7L,"p","f","abcdefghijklmnop");
  when(billing.cloudOperation(eq(7L),eq("egress-settle"),anyMap())).thenThrow(new RuntimeException("network"));
  svc.write(download,new ByteArrayOutputStream());
  var receipt=rows.values().iterator().next();assertEquals("pending",receipt.getState());
  when(receipts.findByState("pending")).thenReturn(List.of(receipt));
  when(billing.cloudOperation(eq(7L),eq("egress-settle"),anyMap())).thenReturn(Map.of());svc.retrySettlements();
  assertEquals("settled",receipt.getState());verify(catalog,times(1)).content(7L,"p","f");
 }
 @Test void legacyQuoteHasRealVersionAndZeroPrice() throws Exception {
  var svc=service();when(quota.postpaidEnabled()).thenReturn(false);
  when(billing.balance(7L)).thenReturn(new MobileBillingClient.BalanceResult(0,"USD","free"));
  var quote=svc.quote(7L,"p","f");assertEquals(0,quote.get("quoteCents"));assertEquals("USD",quote.get("cashCurrency"));
  assertTrue(quote.get("resourceHash").toString().matches("[a-f0-9]{64}"));
  verify(billing,never()).cloudOperation(anyLong(),anyString(),anyMap());
 }
 @Test void trustedSourceUsesSameDurableReceiptAndRejectsChangedReceipt() throws Exception {
  var svc=service();var download=svc.prepareSource(7L,"authorized-file-42",new ByteArrayInputStream(bytes),20,"abcdefghijklmnop",null);
  svc.recordDelivery(download,5,false);svc.recordDelivery(download,5,false);
  assertThrows(IllegalStateException.class,()->svc.recordDelivery(download,6,false));
  assertEquals(5,rows.values().iterator().next().getDeliveredBytes());download.close();
  assertFalse(Files.exists(download.snapshot().path()));
 }
 @Test void changedVersionCannotReserveOrStream() throws Exception {
  var svc=service();
  assertThrows(IllegalArgumentException.class,()->svc.prepare(7L,"p","f","abcdefghijklmnop","0".repeat(64)));
  verify(billing,never()).cloudOperation(eq(7L),eq("egress-reserve"),anyMap());
 }
}
