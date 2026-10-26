// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.messagecenter;

import com.checkba.service.account.AccountService;
import com.checkba.service.ProjectMemberService;
import com.checkba.repository.ProjectRemoteRepository;
import com.checkba.service.im.*;
import com.checkba.version.OfficialCloudService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.*;

/** Account-level cloud mailbox with separately authenticated, local customer connections. */
@Service
public class MessageCenterGateway {
    private final boolean local;
    private final MessageCenterService service;
    private final ImGatewayService im;
    private final OfficialCloudService cloud;
    private final AccountService account;
    private final ObjectProvider<MessageCenterSource> sources;
    private final ObjectProvider<ImProjectActionHandler> projectHandlers;
    private final ObjectMapper json;
    private final ProjectRemoteRepository projectRemotes;
    private final ProjectMemberService projectMembers;
    private final HttpClient http=HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER)
            .connectTimeout(Duration.ofSeconds(10)).build();

    public MessageCenterGateway(@Value("${security.local-mode:false}") boolean local,MessageCenterService service,
            ImGatewayService im,OfficialCloudService cloud,AccountService account,ObjectProvider<MessageCenterSource> sources,
            ObjectProvider<ImProjectActionHandler> projectHandlers,ObjectMapper json,
            ProjectRemoteRepository projectRemotes,ProjectMemberService projectMembers) {
        this.local=local; this.service=service; this.im=im; this.cloud=cloud; this.account=account;
        this.sources=sources; this.projectHandlers=projectHandlers; this.json=json;
        this.projectRemotes=projectRemotes; this.projectMembers=projectMembers;
    }

    public Object execute(Long userId,String action,Map<String,Object> p,Long projectId) {
        if (userId==null) throw bad("请先登录");
        return switch(action) {
            case "list" -> list(userId,p);
            case "counts" -> {
                Map<String,Object> snapshot=list(userId,Map.of("limit",200));
                Map<String,Object> counts=new LinkedHashMap<>(map(snapshot.get("counts")));
                List<?> unavailable=snapshot.get("unavailableSources") instanceof List<?> rows?rows:List.of();
                counts.put("partial",Boolean.TRUE.equals(snapshot.get("hasMore")) || !unavailable.isEmpty()
                        || "unavailable".equals(snapshot.get("cloudStatus")));
                counts.put("unavailableSources",unavailable);
                for (String key:List.of("cloudStatus","cloudError")) if (snapshot.containsKey(key)) counts.put(key,snapshot.get(key));
                yield counts;
            }
            case "read","target" -> {
                String id=MessageCenterService.required(p,"id",300);
                if (local && id.startsWith("local:")) {
                    String scope=account.accountFingerprintOrNull();
                    Object result="read".equals(action)?service.read(userId,id,true):service.target(userId,id,true);
                    assertAccount(scope); yield result;
                }
                if (local) {
                    String scope=im.captureAccountScope();
                    Object response=remote(userId,action,p);
                    Object result="target".equals(action)?localTarget(userId,map(response),true):response;
                    im.assertAccountScope(scope); yield result;
                }
                yield "read".equals(action)?service.read(userId,id,false):service.target(userId,id,false);
            }
            case "im" -> im(userId,p,projectId);
            case "ddClientIm" -> {
                if (!local) throw bad(com.checkba.service.LangText.of("请在已连接客户项目的桌面端打开", "Please open in the desktop app connected to the client project"));
                MessageCenterSource source=sources.orderedStream().filter(s -> s.localOnly() && "dd-client".equals(s.id()))
                        .findFirst().orElseThrow(() -> bad(com.checkba.service.LangText.of("客户项目连接不可用", "Client project connection is unavailable")));
                String scope=account.accountFingerprintOrNull();
                Map<String,Object> params=new LinkedHashMap<>(map(p.get("params")));
                params.put("connectionId",MessageCenterService.required(p,"connectionId",160));
                Object result=source.im(userId,MessageCenterService.required(p,"action",40),params);
                assertAccount(scope); yield result;
            }
            // The local endpoint does not expose these paths. Cloud recipients remain the authenticated account only.
            case "pluginPublish" -> { if (local) throw bad(com.checkba.service.LangText.of("请通过插件通知接口发布", "Please publish through the plugin notification endpoint"));
                yield service.publishToSelf(MessageCenterService.required(p,"pluginId",64),userId,map(p.get("notification"))); }
            case "pluginResolve" -> { if (local) throw bad(com.checkba.service.LangText.of("请通过插件通知接口更新", "Please update through the plugin notification endpoint"));
                yield service.resolveOwn(MessageCenterService.required(p,"pluginId",64),userId,
                        MessageCenterService.required(p,"eventKey",160),MessageCenterService.optional(p,"state","done",16)); }
            default -> throw bad(com.checkba.service.LangText.of("不支持的消息中心操作", "Unsupported Message Center action"));
        };
    }

    public Object publishPlugin(Long userId,String pluginId,Map<String,Object> notification) {
        MessageCenterService.pluginId(pluginId);
        return local?remote(userId,"pluginPublish",Map.of("pluginId",pluginId,"notification",notification))
                :service.publishToSelf(pluginId,userId,notification);
    }
    public Object resolvePlugin(Long userId,String pluginId,String eventKey,String state) {
        MessageCenterService.pluginId(pluginId);
        return local?remote(userId,"pluginResolve",Map.of("pluginId",pluginId,"eventKey",eventKey,"state",state))
                :service.resolveOwn(pluginId,userId,eventKey,state);
    }

    private Object im(Long userId,Map<String,Object> p,Long projectId) {
        String action=MessageCenterService.required(p,"action",40);
        Map<String,Object> params=new LinkedHashMap<>(map(p.get("params")));
        if (local) {
            // Client-supplied material is never accepted as project context by the core host either.
            params.remove("projectContext");
            if ("projectGroup".equals(action)) {
                if (projectId==null || !projectMembers.hasReadPermission(projectId,userId)) throw bad(com.checkba.service.LangText.of("没有当前项目的访问权限", "You do not have access to the current project"));
                String scope=im.captureAccountScope(); var connection=cloud.connectOfficial(userId);
                if (!userId.equals(connection.getUserId()) || !scope.equals(connection.getAccountFingerprint())) throw bad(com.checkba.service.LangText.of("账户已变化，请重新打开消息中心", "Account has changed; please reopen the Message Center"));
                var remote=projectRemotes.findByProjectId(projectId).filter(r -> connection.getId().equals(r.getConnectionId()))
                        .orElseThrow(() -> bad(com.checkba.service.LangText.of("先将项目放入官方案件库后再创建项目群", "Please sync the project to the official case library before creating a project group")));
                String remoteId=remote.getRemoteProjectId();
                if (remoteId==null || !remoteId.matches("[1-9][0-9]{0,18}")) throw bad(com.checkba.service.LangText.of("案件库项目标识无效", "Invalid case library project ID"));
                try { params.put("projectId",Long.parseLong(remoteId)); }
                catch (NumberFormatException e) { throw bad(com.checkba.service.LangText.of("案件库项目标识无效", "Invalid case library project ID")); }
                Map<String,Object> result=new LinkedHashMap<>(map(im.executeWithinScope(userId,scope,action,params)));
                result.put("localProjectId",projectId); im.assertAccountScope(scope); return result;
            }
            if (projectId!=null) for (var handler : projectHandlers) if (handler.supports(action))
                return handler.execute(userId,projectId,action,params);
            if ("ensureAgent".equals(action) && "project".equals(params.get("scope"))) throw bad(com.checkba.service.LangText.of("请先打开助手所属项目", "Please open the project this assistant belongs to first"));
            if ("agentReply".equals(action)) {
                Map<String,Object> info=map(im.execute(userId,"agentInfo",Map.of("conversationId",params.get("conversationId"))));
                Map<String,Object> agent=map(info.get("agent"));
                if (Boolean.TRUE.equals(agent.get("private")) && "project".equals(agent.get("scope"))) throw bad(com.checkba.service.LangText.of("请先打开助手所属项目", "Please open the project this assistant belongs to first"));
            }
        }
        return im.execute(userId,action,params);
    }

    private Map<String,Object> list(Long userId,Map<String,Object> p) {
        int limit=p.get("limit") instanceof Number n?Math.max(1,Math.min(200,n.intValue())):100;
        String scope=local?account.accountFingerprintOrNull():null;
        Map<String,Object> result;
        List<Map<String,Object>> conversations=new ArrayList<>();
        if (local) {
            result=new LinkedHashMap<>(service.list(userId,limit,true));
            try {
                Map<String,Object> remote=map(remote(userId,"list",Map.of("limit",limit)));
                localize(userId,remote);
                merge(result,remote); conversations.addAll(rows(remote.get("conversations")));
                result.put("cloudStatus","connected");
            } catch (IllegalArgumentException unavailable) {
                result.put("cloudStatus","unavailable"); result.put("cloudError",unavailable.getMessage());
            }
        } else {
            result=new LinkedHashMap<>(service.list(userId,limit,false));
            conversations.addAll(rows(map(im.execute(userId,"list",Map.of())).get("conversations")));
        }
        for (var source:sources.orderedStream().filter(s -> s.localOnly()==local).toList()) {
            try {
                var snapshot=source.conversationSnapshot(userId); conversations.addAll(snapshot.items());
                List<String> unavailable=new ArrayList<>((List<String>)result.get("unavailableSources"));
                for (String failed:snapshot.unavailableSources()) unavailable.add(source.id()+":"+failed);
                result.put("unavailableSources",unavailable);
            }
            catch (RuntimeException e) { List<String> unavailable=new ArrayList<>((List<String>)result.get("unavailableSources")); unavailable.add(source.id()); result.put("unavailableSources",unavailable); }
        }
        result.put("conversations",conversations);
        Map<String,Object> counts=new LinkedHashMap<>(map(result.get("counts")));
        counts.put("unreadMessages",conversations.stream().mapToLong(c -> number(c.get("unreadCount"))).sum()); result.put("counts",counts);
        List<Map<String,Object>> notifications=rows(result.get("notifications"));
        notifications.sort(Comparator.comparing((Map<String,Object> n) -> Objects.toString(n.get("createdAt"),"")).reversed());
        result.put("notifications",notifications); result.put("projects",projectChoices(notifications,conversations));
        if (p.get("projectKey") instanceof String projectKey && !projectKey.isBlank()) {
            if (projectKey.length()>256) throw bad(com.checkba.service.LangText.of("项目筛选无效", "Invalid project filter"));
            List<Map<String,Object>> filteredNotices=notifications.stream().filter(n -> projectKey.equals(n.get("projectKey"))).toList();
            List<Map<String,Object>> filteredConversations=conversations.stream().filter(c -> projectKey.equals(c.get("projectKey"))).toList();
            result.put("notifications",filteredNotices); result.put("conversations",filteredConversations);
            result.put("counts",Map.of("unreadNotifications",filteredNotices.stream().filter(n -> !isRead(n)).count(),
                    "pending",filteredNotices.stream().filter(n -> "pending".equals(n.get("actionState"))).count(),
                    "unreadMessages",filteredConversations.stream().mapToLong(c -> number(c.get("unreadCount"))).sum()));
        }
        if (local) assertAccount(scope); return result;
    }

    private static List<Map<String,Object>> projectChoices(List<Map<String,Object>> notices,List<Map<String,Object>> conversations) {
        Map<String,Map<String,Object>> projects=new LinkedHashMap<>();
        List<Map<String,Object>> all=new ArrayList<>(notices); all.addAll(conversations);
        for (var n:all) {
            Object key=n.get("projectKey"); if (key==null && n.get("projectId")!=null) key="project:"+n.get("projectId");
            if (key==null) continue; Map<String,Object> entry=new LinkedHashMap<>();
            entry.put("key",key); entry.put("id",n.get("projectId"));
            entry.put("name",n.get("projectName")==null?com.checkba.service.LangText.of("项目 ", "Project ")+n.get("projectId"):n.get("projectName")); projects.put(String.valueOf(key),entry);
        }
        return new ArrayList<>(projects.values());
    }
    /** Cloud numeric project IDs never become local navigation IDs by coincidence. */
    private void localize(Long userId,Map<String,Object> result) {
        List<Map<String,Object>> all=new ArrayList<>(rows(result.get("notifications")));
        all.addAll(rows(result.get("conversations")));
        for (Map<String,Object> row:all) {
            Object remoteId=row.get("projectId");
            if (remoteId!=null) {
                row.put("projectKey","cloud:"+remoteId); row.put("remoteProjectId",remoteId);
                Long localId=localProject(userId,String.valueOf(remoteId)); row.put("projectId",localId); row.put("localProjectId",localId);
            }
            if (row.get("target") instanceof Map<?,?> target) row.put("target",localTarget(userId,map(target),false));
        }
    }
    private Map<String,Object> localTarget(Long userId,Map<String,Object> target,boolean opening) {
        Map<String,Object> result=new LinkedHashMap<>(target);
        if (target.get("projectId")!=null) {
            Object remoteId=target.get("projectId"); Long localId=localProject(userId,String.valueOf(remoteId));
            result.put("projectKey","cloud:"+remoteId);
            if (localId==null) {
                if (opening) throw bad(com.checkba.service.LangText.of("请先从案件库取回此项目，再打开该事项", "Please pull this project from the case library first before opening this item"));
                result.remove("projectId");
            } else result.put("projectId",localId);
        }
        return result;
    }
    private Long localProject(Long userId,String remoteId) {
        var connection=cloud.connectOfficial(userId);
        if (!userId.equals(connection.getUserId()) || !Objects.equals(connection.getAccountFingerprint(),account.accountFingerprintOrNull()))
            throw bad(com.checkba.service.LangText.of("账户已变化，请重新打开消息中心", "Account has changed; please reopen the Message Center"));
        return projectRemotes.findByConnectionIdAndRemoteProjectId(connection.getId(),remoteId)
                .filter(r -> projectMembers.hasReadPermission(r.getProjectId(),userId)).map(r -> r.getProjectId()).orElse(null);
    }
    private static void merge(Map<String,Object> into,Map<String,Object> from) {
        List<Map<String,Object>> merged=rows(into.get("notifications")); merged.addAll(rows(from.get("notifications"))); into.put("notifications",merged);
        Map<String,Object> counts=new LinkedHashMap<>();
        for (String key:List.of("unreadNotifications","pending")) counts.put(key,number(map(into.get("counts")).get(key))+number(map(from.get("counts")).get(key)));
        into.put("counts",counts); into.put("hasMore",Boolean.TRUE.equals(into.get("hasMore"))||Boolean.TRUE.equals(from.get("hasMore")));
        List<Object> errors=new ArrayList<>((List<?>)into.get("unavailableSources"));
        if (from.get("unavailableSources") instanceof List<?> list) errors.addAll(list); into.put("unavailableSources",errors);
    }

    protected Object remote(Long userId,String action,Map<String,Object> params) {
        String scope=im.captureAccountScope(); var connection=cloud.connectOfficial(userId);
        if (!scope.equals(connection.getAccountFingerprint())) throw bad(com.checkba.service.LangText.of("账户已变化，请重新打开消息中心", "Account has changed; please reopen the Message Center"));
        try {
            byte[] payload=json.writeValueAsBytes(Map.of("action",action,"params",params));
            if (payload.length>65536) throw bad(com.checkba.service.LangText.of("通知请求过大", "Notification request too large"));
            HttpRequest request=HttpRequest.newBuilder(URI.create(connection.getServerUrl()+"/api/message-center/action"))
                    .timeout(Duration.ofSeconds(30)).header("Content-Type","application/json")
                    .header("X-Session-Id",connection.getDeviceToken()).POST(HttpRequest.BodyPublishers.ofByteArray(payload)).build();
            HttpResponse<java.io.InputStream> response=http.send(request,HttpResponse.BodyHandlers.ofInputStream());
            byte[] bytes;
            try (var body=new com.checkba.util.DeadlineInputStream(response.body(),Duration.ofSeconds(30))) { bytes=body.readNBytes(4*1024*1024+1); }
            im.assertAccountScope(scope);
            if (response.statusCode()==401) throw bad(com.checkba.service.LangText.of("云端账户凭据已失效，请重新连接账户", "Cloud account credentials have expired; please reconnect your account"));
            if (response.statusCode()==404) throw bad(com.checkba.service.LangText.of("云端尚未开通消息中心", "Cloud Message Center is not enabled yet"));
            if (response.statusCode()!=200 || bytes.length>4*1024*1024) throw bad(com.checkba.service.LangText.of("云端消息中心暂不可用", "Cloud Message Center is temporarily unavailable"));
            Map<String,Object> body=json.readValue(bytes,new TypeReference<>(){});
            if (!(body.get("code") instanceof Number code) || code.intValue()!=0)
                throw bad(body.get("message") instanceof String message?message:com.checkba.service.LangText.of("消息中心操作失败", "Message Center action failed"));
            return body.get("data");
        } catch (InterruptedException e) { Thread.currentThread().interrupt(); throw bad(com.checkba.service.LangText.of("消息请求已取消", "Message request was cancelled")); }
        catch (java.io.IOException e) { throw bad(com.checkba.service.LangText.of("云端消息中心暂时无法连接", "Cloud Message Center is temporarily unreachable")); }
    }
    private void assertAccount(String scope) { if (!Objects.equals(scope,account.accountFingerprintOrNull())) throw bad(com.checkba.service.LangText.of("账户已变化，请重新打开消息中心", "Account has changed; please reopen the Message Center")); }
    @SuppressWarnings("unchecked") public static Map<String,Object> map(Object value) {
        if (value==null) return Map.of(); if (!(value instanceof Map<?,?>)) throw bad(com.checkba.service.LangText.of("消息请求格式无效", "Invalid message request format")); return (Map<String,Object>)value;
    }
    @SuppressWarnings("unchecked") private static List<Map<String,Object>> rows(Object value) { return value instanceof List<?> list?new ArrayList<>((List<Map<String,Object>>)list):new ArrayList<>(); }
    private static long number(Object value) { return value instanceof Number n?n.longValue():0; }
    private static boolean isRead(Map<String,Object> row) { return row.get("read") instanceof Boolean read?read:row.get("readAt")!=null; }
    private static IllegalArgumentException bad(String s) { return new IllegalArgumentException(s); }
}
