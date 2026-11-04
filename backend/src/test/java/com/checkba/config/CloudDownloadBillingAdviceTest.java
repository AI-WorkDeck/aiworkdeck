// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.config;
import com.checkba.service.mobile.*;
import org.junit.jupiter.api.*;
import org.springframework.core.io.InputStreamResource;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.test.web.servlet.*;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import static org.mockito.Mockito.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
class CloudDownloadBillingAdviceTest {
 final CloudStorageQuotaService quota=mock(CloudStorageQuotaService.class);
 final MobileBillingService billing=mock(MobileBillingService.class);
 final CloudEgressService egress=mock(CloudEgressService.class);
 final Endpoint endpoint=new Endpoint();MockMvc mvc;
 @RestController static class Endpoint {
  boolean closed;
  @GetMapping("/file") @CloudMeteredDownload ResponseEntity<InputStreamResource> file(){
   CloudDownloadContext.mark(7L,"file:stable");
   return ResponseEntity.ok().contentLength(6).body(new InputStreamResource(new ByteArrayInputStream("abcdef".getBytes()){
    public void close()throws IOException{closed=true;super.close();}
   }));
  }
  @GetMapping("/denied") @CloudMeteredDownload ResponseEntity<Map<String,String>> denied(){return ResponseEntity.status(403).body(Map.of("error","denied"));}
 }
 @BeforeEach void setup()throws Exception {
  when(quota.isEnabled()).thenReturn(true);when(quota.postpaidEnabled()).thenReturn(true);
  when(billing.cloudState(7L)).thenReturn(Map.of("cloudAccess",Map.of("epoch",1)));
  when(egress.prepareSource(eq(7L),anyString(),any(),anyLong(),anyString(),isNull())).thenAnswer(c->{
   try(InputStream input=c.getArgument(2)){var path=Files.createTempFile("advice-test", ".bin");Files.write(path,input.readAllBytes());return new CloudEgressService.Download(new CloudEgressService.Snapshot(path,Files.size(path),"hash"),null,7L,false);}
  });
  doAnswer(c->{try(var download=c.<CloudEgressService.Download>getArgument(0)){Files.copy(download.snapshot().path(),c.<OutputStream>getArgument(1));}return null;}).when(egress).write(any(),any());
  mvc=MockMvcBuilders.standaloneSetup(endpoint).setControllerAdvice(new CloudDownloadBillingAdvice(quota,egress,billing)).build();
 }
 @Test void fullFileDeliveredOnce()throws Exception {
  mvc.perform(get("/file")).andExpect(status().isOk()).andExpect(content().bytes("abcdef".getBytes()));
  verify(egress).prepareSource(eq(7L),eq("file:stable"),any(),eq(6L),anyString(),isNull());assertTrue(endpoint.closed);
 }
 @Test void rangeReservesOnlySelectedBytes()throws Exception {
  mvc.perform(get("/file").header("Range","bytes=1-3")).andExpect(status().isPartialContent()).andExpect(content().bytes("bcd".getBytes()));
  verify(egress).prepareSource(eq(7L),eq("file:stable:range:1:3"),any(),eq(3L),anyString(),isNull());assertTrue(endpoint.closed);
 }
 @Test void hardshipRangeRejectedWithoutChargeAndClosesInput()throws Exception {
  when(billing.cloudState(7L)).thenReturn(Map.of("cloudAccess",Map.of("caseId","case")));
  mvc.perform(get("/file").header("Range","bytes=1-3")).andExpect(status().isRequestedRangeNotSatisfiable()).andExpect(content().bytes(new byte[0]));
  verifyNoInteractions(egress);assertTrue(endpoint.closed);
 }
 @Test void errorsNeverMetered()throws Exception {
  mvc.perform(get("/denied")).andExpect(status().isForbidden());verifyNoInteractions(egress);
 }
 @Test void localModeLeavesConverterInControl()throws Exception {
  when(quota.isEnabled()).thenReturn(false);
  mvc.perform(get("/file")).andExpect(content().bytes("abcdef".getBytes()));verifyNoInteractions(egress);
 }
}
