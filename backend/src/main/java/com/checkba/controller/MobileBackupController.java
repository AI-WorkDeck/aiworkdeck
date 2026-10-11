// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;

import com.checkba.service.mobile.*;
import com.checkba.exception.UnauthorizedException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.http.*;
import org.springframework.core.io.InputStreamResource;
import java.io.*;
import java.util.*;

@RestController
@RequestMapping("/api/mobile")
public class MobileBackupController {
    private final MobileBackupService backups;
    private final ProjectCatalogService catalog;
    public MobileBackupController(MobileBackupService backups,ProjectCatalogService catalog) { this.backups=backups;this.catalog=catalog; }
    private Long user(String session) {
        Long id=AuthController.getUserIdFromSession(session);
        if(id==null) throw new UnauthorizedException(com.checkba.service.LangText.of("请先登录", "Please sign in first"));return id;
    }
    public record ConsentRequest(Boolean enabled,String consentVersion) {}
    @GetMapping("/backup-consent") public Map<String,Object> consent(@RequestHeader(value="X-Session-Id",required=false) String session) {
        return backups.consent(user(session));
    }
    @PutMapping("/backup-consent") public Map<String,Object> consent(@RequestHeader(value="X-Session-Id",required=false) String session,
            @RequestBody ConsentRequest request) {
        if(request.enabled()==null) throw new IllegalArgumentException(com.checkba.service.LangText.of("缺少备份决定", "Missing backup decision"));
        return backups.consent(user(session),request.enabled(),request.consentVersion());
    }
    @GetMapping("/backup/files") public Map<String,Object> list(@RequestHeader(value="X-Session-Id",required=false) String session,
            @RequestParam String deviceId,@RequestParam(required=false) String projectKey) {
        return Map.of("files",backups.list(user(session),deviceId,projectKey));
    }
    @PutMapping("/backup/files") public Map<String,Object> put(@RequestHeader(value="X-Session-Id",required=false) String session,
            @RequestParam String deviceId,@RequestParam String projectKey,@RequestParam String fileId,@RequestParam String uid,
            @RequestParam String name,@RequestParam String path,@RequestParam(required=false) String parentId,@RequestParam String sha256,
            @RequestParam MultipartFile file) throws IOException {
        try(InputStream in=file.getInputStream()) {
            return backups.put(user(session),deviceId,projectKey,fileId,uid,name,path,parentId,sha256,in,file.getSize());
        }
    }
    @DeleteMapping("/backup/files") public Map<String,Object> delete(@RequestHeader(value="X-Session-Id",required=false) String session,
            @RequestParam String deviceId,@RequestParam String projectKey,@RequestParam String fileId) {
        backups.delete(user(session),deviceId,projectKey,fileId);return Map.of("code",0);
    }
    public record ManifestRequest(String deviceId,String projectKey,List<Map<String,Object>> files,Integer totalCount) {}
    @PutMapping("/backup/manifest") public Map<String,Object> manifest(@RequestHeader(value="X-Session-Id",required=false) String session,
            @RequestBody ManifestRequest request) {
        backups.manifest(user(session),request.deviceId(),request.projectKey(),request.files(),request.totalCount());return Map.of("code",0);
    }
    public record PullRequest(String deviceId,String projectKey,String remoteFileId,String requestId) {}
    @PostMapping("/preview/pull") public Map<String,Object> pull(@RequestHeader(value="X-Session-Id",required=false) String session,
            @RequestBody PullRequest request) {
        var transfer=backups.pull(user(session),request.deviceId(),request.projectKey(),request.remoteFileId(),request.requestId());
        return Map.of("code",0,"id",transfer.getId(),"credits",transfer.getChargedCredits());
    }
    @SuppressWarnings("unchecked")
    @GetMapping("/preview/catalog/{uid}/files/{fileUid}/content") public ResponseEntity<InputStreamResource> content(
            @RequestHeader(value="X-Session-Id",required=false) String session,@PathVariable String uid,@PathVariable String fileUid) throws IOException {
        Long user=user(session);backups.requireEligible(user);
        var selected=((List<Map<String,Object>>)catalog.fileList(user,uid).get("files")).stream()
                .filter(file -> fileUid.equals(file.get("uid")) && !Boolean.TRUE.equals(file.get("isFolder"))).findFirst()
                .orElseThrow(() -> new IllegalArgumentException(com.checkba.service.LangText.of("文件不存在", "File not found")));
        MobilePreviewPolicy.requireSupported((String)selected.get("name"));
        ProjectCatalogService.Content content;
        if ("cloud".equals(selected.get("source"))) content=catalog.content(user,uid,fileUid);
        else content=backups.content(user,(String)selected.get("deviceId"),(String)selected.get("projectKey"),fileUid);
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_OCTET_STREAM).contentLength(content.size())
                .body(new InputStreamResource(content.stream()));
    }
}
