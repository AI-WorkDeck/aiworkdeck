// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.messagecenter;

import com.checkba.model.entity.MessageCenterNotice;
import com.checkba.repository.*;
import com.checkba.service.ProjectMemberService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;

@Service
public class MessageCenterService {
    private static final Set<String> STATES = Set.of("none","pending","done","cancelled");
    private static final Set<String> TARGET_KEYS = Set.of("kind","pluginId","view","recordId","projectId",
            "projectKey","conversationId","requestId","itemId","connectionId");
    private final MessageCenterNoticeRepository notices;
    private final UserRepository users;
    private final ProjectRepository projects;
    private final ProjectMemberRepository members;
    private final ProjectMemberService permissions;
    private final ObjectProvider<MessageCenterSource> sources;
    private final ObjectProvider<MessageCenterAccessPolicy> policies;
    private final ObjectMapper json;

    public MessageCenterService(MessageCenterNoticeRepository notices, UserRepository users, ProjectRepository projects,
            ProjectMemberRepository members, ProjectMemberService permissions, ObjectProvider<MessageCenterSource> sources,
            ObjectProvider<MessageCenterAccessPolicy> policies, ObjectMapper json) {
        this.notices=notices; this.users=users; this.projects=projects; this.members=members;
        this.permissions=permissions; this.sources=sources; this.policies=policies; this.json=json;
    }

    /** HTTP plugin callers only ever write to their own account. Plugin labels confer no business authority. */
    @Transactional
    public Map<String,Object> publishToSelf(String pluginId, Long userId, Map<String,Object> p) {
        pluginId = pluginId(pluginId);
        for (String prohibited : Set.of("recipientId","recipients","userId","senderId","sourceId","sourceKind","sourceName","pluginId"))
            if (p.containsKey(prohibited)) throw bad("插件不能指定来源身份或其他收件人");
        lockUsers(List.of(userId));
        Map<String,Object> target = targetMap(p.get("target"));
        if (!target.isEmpty() && (!"plugin".equals(target.get("kind")) || !pluginId.equals(target.get("pluginId"))))
            throw bad("插件通知只能打开本插件");
        if (target.containsKey("projectId")) throw bad("插件不能将本机项目编号作为云端项目权限");
        return view(publish("plugin."+pluginId,"插件消息（当前账号触发）","PLUGIN",userId,userId,null,
                required(p,"eventKey",160), optional(p,"kind","notification",40), required(p,"title",256),
                optional(p,"body","",4000), optional(p,"actionState","none",16),target));
    }

    /** Project-authorized third-party server SPI: all identities belong to this authoritative server. */
    @Transactional
    public List<Map<String,Object>> publishBusiness(String sourceId,String sourceName,Long senderId,List<Long> recipients,
            Long projectId,String eventKey,String kind,String title,String body,String actionState,Map<String,Object> target) {
        if (projectId == null || !realMember(projectId,senderId) || !permissions.hasWritePermission(projectId,senderId))
            throw bad("没有项目通知发送权限");
        if (recipients == null || recipients.isEmpty() || recipients.size()>100 || recipients.stream().anyMatch(Objects::isNull))
            throw bad("收件人无效");
        for (Long recipient : recipients) {
            if (!realMember(projectId,recipient) || !permissions.hasReadPermission(projectId,recipient))
                throw bad("收件人不是当前项目成员");
            if (permissions.isClient(projectId,recipient) || users.findById(recipient).map(u -> "CLIENT".equalsIgnoreCase(u.getRole())).orElse(true))
                throw bad("客户通知须由对应业务服务发送");
        }
        return publishAuthorizedBusiness(sourceId,sourceName,senderId,recipients,projectId,eventKey,kind,title,body,actionState,target);
    }

    /** Trusted domain services only: e.g. a law-firm workflow has already checked its authoritative firm roles. */
    @Transactional
    public List<Map<String,Object>> publishAuthorizedBusiness(String sourceId,String sourceName,Long senderId,List<Long> recipients,
            Long projectId,String eventKey,String kind,String title,String body,String actionState,Map<String,Object> target) {
        if (sourceId == null || !sourceId.matches("[a-z][a-z0-9-]{0,99}")) throw bad("业务来源无效");
        if (recipients == null || recipients.isEmpty() || recipients.size()>100 || recipients.stream().anyMatch(Objects::isNull))
            throw bad("收件人无效");
        List<Long> locks=new ArrayList<>(recipients); locks.add(senderId); lockUsers(locks);
        if (projectId == null) {
            MessageCenterAccessPolicy policy=policy(sourceId);
            if (policy == null || recipients.stream().anyMatch(u -> !policy.canAccess(u,eventKey))) throw bad("业务通知范围无法核验");
        }
        Map<String,Object> safeTarget=targetMap(target);
        List<Map<String,Object>> result=new ArrayList<>();
        for (Long recipient : new LinkedHashSet<>(recipients)) result.add(view(publish(sourceId,sourceName,"BUSINESS",senderId,
                recipient,projectId,eventKey,kind,title,body,actionState,safeTarget)));
        return result;
    }

    @Transactional
    public Map<String,Object> resolveOwn(String pluginId,Long userId,String eventKey,String state) {
        if (!Set.of("done","cancelled").contains(state)) throw bad("处理状态无效");
        lockUsers(List.of(userId));
        MessageCenterNotice row=notices.findByRecipientIdAndSourceIdAndEventKey(userId,"plugin."+pluginId(pluginId),eventKey)
                .orElseThrow(() -> bad("通知不存在"));
        row.setActionState(state); row.setUpdatedAt(Instant.now()); notices.save(row); return view(row);
    }

    @Transactional
    public void updateBusinessState(String sourceId,String eventKey,List<Long> recipients,String state) {
        if (!STATES.contains(state)) throw bad("处理状态无效");
        lockUsers(recipients);
        for (Long userId : recipients) notices.findByRecipientIdAndSourceIdAndEventKey(userId,sourceId,eventKey)
                .filter(n -> "BUSINESS".equals(n.getSourceKind())).ifPresent(n -> {
                    n.setActionState(state); n.setUpdatedAt(Instant.now()); notices.save(n);
                });
    }

    private MessageCenterNotice publish(String source,String sourceName,String sourceKind,Long sender,Long recipient,Long projectId,
            String eventKey,String kind,String title,String body,String state,Map<String,Object> target) {
        checked(sourceName,128,false); checked(eventKey,160,false); checked(kind,40,false);
        checked(title,256,false); checked(body,4000,true);
        if (!STATES.contains(state)) throw bad("处理状态无效");
        String targetJson=write(target);
        String hash=hash(write(Arrays.asList(sourceKind,sender,projectId,kind,title,body,state,target)));
        Optional<MessageCenterNotice> existing=notices.findByRecipientIdAndSourceIdAndEventKey(recipient,source,eventKey);
        if (existing.isPresent()) {
            if (!existing.get().getPayloadHash().equals(hash)) throw bad("通知重试标识已用于其他内容");
            return existing.get();
        }
        if ("PLUGIN".equals(sourceKind) && notices.countByRecipientIdAndSourceIdAndCreatedAtAfter(recipient,source,Instant.now().minusSeconds(60))>=60)
            throw bad("插件通知过于频繁，请稍后重试");
        MessageCenterNotice n=new MessageCenterNotice(); n.setId(UUID.randomUUID().toString());
        n.setRecipientId(recipient); n.setSenderId(sender); n.setProjectId(projectId); n.setSourceId(source);
        n.setSourceKind(sourceKind); n.setSourceName(sourceName); n.setEventKey(eventKey); n.setKind(kind);
        n.setTitle(title); n.setBody(body); n.setActionState(state); n.setTargetJson(targetJson); n.setPayloadHash(hash);
        n.setCreatedAt(Instant.now()); n.setUpdatedAt(n.getCreatedAt()); return notices.saveAndFlush(n);
    }

    public Map<String,Object> list(Long userId,int limit,boolean localOnly) {
        requireUser(userId); limit=Math.max(1,Math.min(200,limit));
        List<Map<String,Object>> items=new ArrayList<>(); List<String> errors=new ArrayList<>();
        long unread=0,pending=0; boolean hasMore=false;
        if (!localOnly) {
            List<MessageCenterNotice> rows=notices.findByRecipientIdOrderByCreatedAtDesc(userId,PageRequest.of(0,1000));
            List<MessageCenterNotice> visible=new ArrayList<>();
            Set<String> unavailable=new LinkedHashSet<>();
            for (MessageCenterNotice n:rows) {
                if (unavailable.contains(n.getSourceId())) continue;
                try { if (canAccess(n,userId)) visible.add(n); }
                catch (RuntimeException failure) { unavailable.add(n.getSourceId()); }
            }
            // One failed membership check makes this source incomplete, including earlier successful rows.
            visible.removeIf(n -> unavailable.contains(n.getSourceId()));
            errors.addAll(unavailable);
            unread=visible.stream().filter(n -> n.getReadAt()==null).count();
            pending=visible.stream().filter(n -> "pending".equals(n.getActionState())).count();
            visible.stream().limit(limit).forEach(n -> items.add(view(n)));
            hasMore=visible.size()>limit || rows.size()==1000;
        }
        for (MessageCenterSource source : sources.orderedStream().filter(s -> s.localOnly()==localOnly).toList()) {
            try {
                var snapshot=source.list(userId,limit);
                for (var entry : snapshot.items()) items.add(entryView(source,entry,localOnly));
                unread+=snapshot.unread(); pending+=snapshot.pending();
                for (String unavailable:snapshot.unavailableSources()) errors.add(source.id()+":"+unavailable);
                hasMore|=snapshot.hasMore() || snapshot.items().size()>=limit;
            } catch (RuntimeException failure) { errors.add(source.id()); }
        }
        items.sort(Comparator.comparing((Map<String,Object> n) -> Objects.toString(n.get("createdAt"),"")).reversed());
        Map<String,Object> result=new LinkedHashMap<>(); result.put("notifications",items);
        result.put("counts",Map.of("unreadNotifications",unread,"pending",pending));
        result.put("hasMore",hasMore); result.put("unavailableSources",errors); return result;
    }

    @Transactional
    public Map<String,Object> read(Long userId,String id,boolean localOnly) {
        requireUser(userId); requireUserIdFormat(id);
        if (id.startsWith("notice:") && !localOnly) {
            MessageCenterNotice n=own(userId,id.substring(7));
            if (n.getReadAt()==null) { n.setReadAt(Instant.now()); notices.save(n); }
        } else { Routed r=route(id,localOnly); r.source().markRead(userId,r.id()); }
        return Map.of("id",id,"read",true);
    }

    public Map<String,Object> target(Long userId,String id,boolean localOnly) {
        requireUser(userId); requireUserIdFormat(id);
        if (id.startsWith("notice:") && !localOnly) return parseTarget(own(userId,id.substring(7)).getTargetJson());
        Routed r=route(id,localOnly); return targetMap(r.source().target(userId,r.id()));
    }

    private record Routed(MessageCenterSource source,String id) {}
    private Routed route(String id,boolean localOnly) {
        requireUserIdFormat(id);
        String raw=localOnly && id.startsWith("local:") ? id.substring(6) : id;
        int separator=raw.indexOf(':'); if (separator<1) throw bad("通知不存在");
        String sourceId=raw.substring(0,separator);
        MessageCenterSource source=sources.orderedStream().filter(s -> s.localOnly()==localOnly && s.id().equals(sourceId))
                .findFirst().orElseThrow(() -> bad("通知来源不可用"));
        return new Routed(source,raw.substring(separator+1));
    }

    private MessageCenterNotice own(Long userId,String id) {
        requireUser(userId);
        MessageCenterNotice n=notices.findById(id).filter(row -> row.getRecipientId().equals(userId)).orElseThrow(() -> bad("通知不存在"));
        boolean allowed;
        try { allowed=canAccess(n,userId); }
        catch (RuntimeException failure) { throw new IllegalArgumentException("暂时无法核对通知权限，请稍后重试",failure); }
        if (!allowed) throw bad("通知已无访问权限"); return n;
    }
    private boolean canAccess(MessageCenterNotice n,Long userId) {
        if ("PLUGIN".equals(n.getSourceKind())) return true;
        MessageCenterAccessPolicy policy=policy(n.getSourceId());
        if (policy!=null) return policy.canAccess(userId,n.getEventKey());
        return n.getProjectId()!=null && realMember(n.getProjectId(),userId) && permissions.hasReadPermission(n.getProjectId(),userId)
                && !permissions.isClient(n.getProjectId(),userId)
                && users.findById(userId).map(u -> !"CLIENT".equalsIgnoreCase(u.getRole())).orElse(false);
    }
    private MessageCenterAccessPolicy policy(String sourceId) {
        return policies.orderedStream().filter(p -> p.sourceId().equals(sourceId)).findFirst().orElse(null);
    }
    private boolean realMember(Long projectId,Long userId) {
        return userId!=null && (members.findByProjectIdAndUserId(projectId,userId).isPresent()
                || projects.findById(projectId).map(p -> userId.equals(p.getUserId())).orElse(false));
    }
    private void requireUser(Long userId) { if (userId==null || !users.existsById(userId)) throw bad("请先登录"); }
    private void lockUsers(List<Long> ids) {
        if (ids==null || ids.stream().anyMatch(Objects::isNull)) throw bad("用户无效");
        ids.stream().distinct().sorted().forEach(id -> { if (users.lockStorageOwner(id).isEmpty()) throw bad("用户不存在"); });
    }
    private Map<String,Object> view(MessageCenterNotice n) {
        Map<String,Object> m=new LinkedHashMap<>(); m.put("id","notice:"+n.getId()); m.put("sourceId",n.getSourceId());
        m.put("sourceName",n.getSourceName()); m.put("sourceKind",n.getSourceKind()); m.put("kind",n.getKind());
        m.put("title",n.getTitle()); m.put("body",n.getBody()); m.put("projectId",n.getProjectId());
        if (n.getProjectId()!=null) {
            m.put("projectKey","project:"+n.getProjectId());
            m.put("projectName",projects.findById(n.getProjectId()).map(p -> p.getName()).orElse("项目"));
        }
        m.put("createdAt",n.getCreatedAt().toString()); m.put("readAt",n.getReadAt()==null?null:n.getReadAt().toString());
        m.put("read",n.getReadAt()!=null);
        m.put("actionState",n.getActionState()); m.put("target",parseTarget(n.getTargetJson())); return m;
    }
    private Map<String,Object> entryView(MessageCenterSource source,MessageCenterSource.Entry e,boolean localOnly) {
        Map<String,Object> m=json.convertValue(e,new TypeReference<Map<String,Object>>(){});
        m.put("id",(localOnly?"local:":"")+source.id()+":"+e.id()); m.put("sourceKind","BUSINESS");
        m.put("createdAt",e.createdAt()==null?null:e.createdAt().toString());
        m.put("readAt",e.readAt()==null?null:e.readAt().toString()); m.put("target",targetMap(e.target())); return m;
    }
    public Map<String,Object> targetMap(Object raw) {
        if (raw==null) return Map.of(); if (!(raw instanceof Map<?,?> input)) throw bad("通知目标无效");
        Map<String,Object> safe=new TreeMap<>();
        for (var e : input.entrySet()) {
            if (!(e.getKey() instanceof String key) || !TARGET_KEYS.contains(key)
                    || !(e.getValue() instanceof String || e.getValue() instanceof Number)) throw bad("通知目标包含不支持的字段");
            String value=String.valueOf(e.getValue()); if (value.length()>256 || value.contains("\n") || value.contains("\r")) throw bad("通知目标无效");
            if (Set.of("projectId","requestId","itemId").contains(key) && !value.matches("[1-9][0-9]{0,18}")) throw bad("通知目标编号无效");
            safe.put(key,e.getValue());
        }
        if (!safe.isEmpty() && !Set.of("plugin","im","dd-client","dd","agent","calendar").contains(safe.get("kind"))) throw bad("通知目标类型无效");
        if (safe.containsKey("pluginId")) pluginId(String.valueOf(safe.get("pluginId")));
        if (write(safe).length()>2048) throw bad("通知目标过长"); return safe;
    }
    private Map<String,Object> parseTarget(String s) {
        try { return targetMap(json.readValue(s,new TypeReference<Map<String,Object>>(){})); }
        catch (java.io.IOException e) { throw bad("通知目标不可用"); }
    }
    private String write(Object v) { try { return json.writeValueAsString(v); } catch (Exception e) { throw bad("通知格式无效"); } }
    public static String pluginId(String id) {
        if (id==null || !id.matches("[a-z][a-z0-9-]{0,63}") || Set.of("system","builtin","host","core").contains(id)) throw bad("插件标识无效");
        return id;
    }
    static String required(Map<String,Object> p,String key,int max) { return checked(p.get(key),max,false); }
    static String optional(Map<String,Object> p,String key,String fallback,int max) { return p.containsKey(key)?checked(p.get(key),max,true):fallback; }
    private static String checked(Object value,int max,boolean empty) {
        if (!(value instanceof String s) || s.length()>max || (!empty&&s.isBlank())) throw bad("通知字段无效或过长"); return s;
    }
    private static void requireUserIdFormat(String id) { if (id==null || id.length()>300) throw bad("通知编号无效"); }
    private static String hash(String s) { try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8))); } catch (Exception e) { throw new IllegalStateException(e); } }
    private static IllegalArgumentException bad(String s) { return new IllegalArgumentException(s); }
}
