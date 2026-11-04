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
 public CloudProtocolDownloadService(CloudStorageQuotaService quota,MobileBillingService billing,CloudEgressService egress) {
  this.quota=quota;this.billing=billing;this.egress=egress;
 }
 public boolean enabled(){return quota.isEnabled() && quota.postpaidEnabled();}
 public void deliver(Long user,String identity,InputStream source,long length,HttpServletRequest request,HttpServletResponse response) throws IOException {
  try(source) {
   if(!enabled()){source.transferTo(response.getOutputStream());return;}
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
