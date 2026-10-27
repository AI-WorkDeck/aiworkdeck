// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.service.LangText;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;

/** Account-scoped read model. Desktop snapshots are complete replacements, never a second task authority. */
@Service
public class MobileCalendarService {
    public static final String CONSENT_VERSION = "2026-10-27";
    private final MobileCalendarConsentRepository consents;
    private final MobileCalendarSnapshotRepository snapshots;
    private final MobileProjectDirRepository directories;
    private final UserRepository users;
    private final CloudStorageQuotaService quota;
    private final ObjectMapper mapper;

    public MobileCalendarService(MobileCalendarConsentRepository consents, MobileCalendarSnapshotRepository snapshots,
            MobileProjectDirRepository directories, UserRepository users, CloudStorageQuotaService quota, ObjectMapper mapper) {
        this.consents=consents; this.snapshots=snapshots; this.directories=directories;
        this.users=users; this.quota=quota; this.mapper=mapper;
    }

    public Map<String,Object> settings(Long user) {
        boolean enabled=consents.findById(user).map(MobileCalendarConsent::isEnabled).orElse(false);
        boolean active=false, available=true;
        try { active=quota.persistentQuota(user)>0; }
        catch (MobileBillingFailureException e) { available=false; }
        return Map.of("enabled",enabled,"subscriptionActive",active,"subscriptionAvailable",available,
                "consentVersion",CONSENT_VERSION);
    }

    @Transactional
    public Map<String,Object> settings(Long user, boolean enabled, String version) {
        if (!CONSENT_VERSION.equals(version)) throw new IllegalArgumentException(LangText.of(
                "请阅读并确认日程同步说明","Please review the calendar sync notice"));
        lock(user);
        if (enabled && quota.persistentQuota(user)<=0) throw new IllegalArgumentException(LangText.of(
                "手机日程同步需要有效云端订阅","Mobile calendar sync requires an active cloud subscription"));
        var row=consents.findById(user).orElseGet(MobileCalendarConsent::new);
        row.setUserId(user); row.setEnabled(enabled); row.setConsentVersion(version); row.setDecidedAt(Instant.now());
        consents.save(row);
        if (!enabled) snapshots.deleteByUserId(user);
        return settings(user);
    }

    private void lock(Long user) {
        users.lockStorageOwner(user).orElseThrow(() -> new IllegalArgumentException(LangText.of("用户不存在","User not found")));
    }
    private void requireEnabled(Long user) {
        if (!consents.findById(user).map(MobileCalendarConsent::isEnabled).orElse(false)
                || quota.persistentQuota(user)<=0) throw new IllegalArgumentException(LangText.of(
                        "请先开启手机日程同步","Enable mobile calendar sync first"));
    }

    @Transactional
    public Map<String,Object> replace(Long user, String device, String timeZone, String sourceUpdatedAt,
            List<Map<String,Object>> incoming) {
        return replace(user, device, timeZone, sourceUpdatedAt, incoming, false);
    }

    @Transactional
    public Map<String,Object> replace(Long user, String device, String timeZone, String sourceUpdatedAt,
            List<Map<String,Object>> incoming, boolean truncated) {
        lock(user); requireEnabled(user);
        text(device,64,"deviceId");
        ZoneId zone;
        Instant source;
        try { zone=ZoneId.of(text(timeZone,100,"timeZone")); source=Instant.parse(text(sourceUpdatedAt,40,"sourceUpdatedAt")); }
        catch (DateTimeException e) { throw new IllegalArgumentException(LangText.of("日程时区或快照时间无效","Invalid calendar time zone or snapshot time")); }
        if(source.isAfter(Instant.now().plusSeconds(300))) throw new IllegalArgumentException(LangText.of("日程快照时间无效","Invalid snapshot time"));
        if(incoming==null || incoming.size()>5000) throw new IllegalArgumentException(LangText.of("日程快照数量无效","Invalid calendar snapshot size"));
        var known=new HashMap<String,MobileProjectDir>();
        for(var dir:directories.findByUserIdAndDeviceId(user,device)) known.put(dir.getProjectKey(),dir);
        var row=snapshots.findByUserIdAndDeviceId(user,device).orElseGet(MobileCalendarSnapshot::new);
        if(row.getSourceUpdatedAt()!=null && !source.isAfter(row.getSourceUpdatedAt()))
            return Map.of("accepted",false,"syncedAt",row.getSyncedAt().toString());
        List<Map<String,Object>> events=new ArrayList<>();
        Set<String> ids=new HashSet<>();
        for(var event:incoming) {
            if(event==null) throw new IllegalArgumentException(LangText.of("日程事项无效","Invalid calendar event"));
            String project=text(event.get("projectKey"),64,"projectKey");
            var dir=known.get(project);
            if(dir==null) throw new IllegalArgumentException(LangText.of("项目不存在","Project not found"));
            String task=text(event.get("taskId"),64,"taskId");
            String id=eventId(device,project,task);
            if(!ids.add(id)) throw new IllegalArgumentException(LangText.of("日程事项重复","Duplicate calendar event"));
            LocalDate date;
            String dueTime=event.get("dueTime")==null ? null : text(event.get("dueTime"),18,"dueTime");
            LocalTime time;
            try {
                date=LocalDate.parse(text(event.get("dueDate"),10,"dueDate"));
                time=dueTime==null ? LocalTime.of(9,0) : LocalTime.parse(dueTime);
            } catch (DateTimeException e) { throw new IllegalArgumentException(LangText.of("事项日期或时间无效","Invalid event date or time")); }
            String status=text(event.get("status"),16,"status");
            if(!Set.of("OPEN","DONE").contains(status)) throw new IllegalArgumentException(LangText.of("事项状态无效","Invalid task status"));
            Map<String,Object> clean=new LinkedHashMap<>();
            clean.put("id",id); clean.put("deviceId",device); clean.put("projectKey",project); clean.put("taskId",task);
            clean.put("projectUid",dir.getProjectUid()); clean.put("projectName",dir.getName());
            clean.put("title",text(event.get("title"),2000,"title")); clean.put("dueDate",date.toString());
            clean.put("dueTime",dueTime); clean.put("timeZone",zone.getId()); clean.put("status",status);
            clean.put("updatedAt",source.toString());
            Object before=event.get("remindBefore");
            Instant reminder=null;
            if(before!=null) {
                if(!(before instanceof Number n) || n.doubleValue()!=n.longValue() || n.longValue()<0 || n.longValue()>525600)
                    throw new IllegalArgumentException(LangText.of("提醒时间间隔无效","Invalid reminder interval"));
                if("OPEN".equals(status)) reminder=date.atTime(time).atZone(zone).toInstant().minusSeconds(((Number)before).longValue()*60);
            }
            clean.put("remindAt",reminder==null ? null : reminder.toString());
            List<Map<String,Object>> files=new ArrayList<>();
            if(event.get("files") instanceof List<?> linked) {
                if(linked.size()>200) throw new IllegalArgumentException(LangText.of("关联文件数量过多","Too many linked files"));
                for(Object value:linked) {
                    if(!(value instanceof Map<?,?> f)) throw new IllegalArgumentException(LangText.of("关联文件无效","Invalid linked file"));
                    files.add(Map.of("fileId",text(f.get("fileId"),64,"fileId"),
                            "fileName",f.get("fileName")==null || "".equals(f.get("fileName")) ? "" : text(f.get("fileName"),1024,"fileName")));
                }
            }
            clean.put("files",files); events.add(clean);
        }
        try {
            String json=mapper.writeValueAsString(events);
            if(json.length()>4_000_000) throw new IllegalArgumentException(LangText.of("日程快照过大","Calendar snapshot is too large"));
            row.setEventsJson(json);
        } catch(com.fasterxml.jackson.core.JsonProcessingException e) { throw new IllegalStateException(e); }
        row.setUserId(user); row.setDeviceId(device); row.setSourceUpdatedAt(source); row.setSyncedAt(Instant.now());
        snapshots.save(row);
        return Map.of("accepted",true,"syncedAt",row.getSyncedAt().toString(),"count",events.size(),"truncated",truncated);
    }

    @Transactional
    public Map<String,Object> events(Long user) {
        lock(user);
        Map<String,Object> result=new LinkedHashMap<>(settings(user));
        List<Map<String,Object>> events=new ArrayList<>();
        Instant synced=null;
        if(Boolean.TRUE.equals(result.get("enabled")) && Boolean.TRUE.equals(result.get("subscriptionActive"))) {
            Set<String> known=new HashSet<>();
            for(var dir:directories.findByUserIdOrderByUpdatedAtDesc(user)) known.add(dir.getDeviceId()+"\n"+dir.getProjectKey());
            for(var row:snapshots.findByUserId(user)) {
                try {
                    List<Map<String,Object>> list=mapper.readValue(row.getEventsJson(),new TypeReference<>() {});
                    for(var event:list) if(known.contains(row.getDeviceId()+"\n"+event.get("projectKey"))) events.add(event);
                } catch(com.fasterxml.jackson.core.JsonProcessingException e) { throw new IllegalStateException(LangText.of("暂时无法读取日程数据","Calendar data unavailable"),e); }
                if(synced==null || row.getSyncedAt().isAfter(synced)) synced=row.getSyncedAt();
            }
            events.sort(Comparator.comparing(e -> e.get("dueDate")+"T"+Objects.toString(e.get("dueTime"),"00:00")));
        }
        result.put("events",events); result.put("syncedAt",synced==null ? null : synced.toString());
        return result;
    }

    public static String eventId(String device,String project,String task) {
        return UUID.nameUUIDFromBytes((device+"\n"+project+"\n"+task).getBytes(StandardCharsets.UTF_8)).toString();
    }
    private static String text(Object value,int max,String field) {
        if(!(value instanceof String s) || s.isBlank() || s.length()>max
                || (!Set.of("title","fileName").contains(field) && (s.indexOf('\n')>=0 || s.indexOf('\r')>=0)))
            throw new IllegalArgumentException(LangText.of("字段无效：","Invalid field: ")+field);
        return s;
    }
}
