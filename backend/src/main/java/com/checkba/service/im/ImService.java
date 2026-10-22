// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.im;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;

/** Server-owned messaging history. Project membership never grants conversation access. */
@Service
@lombok.RequiredArgsConstructor
public class ImService {
    public static final int MAX_FILE_BYTES = 8 * 1024 * 1024;
    public static final String FILE_UNAVAILABLE = "抱歉文件还在准备中，请联系您的律师。";
    static final long MAX_CONVERSATION_BYTES = 100L * 1024 * 1024;
    public static final Set<String> ACTIONS = Set.of("self", "list", "create", "invite", "join",
            "members", "removeMember", "leave", "messages", "send", "read", "upload", "download", "fileAccess",
            "agentScopes", "ensureAgent", "agentInfo", "agentReply");
    private final ImConversationRepository conversations;
    private final ImMemberRepository members;
    private final ImInvitationRepository invitations;
    private final ImMessageRepository messages;
    private final ImAttachmentRepository attachments;
    private final UserRepository users;
    @org.springframework.beans.factory.annotation.Autowired(required=false)
    private ImAgentService agents;

    /** The conversation row lock serializes membership, invitations, sends and quota accounting. */
    @Transactional(isolation = org.springframework.transaction.annotation.Isolation.READ_COMMITTED)
    public Object execute(Long userId, String action, Map<String, Object> params) {
        if (userId == null || !users.existsById(userId)) throw bad("请先登录");
        Map<String,Object> p = params == null ? Map.of() : params;
        if (!ACTIONS.contains(action)) throw bad("不支持的沟通操作");
        if ("self".equals(action)) return Map.of("id", userId, "displayName", displayName(userId));
        if ("agentScopes".equals(action)) return agentService().scopes(userId);
        if ("ensureAgent".equals(action)) {
            ImConversation c = agentService().ensure(userId, p);
            return view(c, requireMember(c.getId(), userId));
        }
        if ("list".equals(action)) {
            List<Map<String,Object>> rows = new ArrayList<>();
            for (ImMember member : members.findByUserId(userId)) {
                conversations.findById(member.getConversationId()).ifPresent(c -> {
                    try { authorizeAgent(c, userId); rows.add(view(c, member)); }
                    catch (IllegalArgumentException revoked) { /* Revoked scope membership is not a chat-list capability. */ }
                });
            }
            rows.sort(Comparator.comparing(r -> String.valueOf(r.get("lastMessageAt")), Comparator.reverseOrder()));
            return Map.of("conversations", rows);
        }
        if ("create".equals(action)) return create(userId, p);
        if ("join".equals(action)) return join(userId, p);
        ImConversation conversation = lock(required(p, "conversationId", 36));
        ImMember member = requireMember(conversation.getId(), userId);
        authorizeAgent(conversation, userId);
        return switch (action) {
            case "invite" -> invite(conversation, member, p);
            case "members" -> memberViews(conversation);
            case "agentInfo" -> view(conversation, member);
            case "agentReply" -> agentService().reply(conversation, userId, p);
            case "removeMember" -> remove(conversation, member, number(p, "userId", -1));
            case "leave" -> leave(conversation, member);
            case "messages" -> listMessages(conversation, member, p);
            case "send" -> send(conversation, member, p);
            case "read" -> markRead(conversation, member, p);
            case "upload" -> upload(conversation, member, p);
            case "download" -> download(conversation, member, p);
            case "fileAccess" -> fileAccess(conversation, member, p);
            default -> throw bad("不支持的沟通操作");
        };
    }

    private Object create(Long userId, Map<String,Object> p) {
        String type = required(p, "type", 16);
        if (!Set.of("GROUP", "DIRECT").contains(type)) throw bad("请选择私聊或群聊");
        ImConversation c = new ImConversation();
        c.setId(UUID.randomUUID().toString()); c.setTitle(required(p, "title", 128));
        c.setType(type); c.setOwnerId(userId); c.setCreatedAt(Instant.now());
        c.setLastMessageAt(c.getCreatedAt()); conversations.save(c);
        return view(c, addMember(c.getId(), userId, "OWNER"));
    }

    private Object invite(ImConversation c, ImMember me, Map<String,Object> p) {
        requireOwner(me);
        ImAgentService.requireInvitable(c);
        if ("DIRECT".equals(c.getType()) && members.countByConversationId(c.getId()) >= 2) throw bad("私聊已有两位参与人");
        String role = required(p, "role", 16);
        if (!Set.of("MEMBER", "CLIENT").contains(role)) throw bad("邀请角色无效");
        // A fresh invitation replaces outstanding codes, limiting stale invitations and storage growth.
        invitations.deleteByConversationIdAndIssuedBy(c.getId(), me.getUserId());
        byte[] entropy = new byte[24]; new SecureRandom().nextBytes(entropy);
        String code = Base64.getUrlEncoder().withoutPadding().encodeToString(entropy);
        ImInvitation invite = new ImInvitation(); invite.setTokenHash(sha(code.getBytes(StandardCharsets.UTF_8)));
        invite.setConversationId(c.getId()); invite.setRole(role); invite.setIssuedBy(me.getUserId());
        invite.setExpiresAt(Instant.now().plus(24, ChronoUnit.HOURS)); invitations.save(invite);
        return Map.of("code", code, "expiresAt", invite.getExpiresAt());
    }

    private Object join(Long userId, Map<String,Object> p) {
        String hash = sha(required(p, "code", 64).getBytes(StandardCharsets.UTF_8));
        String conversationId = invitations.conversationIdForHash(hash).orElseThrow(() -> bad("邀请码无效或已过期"));
        ImConversation c = lock(conversationId);
        ImAgentService.requireInvitable(c);
        // Reload under the conversation lock: two redeemers cannot both consume a code.
        ImInvitation invite = invitations.findById(hash).orElseThrow(() -> bad("邀请码无效或已过期"));
        if (invite.getUsedAt() != null || !invite.getExpiresAt().isAfter(Instant.now())) throw bad("邀请码无效或已过期");
        ImMember issuer = requireMember(c.getId(), invite.getIssuedBy()); requireOwner(issuer);
        if (members.findByConversationIdAndUserId(c.getId(), userId).isPresent()) throw bad("你已在此会话中");
        long size = members.countByConversationId(c.getId());
        if (size >= ("DIRECT".equals(c.getType()) ? 2 : 100)) throw bad("会话人数已满");
        invite.setUsedAt(Instant.now()); invitations.save(invite);
        return view(c, addMember(c.getId(), userId, invite.getRole()));
    }

    private Object remove(ImConversation c, ImMember me, long targetId) {
        requireOwner(me);
        ImMember target = requireMember(c.getId(), targetId);
        if ("OWNER".equals(target.getRole())) throw bad("不能移除会话负责人");
        members.delete(target);
        return Map.of("removed", true);
    }

    private Object leave(ImConversation c, ImMember me) {
        if (c.getAgentScope() != null && (Boolean.TRUE.equals(c.getAgentPrivate())
                || ("project".equals(c.getAgentScope()) && "OWNER".equals(me.getRole()))))
            throw bad("此助手会话需要保留，可关闭面板后随时重新打开");
        if ("OWNER".equals(me.getRole()) && members.countByConversationId(c.getId()) > 1) throw bad("请先移除其他成员，再退出会话");
        invitations.deleteByConversationIdAndIssuedBy(c.getId(), me.getUserId());
        members.delete(me);
        return Map.of("left", true);
    }

    private Object listMessages(ImConversation c, ImMember me, Map<String,Object> p) {
        int limit = (int)Math.max(1, Math.min(100, number(p, "limit", 50)));
        long after = number(p, "afterId", 0), before = number(p, "beforeId", Long.MAX_VALUE);
        if (after < 0 || before < 1 || (p.containsKey("afterId") && p.containsKey("beforeId"))) throw bad("消息分页参数无效");
        var page = p.containsKey("afterId")
                ? messages.findByConversationIdAndIdGreaterThanOrderByIdAsc(c.getId(), after, PageRequest.of(0, limit))
                : messages.findByConversationIdAndIdLessThanOrderByIdDesc(c.getId(), before, PageRequest.of(0, limit));
        List<ImMessage> rows = new ArrayList<>(page.getContent());
        rows.sort(Comparator.comparing(ImMessage::getId));
        Map<String,Object> result = new LinkedHashMap<>();
        result.put("messages", rows.stream().map(m -> messageView(m, me)).toList()); result.put("hasMore", page.hasNext());
        result.put("agentStatus", c.getAgentScope() == null ? null : agentService().status(c.getId()));
        return result;
    }

    private Object send(ImConversation c, ImMember me, Map<String,Object> p) {
        String clientId = required(p, "clientMessageId", 100);
        String text = string(p, "text");
        if (text.length() > 8000) throw bad("消息最多8000字");
        String attachmentId = string(p, "attachmentId");
        if (text.isBlank() && attachmentId.isBlank()) throw bad("请输入消息或选择文件");
        var existing = messages.findByConversationIdAndSenderIdAndClientMessageId(c.getId(), me.getUserId(), clientId);
        if (existing.isPresent()) {
            ImMessage old = existing.get();
            if (!old.getText().equals(text) || !Objects.equals(old.getAttachmentId(), attachmentId.isBlank() ? null : attachmentId))
                throw bad("消息重试标识已用于其他内容");
            return messageView(old, me);
        }
        if (!attachmentId.isBlank()) {
            ImAttachment file = requireAttachment(c.getId(), attachmentId);
            if (!file.getUploadedBy().equals(me.getUserId())) throw bad("只能发送自己上传的文件");
        }
        ImMessage message = new ImMessage(); message.setUid(UUID.randomUUID().toString());
        message.setConversationId(c.getId()); message.setSenderId(me.getUserId()); message.setClientMessageId(clientId);
        message.setActorType("HUMAN");
        message.setText(text); message.setAttachmentId(attachmentId.isBlank() ? null : attachmentId);
        message.setCreatedAt(Instant.now()); messages.saveAndFlush(message);
        c.setLastMessageAt(message.getCreatedAt()); conversations.save(c);
        return messageView(message, me);
    }

    private Object markRead(ImConversation c, ImMember me, Map<String,Object> p) {
        long id = number(p, "lastReadId", 0);
        if (id != 0) {
            ImMessage message = messages.findById(id).orElseThrow(() -> bad("消息不存在"));
            if (!c.getId().equals(message.getConversationId())) throw bad("无权访问该消息");
        }
        me.setLastReadId(Math.max(me.getLastReadId(), id)); members.save(me);
        return Map.of("lastReadId", me.getLastReadId());
    }

    private Object upload(ImConversation c, ImMember me, Map<String,Object> p) {
        String encoded = string(p, "base64");
        if (encoded.length() > ((MAX_FILE_BYTES + 2L) / 3) * 4) throw bad("文件不能超过8MiB");
        byte[] bytes;
        try { bytes = Base64.getDecoder().decode(encoded); }
        catch (IllegalArgumentException e) { throw bad("文件编码无效"); }
        if (bytes.length == 0 || bytes.length > MAX_FILE_BYTES) throw bad("文件不能为空且不能超过8MiB");
        String name = safeName(required(p, "name", 500)), digest = sha(bytes);
        String projectUid = null, fileUid = null;
        if (p.get("source") != null) {
            if (!(p.get("source") instanceof Map<?,?> source)) throw bad("文件来源格式无效");
            projectUid = sourceUid(source.get("projectUid")); fileUid = sourceUid(source.get("fileUid"));
        }
        String clientId = p.containsKey("clientMessageId") ? required(p, "clientMessageId", 100) : null;
        if (clientId != null) {
            var existing = attachments.findByConversationIdAndUploadedByAndClientMessageId(c.getId(), me.getUserId(), clientId);
            if (existing.isPresent()) {
                ImAttachment old = existing.get();
                if (!old.getSha256().equals(digest) || !old.getName().equals(name)
                        || !Objects.equals(old.getSourceProjectUid(), projectUid) || !Objects.equals(old.getSourceFileUid(), fileUid))
                    throw bad("文件重试标识已用于其他内容");
                return attachmentView(old, me);
            }
        }
        if (attachments.totalSize(c.getId()) + bytes.length > MAX_CONVERSATION_BYTES) throw bad("本会话文件空间已满（100MiB）");
        ImAttachment file = new ImAttachment(); file.setId(UUID.randomUUID().toString());
        file.setConversationId(c.getId()); file.setUploadedBy(me.getUserId()); file.setClientMessageId(clientId);
        file.setName(name); file.setSize(bytes.length);
        file.setSourceProjectUid(projectUid); file.setSourceFileUid(fileUid);
        file.setSha256(digest); file.setContent(bytes); file.setCreatedAt(Instant.now()); attachments.save(file);
        return attachmentView(file, me);
    }

    private Object download(ImConversation c, ImMember me, Map<String,Object> p) {
        String attachmentId = required(p, "attachmentId", 36);
        var metadata = attachments.metadata(attachmentId, c.getId());
        if (metadata.isEmpty() || !canRead(me, (Long)metadata.get(0)[4], Boolean.TRUE.equals(metadata.get(0)[5])))
            throw bad(FILE_UNAVAILABLE);
        ImAttachment file = requireAttachment(c.getId(), attachmentId);
        Map<String,Object> result = new LinkedHashMap<>(attachmentView(file, me));
        result.put("base64", Base64.getEncoder().encodeToString(file.getContent()));
        return result;
    }

    private Object fileAccess(ImConversation c, ImMember me, Map<String,Object> p) {
        if (!(p.get("clientVisible") instanceof Boolean visible)) throw bad("clientVisible必须为布尔值");
        ImAttachment file = requireAttachment(c.getId(), required(p, "attachmentId", 36));
        if (!canManage(me, file.getUploadedBy())) throw bad(FILE_UNAVAILABLE);
        file.setClientVisible(visible); attachments.save(file);
        return attachmentView(file, me);
    }

    private ImAgentService agentService() {
        if (agents == null) throw bad("当前服务尚未开通沟通助手");
        return agents;
    }
    private void authorizeAgent(ImConversation conversation, Long userId) {
        if (conversation.getAgentScope() != null) agentService().authorize(conversation, userId);
    }
    private Map<String,Object> memberViews(ImConversation conversation) {
        List<Map<String,Object>> rows = new ArrayList<>();
        for (ImMember member : members.findByConversationId(conversation.getId())) {
            rows.add(Map.of("id", member.getUserId(), "displayName", displayName(member.getUserId()), "role", member.getRole(), "actorType", "HUMAN"));
        }
        int humanCount = rows.size();
        if (conversation.getAgentScope() != null) rows.add(Map.of("id", "agent:" + conversation.getId(), "displayName", conversation.getAgentName(), "role", "AGENT", "actorType", "AGENT"));
        return Map.of("members", rows, "humanCount", humanCount);
    }

    private ImConversation lock(String id) { return conversations.lockById(id).orElseThrow(() -> bad("会话不存在或无权访问")); }
    private ImMember requireMember(String id, Long userId) { return members.findByConversationIdAndUserId(id, userId).orElseThrow(() -> bad("会话不存在或无权访问")); }
    private void requireOwner(ImMember member) { if (!"OWNER".equals(member.getRole())) throw bad("只有会话负责人可以执行此操作"); }
    private ImAttachment requireAttachment(String conversationId, String id) {
        ImAttachment file = attachments.findById(id).orElseThrow(() -> bad("文件不存在或无权访问"));
        if (!conversationId.equals(file.getConversationId())) throw bad("文件不存在或无权访问");
        return file;
    }
    private ImMember addMember(String id, Long userId, String role) {
        ImMember member = new ImMember(); member.setConversationId(id); member.setUserId(userId);
        member.setRole(role); member.setJoinedAt(Instant.now()); return members.save(member);
    }
    private Map<String,Object> view(ImConversation c, ImMember member) {
        Map<String,Object> result = new LinkedHashMap<>(Map.of("id", c.getId(), "title", c.getTitle(), "type", c.getType(), "role", member.getRole(),
                "createdAt", c.getCreatedAt(), "lastMessageAt", c.getLastMessageAt(), "lastReadId", member.getLastReadId(),
                "unreadCount", messages.countByConversationIdAndIdGreaterThanAndSenderIdNot(c.getId(), member.getLastReadId(), member.getUserId())));
        if (c.getAgentScope() != null) result.put("agent", ImAgentService.agentView(c));
        return result;
    }
    private Map<String,Object> messageView(ImMessage m, ImMember me) {
        Map<String,Object> result = new LinkedHashMap<>(); result.put("id", m.getId()); result.put("uid", m.getUid());
        result.put("clientMessageId", m.getClientMessageId()); result.put("senderId", m.getSenderId());
        boolean agent = "AGENT".equals(m.getActorType()); result.put("actorType", agent ? "AGENT" : "HUMAN");
        result.put("senderName", agent ? m.getAgentName() : displayName(m.getSenderId()));
        if (agent) result.put("agentName", m.getAgentName());
        result.put("text", m.getText()); result.put("createdAt", m.getCreatedAt());
        if (m.getAttachmentId() != null) {
            // Fetch only metadata: a page of 100 messages must not hydrate 100 attachment blobs.
            var metadata = attachments.metadata(m.getAttachmentId(), m.getConversationId());
            if (!metadata.isEmpty()) {
                Object[] a = metadata.get(0);
                result.put("attachment", attachmentView((String)a[0], (String)a[1], ((Number)a[2]).longValue(),
                        (String)a[3], (Long)a[4], Boolean.TRUE.equals(a[5]), (String)a[6], (String)a[7], me));
            }
        }
        return result;
    }
    private Map<String,Object> attachmentView(ImAttachment a, ImMember me) {
        return attachmentView(a.getId(), a.getName(), a.getSize(), a.getSha256(), a.getUploadedBy(), a.isClientVisible(),
                a.getSourceProjectUid(), a.getSourceFileUid(), me);
    }
    private Map<String,Object> attachmentView(String id, String name, long size, String sha256, Long uploadedBy,
                                               boolean clientVisible, String projectUid, String fileUid, ImMember me) {
        if (!canRead(me, uploadedBy, clientVisible)) return Map.of("id", id, "available", false, "message", FILE_UNAVAILABLE);
        Map<String,Object> result = new LinkedHashMap<>(); result.put("id", id); result.put("name", name);
        result.put("size", size); result.put("sha256", sha256); result.put("available", true);
        result.put("clientVisible", clientVisible); result.put("canManageAccess", canManage(me, uploadedBy));
        if (projectUid != null && fileUid != null) result.put("source", Map.of("projectUid", projectUid, "fileUid", fileUid));
        return result;
    }
    private boolean client(ImMember me) {
        return "CLIENT".equals(me.getRole()) || users.findById(me.getUserId()).map(User::getRole).filter("CLIENT"::equals).isPresent();
    }
    private boolean canRead(ImMember me, Long uploadedBy, boolean clientVisible) {
        return !client(me) || me.getUserId().equals(uploadedBy) || clientVisible;
    }
    private boolean canManage(ImMember me, Long uploadedBy) {
        return !client(me) && ("OWNER".equals(me.getRole()) || me.getUserId().equals(uploadedBy));
    }
    private static String sourceUid(Object value) {
        if (!(value instanceof String raw) || !raw.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"))
            throw bad("文件来源编号无效");
        return UUID.fromString(raw).toString();
    }
    private String displayName(Long userId) { return users.findById(userId).map(User::getDisplayName).filter(s -> !s.isBlank()).orElse("用户"); }
    static String safeName(String name) {
        String clean = name.replace('\\', '/'); clean = clean.substring(clean.lastIndexOf('/') + 1);
        clean = clean.replaceAll("[\\p{Cntrl}<>:\"|?*]", "_").replaceAll("^[. ]+|[. ]+$", "");
        if (clean.isBlank()) throw bad("文件名无效");
        return clean.substring(0, Math.min(180, clean.length()));
    }
    public static String sha(byte[] content) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content)); }
        catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
    public static String string(Map<String,Object> p, String key) { Object value = p.get(key); return value instanceof String s ? s : ""; }
    private static String required(Map<String,Object> p, String key, int max) {
        String value = string(p, key).trim(); if (value.isEmpty() || value.length() > max) throw bad("参数无效：" + key); return value;
    }
    private static long number(Map<String,Object> p, String key, long fallback) {
        Object value = p.get(key); if (value == null) return fallback;
        if (value instanceof Number n && Double.isFinite(n.doubleValue()) && n.doubleValue() == n.longValue()) return n.longValue();
        throw bad("参数无效：" + key);
    }
    private static IllegalArgumentException bad(String message) { return new IllegalArgumentException(message); }
}
