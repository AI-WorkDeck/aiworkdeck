// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;

import com.checkba.model.entity.MobileCaptureOrganization;
import com.checkba.repository.*;
import com.checkba.service.FileTagService;
import com.checkba.service.LangText;
import com.checkba.service.TagService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.multipart.MultipartFile;

import java.io.InputStream;
import java.security.MessageDigest;
import java.time.LocalDateTime;
import java.util.*;

/** Opt-in analysis happens before storage; its stable result never renames an already delivered file. */
@Service
public class MobileCaptureOrganizationService {
    public static final String RULE_VERSION="2026-10-30";
    private final MobileCaptureOrganizationRepository records;
    private final UserRepository users;
    private final ProjectRepository projects;
    private final MobileProjectDirRepository directories;
    private final MobileMediaInboxRepository inbox;
    private final MobileCloudReceiptRepository receipts;
    private final MobileTransferRequestRepository transfers;
    private final MobileMediaMoveRepository moves;
    private final CloudStorageQuotaService quota;
    private final MobileCaptureOrganizationEngine engine;
    private final ObjectMapper json;
    private final ProjectFileRepository files;
    private final TagService tags;
    private final FileTagService fileTags;
    private final TransactionTemplate transaction;

    public MobileCaptureOrganizationService(MobileCaptureOrganizationRepository records,UserRepository users,
            ProjectRepository projects,MobileProjectDirRepository directories,MobileMediaInboxRepository inbox,
            MobileCloudReceiptRepository receipts,MobileTransferRequestRepository transfers,
            MobileMediaMoveRepository moves,
            CloudStorageQuotaService quota,MobileCaptureOrganizationEngine engine,ObjectMapper json,
            ProjectFileRepository files,TagService tags,FileTagService fileTags,PlatformTransactionManager manager) {
        this.records=records;this.users=users;this.projects=projects;this.directories=directories;this.inbox=inbox;
        this.receipts=receipts;this.transfers=transfers;this.moves=moves;this.quota=quota;this.engine=engine;this.json=json;
        this.files=files;this.tags=tags;this.fileTags=fileTags;
        transaction=new TransactionTemplate(manager);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    private record Reservation(MobileCaptureOrganization record,boolean run) {}

    public Map<String,Object> prepare(Long user,String device,String project,String clientId,String name,
            String mediaType,LocalDateTime capturedAt,MultipartFile content,boolean enabled) {
        // Plugin document mirroring is a separate, historical overwrite protocol, not field capture.
        if("document".equals(mediaType)) return null;
        if(!enabled && records.findByUserIdAndClientMediaId(user,clientId).isEmpty()
                && moves.findByUserIdAndTargetClientMediaId(user,clientId).isEmpty()) return null;
        if(user==null || ProjectCatalogService.validUid(clientId)==null || device==null || device.isBlank()
                || device.length()>64 || project==null || project.isBlank() || project.length()>64
                || name==null || name.isBlank() || name.length()>512 || !Set.of("image","video","audio").contains(mediaType)
                || content==null || content.getSize()<=0 || content.getSize()>CloudStorageQuotaService.RELAY_BYTES)
            throw bad("采集资料参数无效或文件超过200MB","Invalid capture details or file exceeds 200MB");
        Reservation reservation=transaction.execute(status->reserve(user,device,project,clientId,name,mediaType,content.getSize(),enabled));
        if(reservation==null || reservation.record()==null) return null; // Already stored by an older version.
        MobileCaptureOrganization row=reservation.record();
        if(!reservation.run()) {
            if(row.getSha256()!=null && !row.getSha256().equals(hash(content)))
                throw bad("这份采集的内容已变化，请使用新的采集编号","Capture content changed; use a new capture ID");
            return view(row);
        }
        String fingerprint=hash(content);
        MobileCaptureOrganizationEngine.Result result;
        try {
            result=engine.analyze(user,content,name,mediaType,capturedAt);
        } catch(RuntimeException failure) {
            result=new MobileCaptureOrganizationEngine.Result("failed",safeName(name),List.of(),Map.of());
        }
        final String sha=fingerprint;
        final MobileCaptureOrganizationEngine.Result analyzed=result;
        return transaction.execute(status->{
            users.lockStorageOwner(user).orElseThrow(()->bad("账户不可用","Account unavailable"));
            requireTarget(user,device,project);
            MobileCaptureOrganization current=records.findByUserIdAndClientMediaId(user,clientId)
                    .orElseThrow(()->bad("采集整理记录已撤销","Capture organization was removed"));
            // A concurrent recovery may already have frozen the original name. Never publish a late rename.
            if("processing".equals(current.getState())) {
                current.setState(Set.of("ready","needs_review","skipped","failed").contains(analyzed.state())?analyzed.state():"failed");
                current.setFileName("ready".equals(current.getState()) ? safeName(analyzed.fileName()) : safeName(name));
                current.setTagsJson(write(analyzed.tags()));
                current.setFieldsJson(write(analyzed.fields()));
                current.setSha256(sha);
                records.saveAndFlush(current);
            }
            return view(current);
        });
    }

    private Reservation reserve(Long user,String device,String project,String id,String name,String type,long size,boolean enabled) {
        users.lockStorageOwner(user).orElseThrow(()->bad("账户不可用","Account unavailable"));
        var prior=records.findByUserIdAndClientMediaId(user,id);
        // Existing storage/move receipts are authoritative; a historical organization target must not
        // reject an otherwise valid retry after a move or trigger another model call.
        var relay=inbox.findByUserIdAndClientMediaId(user,id);
        if(relay.isPresent()) {
            if(!device.equals(relay.get().getDeviceId()) || !project.equals(relay.get().getProjectKey())) throw conflict();
            return new Reservation(prior.orElse(null),false);
        }
        var cloud=receipts.findByUserIdAndClientMediaId(user,id);
        if(cloud.isPresent()) {
            if(!"cloud".equals(device) || !project.equals(String.valueOf(cloud.get().getProjectId()))) throw conflict();
            return new Reservation(prior.orElse(null),false);
        }
        if(prior.isPresent()) {
            var row=prior.get();
            if(!device.equals(row.getDeviceId()) || !project.equals(row.getProjectKey()) || !type.equals(row.getMediaType())
                    || size!=row.getFileSize()) throw conflict();
            if("processing".equals(row.getState())) {
                if(row.getStartedAt().isAfter(LocalDateTime.now().minusSeconds(120)))
                    throw bad("这份采集正在整理，请稍后使用同一采集重试","This capture is being organized; retry the same capture shortly");
                // Unknown outcome after a crash: preserve the original and do not automatically pay again.
                row.setState("failed"); records.saveAndFlush(row);
            }
            return new Reservation(row,false);
        }
        MobileCaptureOrganization source=null;
        String movedHash=null;
        var move=moves.findByUserIdAndTargetClientMediaId(user,id);
        if(move.isPresent()) {
            MobileMediaMoveService.Request request=read(move.get().getRequestJson(),new TypeReference<MobileMediaMoveService.Request>(){});
            if(!device.equals(request.targetDeviceId()) || !project.equals(request.targetProjectKey()) || size!=request.fileSize()) throw conflict();
            source=records.findByUserIdAndClientMediaId(user,request.sourceClientMediaId()).orElse(null);
            if(source!=null && (!type.equals(source.getMediaType()) || "processing".equals(source.getState())
                    || (source.getSha256()!=null && !source.getSha256().equals(request.sha256())))) source=null;
            movedHash=request.sha256();
        }
        // Moving an existing capture preserves its organization even with the new-upload option off.
        // The immutable move intent and its byte hash authorize copying this result, never another AI call.
        if(source==null && !enabled) return new Reservation(null,false);
        if(enabled) {
            requireTarget(user,device,project);
            if("cloud".equals(device)) quota.requirePersistentCapacity(user, size);
            else if(inbox.sumPendingBytes(user)+transfers.sumPendingBytes(user)+size>CloudStorageQuotaService.RELAY_BYTES)
                throw bad("云端临时空间已满，请先收取文件","Cloud relay storage is full; collect pending files first");
        }
        var row=new MobileCaptureOrganization();
        row.setUserId(user);row.setDeviceId(device);row.setProjectKey(project);row.setClientMediaId(id);
        row.setOriginalName(name);row.setFileName(safeName(name));row.setMediaType(type);row.setFileSize(size);
        row.setState(enabled?"processing":"disabled");row.setRuleVersion(RULE_VERSION);row.setStartedAt(LocalDateTime.now());
        if(source!=null) {
            requireTarget(user,device,project);
            row.setState(source.getState());row.setOriginalName(source.getOriginalName());row.setFileName(source.getFileName());
            row.setTagsJson(source.getTagsJson());row.setFieldsJson(source.getFieldsJson());row.setRuleVersion(source.getRuleVersion());row.setSha256(movedHash);
        }
        records.saveAndFlush(row);
        return new Reservation(row,source==null && enabled);
    }

    private void requireTarget(Long user,String device,String key) {
        boolean owned;
        if("cloud".equals(device)) {
            try { owned=projects.findById(Long.valueOf(key)).filter(p->user.equals(p.getUserId())).isPresent(); }
            catch(NumberFormatException invalid) { owned=false; }
        } else owned=directories.findByUserIdAndDeviceId(user,device).stream().anyMatch(p->key.equals(p.getProjectKey()));
        if(!owned) throw bad("项目不存在或无权限","Project not found or access denied");
    }

    public Map<String,Object> result(Long user,String id) {
        return records.findByUserIdAndClientMediaId(user,id).map(this::view).orElse(null);
    }

    public void addResult(Long user,String id,Map<String,Object> response) {
        Map<String,Object> result=result(user,id);
        if(result!=null) response.put("organization",result);
    }

    /** Called only with a server-produced result and an already-authorized local project/file. */
    public void attach(Long user,Long project,Long fileId,Map<String,Object> result) {
        if(result==null || "disabled".equals(result.get("state"))) return;
        var file=files.findById(fileId).filter(f->project.equals(f.getProjectId()) && !Boolean.TRUE.equals(f.getIsDeleted()))
                .orElseThrow(()->bad("文件不存在","File not found"));
        if(projects.findById(project).filter(p->user.equals(p.getUserId())).isEmpty())
            throw bad("项目不存在或无权限","Project not found or access denied");
        ObjectNode metadata;
        try { metadata=file.getMetaJson()==null || file.getMetaJson().isBlank() ? json.createObjectNode() : (ObjectNode)json.readTree(file.getMetaJson()); }
        catch(Exception invalid) { throw new IllegalStateException("Invalid capture metadata",invalid); }
        // A retry repairs partial work, but never reinstates tags after a user has edited a completed result.
        if(metadata.has("captureOrganization")) return;
        if(result.get("tags") instanceof List<?> values) for(Object value:values.stream().limit(5).toList()) {
            if(value instanceof String name && !name.isBlank() && name.length()<=40) {
                var tag=tags.getOrCreateSystemTag(project,name);
                fileTags.addTagToFile(fileId,tag.getId(),user);
            }
        }
        metadata.set("captureOrganization",json.valueToTree(result));
        file.setMetaJson(write(metadata));files.saveAndFlush(file);
    }

    private Map<String,Object> view(MobileCaptureOrganization row) {
        Map<String,Object> out=new LinkedHashMap<>();
        out.put("state",row.getState());out.put("originalName",row.getOriginalName());out.put("fileName",row.getFileName());
        if(!"disabled".equals(row.getState())) out.put("archiveName",archiveName(row));
        out.put("tags",read(row.getTagsJson(),new TypeReference<List<String>>(){}));
        out.put("ruleVersion",row.getRuleVersion());out.put("fields",read(row.getFieldsJson(),new TypeReference<Map<String,String>>(){}));
        return out;
    }
    private String write(Object value) {
        try { return json.writeValueAsString(value); } catch(Exception invalid) { throw new IllegalStateException("Invalid organization result",invalid); }
    }
    private <T> T read(String value,TypeReference<T> type) {
        try { return json.readValue(value,type); } catch(Exception invalid) { throw new IllegalStateException("Invalid organization result",invalid); }
    }
    private static String hash(MultipartFile file) {
        try(InputStream in=file.getInputStream()) {
            MessageDigest digest=MessageDigest.getInstance("SHA-256");byte[] buffer=new byte[65536];long length=0;int read;
            while((read=in.read(buffer))!=-1) { length+=read;if(length>CloudStorageQuotaService.RELAY_BYTES) throw conflict();digest.update(buffer,0,read); }
            if(length!=file.getSize()) throw conflict();
            return HexFormat.of().formatHex(digest.digest());
        } catch(Exception invalid) { throw bad("采集内容无法读取，请重试","Unable to read capture content; retry"); }
    }
    static String safeName(String value) {
        String name=Objects.toString(value,"capture").replace('\\','/');name=name.substring(name.lastIndexOf('/')+1);
        name=name.replaceAll("[\\p{Cntrl}<>:\"/\\\\|?*]","_").replaceAll("[. ]+$","").trim();
        if(name.isBlank()) return "capture";
        int dot=name.lastIndexOf('.');
        String ext=dot>0 && name.length()-dot<=17 ? name.substring(dot) : "";
        String stem=ext.isEmpty()?name:name.substring(0,dot);
        return stem.substring(0,Math.min(150,stem.length()))+ext;
    }
    private static String archiveName(MobileCaptureOrganization row) {
        String name=row.getFileName();
        if(!"cloud".equals(row.getDeviceId())) return MobileRelayClientService.landedFileName(name,row.getClientMediaId());
        int dot=name.lastIndexOf('.');
        String ext=dot>0 ? name.substring(dot+1).toLowerCase(Locale.ROOT) : row.getMediaType();
        String stem=dot>0 ? name.substring(0,dot) : name;
        if(stem.length()>100) stem=stem.substring(0,100);
        if(ext.length()>16) ext=row.getMediaType();
        return stem+"-"+row.getClientMediaId()+"."+ext;
    }
    private static IllegalArgumentException conflict() {return bad("这份采集编号已用于其他内容或项目","This capture ID already belongs to other content or a different project");}
    private static IllegalArgumentException bad(String zh,String en) {return new IllegalArgumentException(LangText.of(zh,en));}
}
