// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;
import org.junit.jupiter.api.*;
import org.springframework.mock.web.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class CloudProtocolDownloadServiceTest {
 final CloudStorageQuotaService quota=mock(CloudStorageQuotaService.class);
 final MobileBillingService billing=mock(MobileBillingService.class);
 final CloudEgressService egress=mock(CloudEgressService.class);
 final CloudProtocolDownloadService service=new CloudProtocolDownloadService(quota,billing,egress);
 @BeforeEach void init(){when(quota.isEnabled()).thenReturn(true);when(quota.postpaidEnabled()).thenReturn(true);when(quota.postpaidFor(anyLong())).thenReturn(true);}
 @Test void hardshipGitCannotAcquireRepeatedDynamicExports()throws Exception {
  when(billing.cloudState(7L)).thenReturn(Map.of("cloudAccess",Map.of("caseId","case")));
  var response=new MockHttpServletResponse();var closed=new java.util.concurrent.atomic.AtomicBoolean();
  var input=new ByteArrayInputStream(new byte[]{1}){public void close()throws IOException{closed.set(true);super.close();}};
  service.deliver(7L,"git:7",input,1,new MockHttpServletRequest(),response);
  assertEquals(409,response.getStatus());assertTrue(closed.get());verifyNoInteractions(egress);
 }
 @Test void authorizedProtocolUsesExactPackBytesAndSynchronousSettlement()throws Exception {
  when(billing.cloudState(7L)).thenReturn(Map.of("cloudAccess",Map.of("epoch",1)));
  var bytes="pack bytes".getBytes();var path=Files.createTempFile("protocol-test", ".pack");Files.write(path,bytes);
  var download=new CloudEgressService.Download(new CloudEgressService.Snapshot(path,bytes.length,"hash"),"event",7L,true);
  when(egress.prepareSource(eq(7L),eq("git:7"),any(),eq((long)bytes.length),anyString(),isNull())).thenAnswer(c->{try(InputStream input=c.getArgument(2)){assertArrayEquals(bytes,input.readAllBytes());}return download;});
  doAnswer(c->{try(var d=c.<CloudEgressService.Download>getArgument(0)){Files.copy(d.snapshot().path(),c.<OutputStream>getArgument(1));}return null;}).when(egress).write(any(),any());
  var response=new MockHttpServletResponse();service.deliver(7L,"git:7",new ByteArrayInputStream(bytes),bytes.length,new MockHttpServletRequest(),response);
  assertArrayEquals(bytes,response.getContentAsByteArray());assertFalse(Files.exists(path));verify(egress).write(eq(download),any());
 }
}
