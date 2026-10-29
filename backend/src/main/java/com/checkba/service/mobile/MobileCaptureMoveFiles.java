// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.service.DdOriginalGuard;
import com.checkba.service.LangText;
import com.checkba.service.ProjectFileService;
import com.checkba.storage.StorageService;
import com.checkba.storage.StorageServiceFactory;
import com.checkba.version.WorkSessionService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Service;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.*;

/** Real-byte verification and recoverable source removal, shared by cloud and desktop workers. */
@Service
public class MobileCaptureMoveFiles {
    private final ProjectRepository projects;
    private final ProjectFileRepository files;
    private final MobileCaptureRemovalRepository removals;
    private final ProjectFileService fileService;
    private final StorageServiceFactory storage;
    private final WorkSessionService sessions;
    private final DdOriginalGuard originals;
    private final ObjectMapper mapper;

    public MobileCaptureMoveFiles(ProjectRepository projects, ProjectFileRepository files,
            MobileCaptureRemovalRepository removals, ProjectFileService fileService, StorageServiceFactory storage,
            WorkSessionService sessions, DdOriginalGuard originals, ObjectMapper mapper) {
        this.projects=projects; this.files=files; this.removals=removals; this.fileService=fileService;
        this.storage=storage; this.sessions=sessions; this.originals=originals; this.mapper=mapper;
    }

    public record Verified(Long fileId,String fileUid,String sha256) {}

    public Verified execute(String scope, Long user, MobileMediaMoveService.Command command, Runnable accountGuard) {
        long projectId=Long.parseLong(command.projectKey());
        if(projectId<=0 || projects.findById(projectId).filter(p->user.equals(p.getUserId())).isEmpty())
            throw conflict();
        return sessions.withFileContentWriteLock(projectId, () -> {
            accountGuard.run();
            requireFresh(command);
            if("REMOVE_SOURCE".equals(command.action())) return remove(scope,user,projectId,command,accountGuard);
            if(!"VERIFY_TARGET".equals(command.action())) throw conflict();
            ProjectFile file=locate(projectId,command);
            verify(storage.getStorageService(),file.getFilePath(),command.sha256(),command.fileSize());
            accountGuard.run();
            return new Verified(file.getId(),file.getUid(),command.sha256());
        });
    }

    /** Attach the complete UUID; the historical eight-character filename marker is never an identity. */
    public void rememberCapture(Long projectId,String path,String captureId) {
        List<ProjectFile> found=files.findByProjectId(projectId).stream().filter(f->path.equals(f.getFilePath())
                && !Boolean.TRUE.equals(f.getIsFolder()) && !Boolean.TRUE.equals(f.getIsDeleted())).toList();
        if(found.size()!=1) throw conflict();
        ProjectFile file=found.get(0);
        String existing=captureId(file);
        if(existing!=null && !existing.equals(captureId)) throw conflict();
        try {
            ObjectNode metadata=file.getMetaJson()==null || file.getMetaJson().isBlank() ? mapper.createObjectNode()
                    : (ObjectNode)mapper.readTree(file.getMetaJson());
            metadata.put("mobileCaptureId",captureId);
            file.setMetaJson(mapper.writeValueAsString(metadata));
            files.saveAndFlush(file);
        } catch(Exception e) { throw new IllegalStateException("Cannot persist capture provenance",e); }
    }

    private ProjectFile locate(long projectId,MobileMediaMoveService.Command c) {
        List<ProjectFile> all=files.findByProjectId(projectId).stream().filter(f->!Boolean.TRUE.equals(f.getIsFolder())
                && !Boolean.TRUE.equals(f.getIsDeleted())).toList();
        List<ProjectFile> found;
        if(c.fileUid()!=null) found=all.stream().filter(f->c.fileUid().equals(f.getUid())).toList();
        else {
            found=all.stream().filter(f->c.clientMediaId().equals(captureId(f))).toList();
            if(found.isEmpty()) {
                String path="projects/"+projectId+"/"+c.relativePath();
                found=all.stream().filter(f->path.equals(f.getFilePath()) && captureId(f)==null).toList();
            }
        }
        if(found.size()!=1) throw conflict();
        ProjectFile file=found.get(0);
        if(file.getUid()==null || file.getFilePath()==null || (file.getExternalPath()!=null && !file.getExternalPath().isBlank()))
            throw conflict();
        if(c.fileId()!=null && !c.fileId().equals(file.getId())) throw conflict();
        return file;
    }

    private Verified remove(String scope,Long user,long projectId,MobileMediaMoveService.Command c,Runnable guard) {
        StorageService store=storage.getStorageService();
        MobileCaptureRemoval journal=removals.findByAccountScopeAndRequestId(scope,c.requestId()).orElse(null);
        if(journal==null) {
            ProjectFile source=locate(projectId,c);
            originals.requireMutableTree(source);
            verify(store,source.getFilePath(),c.sha256(),c.fileSize());
            journal=new MobileCaptureRemoval();
            journal.setAccountScope(scope); journal.setRequestId(c.requestId()); journal.setProjectId(projectId);
            journal.setFileId(source.getId()); journal.setFileUid(source.getUid()); journal.setSourcePath(source.getFilePath());
            journal.setQuarantinePath("projects/"+projectId+"/.mobile-moves/"+UUID.fromString(c.requestId())+".pending");
            journal.setSha256(c.sha256()); journal.setFileSize(c.fileSize()); journal.setState("PREPARED");
            // Commit the identity before touching bytes. A retry must never rediscover a same-name replacement.
            journal=removals.saveAndFlush(journal);
        }
        if(!journal.getProjectId().equals(projectId) || !journal.getSha256().equals(c.sha256())
                || journal.getFileSize()!=c.fileSize()) throw conflict();
        Verified done=new Verified(journal.getFileId(),journal.getFileUid(),journal.getSha256());
        if("DONE".equals(journal.getState())) return done;
        guard.run(); requireFresh(c);
        if("PREPARED".equals(journal.getState())) {
            ProjectFile source=files.findById(journal.getFileId()).orElse(null);
            if(source!=null && (!journal.getFileUid().equals(source.getUid())
                    || !journal.getSourcePath().equals(source.getFilePath()) || !journal.getProjectId().equals(source.getProjectId())))
                throw conflict();
            if(source!=null) originals.requireMutableTree(source);
            if(!store.exists(journal.getQuarantinePath())) {
                if(source==null) throw conflict();
                verify(store,journal.getSourcePath(),c.sha256(),c.fileSize());
                guard.run(); requireFresh(c);
                store.moveNew(journal.getSourcePath(),journal.getQuarantinePath());
            }
            verify(store,journal.getQuarantinePath(),c.sha256(),c.fileSize());
            // A writer recreated the old path after quarantine: never remove its row or bytes.
            if(store.exists(journal.getSourcePath())) throw conflict();
            guard.run();
            if(source!=null) fileService.forgetVanished(source.getId(),user);
            journal.setState("DETACHED"); journal=removals.saveAndFlush(journal);
        }
        // DETACHED is committed before physical cleanup. A crash after delete can finish without touching sourcePath.
        if(store.exists(journal.getQuarantinePath())) {
            verify(store,journal.getQuarantinePath(),c.sha256(),c.fileSize());
            guard.run(); store.delete(journal.getQuarantinePath());
            if(store.exists(journal.getQuarantinePath())) throw conflict();
        }
        journal.setState("DONE"); removals.saveAndFlush(journal);
        return done;
    }

    private String captureId(ProjectFile file) {
        if(file.getMetaJson()==null) return null;
        try { return mapper.readTree(file.getMetaJson()).path("mobileCaptureId").asText(null); }
        catch(Exception e) { throw conflict(); }
    }
    static void requireFresh(MobileMediaMoveService.Command c) {
        if(c.expiresAt()<System.currentTimeMillis()) throw new IllegalStateException(
                LangText.of("移动核验已过期，请重新核验目标文件", "Move verification expired; verify the destination again"));
    }
    static void verify(StorageService store,String path,String sha,long size) {
        try(InputStream input=store.load(path).getInputStream()) {
            MessageDigest digest=MessageDigest.getInstance("SHA-256"); byte[] buffer=new byte[65536]; long total=0; int n;
            while((n=input.read(buffer))!=-1) { total+=n; if(total>size) throw conflict(); digest.update(buffer,0,n); }
            if(total!=size || !HexFormat.of().formatHex(digest.digest()).equals(sha)) throw conflict();
        } catch(RuntimeException e) { throw e; }
        catch(Exception e) { throw new IllegalStateException(LangText.of("无法核验归档原件", "Cannot verify the archived original"),e); }
    }
    static IllegalArgumentException conflict() {
        return new IllegalArgumentException(LangText.of("归档文件身份或内容已变化，移动已停止；已生成的目标副本可能仍保留",
                "The archived file identity or content changed. Move stopped; a destination copy may remain"));
    }
}
