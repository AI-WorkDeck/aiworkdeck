// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version.cloud;

import com.checkba.version.ProjectRepoService;
import com.checkba.version.WorkSessionService;
import com.checkba.version.objects.LocalVersionObjectStore.ObjectRef;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.bind.annotation.*;

import java.io.*;
import java.nio.file.Files;
import java.util.Map;

/** Separate from personal backup: project membership authorizes collaboration replicas. */
@RestController
@RequestMapping("/git/{projectId}.git/awd-objects")
public class ProjectObjectController {
    @org.springframework.beans.factory.annotation.Autowired(required=false)
    private com.checkba.service.mobile.CloudProtocolDownloadService downloads;
    @org.springframework.beans.factory.annotation.Autowired(required=false)
    private CloudGitWriteGuard cloudWrites;
    @org.springframework.beans.factory.annotation.Autowired(required=false)
    private ProjectObjectPlanService plans;

    private final GitAccessService access;
    private final ProjectRepoService repos;
    private final WorkSessionService sessions;
    private final ProjectObjectTransferService transfers;

    public ProjectObjectController(GitAccessService access, ProjectRepoService repos,
                                   WorkSessionService sessions, ProjectObjectTransferService transfers) {
        this.access = access; this.repos = repos; this.sessions = sessions; this.transfers = transfers;
    }

    private void authorize(HttpServletRequest request, long project, boolean write) {
        access.authorize(request, project, write);
        if (!repos.isInitialized(project)) throw new org.springframework.web.server.ResponseStatusException(
                org.springframework.http.HttpStatus.NOT_FOUND);
    }

    @GetMapping("/capabilities")
    public Map<String, Object> capabilities(@PathVariable long projectId, HttpServletRequest request) {
        authorize(request, projectId, false);
        // C12: version stays 1 (0.91 desktops check it); new fields are only added.
        if (plans == null) return Map.of("version", 1, "partBytes", ProjectObjectTransferService.PART_BYTES);
        return Map.of("version", 1, "partBytes", ProjectObjectTransferService.PART_BYTES,
                "freePerFileBytes", plans.freePerFileBytes(), "freePerProjectBytes", plans.freePerProjectBytes(),
                "projectFreeUsedBytes", plans.projectFreeUsedBytes(projectId));
    }

    @GetMapping("/{sha256}")
    public Map<String, Object> status(@PathVariable long projectId, @PathVariable String sha256,
                                     @RequestParam long size, HttpServletRequest request) throws IOException {
        authorize(request, projectId, false);
        return transfers.status(projectId, new ObjectRef(sha256, size));
    }

    @PutMapping("/{sha256}/parts/{part}")
    public Map<String, Object> put(@PathVariable long projectId, @PathVariable String sha256,
                                  @PathVariable int part, @RequestParam long size,
                                  @RequestHeader("X-AWD-Part-Sha256") String partSha,
                                  @RequestHeader(value = "X-AWD-Object-Plan", required = false) String plan,
                                  HttpServletRequest request) throws IOException {
        authorize(request, projectId, true);
        ObjectRef object = new ObjectRef(sha256, size);
        Runnable freeReservation = "free".equalsIgnoreCase(plan) && plans != null ? () -> plans.reserveFree(projectId, object) : null;
        if (request.getContentLengthLong() != ProjectObjectTransferService.partSize(object, part))
            throw new IllegalArgumentException("Invalid part length");
        transfers.putPart(projectId, object, part, partSha, request.getInputStream(),
                publish -> sessions.runLocked(projectId, () -> {
                    authorize(request, projectId, true);
                    if(cloudWrites==null)publish.run();
                    else cloudWrites.write(projectId,null,publish);
                }), freeReservation);
        return Map.of("ok", true);
    }

    @PostMapping("/{sha256}/complete")
    public Map<String, Object> complete(@PathVariable long projectId, @PathVariable String sha256,
                                       @RequestParam long size, HttpServletRequest request) throws IOException {
        authorize(request, projectId, true);
        locked(projectId, () -> {
            authorize(request, projectId, true);
            Runnable publication=()->{try {
                ObjectRef completed=new ObjectRef(sha256,size);
                transfers.complete(projectId,completed);
                if(plans!=null)plans.markComplete(projectId,completed); // C12: reservation permanent, declaration ends
            }catch(IOException e){throw new UncheckedIOException(e);}};
            if(cloudWrites==null)publication.run();else cloudWrites.write(projectId,null,publication);
        });
        return Map.of("complete", true);
    }

    /**
     * C12: this object stays on the sharer's computer (over the free allowance, no paid backup). History may then
     * reference it and pre-receive accepts it. Only members with write access; the size must match the pointer
     * (pre-receive checks sha + size); idempotent per (project, sha).
     */
    @PutMapping("/{sha256}/local-only")
    public Map<String, Object> declareLocalOnly(@PathVariable long projectId, @PathVariable String sha256,
                                                @RequestParam long size, @RequestBody(required = false) Map<String, Object> body,
                                                HttpServletRequest request) {
        long userId = access.authorize(request, projectId, true).userId();
        if (!repos.isInitialized(projectId)) throw new org.springframework.web.server.ResponseStatusException(
                org.springframework.http.HttpStatus.NOT_FOUND);
        if (plans == null) throw new org.springframework.web.server.ResponseStatusException(
                org.springframework.http.HttpStatus.NOT_IMPLEMENTED);
        String hint = body != null && body.get("pathHint") instanceof String s ? s : null;
        plans.declareLocalOnly(projectId, new ObjectRef(sha256, size), userId, hint);
        return Map.of("ok", true);
    }

    @FunctionalInterface private interface IoAction { void run() throws IOException; }
    private void locked(long projectId, IoAction action) throws IOException {
        try { sessions.runLocked(projectId, () -> {
            try { action.run(); } catch (IOException e) { throw new UncheckedIOException(e); }
        }); } catch (UncheckedIOException e) { throw e.getCause(); }
    }

    @GetMapping("/{sha256}/parts/{part}")
    public void download(@PathVariable long projectId, @PathVariable String sha256,
                         @PathVariable int part, @RequestParam long size,
                         HttpServletRequest request, HttpServletResponse response) throws IOException {
        authorize(request, projectId, false);
        ObjectRef object = new ObjectRef(sha256, size);
        long length = ProjectObjectTransferService.partSize(object, part);
        // Opening through the store rejects symlinks; the receiver verifies the whole object's hash.
        try (InputStream in = repos.objects().open(projectId, sha256)) {
            if (Files.size(repos.objects().path(projectId, sha256)) != size) throw new IOException("Object size mismatch");
            in.skipNBytes((long) part * ProjectObjectTransferService.PART_BYTES);
            response.setContentType("application/octet-stream");
            response.setHeader("Cache-Control", "no-store");
            response.setContentLengthLong(length);
            if(downloads!=null && downloads.enabled()) {
                long account=access.authorize(request,projectId,false).userId();
                final long partLength=length;
                InputStream bounded=new FilterInputStream(in) {
                    long left=partLength;
                    public int read() throws IOException {if(left==0)return -1;int n=super.read();if(n>=0)left--;return n;}
                    public int read(byte[] b,int off,int len) throws IOException {if(left==0)return -1;int n=super.read(b,off,(int)Math.min(left,len));if(n>0)left-=n;return n;}
                };
                downloads.deliver(account,"git-object:"+projectId+":"+sha256+":"+part,bounded,length,request,response);
                return;
            }
            byte[] buffer = new byte[64 * 1024];
            final long total = length;
            while (length > 0) {
                int n = in.read(buffer, 0, (int)Math.min(buffer.length, length));
                if (n < 0) throw new EOFException("Incomplete object");
                response.getOutputStream().write(buffer, 0, n);
                length -= n;
            }
            if(downloads!=null && downloads.shadowActive())
                downloads.shadowDelivered(access.authorize(request,projectId,false).userId(),"git-object:"+projectId+":"+sha256+":"+part,total);
        }
    }

    @ExceptionHandler(GitAccessDeniedException.class)
    public void denied(GitAccessDeniedException error, HttpServletResponse response) throws IOException {
        if (error.statusCode() == 401) response.setHeader("WWW-Authenticate", "Basic realm=\"AIWorkdeck Git\"");
        response.sendError(error.statusCode());
    }

    /** C12: over the free allowance → 409 with the numbers; the desktop then declares the file local-only. */
    @ExceptionHandler(ProjectObjectPlanService.FreeLimitException.class)
    public org.springframework.http.ResponseEntity<Map<String, Object>> freeLimit(ProjectObjectPlanService.FreeLimitException e) {
        return org.springframework.http.ResponseEntity.status(409).body(e.body());
    }

    /**
     * Billing refusals used to be a bare 400, indistinguishable from a malformed part (lane C/Q 11-26). They are now
     * 409 with a named code; real protocol errors (part length, hash) stay 400.
     */
    @ExceptionHandler(IllegalArgumentException.class)
    public org.springframework.http.ResponseEntity<Map<String, Object>> invalid(IllegalArgumentException e) {
        String message = e.getMessage();
        String code = billingCode(message);
        if (code != null) return org.springframework.http.ResponseEntity.status(409).body(Map.of("code", code, "message", message));
        return org.springframework.http.ResponseEntity.status(400).build();
    }

    static String billingCode(String message) {
        if (message == null) return null;
        try {
            if (message.equals(com.checkba.service.mobile.CloudBillingText.get("storageLimit"))) return "STORAGE_LIMIT";
            if (message.equals(com.checkba.service.mobile.CloudBillingText.get("writesPaused"))) return "WRITES_PAUSED";
        } catch (RuntimeException unknownToken) { return null; }
        return null;
    }

    @ExceptionHandler(IOException.class)
    public void unavailable(HttpServletResponse response) throws IOException { if (!response.isCommitted()) response.sendError(409); }
}
