// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;
import com.checkba.service.LangText;
import com.checkba.model.entity.*;
import com.checkba.repository.*;
import org.springframework.stereotype.Service;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;

@Service
public class MobileCalendarPushService {
    private final MobileCalendarPushDeviceRepository devices;
    private final MobileCalendarDeliveryRepository deliveries;
    private final MobileCalendarService calendar;
    private final UserRepository users;
    private final MobileCalendarPushGateway gateway;
    private final TransactionTemplate tx;
    public MobileCalendarPushService(MobileCalendarPushDeviceRepository devices, MobileCalendarDeliveryRepository deliveries,
            MobileCalendarService calendar, UserRepository users, MobileCalendarPushGateway gateway, PlatformTransactionManager transactions) {
        this.devices=devices;this.deliveries=deliveries;this.calendar=calendar;this.users=users;this.gateway=gateway;
        this.tx=new TransactionTemplate(transactions);
    }
    public Map<String,Object> status() { return Map.of("available",gateway.available()); }
    public Map<String,Object> register(Long user,String installation,String token,String environment) {
        try {
            if(installation==null || !UUID.fromString(installation).toString().equalsIgnoreCase(installation)) throw new IllegalArgumentException();
        } catch(IllegalArgumentException e) { throw new IllegalArgumentException(LangText.of("通知安装标识无效","Invalid notification installation ID")); }
        if(token==null || !token.matches("[a-fA-F0-9]{64,256}") || environment==null || !Set.of("sandbox","production").contains(environment))
            throw new IllegalArgumentException(LangText.of("通知注册信息无效","Invalid push registration"));
        if(!gateway.available()) return Map.of("available",false,"registered",false);
        return tx.execute(s -> {
            users.lockStorageOwner(user).orElseThrow(() -> new IllegalArgumentException(LangText.of("用户不存在","User not found")));
            var settings=calendar.settings(user);
            if(!Boolean.TRUE.equals(settings.get("enabled")) || !Boolean.TRUE.equals(settings.get("subscriptionActive")))
                throw new IllegalArgumentException(LangText.of("请先开启手机日程同步","Enable mobile calendar sync first"));
            String normalized=token.toLowerCase(Locale.ROOT);
            // A token belongs to only one current account. Account switches revoke its prior delivery history.
            devices.findByToken(normalized).filter(d -> !installation.equals(d.getInstallationId())).ifPresent(d -> {
                deliveries.deleteByInstallationId(d.getInstallationId()); devices.delete(d); devices.flush();
            });
            var row=devices.findById(installation).orElseGet(MobileCalendarPushDevice::new);
            if(!user.equals(row.getUserId()) || !normalized.equals(row.getToken())) deliveries.deleteByInstallationId(installation);
            row.setInstallationId(installation);row.setUserId(user);row.setToken(normalized);row.setEnvironment(environment);
            row.setRegisteredAt(Instant.now());devices.save(row);
            return Map.<String,Object>of("available",true,"registered",true);
        });
    }
    public void unregister(Long user,String installation) {
        tx.executeWithoutResult(s -> {
            users.lockStorageOwner(user).orElseThrow(() -> new IllegalArgumentException(LangText.of("用户不存在","User not found")));
            devices.findById(installation).filter(d -> user.equals(d.getUserId())).ifPresent(d -> {
                devices.delete(d);deliveries.deleteByInstallationId(installation);
            });
        });
    }

    @Scheduled(initialDelay=90_000,fixedDelay=60_000)
    public void sendDue() {
        if(!gateway.available()) return;
        for(Long user:devices.findAll().stream().map(MobileCalendarPushDevice::getUserId).distinct().toList()) {
            try { tx.executeWithoutResult(s -> sendUser(user,Instant.now())); }
            catch(RuntimeException e) {
                org.slf4j.LoggerFactory.getLogger(getClass()).warn("Calendar push pending retry ({})",e.getClass().getSimpleName());
            }
        }
    }
    @SuppressWarnings("unchecked")
    void sendUser(Long user,Instant now) {
        // The same owner lock serializes snapshot replacement, revocation, registration and delivery.
        users.lockStorageOwner(user).orElseThrow(() -> new IllegalArgumentException(LangText.of("用户不存在","User not found")));
        var current=calendar.events(user);
        var registered=devices.findByUserId(user);
        Set<String> invalid=new HashSet<>();
        for(var event:(List<Map<String,Object>>)current.get("events")) {
            if(!"OPEN".equals(event.get("status")) || !(event.get("remindAt") instanceof String when)) continue;
            Instant remindAt=Instant.parse(when);
            if(remindAt.isAfter(now) || remindAt.isBefore(now.minusSeconds(86400))) continue;
            String eventId=String.valueOf(event.get("id"));
            for(var device:registered) {
                if(invalid.contains(device.getInstallationId())) continue;
                String receipt=deliveryId(user,device.getInstallationId(),eventId,when);
                if(deliveries.existsById(receipt)) continue;
                var result=gateway.send(device,eventId,receipt);
                if(result==MobileCalendarPushGateway.Result.INVALID_DEVICE) {
                    invalid.add(device.getInstallationId()); devices.delete(device); continue;
                }
                if(result==MobileCalendarPushGateway.Result.SENT) {
                    var delivered=new MobileCalendarDelivery();delivered.setId(receipt);delivered.setUserId(user);
                    delivered.setInstallationId(device.getInstallationId());delivered.setSentAt(now);deliveries.save(delivered);
                }
            }
        }
    }
    static String deliveryId(Long user,String installation,String event,String remindAt) {
        return UUID.nameUUIDFromBytes((user+"\n"+installation+"\n"+event+"\n"+remindAt).getBytes(StandardCharsets.UTF_8)).toString();
    }
    @Scheduled(initialDelay=300_000,fixedDelay=86_400_000)
    public void cleanReceipts() {
        tx.executeWithoutResult(s -> deliveries.deleteBySentAtBefore(Instant.now().minusSeconds(90L*86400)));
    }
}
