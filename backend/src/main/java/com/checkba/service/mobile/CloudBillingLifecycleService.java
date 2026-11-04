// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.service.LangText;
import com.checkba.service.messagecenter.MessageCenterService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.core.type.TypeReference;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.time.Instant;
import java.util.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** Cloud-only lifecycle. Never sends file deletion commands or invokes account deletion. */
@Service
public class CloudBillingLifecycleService {
 private static final org.slf4j.Logger log=org.slf4j.LoggerFactory.getLogger(CloudBillingLifecycleService.class);
 private final AccountBindingRepository bindings; private final UserRepository users;
 private final MobileBillingService billing; private final CloudStorageQuotaService quota;
 private final MessageCenterService messages; private final CloudCleanupJobRepository jobs;
 private final MobileFileBackupRepository backups; private final MobileVersionObjectRepository versions;
 private final MobileRelayBlobStore blobs; private final MobileAssistantConsentRepository assistantConsents;
 private final MobileProjectSummaryRepository summaries; private final MobileAssistantTurnRepository turns;
 private final MobileCalendarSnapshotRepository calendars;
 @org.springframework.beans.factory.annotation.Autowired private CloudProjectCleanupService projects;
 @org.springframework.beans.factory.annotation.Autowired private MobileMediaInboxRepository media;
 @org.springframework.beans.factory.annotation.Autowired private MobileTransferRequestRepository transfers;
 @org.springframework.beans.factory.annotation.Autowired private MobileProjectManifestRepository manifests;
 @org.springframework.beans.factory.annotation.Autowired private MobileProjectDirRepository directories;
 @org.springframework.beans.factory.annotation.Autowired private MobileCalendarPushDeviceRepository pushDevices;
 @org.springframework.beans.factory.annotation.Autowired private MobileCalendarDeliveryRepository deliveries;
 @org.springframework.beans.factory.annotation.Autowired private MessageCenterNoticeRepository noticeRepository;
 private final ObjectMapper json; private final TransactionTemplate tx;
 private final boolean local, cleanupEnabled;
 public CloudBillingLifecycleService(AccountBindingRepository bindings,UserRepository users,MobileBillingService billing,
   CloudStorageQuotaService quota,MessageCenterService messages,CloudCleanupJobRepository jobs,
   MobileFileBackupRepository backups,MobileVersionObjectRepository versions,MobileRelayBlobStore blobs,
   MobileAssistantConsentRepository assistantConsents,MobileProjectSummaryRepository summaries,
   MobileAssistantTurnRepository turns,MobileCalendarSnapshotRepository calendars,ObjectMapper json,
   PlatformTransactionManager manager,@Value("${security.local-mode:false}") boolean local,
   @Value("${storage.postpaid.cleanup-enabled:false}") boolean cleanupEnabled) {
  this.bindings=bindings;this.users=users;this.billing=billing;this.quota=quota;this.messages=messages;
  this.jobs=jobs;this.backups=backups;this.versions=versions;this.blobs=blobs;this.assistantConsents=assistantConsents;
  this.summaries=summaries;this.turns=turns;this.calendars=calendars;this.json=json;this.tx=new TransactionTemplate(manager);
  this.local=local;this.cleanupEnabled=cleanupEnabled;
 }
 @Scheduled(initialDelay=90000,fixedDelay=60000)
 public void tick() {
  if(local || !quota.isEnabled() || !quota.postpaidEnabled()) return;
  for(var binding:bindings.findAll()) try { process(binding.getUserId()); }
  catch(RuntimeException failure) { log.warn("Cloud lifecycle deferred userId={} failureType={}",binding.getUserId(),failure.getClass().getSimpleName()); }
 }
 @SuppressWarnings("unchecked") private static Map<String,Object> map(Object value) { return (Map<String,Object>)value; }
 public void process(Long user) {
  String locale=users.findById(user).map(User::getCloudBillingLocale).orElse(null);
  com.checkba.service.AppLanguageScope.run(locale,()->processScoped(user));
 }
 private void processScoped(Long user) {
  if(local || !quota.isEnabled() || !quota.postpaidEnabled()) return;
  var state=billing.cloudState(user); var access=map(state.get("cloudAccess"));var money=map(state.get("billing"));
  String caseId=(String)access.get("caseId");
  if(caseId==null) {if(Boolean.TRUE.equals(access.get("frozen")))recoverCompleted(user);return;}
  Object remind=money.get("remindAt");
  if(remind instanceof String at && !Instant.parse(at).isAfter(Instant.now())) {
   String event="billing:"+user+":"+caseId;
   // publish commits before acknowledgement: a remote ack can never precede durable in-app delivery.
   String receipt=noticeRepository==null?null:noticeRepository.findByRecipientIdAndSourceIdAndEventKey(user,"cloud-billing",event).map(MessageCenterNotice::getId).orElse(null);
   if(receipt==null) {
   var delivered=messages.publishAuthorizedBusiness("cloud-billing",CloudBillingText.get("sourceName"),
     user,List.of(user),null,event,"billing",CloudBillingText.get("overdueTitle"),
     CloudBillingText.get("overdueBody").replace("{deadline}",String.valueOf(money.get("cleanupAt"))),"pending",Map.of());
   receipt=String.valueOf(delivered.get(0).get("id"));
   }
   billing.cloudOperation(user,"notification-ack",Map.of("caseId",caseId,"channel","in_app","receiptId",receipt));
  }
  if(!cleanupEnabled) return;
  state=billing.cloudState(user);access=map(state.get("cloudAccess"));
  if(!Boolean.TRUE.equals(access.get("cleanupEligible")) && !"deleting".equals(access.get("cleanupState"))) return;
  cleanup(user,caseId);
 }
 /** Recovery after payment only reads existing receipts; it never requests a deletion permit. */
 private void recoverCompleted(Long user) {
  for(var job:jobs.findByUserIdAndStateNot(user,"complete")) {
   if("reconciled".equals(job.getState()))continue;
   java.util.concurrent.atomic.AtomicBoolean resolved=new java.util.concurrent.atomic.AtomicBoolean(true);
   for(var item:items(job)) {
    Runnable recovery=()->tx.executeWithoutResult(status->{
     users.lockStorageOwner(user).orElseThrow();
     var current=jobs.findById(job.getId()).orElseThrow();
     Set<String> done=new LinkedHashSet<>();
     try {if(current.getCompletedItemsJson()!=null)done.addAll(json.readValue(current.getCompletedItemsJson(),new TypeReference<List<String>>(){}));}
     catch(Exception failure){throw new IllegalStateException(failure);}
     String key=item.type()+":"+item.id();if(done.contains(key))return;
     var receipt=billing.cloudOperation(user,"cleanup-claim",Map.of("epoch",current.getEpoch(),"caseId",current.getCaseId(),
       "manifestHash",current.getManifestHash(),"itemCount",items(current).size(),"itemId",key,"itemHash",hash(write(item)),"receiptOnly",true));
     if(!Boolean.TRUE.equals(receipt.get("completed"))) {
      // Missing or cancelled claims retain the original bytes. An unresolved issued claim needs review.
      if(!Boolean.FALSE.equals(receipt.get("issued")) && !Boolean.TRUE.equals(receipt.get("cancelled")))resolved.set(false);
      return;
     }
     quota.storageChanging(user);delete(user,item,true);done.add(key);current.setCompletedItemsJson(write(done));jobs.save(current);
    });
    if("project".equals(item.type()))projects.withProjectLock(new CloudProjectCleanupService.Target(user,item.id(),item.locator()),recovery);
    else if("user-memory".equals(item.type()))projects.withUserMemoryLock(user,recovery);
    else recovery.run();
   }
   if(resolved.get()) {
    // All local metadata repairs above committed before the account centre can allow a new epoch.
    billing.cloudOperation(user,"cleanup-reconciled",Map.of("epoch",job.getEpoch(),"caseId",job.getCaseId(),"manifestHash",job.getManifestHash()));
    tx.executeWithoutResult(status->{var current=jobs.findById(job.getId()).orElseThrow();current.setState("reconciled");jobs.save(current);});
   }
  }
 }
 public record Item(String type,Long id,String locator,String hash) {}
 private String hash(String input) {
  try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(input.getBytes(StandardCharsets.UTF_8))); }
  catch(Exception e) { throw new IllegalStateException(e); }
 }
 private String write(Object value) {try{return json.writeValueAsString(value);}catch(Exception e){throw new IllegalStateException(e);}}
 private List<Item> items(CloudCleanupJob job) {try{return json.readValue(job.getItemsJson(),new TypeReference<List<Item>>(){});}catch(Exception e){throw new IllegalStateException(e);}}
 private void cleanup(Long user,String caseId) {
  // The manifest is retained across crashes. Its exact locators are bound into every irreversible claim.
  CloudCleanupJob job=tx.execute(s -> {
   users.lockStorageOwner(user).orElseThrow();
   var existing=jobs.findByUserIdAndCaseId(user,caseId); if(existing.isPresent()) return existing.get();
   List<Item> plan=new ArrayList<>();
   for(var target:projects.listOwnedCleanupTargets(user)) plan.add(new Item("project",target.projectId(),target.projectUid(),Long.toString(user)));
   for(var row:backups.findByUserId(user)) plan.add(new Item("backup",row.getId(),row.getStoragePath(),row.getSha256()));
   for(var row:versions.findByUserId(user)) plan.add(new Item("version",row.getId(),row.getStoragePath(),row.getObjectSha()));
   for(var row:media.findByUserId(user)) plan.add(new Item("media",row.getId(),row.getStoragePath(),row.getClientMediaId()));
   for(var row:transfers.findByUserId(user)) plan.add(new Item("transfer",row.getId(),row.getStoragePath(),row.getRequestId()));
   plan.add(new Item("user-memory",user,"",Long.toString(user)));
   plan.add(new Item("derived",user,"",caseId));
   plan.sort(Comparator.comparing((Item i)->"derived".equals(i.type())?"zz-derived":i.type()).thenComparing(Item::id));
   String payload=write(plan);var created=new CloudCleanupJob();created.setId(hash(user+":"+caseId));
   created.setUserId(user);created.setCaseId(caseId);created.setItemsJson(payload);created.setManifestHash(hash(payload));
   created.setEpoch(((Number)map(billing.cloudState(user).get("cloudAccess")).get("epoch")).longValue());
   created.setState(projects.needsReview(user)?"review":"planned");
   if(plan.stream().anyMatch(i->!java.util.Set.of("derived","project","user-memory").contains(i.type()) && i.locator()!=null && !blobs.ownedLocator(user,i.locator()))) {
       created.setState("review");created.setReviewReason("cloud_locator_requires_review");
   }
   if("review".equals(created.getState()) && created.getReviewReason()==null) created.setReviewReason("ownership_requires_review");
   created.setCompletedItemsJson("[]");
   if(!"review".equals(created.getState())) {
    var first=plan.get(0);
    Map<String,Object> claim=billing.cloudOperation(user,"cleanup-claim",Map.of("epoch",created.getEpoch(),"caseId",caseId,
      "manifestHash",created.getManifestHash(),"itemCount",plan.size(),"itemId",first.type()+":"+first.id(),"itemHash",hash(write(first))));
    if(!Boolean.TRUE.equals(claim.get("allowed"))) created.setState("partial");
    else { created.setEpoch(((Number)claim.get("epoch")).longValue());created.setState("deleting"); }
   }
   return jobs.saveAndFlush(created);
  });
  if("review".equals(job.getState())) return;
  for(Item item:items(job)) {
   java.util.function.Supplier<Boolean> execution=()->tx.execute(s -> {
    users.lockStorageOwner(user).orElseThrow();
    var current=jobs.findById(job.getId()).orElseThrow();
    Set<String> completed=new LinkedHashSet<>();
    try { if(current.getCompletedItemsJson()!=null) completed.addAll(json.readValue(current.getCompletedItemsJson(),new TypeReference<List<String>>(){})); }
    catch(Exception invalid) { throw new IllegalStateException(invalid); }
    String itemKey=item.type()+":"+item.id();
    if(completed.contains(itemKey)) return true;
    if(projects.needsReview(user)) {current.setState("review");current.setReviewReason("ownership_requires_review");jobs.save(current);return false;}
    Map<String,Object> claim=billing.cloudOperation(user,"cleanup-claim",Map.of("epoch",current.getEpoch(),"caseId",caseId,
      "manifestHash",current.getManifestHash(),"itemCount",items(current).size(),"itemId",item.type()+":"+item.id(),"itemHash",hash(write(item))));
    boolean receiptOnly=Boolean.TRUE.equals(claim.get("completed"));
    if(!Boolean.TRUE.equals(claim.get("allowed")) && !receiptOnly) {current.setState("partial");jobs.save(current);return false;}
    current.setEpoch(((Number)claim.get("epoch")).longValue());current.setState("deleting");jobs.saveAndFlush(current);
    var owner=users.findById(user).orElseThrow();owner.setCloudBackupPaused(true);users.save(owner);
    assistantConsents.lockByUserId(user).ifPresent(c->{c.setRevision(c.getRevision()+1);assistantConsents.save(c);});
    if(!receiptOnly && (!(claim.get("expiresAt") instanceof String expires) || !Instant.parse(expires).isAfter(Instant.now())))
        throw new IllegalStateException("Cleanup execution permit expired");
    quota.storageChanging(user);
    if(!receiptOnly && !Instant.parse((String)claim.get("expiresAt")).isAfter(Instant.now())) throw new IllegalStateException("Cleanup execution permit expired");
    delete(user,item,receiptOnly);
    if(!receiptOnly) billing.cloudOperation(user,"cleanup-complete",Map.of("claimId",claim.get("claimId"),"success",true));
    completed.add(itemKey);current.setCompletedItemsJson(write(completed));jobs.save(current);
    return true;
   });
   boolean proceed;
   if("project".equals(item.type())) {
       java.util.concurrent.atomic.AtomicReference<Boolean> result=new java.util.concurrent.atomic.AtomicReference<>(false);
       projects.withProjectLock(new CloudProjectCleanupService.Target(user,item.id(),item.locator()),()->result.set(execution.get()));
       proceed=Boolean.TRUE.equals(result.get());
   } else if("user-memory".equals(item.type())) {
       java.util.concurrent.atomic.AtomicReference<Boolean> result=new java.util.concurrent.atomic.AtomicReference<>(false);
       projects.withUserMemoryLock(user,()->result.set(execution.get()));proceed=Boolean.TRUE.equals(result.get());
   } else proceed=Boolean.TRUE.equals(execution.get());
   if(!proceed) return;
  }
  billing.cloudOperation(user,"cleanup-finish",Map.of("caseId",caseId,"epoch",jobs.findById(job.getId()).orElseThrow().getEpoch(),"manifestHash",job.getManifestHash(),"itemCount",items(job).size()));
  tx.executeWithoutResult(s->{var current=jobs.findById(job.getId()).orElseThrow();current.setState("complete");jobs.save(current);});
 }
 private void delete(Long user,Item item,boolean receiptOnly) {
  if(receiptOnly && item.locator()!=null && !java.util.Set.of("derived","project","user-memory").contains(item.type()) && blobs.exists(item.locator()))
      throw new IllegalStateException("Completed deletion still has bytes; manual review required");
  if(!java.util.Set.of("derived","project","user-memory").contains(item.type()) && item.locator()!=null && !blobs.ownedLocator(user,item.locator()))
      throw new IllegalStateException("Cloud locator ownership requires review");
  switch(item.type()) {
   case "backup" -> backups.findById(item.id()).ifPresent(row->{
    if(!user.equals(row.getUserId()) || !Objects.equals(item.locator(),row.getStoragePath()) || !item.hash().equals(row.getSha256())) throw new IllegalStateException("Cleanup target changed");
    if(!receiptOnly) removeBlob(item.locator());backups.delete(row);
   });
   case "version" -> versions.findById(item.id()).ifPresent(row->{
    if(!user.equals(row.getUserId()) || !Objects.equals(item.locator(),row.getStoragePath()) || !item.hash().equals(row.getObjectSha())) throw new IllegalStateException("Cleanup target changed");
    if(!receiptOnly) removeBlob(item.locator());versions.delete(row);
   });
   case "user-memory" -> projects.deleteUserMemory(user,receiptOnly);
   case "project" -> {
    var target=new CloudProjectCleanupService.Target(user,item.id(),item.locator());
    if(receiptOnly) projects.reconcileCompleted(target);else projects.deleteExact(target);
   }
   case "media" -> media.findById(item.id()).ifPresent(row->{
    if(!user.equals(row.getUserId()) || !Objects.equals(item.locator(),row.getStoragePath()) || !item.hash().equals(row.getClientMediaId())) throw new IllegalStateException("Cleanup target changed");
    if(!receiptOnly) removeBlob(item.locator());media.delete(row);
   });
   case "transfer" -> transfers.findById(item.id()).ifPresent(row->{
    if(!user.equals(row.getUserId()) || !Objects.equals(item.locator(),row.getStoragePath()) || !item.hash().equals(row.getRequestId())) throw new IllegalStateException("Cleanup target changed");
    if(!receiptOnly) removeBlob(item.locator());row.setStoragePath(null);row.setPayloadJson(null);row.setStatus("FAILED");
    row.setErrorMessage(CloudBillingText.get("dataCleared"));transfers.save(row);
   });
   case "derived" -> { summaries.deleteByUserId(user);turns.deleteByUserId(user);calendars.deleteByUserId(user);
    manifests.deleteByUserId(user);directories.deleteByUserId(user);deliveries.deleteByUserId(user);pushDevices.deleteByUserId(user); }

   default -> throw new IllegalStateException("Unknown cleanup target");
  }
 }
 private void removeBlob(String locator) {
  if(locator==null) return;
  blobs.deleteQuietly(locator);if(blobs.exists(locator)) throw new IllegalStateException("Cloud object deletion incomplete");
 }
}
