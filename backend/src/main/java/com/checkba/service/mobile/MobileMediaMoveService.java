// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.service.LangText;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.io.*;
import java.security.*;
import java.time.LocalDateTime;
import java.util.*;

/** Account-scoped, idempotent copy/verify/remove coordinator. Never rewrites an existing upload target. */
@Service
public class MobileMediaMoveService {
    private final MobileMediaMoveRepository moves;
    private final MobileCaptureReceiptRepository receipts;
    private final MobileMediaInboxRepository inbox;
    private final MobileCloudReceiptRepository cloud;
    private final MobileProjectDirRepository directory;
    private final ProjectRepository projects;
    private final ProjectFileRepository files;
    private final UserRepository users;
    private final MobileCaptureMoveFiles localFiles;
    private final ObjectMapper mapper;
    private final TransactionTemplate tx;
    private static final long COMMAND_MS=5*60*1000L;

    public MobileMediaMoveService(MobileMediaMoveRepository moves,MobileCaptureReceiptRepository receipts,
            MobileMediaInboxRepository inbox,MobileCloudReceiptRepository cloud,MobileProjectDirRepository directory,
            ProjectRepository projects,ProjectFileRepository files,UserRepository users,MobileCaptureMoveFiles localFiles,
            ObjectMapper mapper,PlatformTransactionManager transactions) {
        this.moves=moves; this.receipts=receipts; this.inbox=inbox; this.cloud=cloud; this.directory=directory;
        this.projects=projects; this.files=files; this.users=users; this.localFiles=localFiles; this.mapper=mapper;
        this.tx=new TransactionTemplate(transactions);
    }
    public record Request(String requestId,String sourceClientMediaId,String targetClientMediaId,
            String sourceDeviceId,String sourceProjectKey,String targetDeviceId,String targetProjectKey,String sha256,long fileSize) {}
    public record View(String requestId,String targetClientMediaId,String status,String error) {}
    record Locator(String deviceId,String projectKey,String clientMediaId,String relativePath,Long fileId,String fileUid,long fileSize,boolean delivered) {}
    public record Command(String requestId,String commandId,long expiresAt,String action,String deviceId,String projectKey,
            String clientMediaId,String sha256,long fileSize,String relativePath,Long fileId,String fileUid) {}
    public record Result(String commandId,String deviceId,String action,boolean success,String sha256,Long fileId,String fileUid,String error) {}
    /** Only thrown before a new intent is saved. Existing/unknown outcomes never use this marker. */
    public static final class NotRegistered extends IllegalArgumentException {
        NotRegistered(String message) { super(message); }
    }

    public View register(Long user,Request r) {
        return tx.execute(ignored -> {
            lock(user);
            MobileMediaMove prior=r==null?null:moves.findByUserIdAndRequestId(user,r.requestId()).orElse(null);
            if(prior!=null) {
                if(!read(prior.getRequestJson(),Request.class).equals(r)) throw conflict();
                return view(prior);
            }
            Locator source;
            try {
                validate(r);
                if(moves.findByUserIdAndSourceClientMediaId(user,r.sourceClientMediaId()).isPresent()
                        || moves.findByUserIdAndSourceClientMediaId(user,r.targetClientMediaId()).isPresent()
                        || moves.findByUserIdAndTargetClientMediaId(user,r.targetClientMediaId()).isPresent()
                        || moves.findByUserIdAndTargetClientMediaId(user,r.sourceClientMediaId())
                                .filter(previous->!"DONE".equals(previous.getStatus())).isPresent()) throw conflict();
                source=locator(user,r.sourceClientMediaId());
                if(source==null || !source.deviceId().equals(r.sourceDeviceId()) || !source.projectKey().equals(r.sourceProjectKey())
                        || source.fileSize()!=r.fileSize()) throw new IllegalArgumentException(LangText.of(
                                "原件归档身份已过期或无法核实，请在桌面端移动；未创建移动任务",
                                "The original archive identity expired or cannot be verified; move it on desktop. No move was created"));
                if(locator(user,r.targetClientMediaId())!=null) throw conflict();
                requireTarget(user,r.targetDeviceId(),r.targetProjectKey());
                requireUnambiguous(user,source);
            } catch(IllegalArgumentException invalid) { throw new NotRegistered(invalid.getMessage()); }
            MobileMediaMove move=new MobileMediaMove(); move.setUserId(user); move.setRequestId(r.requestId());
            move.setSourceClientMediaId(r.sourceClientMediaId()); move.setTargetClientMediaId(r.targetClientMediaId());
            move.setRequestJson(json(r)); move.setSourceJson(json(source)); move.setCreatedAt(LocalDateTime.now());
            phase(move,"WAITING_TARGET"); moves.saveAndFlush(move);
            return view(move);
        });
    }
    public View get(Long user,String id) {
        advanceCloud(user,id);
        return tx.execute(ignored->{lock(user); MobileMediaMove m=owned(user,id); expire(m); return view(m);});
    }
    public View retry(Long user,String id) {
        return tx.execute(ignored->{lock(user); MobileMediaMove m=owned(user,id);
            if("FAILED".equals(m.getStatus())) { phase(m,"WAITING_TARGET"); moves.saveAndFlush(m); }
            else expire(m);
            return view(m);
        });
    }
    public List<Command> commands(Long user,String device) {
        if(device==null || device.isBlank() || device.length()>64) throw conflict();
        return tx.execute(ignored->{lock(user); List<Command> result=new ArrayList<>();
            for(MobileMediaMove m:moves.findByUserId(user)) {
                Command c=command(m); if(c!=null && device.equals(c.deviceId())) result.add(c);
            }
            return result;
        });
    }
    public View result(Long user,String id,Result result) {
        return tx.execute(ignored->{lock(user); MobileMediaMove m=owned(user,id);
            Command c=command(m);
            // Late acknowledgements cannot regress a phase, or resurrect FAILED/DONE.
            if(c==null || !Objects.equals(c.commandId(),result.commandId())) return view(m);
            if(!Objects.equals(c.deviceId(),result.deviceId()) || !Objects.equals(c.action(),result.action())) throw conflict();
            if(!result.success()) {
                m.setStatus("FAILED"); m.setError("ARCHIVE_CHANGED".equals(result.error()) ? conflict().getMessage()
                        : LangText.of("移动未完成；目标副本可能已保留。请重试原请求",
                        "Move did not complete; a destination copy may remain. Retry this request"));
            } else {
                if(!c.sha256().equals(result.sha256()) || result.fileId()==null || result.fileUid()==null
                        || (c.fileId()!=null && !c.fileId().equals(result.fileId()))
                        || (c.fileUid()!=null && !c.fileUid().equals(result.fileUid()))) throw conflict();
                phase(m,"VERIFY_TARGET".equals(c.action())?"WAITING_SOURCE":"DONE");
            }
            moves.saveAndFlush(m); return view(m);
        });
    }

    private Command command(MobileMediaMove m) {
        expire(m);
        Request r=read(m.getRequestJson(),Request.class); Locator destination; String action;
        if("WAITING_TARGET".equals(m.getStatus())) {
            destination=locator(m.getUserId(),r.targetClientMediaId()); action="VERIFY_TARGET";
            if(destination==null || !destination.delivered()) return null;
            if(!destination.deviceId().equals(r.targetDeviceId()) || !destination.projectKey().equals(r.targetProjectKey())
                    || destination.fileSize()!=r.fileSize()) { fail(m); return null; }
        } else if("WAITING_SOURCE".equals(m.getStatus())) {
            destination=read(m.getSourceJson(),Locator.class); action="REMOVE_SOURCE";
            Locator fresh=locator(m.getUserId(),r.sourceClientMediaId());
            if(!destination.delivered() && (fresh==null || !fresh.delivered())) {
                if(fresh==null) fail(m);
                return null;
            }
        } else return null;
        return new Command(m.getRequestId(),m.getCommandId(),m.getCommandExpiresAt(),action,destination.deviceId(),
                destination.projectKey(),destination.clientMediaId(),r.sha256(),r.fileSize(),destination.relativePath(),
                destination.fileId(),destination.fileUid());
    }
    private void expire(MobileMediaMove m) {
        if(Set.of("WAITING_TARGET","WAITING_SOURCE").contains(m.getStatus()) && m.getCommandExpiresAt()<System.currentTimeMillis()) {
            // Reverify destination after any long offline gap; a five-minute-old receipt is not fresh permission to delete.
            phase(m,"WAITING_TARGET"); moves.saveAndFlush(m);
        }
    }
    private void phase(MobileMediaMove m,String state) {
        m.setStatus(state); m.setError(""); m.setCommandId(UUID.randomUUID().toString());
        m.setCommandExpiresAt(System.currentTimeMillis()+COMMAND_MS);
    }
    private void fail(MobileMediaMove m) {
        m.setStatus("FAILED"); m.setError(LangText.of("归档身份无法核实，移动停止；目标副本可能已保留",
                "Archive identity cannot be verified. Move stopped; a destination copy may remain")); moves.saveAndFlush(m);
    }
    private View view(MobileMediaMove m) {return new View(m.getRequestId(),m.getTargetClientMediaId(),m.getStatus(),m.getError());}
    private MobileMediaMove owned(Long user,String id) {
        return moves.findByUserIdAndRequestId(user,id).orElseThrow(()->new IllegalArgumentException(
                LangText.of("移动任务不存在", "Move request not found")));
    }
    private void lock(Long user) {users.lockStorageOwner(user).orElseThrow(MobileMediaMoveService::conflict);}
    private void requireTarget(Long user,String device,String project) {
        if("cloud".equals(device)) {
            Long id=Long.valueOf(project);
            if(projects.findById(id).filter(p->user.equals(p.getUserId())).isEmpty()) throw conflict();
        } else if(directory.findByUserIdAndDeviceId(user,device).stream().noneMatch(p->project.equals(p.getProjectKey()))) throw conflict();
    }
    private Locator locator(Long user,String client) {
        MobileCloudReceipt cloudReceipt=cloud.findByUserIdAndClientMediaId(user,client).orElse(null);
        if(cloudReceipt!=null) {
            ProjectFile file=files.findById(cloudReceipt.getFileId()).filter(f->cloudReceipt.getFileUid().equals(f.getUid())
                    && cloudReceipt.getProjectId().equals(f.getProjectId()) && !Boolean.TRUE.equals(f.getIsDeleted())).orElse(null);
            if(file==null || projects.findById(cloudReceipt.getProjectId()).filter(p->user.equals(p.getUserId())).isEmpty()) return null;
            return new Locator("cloud",cloudReceipt.getProjectId().toString(),client,"",file.getId(),file.getUid(),file.getFileSize(),true);
        }
        MobileCaptureReceipt receipt=receipts.findByUserIdAndClientMediaId(user,client).orElse(null);
        if(receipt!=null) return new Locator(receipt.getDeviceId(),receipt.getProjectKey(),client,receipt.getRelativePath(),
                null,null,receipt.getFileSize(),receipt.getDeliveredAt()!=null);
        MobileMediaInbox item=inbox.findByUserIdAndClientMediaId(user,client).orElse(null);
        if(item==null || !Set.of("audio","image","video").contains(item.getMediaType())) return null;
        return new Locator(item.getDeviceId(),item.getProjectKey(),client,relativePath(item),null,null,item.getFileSize(),item.getDeliveredAt()!=null);
    }
    static String relativePath(MobileMediaInbox item) {
        String date=(item.getCapturedAt()==null?item.getCreatedAt():item.getCapturedAt()).toLocalDate().toString();
        return ("audio".equals(item.getMediaType())?"现场录音":"现场影像")+"/"+date+"/"
                +MobileRelayClientService.landedFileName(item.getFileName(),item.getClientMediaId());
    }
    private void requireUnambiguous(Long user,Locator source) {
        for(MobileMediaInbox row:inbox.findByUserId(user)) {
            if(!row.getClientMediaId().equals(source.clientMediaId()) && row.getDeviceId().equals(source.deviceId())
                    && row.getProjectKey().equals(source.projectKey()) && relativePath(row).equals(source.relativePath())) throw conflict();
        }
        for(MobileCaptureReceipt row:receipts.findByUserId(user)) {
            if(!row.getClientMediaId().equals(source.clientMediaId()) && row.getDeviceId().equals(source.deviceId())
                    && row.getProjectKey().equals(source.projectKey()) && row.getRelativePath().equals(source.relativePath())) throw conflict();
        }
    }
    /** Called inside the relay ACK transaction before the 30-day row may expire. */
    public void rememberRelay(MobileMediaInbox item) {
        if(!Set.of("audio","image","video").contains(item.getMediaType())) return;
        MobileCaptureReceipt r=receipts.findByUserIdAndClientMediaId(item.getUserId(),item.getClientMediaId()).orElse(new MobileCaptureReceipt());
        r.setInboxId(item.getId()); r.setUserId(item.getUserId()); r.setClientMediaId(item.getClientMediaId()); r.setDeviceId(item.getDeviceId());
        r.setProjectKey(item.getProjectKey()); r.setRelativePath(relativePath(item)); r.setFileSize(item.getFileSize());
        r.setDeliveredAt(item.getDeliveredAt()); receipts.saveAndFlush(r);
    }
    public List<Map<String,Object>> deliveredStatus(Long user,List<String> ids) {
        List<Map<String,Object>> result=new ArrayList<>();
        for(String id:ids) receipts.findByUserIdAndClientMediaId(user,id).filter(r->r.getDeliveredAt()!=null)
                .ifPresent(r->result.add(Map.of("clientMediaId",id,"delivered",true,"waitingSeconds",0L)));
        return result;
    }
    public MobileMediaInbox deliveredReplay(Long user,String device,String project,String client) {
        MobileCaptureReceipt receipt=receipts.findByUserIdAndClientMediaId(user,client).orElse(null);
        if(receipt==null || receipt.getDeliveredAt()==null) return null;
        if(!receipt.getDeviceId().equals(device) || !receipt.getProjectKey().equals(project)) throw conflict();
        MobileMediaInbox replay=new MobileMediaInbox(); replay.setId(receipt.getInboxId()); replay.setClientMediaId(client);
        replay.setDeliveredAt(receipt.getDeliveredAt()); return replay;
    }
    /** Uploads and registration share the owner lock, preventing an existing transfer ID from being hijacked. */
    public InputStream checkedUpload(Long user,String device,String project,String client,long size,InputStream bytes) {
        lock(user);
        if(moves.findByUserIdAndSourceClientMediaId(user,client).isPresent()
                && inbox.findByUserIdAndClientMediaId(user,client).isEmpty()
                && receipts.findByUserIdAndClientMediaId(user,client).isEmpty()
                && cloud.findByUserIdAndClientMediaId(user,client).isEmpty()) throw conflict();
        MobileMediaMove move=moves.findByUserIdAndTargetClientMediaId(user,client).orElse(null);
        if(move==null) return bytes;
        Request r=read(move.getRequestJson(),Request.class);
        if(!r.targetDeviceId().equals(device) || !r.targetProjectKey().equals(project) || size!=r.fileSize()) throw conflict();
        try {return new CheckedInput(bytes,r.sha256(),size);} catch(NoSuchAlgorithmException e) {throw new IllegalStateException(e);}
    }
    static class CheckedInput extends FilterInputStream {
        final MessageDigest digest=MessageDigest.getInstance("SHA-256"); final String sha; final long size; long count; boolean checked;
        CheckedInput(InputStream in,String sha,long size) throws NoSuchAlgorithmException {super(in);this.sha=sha;this.size=size;}
        @Override public int read() throws IOException {byte[] b=new byte[1];return read(b,0,1)<0?-1:Byte.toUnsignedInt(b[0]);}
        @Override public int read(byte[] b,int off,int len) throws IOException {
            int n=in.read(b,off,len); if(n>0) {count+=n;digest.update(b,off,n);}
            return n;
        }
        void finish() throws IOException {
            if(!checked) {checked=true;if(count!=size || !sha.equals(HexFormat.of().formatHex(digest.digest())))throw new IOException("Move payload hash mismatch");}
        }
    }
    public static void finishUpload(InputStream input) throws IOException {if(input instanceof CheckedInput checked) checked.finish();}

    @Scheduled(initialDelay=60000,fixedDelay=30000)
    public void advanceCloudMoves() {
        for(MobileMediaMove m:moves.findByStatusIn(Set.of("WAITING_TARGET","WAITING_SOURCE"))) {
            try {advanceCloud(m.getUserId(),m.getRequestId());} catch(RuntimeException failure) { org.slf4j.LoggerFactory.getLogger(MobileMediaMoveService.class)
                    .warn("Capture move {} deferred: {}",m.getRequestId(),failure.getClass().getSimpleName()); }
        }
    }
    private void advanceCloud(Long user,String id) {
        for(int step=0;step<2;step++) {
            Command c=tx.execute(ignored->{lock(user);return command(owned(user,id));});
            if(c==null || !"cloud".equals(c.deviceId())) return;
            Result result;
            try {
                var verified=localFiles.execute("cloud:"+user,user,c,()->{});
                result=new Result(c.commandId(),"cloud",c.action(),true,verified.sha256(),verified.fileId(),verified.fileUid(),null);
            } catch(RuntimeException e) { result=new Result(c.commandId(),"cloud",c.action(),false,null,null,null,e instanceof IllegalArgumentException?"ARCHIVE_CHANGED":null); }
            result(user,id,result);
        }
    }
    private static void validate(Request r) {
        if(r==null) throw conflict();
        for(String uuid:new String[]{r.requestId(),r.sourceClientMediaId(),r.targetClientMediaId()})
            if(uuid==null || !UUID.fromString(uuid).toString().equalsIgnoreCase(uuid)) throw conflict();
        for(String text:new String[]{r.sourceDeviceId(),r.sourceProjectKey(),r.targetDeviceId(),r.targetProjectKey()})
            if(text==null || text.isBlank() || text.length()>64) throw conflict();
        if(r.sha256()==null || !r.sha256().matches("[a-f0-9]{64}") || r.fileSize()<1 || r.fileSize()>209715200L
                || r.sourceClientMediaId().equalsIgnoreCase(r.targetClientMediaId())
                || (r.sourceDeviceId().equals(r.targetDeviceId()) && r.sourceProjectKey().equals(r.targetProjectKey()))) throw conflict();
    }
    private String json(Object v) {try{return mapper.writeValueAsString(v);}catch(Exception e){throw new IllegalStateException(e);}}
    private <T>T read(String json,Class<T> type) {try{return mapper.readValue(json,type);}catch(Exception e){throw new IllegalStateException(e);}}
    private static IllegalArgumentException conflict() {return MobileCaptureMoveFiles.conflict();}
}
