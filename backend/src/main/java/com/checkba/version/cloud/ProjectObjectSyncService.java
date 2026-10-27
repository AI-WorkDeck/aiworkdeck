// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version.cloud;

import com.checkba.service.LangText;
import com.checkba.service.mobile.MobileRelayClientService;
import com.checkba.version.ProjectRepoService;
import com.checkba.version.VersionException;
import com.checkba.version.objects.LocalVersionObjectStore;
import com.checkba.version.objects.LocalVersionObjectStore.ObjectRef;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import java.io.*;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import com.checkba.util.DeadlineInputStream;

/** Transfers immutable objects before Git can publish or materialize their references. */
@Service
public class ProjectObjectSyncService {
    private final ProjectRepoService repos;
    private final ObjectProvider<MobileRelayClientService> relay;
    private final ObjectMapper json;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NEVER).build();

    public ProjectObjectSyncService(ProjectRepoService repos, ObjectProvider<MobileRelayClientService> relay,
                                    ObjectMapper json) {
        this.repos = repos; this.relay = relay; this.json = json;
    }

    public void upload(long project, String remoteUrl, String username, String token) {
        Set<ObjectRef> refs = pushedObjects(project);
        if (refs.isEmpty()) return;
        MobileRelayClientService client = relay.getIfAvailable();
        if (client == null) throw VersionException.userFacing(LangText.of(
                "大文件已保存在本机，请开启文件云端备份后再交稿", "Large files are saved locally. Enable cloud file backup before submitting them."));
        String accountScope = client.catalogAccountScope();
        requireConsent(client, accountScope);
        try {
            capabilities(remoteUrl, username, token);
            for (ObjectRef ref : refs) {
                requireConsent(client, accountScope);
                repos.objects().verify(project, ref);
                String base = remoteUrl + "/awd-objects/" + ref.sha256();
                JsonNode state = responseJson(request(base + "?size=" + ref.size(), username, token).GET().build());
                if (state.path("complete").asBoolean()) continue;
                Set<Integer> ready = new HashSet<>();
                state.path("parts").forEach(n -> ready.add(n.asInt(-1)));
                int count = partCount(ref);
                for (int part = 0; part < count; part++) {
                    if (ready.contains(part)) continue;
                    requireConsent(client, accountScope);
                    long length = ProjectObjectTransferService.partSize(ref, part);
                    String hash;
                    try (InputStream in = partStream(project, ref, part)) { hash = LocalVersionObjectStore.fingerprint(in).sha256(); }
                    final int index = part;
                    var publisher = HttpRequest.BodyPublishers.fromPublisher(HttpRequest.BodyPublishers.ofInputStream(() -> {
                        try { return partStream(project, ref, index); }
                        catch (IOException e) { throw new UncheckedIOException(e); }
                    }), length);
                    responseJson(request(base + "/parts/" + part + "?size=" + ref.size(), username, token)
                            .header("Content-Type", "application/octet-stream").header("X-AWD-Part-Sha256", hash).PUT(publisher).build());
                }
                requireConsent(client, accountScope);
                responseJson(request(base + "/complete?size=" + ref.size(), username, token)
                        .POST(HttpRequest.BodyPublishers.noBody()).build());
            }
        } catch (IOException | InterruptedException e) {
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            throw VersionException.userFacing(LangText.of(
                    "大文件尚未完整同步，原文件和版本已保存在本机，请稍后重试交稿",
                    "Large files have not finished syncing. Your local files and versions are safe; retry submitting later."));
        }
    }

    public void download(long project, String remoteUrl, String username, String token, String ref) {
        Set<ObjectRef> needed = new LinkedHashSet<>(repos.objectPointersAt(project, ref, true));
        try (var repository = repos.open(project)) {
            for (var tag : repository.getRefDatabase().getRefsByPrefix("refs/tags/"))
                needed.addAll(repos.objectPointersAt(repository, tag.getName(), true));
        } catch (IOException e) { throw new VersionException("Read version references failed", e); }
        if (needed.isEmpty()) return;
        try {
            for (ObjectRef object : needed) {
                try { repos.objects().verify(project, object); continue; }
                catch (IOException absentOrCorrupt) { /* Download to an atomic temporary file. */ }
                capabilities(remoteUrl, username, token);
                int count = partCount(object);
                Enumeration<InputStream> parts = new Enumeration<>() {
                    int index;
                    public boolean hasMoreElements() { return index < count; }
                    public InputStream nextElement() {
                        int part = index++;
                        try {
                            HttpResponse<InputStream> response = http.send(request(remoteUrl + "/awd-objects/" + object.sha256()
                                    + "/parts/" + part + "?size=" + object.size(), username, token).GET().build(), HttpResponse.BodyHandlers.ofInputStream());
                            long expected = ProjectObjectTransferService.partSize(object, part);
                            if (response.statusCode() != 200 || response.headers().firstValueAsLong("Content-Length").orElse(-1) != expected
                                    || !response.headers().firstValue("Content-Type").orElse("").startsWith("application/octet-stream")) {
                                response.body().close(); throw new IOException("Version object part unavailable");
                            }
                            return new DeadlineInputStream(response.body(), Duration.ofSeconds(90));
                        } catch (IOException e) { throw new UncheckedIOException(e); }
                        catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new UncheckedIOException(new IOException(e)); }
                    }
                };
                try (InputStream in = joinedParts(parts)) { repos.objects().importObject(project, object, in); }
            }
        } catch (IOException | InterruptedException | UncheckedIOException e) {
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            throw VersionException.userFacing(LangText.of(
                    "这份版本的大文件暂时无法取回，尚未替换本地文件，请稍后重试",
                    "Large files for this version are unavailable. Local files have not been replaced; please retry later."));
        }
    }

    private Set<ObjectRef> pushedObjects(long project) {
        Set<ObjectRef> result = new LinkedHashSet<>(repos.objectPointersAt(project, repos.mainBranch(), true));
        try (var repo = repos.open(project)) {
            for (var tag : repo.getRefDatabase().getRefsByPrefix("refs/tags/awd/milestone/"))
                result.addAll(repos.objectPointersAt(repo, tag.getName(), true));
            return result;
        } catch (IOException e) { throw new VersionException("Read version references failed", e); }
    }

    private void capabilities(String url, String user, String token) throws IOException, InterruptedException {
        JsonNode capability = responseJson(request(url + "/awd-objects/capabilities", user, token).GET().build());
        if (capability.path("version").asInt() != 1 || capability.path("partBytes").asInt() != ProjectObjectTransferService.PART_BYTES)
            throw new IOException("Remote does not support version objects");
    }

    private void requireConsent(MobileRelayClientService client, String scope) {
        client.requireCatalogAccountScope(scope);
        client.requireVersionObjectCloudConsent();
        client.requireCatalogAccountScope(scope);
    }

    private HttpRequest.Builder request(String url, String user, String token) {
        URI uri = URI.create(url);
        if (!Set.of("http", "https").contains(uri.getScheme()) || uri.getUserInfo() != null)
            throw new IllegalArgumentException("Unsupported object endpoint");
        String credential = Base64.getEncoder().encodeToString(((user == null ? "" : user) + ":" + token).getBytes(StandardCharsets.UTF_8));
        return HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(90)).header("Authorization", "Basic " + credential);
    }

    private JsonNode responseJson(HttpRequest request) throws IOException, InterruptedException {
        HttpResponse<InputStream> response = http.send(request, HttpResponse.BodyHandlers.ofInputStream());
        try (InputStream in = new DeadlineInputStream(response.body(), Duration.ofSeconds(90))) {
            if (response.statusCode() != 200) throw new IOException("Object endpoint status " + response.statusCode());
            byte[] payload = in.readNBytes(64 * 1024 + 1);
            if (payload.length > 64 * 1024) throw new IOException("Oversized object response");
            JsonNode result = json.readTree(payload);
            if (result == null || !result.isObject() || result.has("code") && result.path("code").asInt(-1) != 0)
                throw new IOException("Invalid object response");
            return result;
        }
    }

    // SequenceInputStream.close() opens every remaining stream in its enumeration. For HTTP parts
    // that would start more downloads while unwinding a failed transfer, still holding the repo lock.
    static InputStream joinedParts(Enumeration<InputStream> parts) {
        return new InputStream() {
            private InputStream current;
            private boolean closed;
            @Override public int read() throws IOException {
                byte[] one = new byte[1];
                return read(one, 0, 1) < 0 ? -1 : one[0] & 0xff;
            }
            @Override public int read(byte[] bytes, int offset, int length) throws IOException {
                Objects.checkFromIndexSize(offset, length, bytes.length);
                if (closed) throw new IOException("Object transfer is closed");
                if (length == 0) return 0;
                while (true) {
                    if (current == null) {
                        if (!parts.hasMoreElements()) return -1;
                        current = parts.nextElement();
                    }
                    int count = current.read(bytes, offset, length);
                    if (count >= 0) return count;
                    current.close();
                    current = null;
                }
            }
            @Override public void close() throws IOException {
                closed = true;
                if (current != null) current.close();
            }
        };
    }

    private int partCount(ObjectRef ref) { return Math.toIntExact(Math.max(1, (ref.size() - 1) / ProjectObjectTransferService.PART_BYTES + 1)); }

    private InputStream partStream(long project, ObjectRef object, int part) throws IOException {
        InputStream source = repos.objects().open(project, object.sha256());
        try { source.skipNBytes((long)part * ProjectObjectTransferService.PART_BYTES); }
        catch (IOException e) { source.close(); throw e; }
        return new FilterInputStream(source) {
            long remaining = ProjectObjectTransferService.partSize(object, part);
            @Override public int read() throws IOException {
                if (remaining == 0) return -1;
                int b = super.read(); if (b != -1) remaining--; return b;
            }
            @Override public int read(byte[] b, int off, int len) throws IOException {
                if (remaining == 0) return -1;
                int n = super.read(b, off, (int)Math.min(len, remaining)); if (n > 0) remaining -= n; return n;
            }
        };
    }
}
