// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;

import com.checkba.model.entity.CloudStorageSample;
import com.checkba.repository.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.*;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.beans.factory.ObjectProvider;
import java.time.Instant;
import java.util.*;

/** Durable capacity changes, not polling estimates. The account centre owns prices and free-space history. */
@Service
public class CloudStorageMeterService {
 private static final org.slf4j.Logger log=org.slf4j.LoggerFactory.getLogger(CloudStorageMeterService.class);
    private static final java.time.format.DateTimeFormatter ISO_MILLIS=new java.time.format.DateTimeFormatterBuilder().appendInstant(3).toFormatter();
    private static String iso(Instant value) { return ISO_MILLIS.format(value); }
    private final CloudStorageSampleRepository samples;
    private final UserRepository users;
    private final AccountBindingRepository bindings;
    private final ObjectProvider<CloudStorageQuotaService> quotas;
    private final MobileBillingService billing;
    private final TransactionTemplate tx;
    public CloudStorageMeterService(CloudStorageSampleRepository samples,UserRepository users,
            AccountBindingRepository bindings,ObjectProvider<CloudStorageQuotaService> quotas,
            MobileBillingService billing,PlatformTransactionManager manager) {
        this.samples=samples;this.users=users;this.bindings=bindings;this.quotas=quotas;this.billing=billing;
        this.tx=new TransactionTemplate(manager);
    }
    public void initialize(Long user) {
        if(!quotas.getObject().postpaidEnabled()) return;
        tx.executeWithoutResult(s->{users.lockStorageOwner(user).orElseThrow();observe(user);});
    }
    /** Caller holds the same owner lock as the storage mutation. Publish the new sample at commit. */
    public void changing(Long user) {
        if(!quotas.getObject().postpaidEnabled()) return;
        if(!TransactionSynchronizationManager.isActualTransactionActive()) throw new IllegalStateException("Storage meter requires a transaction");
        observe(user);
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override public void beforeCommit(boolean readOnly) { if(!readOnly) observe(user); }
        });
    }
    private void observe(Long user) {
        long bytes=quotas.getObject().usedBytes(user);
        var history=samples.findByUserIdOrderByObservedAtAscIdAsc(user);
        if(!history.isEmpty() && history.get(history.size()-1).getStoredBytes()==bytes) return;
        var row=new CloudStorageSample();row.setUserId(user);row.setObservedAt(Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MILLIS));row.setStoredBytes(bytes);
        samples.saveAndFlush(row);
    }
    @Scheduled(initialDelay=60000,fixedDelay=60000)
    public void settle() {
        if(!quotas.getObject().postpaidEnabled()) return;
        for(var binding:bindings.findAll()) try {
            long deadline=System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(5);
            for(int interval=0;interval<500 && System.nanoTime()<deadline;interval++) if(!settleOne(binding.getUserId())) break;
        }
        catch(RuntimeException failure) { log.warn("Cloud storage settlement deferred userId={} failureType={}",binding.getUserId(),failure.getClass().getSimpleName()); }
    }
    @SuppressWarnings("unchecked")
    public void settle(Long user) { settleOne(user); }
    private boolean settleOne(Long user) {
        return Boolean.TRUE.equals(tx.execute(ignored -> {
            users.lockStorageOwner(user).orElseThrow();
            Map<String,Object> state=billing.cloudState(user);
            Map<String,Object> money=(Map<String,Object>)state.get("billing");
            Map<String,Object> access=(Map<String,Object>)state.get("cloudAccess");
            if(!Boolean.TRUE.equals(money.get("accepted"))) return false;
            Instant from=Instant.parse((String)money.get("storageMeteredThrough"));
            var history=samples.findByUserIdOrderByObservedAtAscIdAsc(user);
            if(history.isEmpty()) { observe(user); history=samples.findByUserIdOrderByObservedAtAscIdAsc(user); }
            if(history.get(0).getObservedAt().isAfter(from)) {
                billing.cloudOperation(user,"storage-baseline",Map.of("epoch",access.get("epoch"),
                        "observedAt",iso(history.get(0).getObservedAt())));
                return true; // Unknown historical occupancy is never fabricated or billed.
            }
            long bytes=history.get(0).getStoredBytes();
            for(var sample:history) {
                if(!sample.getObservedAt().isAfter(from)) bytes=sample.getStoredBytes();
            }
            Instant to=Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MILLIS);
            for(var sample:history) if(sample.getObservedAt().isAfter(from)) { to=sample.getObservedAt();break; }
            if(!to.isAfter(from)) return false;
            String event="storage:"+user+":"+from+":"+to;
            Map<String,Object> settled=billing.cloudOperation(user,"storage-usage",Map.of("eventId",event,"epoch",access.get("epoch"),
                    "from",iso(from),"to",iso(to),"storedBytes",Long.toString(bytes)));
            Object raw=settled==null?null:settled.get("billing");
            Object through=raw instanceof Map<?,?> value?value.get("storageMeteredThrough"):null;
            return through instanceof String next && Instant.parse(next).isAfter(from) && to.isBefore(Instant.now().minusMillis(100));
        }));
    }
}
