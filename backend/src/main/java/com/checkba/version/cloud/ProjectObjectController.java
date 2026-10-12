// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
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
        return Map.of("version", 1, "partBytes", ProjectObjectTransferService.PART_BYTES);
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
                                  HttpServletRequest request) throws IOException {
        authorize(request, projectId, true);
        ObjectRef object = new ObjectRef(sha256, size);
        if (request.getContentLengthLong() != ProjectObjectTransferService.partSize(object, part))
            throw new IllegalArgumentException("Invalid part length");
        locked(projectId, () -> transfers.putPart(projectId, object, part, partSha, request.getInputStream()));
        return Map.of("ok", true);
    }

    @PostMapping("/{sha256}/complete")
    public Map<String, Object> complete(@PathVariable long projectId, @PathVariable String sha256,
                                       @RequestParam long size, HttpServletRequest request) throws IOException {
        authorize(request, projectId, true);
        locked(projectId, () -> transfers.complete(projectId, new ObjectRef(sha256, size)));
        return Map.of("complete", true);
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
            byte[] buffer = new byte[64 * 1024];
            while (length > 0) {
                int n = in.read(buffer, 0, (int)Math.min(buffer.length, length));
                if (n < 0) throw new EOFException("Incomplete object");
                response.getOutputStream().write(buffer, 0, n);
                length -= n;
            }
        }
    }

    @ExceptionHandler(GitAccessDeniedException.class)
    public void denied(GitAccessDeniedException error, HttpServletResponse response) throws IOException {
        if (error.statusCode() == 401) response.setHeader("WWW-Authenticate", "Basic realm=\"AIWorkdeck Git\"");
        response.sendError(error.statusCode());
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public void invalid(HttpServletResponse response) throws IOException { response.sendError(400); }

    @ExceptionHandler(IOException.class)
    public void unavailable(HttpServletResponse response) throws IOException { if (!response.isCommitted()) response.sendError(409); }
}
