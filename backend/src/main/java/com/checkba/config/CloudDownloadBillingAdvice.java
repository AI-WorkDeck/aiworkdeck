// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.config;

import com.checkba.service.mobile.*;
import org.springframework.core.MethodParameter;
import org.springframework.core.io.*;
import org.springframework.core.io.support.ResourceRegion;
import org.springframework.http.*;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.server.*;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyAdvice;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Explicit file routes only. Auth failures/JSON/other routes never acquire a paid reservation. */
@ControllerAdvice
public class CloudDownloadBillingAdvice implements ResponseBodyAdvice<Object> {
 private final CloudStorageQuotaService quota;private final CloudEgressService egress;private final MobileBillingService billing;
 public CloudDownloadBillingAdvice(CloudStorageQuotaService quota,CloudEgressService egress,MobileBillingService billing) {
  this.quota=quota;this.egress=egress;this.billing=billing;
 }
 public boolean supports(MethodParameter method,Class<? extends HttpMessageConverter<?>> converter) {
  return method.hasMethodAnnotation(CloudMeteredDownload.class);
 }
 public Object beforeBodyWrite(Object body,MethodParameter method,MediaType type,
       Class<? extends HttpMessageConverter<?>> converter,ServerHttpRequest request,ServerHttpResponse response) {
  if(!quota.isEnabled() || !quota.postpaidEnabled() || body==null) return body;
  if(!(request instanceof ServletServerHttpRequest servletRequest) || !(response instanceof ServletServerHttpResponse servletResponse)) return body;
  var req=servletRequest.getServletRequest();var res=servletResponse.getServletResponse();
  if(res.getStatus()<200 || res.getStatus()>=300) return body;
  Resource resource;long start=0,size,total;
  if(body instanceof ResourceRegion region) {resource=region.getResource();start=region.getPosition();size=region.getCount();}
  else if(body instanceof List<?> regions && !regions.isEmpty() && regions.get(0) instanceof ResourceRegion region) {
   if(regions.size()!=1) {res.setStatus(416);response.getHeaders().setContentLength(0);return null;}
   resource=region.getResource();start=region.getPosition();size=region.getCount();
  } else if(body instanceof Resource value) { resource=value;size=-1; }
  else if(body instanceof byte[] bytes) { resource=new ByteArrayResource(bytes);size=bytes.length; }
  else if(body instanceof String text) { byte[] bytes=text.getBytes(StandardCharsets.UTF_8);resource=new ByteArrayResource(bytes);size=bytes.length; }
  else return body;
  try (InputStream input=resource.getInputStream()) {
   CloudDownloadContext context=CloudDownloadContext.from(req);
   if(context==null)throw new IllegalArgumentException(CloudBillingText.get("downloadUpdate"));
   Long user=context.userId();
   total=resource instanceof InputStreamResource?response.getHeaders().getContentLength():resource.contentLength();
   if(total<0) throw new IOException(CloudBillingText.get("readUnavailable"));
   String range=req.getHeader("Range");
   if(range!=null) {
    Object raw=billing.cloudState(user).get("cloudAccess");
    if(raw instanceof Map<?,?> access && access.get("caseId")!=null) {
     res.setStatus(416);response.getHeaders().setContentLength(0);return null;
    }
    List<HttpRange> ranges;
    try {ranges=HttpRange.parseRanges(range);} catch(IllegalArgumentException invalid) {res.setStatus(416);response.getHeaders().setContentLength(0);return null;}
    if(ranges.size()!=1) {res.setStatus(416);response.getHeaders().setContentLength(0);return null;}
    start=ranges.get(0).getRangeStart(total);long end=ranges.get(0).getRangeEnd(total);size=end-start+1;
    if(start<0 || start>=total || size<=0) {res.setStatus(416);response.getHeaders().setContentLength(0);return null;}
    response.getHeaders().set(HttpHeaders.CONTENT_RANGE,"bytes "+start+"-"+end+"/"+total);res.setStatus(206);
   } else if(size<0)size=total;
   final long length=size;
   input.skipNBytes(start);
   InputStream bounded=new FilterInputStream(input) {
    long left=length;
    public int read() throws IOException {if(left==0)return -1;int value=super.read();if(value>=0)left--;return value;}
    public int read(byte[] buffer,int offset,int count) throws IOException {if(left==0)return -1;int n=super.read(buffer,offset,(int)Math.min(left,count));if(n>0)left-=n;return n;}
   };
   String attempt=req.getParameter("requestId");if(attempt==null || attempt.isBlank())attempt=UUID.randomUUID().toString();
   String identity=context.resourceId()+(range==null?"":":range:"+start+":"+size);
   // Only server-authorized file bytes and selected range reach the account centre.
   var download=egress.prepareSource(user,identity,bounded,size,attempt,req.getParameter("expectedHash"));
   response.getHeaders().setContentLength(download.size());
   if(type!=null)response.getHeaders().setContentType(type);
   response.getHeaders().set("X-Cloud-Download-Request",attempt);
   OutputStream output;
   try {output=response.getBody();} catch(IOException | RuntimeException failure) {
    try {egress.recordDelivery(download,0,false);} finally {download.close();}
    throw failure;
   }
   egress.write(download,output);
   return null; // Already delivered synchronously; no converter or async task can replay it.
  } catch(IOException failure) {throw new UncheckedIOException(failure);}
 }
}
