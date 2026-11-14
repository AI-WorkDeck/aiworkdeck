// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.im;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

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
    /**
     * Client uploads (scanned evidence) have their own limits, set by ops: per file and per client in a project's group.
     * They are not counted against the group's 100 MiB, which stays for staff files.
     */
    @org.springframework.beans.factory.annotation.Value("${im.client-upload.max-file-mb:50}")
    private long clientMaxFileMb = 50;
    @org.springframework.beans.factory.annotation.Value("${im.client-upload.max-total-mb:512}")
    private long clientMaxTotalMb = 512;
    public long clientMaxFileBytes() { return clientMaxFileMb * 1024 * 1024; }
    public long clientMaxTotalBytes() { return clientMaxTotalMb * 1024 * 1024; }
    /** Largest JSON body an upload may need: a client file as base64, plus room for the envelope. */
    public long maxRequestBytes() { return Math.max(ImGatewayService.MAX_JSON_BYTES, (Math.max(MAX_FILE_BYTES, clientMaxFileBytes()) + 2) / 3 * 4 + 1024 * 1024); }
    public static final Set<String> ACTIONS = Set.of("self", "list", "create", "invite", "join",
            "members", "removeMember", "leave", "messages", "send", "read", "upload", "download", "fileAccess",
            "agentScopes", "ensureAgent", "agentInfo", "agentReply", "projectGroup");
    /** Polled every few seconds by every open panel: these never take the conversation row lock. */
    static final Set<String> READ_ONLY_ACTIONS = Set.of("self", "list", "members", "agentInfo", "messages", "download");
    /**
     * Everything a client holding an access code (global role CLIENT) may call (B4). They reach only the project group
     * of the project their code is for; DMs, other groups, private assistants, membership and access management are not
     * theirs. Checked here, before any action, so the portal, the desktop client proxy and direct calls share one rule.
     */
    public static final Set<String> CLIENT_PORTAL_ACTIONS = Set.of("self", "projectGroup", "members", "messages", "send", "read", "upload", "download");
    public static final String CHAT_INVITE_FOR_ACCOUNTS = "此邀请码用于 AI WorkDeck 账户；你可以在这里的项目沟通里与律师交流。";
    public static final String DENIED_GENERIC_CODE = "GENERIC_CODE";
    public static final String DENIED_CODE_INACTIVE = "CODE_INACTIVE", DENIED_OUT_OF_SCOPE = "OUT_OF_SCOPE", DENIED_ACTION = "ACTION_NOT_ALLOWED";
    /** One denial record per client per window: a cut-off portal keeps polling every few seconds. */
    private static final long DENIAL_AUDIT_WINDOW_MS = 10 * 60 * 1000L;
    private final Map<String, Long> deniedAudited = new java.util.concurrent.ConcurrentHashMap<>();
    private final ImConversationRepository conversations;
    private final ImMemberRepository members;
    private final ImInvitationRepository invitations;
    private final ImMessageRepository messages;
    private final ImAttachmentRepository attachments;
    private final UserRepository users;
    @org.springframework.beans.factory.annotation.Autowired(required=false)
    private ImAgentService agents;
    @org.springframework.beans.factory.annotation.Autowired
    private ProjectRepository projects;
    @org.springframework.beans.factory.annotation.Autowired(required=false)
    private com.checkba.service.ProjectMemberService projectPermissions;
    @org.springframework.beans.factory.annotation.Autowired(required=false)
    private com.checkba.service.ClientInvitationService clientInvitations;
    @org.springframework.beans.factory.annotation.Autowired(required=false)
    private ClientPortalChatAudit portalAudit;
    @org.springframework.beans.factory.annotation.Autowired(required=false)
    private com.checkba.service.UserRateLimiter rateLimiter;

    private TransactionTemplate writes, reads;
    @org.springframework.beans.factory.annotation.Autowired
    void transactions(PlatformTransactionManager manager) {
        writes = new TransactionTemplate(manager);
        writes.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
        reads = new TransactionTemplate(manager);
        reads.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
        reads.setReadOnly(true);
    }

    /**
     * The conversation row lock serializes membership, invitations, sends and quota accounting. Sends must stay
     * serialized: message ids then become visible in id order, so an {@code afterId} poll never skips a slower sender.
     * Read-only actions take no lock and run in a read-only transaction: every open panel polls them, and queueing
     * them on the row made members of one group wait for each other. What the lock gave a read is kept by checking
     * membership again after the rows are read (see below). A read nested in a caller's own transaction keeps the
     * lock: such callers (project import/export) decide writes from what they read.
     */
    /**
     * Entry for requests that arrive over the network ({@code /api/im/action}, and the server-mode gateway). Counts the
     * request against the caller's own buckets before running it: sends and uploads per sender; every other action too
     * when the caller is an access-code client. Server-side posters (law-firm notices, assistant replies) call
     * {@link #execute} directly and are not counted.
     */
    public Object executeRequest(Long userId, String action, Map<String, Object> params) {
        if (rateLimiter != null && userId != null) {
            // A message is one send whether or not it carries a file, so a lawyer sharing files is not throttled twice.
            if ("send".equals(action)) {
                long retry = rateLimiter.acquire(com.checkba.service.UserRateLimiter.Kind.IM_SEND, userId);
                if (retry > 0) throw new com.checkba.exception.RateLimitedException(retry, com.checkba.service.LangText.of(
                        "发送太快，请 " + retry + " 秒后再发", "You're sending too fast; please wait " + retry + " seconds"));
            } else if (users.findById(userId).map(User::getRole).filter("CLIENT"::equals).isPresent()) {
                long retry = rateLimiter.acquire("upload".equals(action)
                        ? com.checkba.service.UserRateLimiter.Kind.UPLOAD : com.checkba.service.UserRateLimiter.Kind.IM_READ, userId);
                if (retry > 0) throw new com.checkba.exception.RateLimitedException(retry);
            }
        }
        return execute(userId, action, params);
    }

    public Object execute(Long userId, String action, Map<String, Object> params) {
        boolean unlocked = READ_ONLY_ACTIONS.contains(action) && !TransactionSynchronizationManager.isActualTransactionActive();
        return (unlocked ? reads : writes).execute(status -> execute(userId, action, params, unlocked));
    }

    private Object execute(Long userId, String action, Map<String, Object> params, boolean unlocked) {
        // Loaded, not just counted: the caller's row is read again later (name, client status) and then comes from the session.
        User caller = userId == null ? null : users.findById(userId).orElse(null);
        if (caller == null) throw bad("请先登录");
        Map<String,Object> p = params == null ? Map.of() : params;
        if (!ACTIONS.contains(action)) throw bad(com.checkba.service.LangText.of("不支持的沟通操作", "Unsupported IM action"));
        // Access-code clients: the code is checked on every request, not only at login, so expiry and revocation end
        // chat on the next poll. portalProjectId is then the only project whose group they may touch.
        Long portalProjectId = null;
        com.checkba.model.entity.ProjectInvitation portalCode = null;
        if ("CLIENT".equals(caller.getRole())) {
            portalCode = clientInvitations == null ? null : clientInvitations.activeInvitationFor(caller).orElse(null);
            if (portalCode == null) throw portalDenied(userId, clientInvitations == null ? null : clientInvitations.invitedProjectOf(caller).orElse(null), DENIED_CODE_INACTIVE);
            portalProjectId = portalCode.getProjectId();
            // A generic code is one identity shared by everyone holding it (and a typed name picks anyone's login):
            // chat needs a code issued to one named client.
            if (!"CLIENT_NAMED".equals(portalCode.getType())) throw portalDenied(userId, portalProjectId, DENIED_GENERIC_CODE);
            if ("join".equals(action)) {
                // A chat invitation code is for AI WorkDeck accounts; say so instead of a generic refusal.
                portalDenied(userId, portalProjectId, DENIED_ACTION);
                throw new ImAccessDeniedException(DENIED_ACTION, com.checkba.service.LangText.of(CHAT_INVITE_FOR_ACCOUNTS,
                        "This invitation is for AI WorkDeck accounts. You can talk to your lawyers in this project's chat here."));
            }
            if (!CLIENT_PORTAL_ACTIONS.contains(action)) throw portalDenied(userId, portalProjectId, DENIED_ACTION);
            if ("projectGroup".equals(action) && number(p, "projectId", -1) != portalProjectId)
                throw portalDenied(userId, portalProjectId, DENIED_OUT_OF_SCOPE);
        }
        if ("self".equals(action)) return Map.of("id", userId, "displayName", displayName(userId));
        if ("agentScopes".equals(action)) return agentService().scopes(userId);
        if ("ensureAgent".equals(action)) {
            if (p.containsKey("private") && !(p.get("private") instanceof Boolean)) throw bad(com.checkba.service.LangText.of("private必须为布尔值", "private must be a boolean"));
            String key = string(p, "scopeKey");
            if ("project".equals(string(p, "scope")) && !Boolean.TRUE.equals(p.get("private")) && key.matches("project:[1-9][0-9]{0,18}")) {
                try { return projectGroup(userId, Map.of("projectId", Long.parseLong(key.substring(8)))); }
                catch (NumberFormatException invalid) { throw bad(com.checkba.service.LangText.of("项目标识无效", "Invalid project identifier")); }
            }
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
        if ("projectGroup".equals(action)) return projectGroup(userId, p, portalCode);
        if ("join".equals(action)) return join(userId, p);
        String conversationId = required(p, "conversationId", 36);
        // "read" only advances the caller's own cursor, atomically in SQL, so it does not queue behind the group either.
        ImConversation conversation = unlocked || "read".equals(action)
                ? conversations.findById(conversationId).orElseThrow(ImService::unknownConversation) : lock(conversationId);
        if (portalProjectId != null && !portalProjectId.equals(conversation.getProjectId()))
            throw portalDenied(userId, portalProjectId, DENIED_OUT_OF_SCOPE);
        ImMember member = requireMember(conversation.getId(), userId);
        authorizeAgent(conversation, userId);
        Object result = switch (action) {
            case "invite" -> invite(conversation, member, p);
            // The roster (names, account ids, other clients) is not a client's to read anywhere; the count is enough.
            case "members" -> portalProjectId != null
                    ? Map.of("members", List.of(), "humanCount", members.findByConversationId(conversation.getId()).size())
                    : memberViews(conversation);
            case "agentInfo" -> view(conversation, member);
            case "agentReply" -> agentService().reply(conversation, userId, p);
            case "removeMember" -> remove(conversation, member, number(p, "userId", -1), Boolean.TRUE.equals(p.get("revokeCode")));
            case "leave" -> leave(conversation, member);
            case "messages" -> listMessages(conversation, member, p);
            case "send" -> send(conversation, member, p);
            case "read" -> markRead(conversation, member, p);
            case "upload" -> upload(conversation, member, p);
            case "download" -> download(conversation, member, p);
            case "fileAccess" -> fileAccess(conversation, member, p);
            default -> throw bad(com.checkba.service.LangText.of("不支持的沟通操作", "Unsupported IM action"));
        };
        // Without the lock a removal and a later send can both commit between the check above and the rows just read.
        // Still a member now means nothing read was sent after a removal; otherwise the result is discarded.
        if (unlocked) requireMember(conversation.getId(), userId);
        return result;
    }

    private Object create(Long userId, Map<String,Object> p) {
        String type = required(p, "type", 16);
        if (!Set.of("GROUP", "DIRECT").contains(type)) throw bad(com.checkba.service.LangText.of("请选择私聊或群聊", "Please select a direct or group conversation"));
        ImConversation c = new ImConversation();
        c.setId(UUID.randomUUID().toString()); c.setTitle(required(p, "title", 128));
        c.setType(type); c.setOwnerId(userId); c.setCreatedAt(Instant.now());
        c.setLastMessageAt(c.getCreatedAt()); conversations.save(c);
        return view(c, addMember(c.getId(), userId, "OWNER"));
    }

    /** Entering a project group grants no project rights. Every subsequent action rechecks its ACL. */
    private Object projectGroup(Long userId, Map<String,Object> p) { return projectGroup(userId, p, null); }

    /** {@code portalCode}: the caller's active access code when they are an access-code client, else null. */
    private Object projectGroup(Long userId, Map<String,Object> p, com.checkba.model.entity.ProjectInvitation portalCode) {
        long projectId = number(p, "projectId", -1);
        if (projectPermissions == null || projectId <= 0 || !projectPermissions.hasReadPermission(projectId, userId))
            throw bad(com.checkba.service.LangText.of("项目不存在或无权访问", "Project does not exist or access denied"));
        Project project = projects.lockForImWrite(projectId).orElseThrow(() -> bad(com.checkba.service.LangText.of("项目不存在或无权访问", "Project does not exist or access denied")));
        if (!projectPermissions.hasReadPermission(projectId, userId) || project.getUserId() == null)
            throw bad(com.checkba.service.LangText.of("项目不存在或无权访问", "Project does not exist or access denied"));
        ImConversation c = conversations.findByProjectId(projectId).orElse(null);
        if (c == null) {
            c = new ImConversation(); c.setId(UUID.randomUUID().toString()); c.setType("GROUP");
            String title = Objects.toString(project.getName(), com.checkba.service.LangText.of("项目", "Project")) + com.checkba.service.LangText.of(" · 项目群", " · Project Group");
            c.setTitle(title.substring(0, Math.min(128, title.length()))); c.setOwnerId(project.getUserId());
            c.setProjectId(projectId); c.setCreatedAt(Instant.now()); c.setLastMessageAt(c.getCreatedAt());
            conversations.save(c); addMember(c.getId(), project.getUserId(), "OWNER");
        }
        c = lock(c.getId());
        if (c.getAgentScope() == null) {
            c.setAgentScope("project"); c.setAgentScopeKey("project:" + projectId); c.setAgentName(com.checkba.service.LangText.of("项目助手", "Project Assistant")); c.setAgentPrivate(false);
            c.setAgentBindingKey(sha(("project\nproject:" + projectId + "\nshared").getBytes(StandardCharsets.UTF_8)));
            conversations.saveAndFlush(c);
        }
        ImMember member = members.findByConversationIdAndUserId(c.getId(), userId).orElse(null);
        if (member == null) {
            member = addMember(c.getId(), userId,
                    Objects.equals(c.getOwnerId(), userId) ? "OWNER" : portalCode != null || projectPermissions.isClient(projectId, userId) ? "CLIENT" : "MEMBER");
            // Earlier messages only when the lawyer chose so on this client's access code; floors set once, never widened.
            boolean shareHistory = portalCode != null && Boolean.TRUE.equals(portalCode.getImShareHistory());
            if (!shareHistory) member = limitClientHistory(member);
            if (portalCode != null && portalAudit != null) {
                try { portalAudit.joined(userId, projectId, c.getId(), c.getTitle(), shareHistory); }
                catch (RuntimeException ignored) { /* Audit never blocks chat. */ }
            }
        }
        return view(c, member);
    }

    private Object invite(ImConversation c, ImMember me, Map<String,Object> p) {
        requireOwner(me);
        if (c.getProjectId() != null) throw bad(com.checkba.service.LangText.of("请通过项目成员邀请加入项目群，群聊邀请码不授予项目权限", "Please invite members through project membership; group invite codes do not grant project permissions"));
        ImAgentService.requireInvitable(c);
        if ("DIRECT".equals(c.getType()) && members.countByConversationId(c.getId()) >= 2) throw bad(com.checkba.service.LangText.of("私聊已有两位参与人", "Direct conversation already has two participants"));
        String role = required(p, "role", 16);
        if (!Set.of("MEMBER", "CLIENT").contains(role)) throw bad(com.checkba.service.LangText.of("邀请角色无效", "Invalid invitation role"));
        if (p.containsKey("shareHistory") && !(p.get("shareHistory") instanceof Boolean)) throw bad(com.checkba.service.LangText.of("shareHistory必须为布尔值", "shareHistory must be a boolean"));
        // Earlier messages open only through an explicit client invitation; a member code never carries
        // that choice, so a client account redeeming it stays limited to messages after joining.
        boolean shareHistory = "CLIENT".equals(role) && Boolean.TRUE.equals(p.get("shareHistory"));
        // A fresh invitation ends outstanding codes. Their rows stay for 30 days, so a replaced code typed into the
        // client portal is still explained as a chat code (QA D4) instead of "invalid access code".
        Instant now = Instant.now();
        invitations.expireOutstanding(c.getId(), me.getUserId(), now);
        invitations.deleteByExpiresAtBefore(now.minus(30, ChronoUnit.DAYS));
        byte[] entropy = new byte[24]; new SecureRandom().nextBytes(entropy);
        String code = Base64.getUrlEncoder().withoutPadding().encodeToString(entropy);
        ImInvitation invite = new ImInvitation(); invite.setTokenHash(sha(code.getBytes(StandardCharsets.UTF_8)));
        invite.setConversationId(c.getId()); invite.setRole(role); invite.setIssuedBy(me.getUserId());
        invite.setShareHistory(shareHistory);
        invite.setExpiresAt(now.plus(24, ChronoUnit.HOURS)); invitations.save(invite);
        audit(com.checkba.service.audit.FirmAuditLog.event("CLIENT", "CHAT_INVITE_ISSUED").actor(me.getUserId())
                .target("CONVERSATION", c.getId(), c.getTitle()).detail("role", role).detail("shareHistory", shareHistory));
        // Echoed so a panel can tell a server that enforces the choice from an older one that ignores it.
        return Map.of("code", code, "expiresAt", invite.getExpiresAt(), "shareHistory", shareHistory);
    }

    private Object join(Long userId, Map<String,Object> p) {
        String hash = sha(required(p, "code", 64).getBytes(StandardCharsets.UTF_8));
        String conversationId = invitations.conversationIdForHash(hash).orElseThrow(() -> bad(com.checkba.service.LangText.of("邀请码无效或已过期", "Invitation code is invalid or expired")));
        ImConversation c = lock(conversationId);
        ImAgentService.requireInvitable(c);
        // Reload under the conversation lock: two redeemers cannot both consume a code.
        ImInvitation invite = invitations.findById(hash).orElseThrow(() -> bad(com.checkba.service.LangText.of("邀请码无效或已过期", "Invitation code is invalid or expired")));
        if (invite.getUsedAt() != null || !invite.getExpiresAt().isAfter(Instant.now())) throw bad(com.checkba.service.LangText.of("邀请码无效或已过期", "Invitation code is invalid or expired"));
        ImMember issuer = requireMember(c.getId(), invite.getIssuedBy()); requireOwner(issuer);
        if (members.findByConversationIdAndUserId(c.getId(), userId).isPresent()) throw bad(com.checkba.service.LangText.of("你已在此会话中", "You are already in this conversation"));
        long size = members.countByConversationId(c.getId());
        if (size >= ("DIRECT".equals(c.getType()) ? 2 : 100)) throw bad(com.checkba.service.LangText.of("会话人数已满", "Conversation has reached its member limit"));
        invite.setUsedAt(Instant.now()); invitations.save(invite);
        ImMember member = addMember(c.getId(), userId, invite.getRole());
        boolean shareHistory = "CLIENT".equals(invite.getRole()) && Boolean.TRUE.equals(invite.getShareHistory());
        // Filed under the issuer's firm: the redeemer is often an outside client with no firm of their own.
        audit(com.checkba.service.audit.FirmAuditLog.event("CLIENT", "CHAT_INVITE_REDEEMED").actor(userId).firmOf(invite.getIssuedBy())
                .target("CONVERSATION", c.getId(), c.getTitle()).detail("issuedBy", invite.getIssuedBy())
                .detail("role", invite.getRole()).detail("shareHistory", shareHistory));
        return view(c, shareHistory ? member : limitClientHistory(member));
    }

    /**
     * {@code revokeCode}: the lawyer confirmed that removing an access-code client revokes their code (B4). Their chat
     * membership is the code, so without revoking it they would simply be re-added on their next poll.
     */
    private Object remove(ImConversation c, ImMember me, long targetId, boolean revokeCode) {
        requireOwner(me);
        ImMember target = requireMember(c.getId(), targetId);
        if ("OWNER".equals(target.getRole())) throw bad(com.checkba.service.LangText.of("不能移除会话负责人", "Cannot remove the conversation owner"));
        // An access-code client would come straight back on their next poll: their access is the code, so end it there.
        if (users.findById(targetId).map(User::getRole).filter("CLIENT"::equals).isPresent()) {
            if (!revokeCode || c.getProjectId() == null || projectPermissions == null)
                throw bad(com.checkba.service.LangText.of("这位客户凭访问码进入项目沟通；要让他离开，请撤销他的访问码。",
                        "This client is in project chat by access code; to remove them, revoke their access code."));
            // Same path as removing the client from the project: permission checks, member row deleted, code revoked.
            projectPermissions.removeMember(c.getProjectId(), targetId, me.getUserId());
            members.delete(target);
            return Map.of("removed", true, "codeRevoked", true);
        }
        members.delete(target);
        audit(com.checkba.service.audit.FirmAuditLog.event("CLIENT", "CHAT_MEMBER_REMOVED").actor(me.getUserId())
                .target("CONVERSATION", c.getId(), c.getTitle()).detail("removedUserId", targetId).detail("role", target.getRole()));
        return Map.of("removed", true);
    }

    private Object leave(ImConversation c, ImMember me) {
        if (c.getAgentScope() != null && (Boolean.TRUE.equals(c.getAgentPrivate())
                || ("project".equals(c.getAgentScope()) && "OWNER".equals(me.getRole()))))
            throw bad(com.checkba.service.LangText.of("此助手会话需要保留，可关闭面板后随时重新打开", "This assistant conversation must be kept; you can close the panel and reopen it anytime"));
        if ("OWNER".equals(me.getRole()) && members.countByConversationId(c.getId()) > 1) throw bad(com.checkba.service.LangText.of("请先移除其他成员，再退出会话", "Please remove other members before leaving the conversation"));
        invitations.deleteByConversationIdAndIssuedBy(c.getId(), me.getUserId());
        members.delete(me);
        return Map.of("left", true);
    }

    private Object listMessages(ImConversation c, ImMember me, Map<String,Object> p) {
        int limit = (int)Math.max(1, Math.min(100, number(p, "limit", 50)));
        long after = number(p, "afterId", 0), before = number(p, "beforeId", Long.MAX_VALUE);
        if (after < 0 || before < 1 || (p.containsKey("afterId") && p.containsKey("beforeId"))) throw bad(com.checkba.service.LangText.of("消息分页参数无效", "Invalid message pagination parameters"));
        long floor = historyFloor(me);
        var page = p.containsKey("afterId")
                ? messages.findByConversationIdAndIdGreaterThanOrderByIdAsc(c.getId(), Math.max(after, floor), PageRequest.of(0, limit))
                : messages.findByConversationIdAndIdGreaterThanAndIdLessThanOrderByIdDesc(c.getId(), floor, before, PageRequest.of(0, limit));
        List<ImMessage> rows = new ArrayList<>(page.getContent());
        rows.sort(Comparator.comparing(ImMessage::getId));
        Map<String,Object> result = new LinkedHashMap<>();
        boolean client = client(me);
        result.put("messages", messageViews(rows, me, client)); result.put("hasMore", page.hasNext());
        Map<String,Object> agentStatus = c.getAgentScope() == null ? null : agentService().status(c.getId());
        if (agentStatus != null && agentStatus.get("messageId") instanceof Number source && source.longValue() <= floor) agentStatus = null;
        result.put("agentStatus", agentStatus);
        result.put("revision", revision(c, me, client));
        return result;
    }

    private Object send(ImConversation c, ImMember me, Map<String,Object> p) {
        String clientId = required(p, "clientMessageId", 100);
        String text = string(p, "text");
        if (text.length() > 8000) throw bad(com.checkba.service.LangText.of("消息最多8000字", "Message cannot exceed 8,000 characters"));
        String attachmentId = string(p, "attachmentId");
        if (text.isBlank() && attachmentId.isBlank()) throw bad(com.checkba.service.LangText.of("请输入消息或选择文件", "Please enter a message or select a file"));
        var existing = messages.findByConversationIdAndSenderIdAndClientMessageId(c.getId(), me.getUserId(), clientId);
        if (existing.isPresent()) {
            ImMessage old = existing.get();
            if (!old.getText().equals(text) || !Objects.equals(old.getAttachmentId(), attachmentId.isBlank() ? null : attachmentId))
                throw bad(com.checkba.service.LangText.of("消息重试标识已用于其他内容", "Message retry key has already been used for different content"));
            return messageView(old, me);
        }
        if (!attachmentId.isBlank()) {
            ImAttachment file = requireAttachment(c.getId(), attachmentId);
            if (!file.getUploadedBy().equals(me.getUserId())) throw bad(com.checkba.service.LangText.of("只能发送自己上传的文件", "You can only send files that you uploaded"));
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
            ImMessage message = messages.findById(id).orElseThrow(() -> bad(com.checkba.service.LangText.of("消息不存在", "Message not found")));
            if (!c.getId().equals(message.getConversationId())) throw bad(com.checkba.service.LangText.of("无权访问该消息", "You do not have access to this message"));
        }
        members.advanceLastRead(me.getId(), id);
        return Map.of("lastReadId", Math.max(me.getLastReadId(), id));
    }

    private Object upload(ImConversation c, ImMember me, Map<String,Object> p) {
        String encoded = string(p, "base64");
        boolean fromClient = client(me);
        long maxFile = fromClient ? clientMaxFileBytes() : MAX_FILE_BYTES;
        if (encoded.length() > ((maxFile + 2L) / 3) * 4) throw fileTooLarge(fromClient, maxFile);
        byte[] bytes;
        try { bytes = Base64.getDecoder().decode(encoded); }
        catch (IllegalArgumentException e) { throw bad(com.checkba.service.LangText.of("文件编码无效", "Invalid file encoding")); }
        if (bytes.length == 0) throw bad(com.checkba.service.LangText.of("文件不能为空", "File cannot be empty"));
        if (bytes.length > maxFile) throw fileTooLarge(fromClient, maxFile);
        String name = safeName(required(p, "name", 500)), digest = sha(bytes);
        String projectUid = null, fileUid = null;
        // A client's upload is never a project-file reference; only staff can cite project files.
        if (p.get("source") != null && !fromClient) {
            if (!(p.get("source") instanceof Map<?,?> source)) throw bad(com.checkba.service.LangText.of("文件来源格式无效", "Invalid file source format"));
            projectUid = sourceUid(source.get("projectUid")); fileUid = sourceUid(source.get("fileUid"));
        }
        String clientId = p.containsKey("clientMessageId") ? required(p, "clientMessageId", 100) : null;
        if (clientId != null) {
            var existing = attachments.findByConversationIdAndUploadedByAndClientMessageId(c.getId(), me.getUserId(), clientId);
            if (existing.isPresent()) {
                ImAttachment old = existing.get();
                if (!old.getSha256().equals(digest) || !old.getName().equals(name)
                        || !Objects.equals(old.getSourceProjectUid(), projectUid) || !Objects.equals(old.getSourceFileUid(), fileUid))
                    throw bad(com.checkba.service.LangText.of("文件重试标识已用于其他内容", "File retry key has already been used for different content"));
                return attachmentView(old, me);
            }
        }
        if (fromClient && attachments.totalSizeBy(c.getId(), me.getUserId()) + bytes.length > clientMaxTotalBytes())
            throw new ImLimitException(ImLimitException.QUOTA_FULL, clientMaxTotalBytes(), com.checkba.service.LangText.of(
                    "你在本项目上传的文件总量已达 " + mib(clientMaxTotalBytes()) + "MiB 上限，请联系律师",
                    "You have reached the " + mib(clientMaxTotalBytes()) + " MiB total upload limit for this project; please contact your lawyer"));
        if (!fromClient && attachments.totalSize(c.getId()) - attachments.totalSizeByClients(c.getId()) + bytes.length > MAX_CONVERSATION_BYTES) throw bad(com.checkba.service.LangText.of("本会话文件空间已满（100MiB）", "Conversation file storage is full (100 MiB)"));
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
            throw bad(fileUnavailable());
        // A file posted only before a history-limited client joined stays out of reach even if it was opened to clients.
        long floor = historyFloor(me);
        if (floor > 0 && !me.getUserId().equals(metadata.get(0)[4])
                && !messages.existsByConversationIdAndAttachmentIdAndIdGreaterThan(c.getId(), attachmentId, floor))
            throw bad(fileUnavailable());
        ImAttachment file = requireAttachment(c.getId(), attachmentId);
        audit(com.checkba.service.audit.FirmAuditLog.event("DATA", "CHAT_FILE_DOWNLOADED").actor(me.getUserId()).firmOf(c.getOwnerId())
                .project(c.getProjectId()).target("CHAT_FILE", attachmentId, file.getName()).detail("conversationId", c.getId()));
        Map<String,Object> result = new LinkedHashMap<>(attachmentView(file, me));
        result.put("base64", Base64.getEncoder().encodeToString(file.getContent()));
        return result;
    }

    private Object fileAccess(ImConversation c, ImMember me, Map<String,Object> p) {
        if (!(p.get("clientVisible") instanceof Boolean visible)) throw bad(com.checkba.service.LangText.of("clientVisible必须为布尔值", "clientVisible must be a boolean"));
        ImAttachment file = requireAttachment(c.getId(), required(p, "attachmentId", 36));
        if (!canManage(me, file.getUploadedBy())) throw bad(fileUnavailable());
        file.setClientVisible(visible); attachments.save(file);
        c.setAccessRevision(c.getAccessRevision() == null ? 1 : c.getAccessRevision() + 1); conversations.save(c);
        return attachmentView(file, me);
    }

    private ImAgentService agentService() {
        if (agents == null) throw bad(com.checkba.service.LangText.of("当前服务尚未开通沟通助手", "IM assistant is not enabled on this server"));
        return agents;
    }
    private void authorizeAgent(ImConversation conversation, Long userId) {
        if (conversation.getProjectId() != null && !projectPermissions.hasReadPermission(conversation.getProjectId(), userId))
            throw bad(com.checkba.service.LangText.of("项目不存在或已退出项目", "Project does not exist or you have left the project"));
        if (conversation.getAgentScope() != null) agentService().authorize(conversation, userId);
    }
    private Map<String,Object> memberViews(ImConversation conversation) {
        List<Map<String,Object>> rows = new ArrayList<>();
        List<ImMember> all = members.findByConversationId(conversation.getId());
        Set<Long> accessCodeClients = new HashSet<>();
        for (User user : users.findAllById(all.stream().map(ImMember::getUserId).toList()))
            if ("CLIENT".equals(user.getRole())) accessCodeClients.add(user.getId());
        for (ImMember member : all) {
            Map<String,Object> row = new LinkedHashMap<>(Map.of("id", member.getUserId(), "displayName", displayName(member.getUserId()), "role", member.getRole(), "actorType", "HUMAN"));
            // Removing them means revoking their access code; the panels offer that instead of a plain remove.
            if (accessCodeClients.contains(member.getUserId())) row.put("accessCode", true);
            rows.add(row);
        }
        int humanCount = rows.size();
        if (conversation.getAgentScope() != null) rows.add(Map.of("id", "agent:" + conversation.getId(), "displayName", conversation.getAgentName(), "role", "AGENT", "actorType", "AGENT"));
        return Map.of("members", rows, "humanCount", humanCount);
    }

    /**
     * The same answer whatever the reason, so a client learns nothing about other conversations; the audit keeps the
     * reason. A code that stopped working gets the portal's own wording so the client knows to ask the lawyer.
     */
    private IllegalArgumentException portalDenied(Long userId, Long projectId, String reason) {
        if (portalAudit != null) {
            if (deniedAudited.size() > 10_000) deniedAudited.clear();
            String key = userId + ":" + reason;
            long now = System.currentTimeMillis();
            Long last = deniedAudited.get(key);
            if (last == null || now - last > DENIAL_AUDIT_WINDOW_MS) {
                deniedAudited.put(key, now);
                try { portalAudit.denied(userId, projectId, reason); }
                catch (RuntimeException ignored) { /* Audit never blocks the answer. */ }
            }
        }
        if (DENIED_CODE_INACTIVE.equals(reason))
            return new ImAccessDeniedException(reason, com.checkba.service.LangText.of("访问码已失效或已过期，请联系律师", "Your access code is no longer valid or has expired; please contact your lawyer"));
        if (DENIED_GENERIC_CODE.equals(reason))
            return new ImAccessDeniedException(reason, com.checkba.service.LangText.of("这个访问码是通用码，不能用于项目沟通。请让律师为你单独生成一个访问码。",
                    "This is a shared access code and can't be used for project chat. Please ask your lawyer for an access code of your own."));
        return new ImAccessDeniedException(reason, com.checkba.service.LangText.of("会话不存在或无权访问", "Conversation does not exist or access denied"));
    }

    private static IllegalArgumentException unknownConversation() { return bad(com.checkba.service.LangText.of("会话不存在或无权访问", "Conversation does not exist or access denied")); }
    private ImConversation lock(String id) { return conversations.lockById(id).orElseThrow(ImService::unknownConversation); }
    private ImMember requireMember(String id, Long userId) { return members.findByConversationIdAndUserId(id, userId).orElseThrow(ImService::unknownConversation); }
    private void requireOwner(ImMember member) { if (!"OWNER".equals(member.getRole())) throw bad(com.checkba.service.LangText.of("只有会话负责人可以执行此操作", "Only the conversation owner can perform this action")); }
    private ImAttachment requireAttachment(String conversationId, String id) {
        ImAttachment file = attachments.findById(id).orElseThrow(() -> bad(com.checkba.service.LangText.of("文件不存在或无权访问", "File does not exist or access denied")));
        if (!conversationId.equals(file.getConversationId())) throw bad(com.checkba.service.LangText.of("文件不存在或无权访问", "File does not exist or access denied"));
        return file;
    }
    private ImMember addMember(String id, Long userId, String role) {
        ImMember member = new ImMember(); member.setConversationId(id); member.setUserId(userId);
        member.setRole(role); member.setJoinedAt(Instant.now()); return members.save(member);
    }
    /** Callers hold the conversation lock, so no send can land between this read and the membership. */
    private ImMember limitClientHistory(ImMember member) {
        if (!client(member)) return member;
        member.setHistoryAfterId(messages.maxId(member.getConversationId())); return members.save(member);
    }
    private static long mib(long bytes) { return bytes / (1024 * 1024); }
    private static IllegalArgumentException fileTooLarge(boolean client, long maxFile) {
        String zh = "单个文件不能超过 " + mib(maxFile) + "MiB", en = "A single file cannot exceed " + mib(maxFile) + " MiB";
        return client ? new ImLimitException(ImLimitException.FILE_TOO_LARGE, maxFile, com.checkba.service.LangText.of(zh, en))
                : bad(com.checkba.service.LangText.of(zh, en));
    }
    private static long historyFloor(ImMember member) { return member.getHistoryAfterId() == null ? 0 : member.getHistoryAfterId(); }
    private Map<String,Object> view(ImConversation c, ImMember member) {
        Map<String,Object> result = new LinkedHashMap<>(Map.of("id", c.getId(), "title", c.getTitle(), "type", c.getType(), "role", member.getRole(),
                "createdAt", c.getCreatedAt(), "lastMessageAt", c.getLastMessageAt(), "lastReadId", member.getLastReadId(),
                "unreadCount", messages.countByConversationIdAndIdGreaterThanAndSenderIdNot(c.getId(), Math.max(member.getLastReadId(), historyFloor(member)), member.getUserId())));
        if (c.getAgentScope() != null) {
            result.put("agent", ImAgentService.agentView(c));
            result.put("canRequestAgent", (c.getProjectId() == null && c.getAgentProjectId() == null) || !client(member));
        }
        // Clients read their upload limits from here, so the portal checks a file before sending it.
        if (c.getProjectId() != null && "CLIENT".equals(member.getRole()))
            result.put("uploadLimits", Map.of("maxFileBytes", clientMaxFileBytes(), "maxTotalBytes", clientMaxTotalBytes()));
        Long projectId = c.getProjectId() != null ? c.getProjectId() : c.getAgentProjectId();
        if (projectId != null) {
            result.put("projectId", projectId);
            result.put("projectKey", "project:" + projectId);
            projects.findById(projectId).ifPresent(project -> result.put("projectName", Objects.toString(project.getName(), com.checkba.service.LangText.of("项目", "Project"))));
        }
        return result;
    }
    /**
     * What lets a poller skip re-reading a page it already has: it changes whenever a message already shown could render
     * differently for this viewer (an attachment's client access was toggled, or the viewer's role or client status
     * changed). New messages are what {@code afterId} finds. Sender names and avatars are not covered.
     */
    private static String revision(ImConversation c, ImMember me, boolean client) {
        return (c.getAccessRevision() == null ? 0 : c.getAccessRevision()) + ":" + me.getRole() + ":" + (client ? "client" : "staff");
    }
    private Map<String,Object> messageView(ImMessage m, ImMember me) {
        return messageViews(List.of(m), me, m.getAttachmentId() != null && client(me)).get(0);
    }
    /** One statement each for the senders, their avatars and the attachment metadata, however long the page. */
    private List<Map<String,Object>> messageViews(List<ImMessage> rows, ImMember me, boolean client) {
        Set<Long> senderIds = new HashSet<>(); Set<String> attachmentIds = new HashSet<>();
        for (ImMessage m : rows) {
            if (!"AGENT".equals(m.getActorType())) senderIds.add(m.getSenderId());
            if (m.getAttachmentId() != null) attachmentIds.add(m.getAttachmentId());
        }
        Map<Long,User> senders = new HashMap<>();
        if (!senderIds.isEmpty()) for (User user : users.findAllById(senderIds)) senders.put(user.getId(), user);
        Map<Long,String> avatars = new HashMap<>();
        if (projectPermissions != null) avatars.putAll(projectPermissions.avatarUrlsFor(senders.values()));
        else for (User user : senders.values()) if (user.getAvatarUrl() != null) avatars.put(user.getId(), user.getAvatarUrl());
        // Fetch only metadata: a page of 100 messages must not hydrate 100 attachment blobs.
        Map<String,Object[]> files = new HashMap<>();
        if (!attachmentIds.isEmpty()) for (Object[] a : attachments.metadataIn(me.getConversationId(), attachmentIds)) files.put((String)a[0], a);
        // Lawyers must see which messages came from the client: client member of this group, or an access-code client.
        Set<Long> clientSenders = new HashSet<>();
        for (User user : senders.values()) if ("CLIENT".equals(user.getRole())) clientSenders.add(user.getId());
        if (!senderIds.isEmpty() && clientSenders.size() < senders.size())
            for (ImMember member : members.findByConversationId(me.getConversationId()))
                if ("CLIENT".equals(member.getRole()) && senderIds.contains(member.getUserId())) clientSenders.add(member.getUserId());
        List<Map<String,Object>> views = new ArrayList<>(rows.size());
        for (ImMessage m : rows) {
            Map<String,Object> result = new LinkedHashMap<>(); result.put("id", m.getId()); result.put("uid", m.getUid());
            result.put("clientMessageId", m.getClientMessageId()); result.put("senderId", m.getSenderId());
            boolean agent = "AGENT".equals(m.getActorType()); result.put("actorType", agent ? "AGENT" : "HUMAN");
            result.put("senderName", agent ? m.getAgentName() : displayName(senders.get(m.getSenderId())));
            if (agent) result.put("agentName", m.getAgentName());
            else Optional.ofNullable(avatars.get(m.getSenderId())).filter(url -> !url.isBlank()).ifPresent(url -> result.put("senderAvatarUrl", url));
            if (!agent && clientSenders.contains(m.getSenderId())) result.put("fromClient", true);
            result.put("text", m.getText()); result.put("createdAt", m.getCreatedAt());
            Object[] a = m.getAttachmentId() == null || !m.getConversationId().equals(me.getConversationId()) ? null : files.get(m.getAttachmentId());
            if (a != null) result.put("attachment", attachmentView((String)a[0], (String)a[1], ((Number)a[2]).longValue(),
                    (String)a[3], (Long)a[4], Boolean.TRUE.equals(a[5]), (String)a[6], (String)a[7], me, client));
            views.add(result);
        }
        return views;
    }
    private Map<String,Object> attachmentView(ImAttachment a, ImMember me) {
        return attachmentView(a.getId(), a.getName(), a.getSize(), a.getSha256(), a.getUploadedBy(), a.isClientVisible(),
                a.getSourceProjectUid(), a.getSourceFileUid(), me, client(me));
    }
    private Map<String,Object> attachmentView(String id, String name, long size, String sha256, Long uploadedBy,
                                               boolean clientVisible, String projectUid, String fileUid, ImMember me, boolean client) {
        if (!canRead(me, client, uploadedBy, clientVisible)) return Map.of("id", id, "available", false, "message", fileUnavailable());
        Map<String,Object> result = new LinkedHashMap<>(); result.put("id", id); result.put("name", name);
        result.put("size", size); result.put("sha256", sha256); result.put("available", true);
        result.put("clientVisible", clientVisible); result.put("canManageAccess", canManage(me, client, uploadedBy));
        if (projectUid != null && fileUid != null) result.put("source", Map.of("projectUid", projectUid, "fileUid", fileUid));
        return result;
    }
    private static String fileUnavailable() {
        return com.checkba.service.LangText.of(FILE_UNAVAILABLE, "Sorry, this file is still being prepared. Please contact your lawyer.");
    }
    private boolean client(ImMember me) {
        return "CLIENT".equals(me.getRole()) || users.findById(me.getUserId()).map(User::getRole).filter("CLIENT"::equals).isPresent()
                || conversations.findById(me.getConversationId()).map(c -> c.getProjectId() != null ? c.getProjectId() : c.getAgentProjectId())
                    .map(projectId -> projectPermissions == null || projectPermissions.isClient(projectId, me.getUserId())).orElse(false);
    }
    private boolean canRead(ImMember me, Long uploadedBy, boolean clientVisible) { return canRead(me, client(me), uploadedBy, clientVisible); }
    private static boolean canRead(ImMember me, boolean client, Long uploadedBy, boolean clientVisible) {
        return !client || me.getUserId().equals(uploadedBy) || clientVisible;
    }
    private boolean canManage(ImMember me, Long uploadedBy) { return canManage(me, client(me), uploadedBy); }
    private static boolean canManage(ImMember me, boolean client, Long uploadedBy) {
        return !client && ("OWNER".equals(me.getRole()) || me.getUserId().equals(uploadedBy));
    }
    private static String sourceUid(Object value) {
        if (!(value instanceof String raw) || !raw.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"))
            throw bad(com.checkba.service.LangText.of("文件来源编号无效", "Invalid file source ID"));
        return UUID.fromString(raw).toString();
    }
    private String displayName(Long userId) { return displayName(users.findById(userId).orElse(null)); }
    private static String displayName(User user) { return Optional.ofNullable(user).map(User::getDisplayName).filter(s -> !s.isBlank()).orElse(com.checkba.service.LangText.of("用户", "User")); }
    static String safeName(String name) {
        String clean = name.replace('\\', '/'); clean = clean.substring(clean.lastIndexOf('/') + 1);
        clean = clean.replaceAll("[\\p{Cntrl}<>:\"|?*]", "_");
        int start = 0, end = clean.length();
        while (start < end && (clean.charAt(start) == '.' || clean.charAt(start) == ' ')) start++;
        while (end > start && (clean.charAt(end - 1) == '.' || clean.charAt(end - 1) == ' ')) end--;
        clean = clean.substring(start, end);
        if (clean.isBlank()) throw bad(com.checkba.service.LangText.of("文件名无效", "Invalid file name"));
        return clean.substring(0, Math.min(180, clean.length()));
    }
    /** Firm audit log (S20): invitations with their history choice, redemptions and removals; never message text. */
    private com.checkba.service.audit.FirmAuditLog firmAudit;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    void setFirmAudit(com.checkba.service.audit.FirmAuditLog firmAudit) { this.firmAudit = firmAudit; }

    private void audit(com.checkba.service.audit.FirmAuditLog.Event e) {
        if (firmAudit != null) firmAudit.record(e);
    }

    public static String sha(byte[] content) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content)); }
        catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
    public static String string(Map<String,Object> p, String key) { Object value = p.get(key); return value instanceof String s ? s : ""; }
    private static String required(Map<String,Object> p, String key, int max) {
        String value = string(p, key).trim(); if (value.isEmpty() || value.length() > max) throw bad(com.checkba.service.LangText.of("参数无效：" + key, "Invalid parameter: " + key)); return value;
    }
    private static long number(Map<String,Object> p, String key, long fallback) {
        Object value = p.get(key); if (value == null) return fallback;
        if (value instanceof Number n && Double.isFinite(n.doubleValue()) && n.doubleValue() == n.longValue()) return n.longValue();
        throw bad(com.checkba.service.LangText.of("参数无效：" + key, "Invalid parameter: " + key));
    }
    private static IllegalArgumentException bad(String message) { return new IllegalArgumentException(message); }
}
