// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;

import com.checkba.model.entity.CloudEgressReceipt;
import com.checkba.repository.CloudEgressReceiptRepository;
import com.checkba.repository.UserRepository;
import org.springframework.stereotype.Service;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

/** Server-owned snapshot and delivery receipts. No client-supplied size or account identity. */
@Service
public class CloudEgressService {
 private static final org.slf4j.Logger log=org.slf4j.LoggerFactory.getLogger(CloudEgressService.class);
 private final ProjectCatalogService catalog;private final MobileBackupService backups;
 private final MobileBillingService billing;private final CloudStorageQuotaService quota;
 private final CloudEgressReceiptRepository receipts;private final UserRepository users;
 private final TransactionTemplate tx;
 public CloudEgressService(ProjectCatalogService catalog,MobileBackupService backups,MobileBillingService billing,
  CloudStorageQuotaService quota,CloudEgressReceiptRepository receipts,UserRepository users,PlatformTransactionManager manager) {
  this.catalog=catalog;this.backups=backups;this.billing=billing;this.quota=quota;this.receipts=receipts;this.users=users;this.tx=new TransactionTemplate(manager);
 }
 @SuppressWarnings("unchecked") private Map<String,Object> selected(Long user,String project,String file) {
  return ((List<Map<String,Object>>)catalog.fileList(user,project).get("files")).stream()
   .filter(f->file.equals(f.get("uid"))&&!Boolean.TRUE.equals(f.get("isFolder")))
   .findFirst().orElseThrow(()->new IllegalArgumentException(CloudBillingText.get("fileNotFound")));
 }
 private ProjectCatalogService.Content content(Long user,String project,String file,Map<String,Object> selected) throws IOException {
  return "cloud".equals(selected.get("source"))?catalog.content(user,project,file):backups.content(user,(String)selected.get("deviceId"),(String)selected.get("projectKey"),file);
 }
 public void requirePreview(Long user,String project,String file) {
  backups.requireEligible(user);
  MobilePreviewPolicy.requireSupported((String)selected(user,project,file).get("name"));
 }
 public Map<String,Object> quote(Long user,String project,String file) throws IOException {
  if(quota.postpaidEnabled() && !quota.canRead(user))throw new IllegalArgumentException(CloudBillingText.get("readUnavailable"));
  var selected=selected(user,project,file);
  try(var snapshot=snapshot(user,project,file,selected)) {
   if(!quota.postpaidEnabled()) return Map.of("credits",0,"quoteCents",0,"cashCurrency",billing.balance(user).currency(),"resourceHash",snapshot.hash,"estimated",true);
   var state=billing.cloudState(user);var access=map(state.get("cloudAccess"));
   Map<String,Object> input=new LinkedHashMap<>();input.put("bytes",Long.toString(snapshot.size));input.put("resourceHash",snapshot.hash);
   if(access.get("caseId")!=null) input.put("exportCaseId",access.get("caseId"));
   var result=new LinkedHashMap<>(billing.cloudOperation(user,"egress-quote",input));
   result.put("credits",result.getOrDefault("quoteCents",0));result.put("resourceHash",snapshot.hash);result.put("estimated",true);return result;
  }
 }
 @SuppressWarnings("unchecked") private static Map<String,Object> map(Object o) { return (Map<String,Object>)o; }
 public record Snapshot(Path path,long size,String hash) implements AutoCloseable {public void close() throws IOException {Files.deleteIfExists(path);}}
 private Snapshot snapshot(Long user,String project,String file,Map<String,Object> entry) throws IOException {
  return snapshotSource(user,"file:"+file,content(user,project,file,entry).stream(),Long.MAX_VALUE);
 }
 private Snapshot snapshotSource(Long user,String resource,InputStream source,long maxBytes) throws IOException {
  Path path;
  try { path=Files.createTempFile("awd-cloud-download-",".tmp"); }
  catch(IOException failure) {source.close();throw failure;}
  try (var input=source;var output=Files.newOutputStream(path)) {
   MessageDigest digest=MessageDigest.getInstance("SHA-256");
   digest.update((user+":"+resource+":").getBytes(java.nio.charset.StandardCharsets.UTF_8));
   long count=0;byte[] buffer=new byte[64*1024];int n;
   while((n=input.read(buffer))!=-1){count=Math.addExact(count,n);if(count>maxBytes)throw new IOException("Cloud download exceeds transfer size limit");output.write(buffer,0,n);digest.update(buffer,0,n);}
   return new Snapshot(path,count,HexFormat.of().formatHex(digest.digest()));
  } catch(Exception e) {Files.deleteIfExists(path);if(e instanceof IOException io)throw io;throw new IOException("Cloud snapshot unavailable",e);}
 }
 public record Download(Snapshot snapshot,String eventId,Long user,boolean billed) implements AutoCloseable {
  public long size(){return snapshot.size;} public void close() throws IOException {snapshot.close();}
 }
 public Download prepare(Long user,String project,String file,String requestId) throws IOException {
  return prepare(user,project,file,requestId,null);
 }
 public Download prepare(Long user,String project,String file,String requestId,String expectedHash) throws IOException {
  if(quota.postpaidEnabled() && !quota.canRead(user))throw new IllegalArgumentException(CloudBillingText.get("readUnavailable"));
  var entry=selected(user,project,file);
  return reserve(user,snapshot(user,project,file,entry),requestId,expectedHash);
 }
 /** The caller must authorize this account and resource before supplying any bytes. */
 public Download prepareSource(Long user,String trustedResourceId,InputStream source,long maxBytes,String requestId,String expectedHash) throws IOException {
  if(quota.postpaidEnabled() && !quota.canRead(user)) {
   source.close();throw new IllegalArgumentException(CloudBillingText.get("readUnavailable"));
  }
  return reserve(user,snapshotSource(user,trustedResourceId,source,maxBytes),requestId,expectedHash);
 }
 private Download reserve(Long user,Snapshot snapshot,String requestId,String expectedHash) throws IOException {
  try {
   if(expectedHash!=null && !snapshot.hash.equals(expectedHash)) throw new IllegalArgumentException(CloudBillingText.get("downloadChanged"));
   if(!quota.postpaidEnabled() || snapshot.size==0)return new Download(snapshot,null,user,false);
   if(requestId==null || !requestId.matches("[A-Za-z0-9_-]{16,80}"))throw new IllegalArgumentException(CloudBillingText.get("downloadUpdate"));
   String event="egress-"+user+"-"+requestId;
   tx.executeWithoutResult(s->{
    users.lockStorageOwner(user).orElseThrow();
    if(receipts.existsById(event)) throw new IllegalArgumentException(CloudBillingText.get("downloadUsed"));
    var state=billing.cloudState(user);var access=map(state.get("cloudAccess"));
    Map<String,Object> input=new LinkedHashMap<>();input.put("eventId",event);input.put("epoch",access.get("epoch"));input.put("resourceHash",snapshot.hash);input.put("bytes",Long.toString(snapshot.size));input.put("totalBytes",Long.toString(snapshot.size));input.put("offset","0");
    if(access.get("caseId")!=null)input.put("exportCaseId",access.get("caseId"));
    billing.cloudOperation(user,"egress-reserve",input);
    var row=new CloudEgressReceipt();row.setId(event);row.setUserId(user);row.setResourceHash(snapshot.hash);row.setBytes(snapshot.size);row.setState("reserved");receipts.saveAndFlush(row);
   });
   return new Download(snapshot,event,user,true);
  } catch(RuntimeException e) {snapshot.close();throw e;}
 }
 public void write(Download download,OutputStream output) throws IOException {
  long written=0;boolean completed=false;
  try(download;var input=Files.newInputStream(download.snapshot.path)) {
   byte[] bytes=new byte[64*1024];int n;
   while((n=input.read(bytes))!=-1){output.write(bytes,0,n);written+=n;}
   output.flush();completed=true;
  } finally {
   recordDelivery(download,written,completed);
  }
 }
 /** Persists a delivery receipt before attempting settlement; never replays response bytes. */
 public void recordDelivery(Download download,long delivered,boolean completed) {
  if(delivered<0 || delivered>download.size() || (completed && delivered!=download.size()))
   throw new IllegalArgumentException("Invalid cloud delivery receipt");
  if(!download.billed)return;
  tx.executeWithoutResult(s->{
   users.lockStorageOwner(download.user).orElseThrow();
   var row=receipts.findById(download.eventId).orElseThrow();
   if(!"reserved".equals(row.getState())) {
    if(row.getDeliveredBytes()!=delivered || row.isCompleted()!=completed)throw new IllegalStateException("Cloud delivery receipt differs");
    return;
   }
   row.setDeliveredBytes(delivered);row.setCompleted(completed);row.setState("pending");receipts.saveAndFlush(row);
  });
  try {settle(download.eventId);} catch(RuntimeException failure) { log.warn("Cloud egress settlement pending: event={}, failure={}",download.eventId,failure.getClass().getSimpleName()); }
 }
 private void settle(String id) {
  var row=receipts.findById(id).orElseThrow();
  if(!"pending".equals(row.getState()))return;
  billing.cloudOperation(row.getUserId(),"egress-settle",Map.of("eventId",id,"deliveredBytes",Long.toString(row.getDeliveredBytes()),"completed",row.isCompleted()));
  tx.executeWithoutResult(s->{var current=receipts.findById(id).orElseThrow();current.setState("settled");receipts.save(current);});
 }
 @Scheduled(initialDelay=60000,fixedDelay=60000) public void retrySettlements() {
  if(!quota.postpaidEnabled())return;
  for(var row:receipts.findByState("pending"))try{settle(row.getId());}catch(RuntimeException failure){log.warn("Cloud egress settlement retry failed: event={}, failure={}",row.getId(),failure.getClass().getSimpleName());}
 }
}
