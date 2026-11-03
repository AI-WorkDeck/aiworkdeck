// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;

import com.checkba.model.entity.DesktopAssistantCopyReceipt;
import com.checkba.model.entity.ProjectAiMessage;
import com.checkba.repository.DesktopAssistantCopyReceiptRepository;
import com.checkba.repository.ProjectAiMessageRepository;
import com.checkba.repository.ProjectRepository;
import com.checkba.service.LocalIdentityService;
import com.checkba.service.account.AccountService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.DefaultTransactionDefinition;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.UUID;

/** Imports plain conversation text only; never executes tools, imports attachments or rewrites source files. */
@Service
public class DesktopAssistantCopyImportService {
    public record Session(String site, String accountId, String fingerprint, long generation, String deviceId, Long userId) {}
    public static class Rejected extends IllegalArgumentException {
        public Rejected(String code) { super(code); }
    }
    private final AccountService accounts;
    private final LocalIdentityService identity;
    private final ProjectRepository projects;
    private final ProjectAiMessageRepository messages;
    private final DesktopAssistantCopyReceiptRepository receipts;
    private final ObjectMapper mapper;
    private final PlatformTransactionManager transactions;

    public DesktopAssistantCopyImportService(AccountService accounts, LocalIdentityService identity,
            ProjectRepository projects, ProjectAiMessageRepository messages,
            DesktopAssistantCopyReceiptRepository receipts, ObjectMapper mapper, PlatformTransactionManager transactions) {
        this.accounts=accounts;this.identity=identity;this.projects=projects;this.messages=messages;
        this.receipts=receipts;this.mapper=mapper;this.transactions=transactions;
    }

    public void requireSession(Session session) {
        if (session.accountId()==null || session.accountId().isBlank() || session.fingerprint()==null
                || session.userId()==null || session.generation()!=accounts.connectionVersion()
                || !session.accountId().equals(accounts.currentAccountIdOrNull())
                || !session.fingerprint().equals(accounts.accountFingerprintOrNull())
                || !session.userId().equals(identity.localUserId()))
            throw new IllegalStateException("ASSISTANT_COPY_ACCOUNT_CHANGED");
    }

    public DesktopAssistantCopyReceipt importCopy(Session session, JsonNode envelope) {
        // Parse without identity monitors. Never hold the account monitor while waiting for a project
        // DB lock: project IM holds that lock before checking the account in the opposite direction.
        requireSession(session);
        String requestId=uuid(envelope,"requestId"), conversationId=uuid(envelope,"conversationId");
        String uid=uuid(envelope,"targetProjectUid"), key=text(envelope,"targetProjectKey");
        if (!session.deviceId().equals(text(envelope,"targetDeviceId"))) throw new Rejected("IDENTITY_MISMATCH");
        Long projectId;
        try { projectId=Long.valueOf(key);if(projectId<=0||!key.equals(projectId.toString()))throw new NumberFormatException(); }
        catch(NumberFormatException e){throw new Rejected("IDENTITY_MISMATCH");}
        String payload=text(envelope,"snapshotJson"), hash=text(envelope,"sha256");
        if (payload.getBytes(StandardCharsets.UTF_8).length > 16*1024*1024) throw new Rejected("INVALID_SNAPSHOT");
        if (!hash.matches("[a-f0-9]{64}") || !hash.equals(sha256(payload))) throw new Rejected("HASH_MISMATCH");
        JsonNode snapshot;
        try { snapshot=mapper.readTree(payload); }
        catch(Exception e){throw new Rejected("INVALID_SNAPSHOT");}
        if(snapshot.path("version").asInt()!=1 || !conversationId.equals(text(snapshot,"conversationId"))
                || !uid.equals(text(snapshot,"targetProjectUid")) || !key.equals(text(snapshot,"targetProjectKey"))
                || !session.deviceId().equals(text(snapshot,"targetDeviceId"))) throw new Rejected("INVALID_SNAPSHOT");
        text(snapshot,"sourceConversationId");
        JsonNode rows=snapshot.path("messages");
        if(!rows.isArray()||rows.isEmpty()||rows.size()!=envelope.path("messageCount").asInt(-1))throw new Rejected("INVALID_SNAPSHOT");
        var imported=new ArrayList<ProjectAiMessage>();
        LocalDateTime previous=null;
        for(JsonNode row:rows) {
            String role=text(row,"role"), content=text(row,"content");
            if(!role.equals("USER")&&!role.equals("ASSISTANT"))throw new Rejected("INVALID_SNAPSHOT");
            LocalDateTime time;
            try{time=LocalDateTime.ofInstant(Instant.parse(text(row,"createdAt")),ZoneOffset.UTC);}
            catch(Exception e){throw new Rejected("INVALID_SNAPSHOT");}
            if(previous!=null&&!time.isAfter(previous))time=previous.plusNanos(1_000_000);
            previous=time;
            var message=new ProjectAiMessage();message.setProjectId(projectId);message.setUserId(session.userId());
            message.setConversationId(conversationId);message.setRole(role);message.setContent(content);message.setCreatedAt(time);
            // No sourceChannel: unlike an Office mirror this is a new, ordinary, editable conversation.
            imported.add(message);
        }
        String scope=sha256(session.site()+"\n"+session.accountId()),receiptId=sha256(scope+"\n"+requestId);
        var definition=new DefaultTransactionDefinition(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        var status=transactions.getTransaction(definition);
        try {
            var existing=receipts.findById(receiptId).orElse(null);
            com.checkba.model.entity.Project project=null;
            if(existing==null) {
                project=projects.lockForImWrite(projectId).orElseThrow(()->new Rejected("TARGET_UNAVAILABLE"));
                // A competing import may have committed while this one waited for the project lock.
                existing=receipts.findById(receiptId).orElse(null);
            }
            synchronized(accounts) {
                synchronized(identity) {
                    requireSession(session);
                    DesktopAssistantCopyReceipt receipt;
                    if(existing!=null) {
                        if(!hash.equals(existing.getSha256())||!projectId.equals(existing.getProjectId())
                                ||!uid.equals(existing.getProjectUid())||!conversationId.equals(existing.getConversationId()))
                            throw new Rejected("INVALID_SNAPSHOT");
                        receipt=existing;
                    } else {
                        if(!session.userId().equals(project.getUserId()))throw new Rejected("TARGET_NOT_OWNED");
                        if(!uid.equals(project.getUid()))throw new Rejected("IDENTITY_MISMATCH");
                        if(project.isLooseFileWorkspace()||project.isScratchWorkspace())throw new Rejected("TARGET_NOT_FORMAL");
                        if(messages.findFirstByConversationId(conversationId).isPresent())throw new Rejected("CONVERSATION_CONFLICT");
                        messages.saveAll(imported);
                        receipt=new DesktopAssistantCopyReceipt();receipt.setId(receiptId);receipt.setAccountScope(scope);
                        receipt.setRequestId(requestId);receipt.setProjectId(projectId);receipt.setProjectUid(uid);
                        receipt.setTargetDeviceId(session.deviceId());
                        receipt.setConversationId(conversationId);receipt.setSha256(hash);receipt.setMessageCount(imported.size());
                        receipt.setImportedAt(LocalDateTime.now(ZoneOffset.UTC));receipts.saveAndFlush(receipt);
                    }
                    requireSession(session);
                    // REQUIRES_NEW owns the actual commit; returning from a joined TransactionTemplate
                    // would release the identity monitors before the outer transaction commits.
                    transactions.commit(status);
                    return receipt;
                }
            }
        } catch(RuntimeException | Error failure) {
            if(!status.isCompleted()) {
                try { transactions.rollback(status); }
                catch(RuntimeException rollbackFailure) { failure.addSuppressed(rollbackFailure); }
            }
            throw failure;
        }
    }
    private static String text(JsonNode node,String name){
        JsonNode value=node.get(name);if(value==null||!value.isTextual()||value.asText().isBlank())throw new Rejected("INVALID_SNAPSHOT");
        return value.asText();
    }
    private static String uuid(JsonNode node,String name){
        String value=text(node,name);
        try{if(!UUID.fromString(value).toString().equals(value))throw new IllegalArgumentException();return value;}
        catch(IllegalArgumentException e){throw new Rejected("INVALID_SNAPSHOT");}
    }
    static String sha256(String value){
        try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));}
        catch(java.security.NoSuchAlgorithmException e){throw new IllegalStateException(e);}
    }
}
