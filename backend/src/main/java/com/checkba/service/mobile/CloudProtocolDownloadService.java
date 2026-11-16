// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Service;
import java.io.*;
import java.util.*;

/** Git's dynamically negotiated pack/part protocol is not a stable full-file hardship export. */
@Service
public class CloudProtocolDownloadService {
 private final CloudStorageQuotaService quota;
 private final MobileBillingService billing;
 private final CloudEgressService egress;
 @org.springframework.beans.factory.annotation.Autowired(required=false) private CloudPostpaidShadowService shadow;
 public CloudProtocolDownloadService(CloudStorageQuotaService quota,MobileBillingService billing,CloudEgressService egress) {
  this.quota=quota;this.billing=billing;this.egress=egress;
 }
 public boolean enabled(){return quota.isEnabled() && quota.postpaidEnabled();}
 /** Shadow metering for the unbilled protocol path: records bytes already written, never blocks. */
 public boolean shadowActive(){return shadow!=null && shadow.active();}
 public void shadowDelivered(Long user,String identity,long bytes){if(shadow!=null)shadow.egress(user,identity,bytes,true);}
 /** Counts bytes written through it, for shadow reporting of streamed protocol responses. */
 public static final class CountingOutput extends java.io.FilterOutputStream {
  public long count;
  public CountingOutput(OutputStream target){super(target);}
  @Override public void write(int b) throws IOException {out.write(b);count++;}
  @Override public void write(byte[] b,int off,int len) throws IOException {out.write(b,off,len);count+=len;}
 }
 public void deliver(Long user,String identity,InputStream source,long length,HttpServletRequest request,HttpServletResponse response) throws IOException {
  try(source) {
   if(!enabled() || !quota.postpaidFor(user)){source.transferTo(response.getOutputStream());return;}
   Object raw=billing.cloudState(user).get("cloudAccess");
   if(raw instanceof Map<?,?> state && state.get("caseId")!=null) {response.sendError(409);return;}
   String attempt=request.getParameter("requestId");if(attempt==null || attempt.isBlank())attempt=UUID.randomUUID().toString();
   var download=egress.prepareSource(user,identity,source,length,attempt,null);
   response.setContentLengthLong(download.size());
   OutputStream output;
   try {output=response.getOutputStream();}catch(IOException | RuntimeException failure){
    try {egress.recordDelivery(download,0,false);}finally{download.close();}throw failure;
   }
   egress.write(download,output);
  }
 }
}
