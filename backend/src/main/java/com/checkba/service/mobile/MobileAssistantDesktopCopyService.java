// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;

import com.checkba.model.entity.MobileAssistantDesktopCopy;
import com.checkba.repository.*;
import com.checkba.service.LangText;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.Duration;
import java.util.*;

/** Independent durable transcript envelopes. Never enters the legacy Office mirror queue. */
@Service
@RequiredArgsConstructor
public class MobileAssistantDesktopCopyService {
    private final MobileAssistantDesktopCopyRepository copies;
    private final MobileAssistantService assistant;
    private final MobileAssistantConsentRepository consents;
    private final MobileProjectDirRepository directories;
    private final UserRepository users;
    private final ObjectMapper mapper;
    public record Request(String requestId,String targetProjectUid,String targetDeviceId,String targetProjectKey) {}
    public record Ack(String deviceId,String targetProjectUid,String sha256,String status,String error) {}
    public record Receipt(String requestId,String status,boolean sourcePreserved,boolean filesCopied,
            String sourceConversationId,String conversationId,String targetProjectUid,String targetDeviceId,
            String targetProjectKey,int messageCount,Instant expiresAt,Instant deliveredAt,String error) {}
    public record Envelope(String requestId,String conversationId,String targetProjectUid,String targetDeviceId,
            String targetProjectKey,String snapshotJson,String sha256,int messageCount,Instant expiresAt) {}
    public record Snapshot(int version,String sourceConversationId,String conversationId,String targetProjectUid,
            String targetDeviceId,String targetProjectKey,List<MobileAssistantTranscript.Message> messages) {}

    @Transactional
    public Receipt create(Long user,String source,Request request) {
        lock(user);
        String sourceId=uuid(source), requestId=uuid(request.requestId()), uid=uuid(request.targetProjectUid());
        String device=identity(request.targetDeviceId()), key=identity(request.targetProjectKey());
        if ("cloud".equals(device)) throw invalidTarget();
        var prior=copies.findByUserIdAndRequestId(user,requestId);
        if(prior.isPresent()) {
            var row=prior.get();
            if(!sourceId.equals(row.getSourceConversationId()) || !uid.equals(row.getTargetProjectUid())
                    || !device.equals(row.getTargetDeviceId()) || !key.equals(row.getTargetProjectKey()))
                throw new IllegalArgumentException("ASSISTANT_COPY_REQUEST_CONFLICT");
            refresh(row); return receipt(row);
        }
        requireTarget(user,device,key,uid);
        var sourceTurns=assistant.readableConversationForCopy(user,sourceId);
        var messages=MobileAssistantTranscript.from(sourceTurns);
        var row=new MobileAssistantDesktopCopy();
        row.setUserId(user); row.setRequestId(requestId); row.setSourceConversationId(sourceId);
        row.setConversationId(UUID.randomUUID().toString()); row.setTargetProjectUid(uid);
        row.setTargetDeviceId(device); row.setTargetProjectKey(key); row.setStatus("QUEUED");
        row.setConsentRevision(consents.accessState(user).orElseThrow().getRevision());
        row.setCreatedAt(Instant.now()); row.setExpiresAt(row.getCreatedAt().plus(Duration.ofDays(30)));
        row.setMessageCount(messages.size());
        try {
            String json=mapper.writeValueAsString(new Snapshot(1,sourceId,row.getConversationId(),uid,device,key,messages));
            row.setSourceTurnIdsJson(mapper.writeValueAsString(sourceTurns.stream().map(turn->turn.getId()).toList()));
            row.setSnapshotJson(json); row.setSha256(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(json.getBytes(StandardCharsets.UTF_8))));
        } catch(Exception e) { throw new IllegalStateException("Cannot serialize transcript copy",e); }
        if(row.getSnapshotJson().getBytes(StandardCharsets.UTF_8).length > 16*1024*1024) throw new IllegalArgumentException(LangText.of(
                "对话记录超过转存大小限制，未创建转存任务", "The transcript exceeds the copy size limit; no transfer was created"));
        copies.saveAndFlush(row); return receipt(row);
    }
    @Transactional
    public Receipt get(Long user,String requestId) {
        lock(user); var row=owned(user,requestId); refresh(row); return receipt(row);
    }
    @Transactional
    public List<Receipt> history(Long user,String source) {
        lock(user);
        return copies.findTop20ByUserIdAndSourceConversationIdOrderByIdDesc(user,uuid(source)).stream()
                .map(row->{refresh(row);return receipt(row);}).toList();
    }
    @Transactional
    public List<Envelope> pending(Long user,String deviceId) {
        lock(user); String device=identity(deviceId); List<Envelope> out=new ArrayList<>();
        for(var row:copies.findTop10ByUserIdAndTargetDeviceIdAndStatusOrderByIdAsc(user,device,"QUEUED")) {
            refresh(row);
            if("QUEUED".equals(row.getStatus())) out.add(new Envelope(row.getRequestId(),row.getConversationId(),
                    row.getTargetProjectUid(),row.getTargetDeviceId(),row.getTargetProjectKey(),row.getSnapshotJson(),
                    row.getSha256(),row.getMessageCount(),row.getExpiresAt()));
        }
        return out;
    }
    @Transactional
    public Receipt ack(Long user,String requestId,Ack ack) {
        lock(user); var row=owned(user,requestId);
        if(!row.getTargetDeviceId().equals(ack.deviceId()) || !row.getTargetProjectUid().equals(ack.targetProjectUid())
                || !row.getSha256().equals(ack.sha256())) throw new IllegalArgumentException("ASSISTANT_COPY_ACK_MISMATCH");
        if(ack.status()==null || !Set.of("DELIVERED","FAILED").contains(ack.status())) throw new IllegalArgumentException("ASSISTANT_COPY_ACK_INVALID");
        // An imported snapshot cannot be recalled. Accept a late successful ACK as the factual delivery receipt,
        // even if the queue expired or consent was revoked after the desktop downloaded it.
        if("DELIVERED".equals(row.getStatus())) return receipt(row);
        if("DELIVERED".equals(ack.status())) {
            row.setStatus("DELIVERED"); row.setDeliveredAt(Instant.now()); row.setError(null); row.setSnapshotJson(null);
        } else if("QUEUED".equals(row.getStatus())) {
            String error=Set.of("TARGET_UNAVAILABLE","TARGET_NOT_OWNED","TARGET_NOT_FORMAL","IDENTITY_MISMATCH","INVALID_SNAPSHOT","HASH_MISMATCH","CONVERSATION_CONFLICT")
                    .contains(Objects.toString(ack.error(),"")) ? ack.error() : "TARGET_UNAVAILABLE";
            finish(row,"FAILED",error);
        }
        return receipt(row);
    }
    private void refresh(MobileAssistantDesktopCopy row) {
        if(!"QUEUED".equals(row.getStatus())) return;
        if(!row.getExpiresAt().isAfter(Instant.now())) { finish(row,"EXPIRED","EXPIRED"); return; }
        var consent=consents.accessState(row.getUserId());
        if(consent.isEmpty() || !consent.get().getEnabled() || consent.get().getRevision()!=row.getConsentRevision()) {
            finish(row,"FAILED","SOURCE_UNAVAILABLE"); return;
        }
        try { assistant.readableCopyTurns(row.getUserId(),row.getSourceConversationId(),row.getConsentRevision(),sourceIds(row)); }
        catch(IllegalArgumentException revoked) { finish(row,"FAILED","SOURCE_UNAVAILABLE"); return; }
        try { requireTarget(row.getUserId(),row.getTargetDeviceId(),row.getTargetProjectKey(),row.getTargetProjectUid()); }
        catch(IllegalArgumentException removed) { finish(row,"FAILED","TARGET_UNAVAILABLE"); }
    }
    private List<Long> sourceIds(MobileAssistantDesktopCopy row) {
        try { return mapper.readValue(row.getSourceTurnIdsJson(),new com.fasterxml.jackson.core.type.TypeReference<List<Long>>() {}); }
        catch(java.io.IOException e) { throw new IllegalStateException("Invalid stored transcript source identity",e); }
    }
    private void requireTarget(Long user,String device,String key,String uid) {
        var target=directories.findByUserIdAndDeviceId(user,device).stream()
                .filter(row->key.equals(row.getProjectKey()) && uid.equals(row.getProjectUid())).findFirst().orElseThrow(MobileAssistantDesktopCopyService::invalidTarget);
        if(target.getProjectType()==null || target.getOwned()==null) throw new IllegalArgumentException(LangText.of(
                "请升级目标桌面端并同步项目目录后重试", "Update the target desktop and sync its project directory before retrying"));
        if(!Boolean.TRUE.equals(target.getOwned()) || target.getProjectType().isBlank()
                || Set.of("SCRATCH","LOOSE_FILES").contains(target.getProjectType())) throw invalidTarget();
    }
    private static IllegalArgumentException invalidTarget() { return new IllegalArgumentException(LangText.of(
            "请选择本人拥有的正式桌面项目并刷新目录", "Select your own formal desktop project and refresh its directory")); }
    private void lock(Long user) { users.lockStorageOwner(user).orElseThrow(()->new IllegalArgumentException("ASSISTANT_COPY_ACCOUNT_NOT_FOUND")); }
    private MobileAssistantDesktopCopy owned(Long user,String request) { return copies.findByUserIdAndRequestId(user,uuid(request))
            .orElseThrow(()->new IllegalArgumentException("ASSISTANT_COPY_NOT_FOUND")); }
    private static String uuid(String value) { String id=ProjectCatalogService.validUid(value); if(id==null) throw new IllegalArgumentException("ASSISTANT_COPY_INVALID_ID"); return id; }
    private static String identity(String value) { if(value==null || value.isBlank() || value.length()>64 || !value.equals(value.trim())) throw new IllegalArgumentException("ASSISTANT_COPY_INVALID_TARGET"); return value; }
    private static void finish(MobileAssistantDesktopCopy row,String status,String error) { row.setStatus(status);row.setError(error);row.setSnapshotJson(null); }
    private static Receipt receipt(MobileAssistantDesktopCopy row) { return new Receipt(row.getRequestId(),row.getStatus(),true,false,
            row.getSourceConversationId(),row.getConversationId(),row.getTargetProjectUid(),row.getTargetDeviceId(),row.getTargetProjectKey(),
            row.getMessageCount(),row.getExpiresAt(),row.getDeliveredAt(),row.getError()); }
}
