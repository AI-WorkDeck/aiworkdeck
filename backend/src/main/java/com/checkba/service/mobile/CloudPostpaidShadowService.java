// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;

import com.checkba.model.entity.CloudEgressReceipt;
import com.checkba.repository.AccountBindingRepository;
import com.checkba.repository.CloudEgressReceiptRepository;
import com.checkba.repository.UserRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;

/**
 * Shadow metering (storage.postpaid.shadow): measures storage and egress and reports them to the account
 * centre's separate shadow ledger. It never reserves, charges, gates access, notifies or cleans up, and every
 * failure is swallowed. Live postpaid takes precedence: with storage.postpaid.enabled on, shadow is inert.
 */
@Service
public class CloudPostpaidShadowService {
 private static final org.slf4j.Logger log=org.slf4j.LoggerFactory.getLogger(CloudPostpaidShadowService.class);
 private static final java.time.format.DateTimeFormatter ISO_MILLIS=new java.time.format.DateTimeFormatterBuilder().appendInstant(3).toFormatter();
 static final String PENDING="shadow-pending",SENT="shadow-sent",FAILED="shadow-failed";
 private final boolean shadow;
 private final CloudStorageQuotaService quota;private final MobileBillingService billing;
 private final AccountBindingRepository bindings;private final UserRepository users;private final CloudEgressReceiptRepository receipts;
 public CloudPostpaidShadowService(@Value("${storage.postpaid.shadow:false}") boolean shadow,CloudStorageQuotaService quota,
   MobileBillingService billing,AccountBindingRepository bindings,UserRepository users,CloudEgressReceiptRepository receipts) {
  this.shadow=shadow;this.quota=quota;this.billing=billing;this.bindings=bindings;this.users=users;this.receipts=receipts;
 }
 public boolean active() { return shadow && quota.isEnabled() && !quota.postpaidEnabled(); }

 /** Persist a delivered-bytes receipt; reported by {@link #report()}. Never throws into the download path. */
 public void egress(Long user,String resource,long bytes,boolean completed) {
  if(!active() || user==null) return;
  try {
   var row=new CloudEgressReceipt();
   row.setId("shadow-"+Instant.now().toEpochMilli()+"-"+UUID.randomUUID());row.setUserId(user);
   row.setResourceHash(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(String.valueOf(resource).getBytes(StandardCharsets.UTF_8))));
   row.setBytes(bytes);row.setDeliveredBytes(bytes);row.setCompleted(completed);row.setState(PENDING);
   receipts.save(row);
  } catch(Exception failure) { log.warn("Shadow egress receipt skipped userId={} failureType={}",user,failure.getClass().getSimpleName()); }
 }

 /** Every 10 minutes: one storage reading per mapped account, then pending egress receipts. */
 @Scheduled(initialDelay=120000,fixedDelay=600000)
 public void report() {
  if(!active()) return;
  for(var binding:bindings.findAll()) try {
   Instant now=Instant.now();String at=ISO_MILLIS.format(now);
   long bytes=quota.usedBytes(binding.getUserId(),true);
   billing.cloudOperation(binding.getUserId(),"shadow-storage",Map.of("eventId","shadow-storage:"+binding.getUserId()+":"+at,"observedAt",at,"storedBytes",Long.toString(bytes)));
  } catch(RuntimeException failure) { log.warn("Shadow storage reading deferred userId={} failureType={}",binding.getUserId(),failure.getClass().getSimpleName()); }
  for(var row:receipts.findByState(PENDING)) try {
   String at=ISO_MILLIS.format(Instant.ofEpochMilli(Long.parseLong(row.getId().split("-")[1])));
   billing.cloudOperation(row.getUserId(),"shadow-egress",Map.of("eventId",row.getId(),"observedAt",at,"bytes",Long.toString(row.getDeliveredBytes()),"completed",row.isCompleted()));
   row.setState(SENT);receipts.save(row);
  } catch(MobileBillingFailureException failure) {
   // Only an unreachable account centre is retried; a rejected or unmapped report is kept locally as failed.
   if(failure.getKind()!=MobileBillingKind.UNAVAILABLE) {row.setState(FAILED);receipts.save(row);}
   log.warn("Shadow egress report deferred event={} kind={}",row.getId(),failure.getKind());
  } catch(RuntimeException failure) { log.warn("Shadow egress report deferred event={} failureType={}",row.getId(),failure.getClass().getSimpleName()); }
 }

 /** Hourly: cloud accounts that hold data but have no account-centre mapping cannot be reconciled. */
 @Scheduled(initialDelay=300000,fixedDelay=3600000)
 public void reportUnmapped() {
  if(!active()) return;
  try {
   Set<Long> mapped=new HashSet<>();for(var binding:bindings.findAll()) mapped.add(binding.getUserId());
   long count=0,total=0;List<Long> sample=new ArrayList<>();
   for(var user:users.findAll()) {
    if(mapped.contains(user.getId())) continue;
    long bytes;
    try { bytes=quota.usedBytes(user.getId(),true); } catch(RuntimeException failure) { continue; }
    if(bytes<=0) continue;
    count++;total=Math.addExact(total,bytes);if(sample.size()<50) sample.add(user.getId());
   }
   billing.shadowUnmapped(Map.of("observedAt",ISO_MILLIS.format(Instant.now()),"users",count,"bytes",Long.toString(total),"sample",sample));
  } catch(RuntimeException failure) { log.warn("Shadow unmapped report deferred failureType={}",failure.getClass().getSimpleName()); }
 }
}
