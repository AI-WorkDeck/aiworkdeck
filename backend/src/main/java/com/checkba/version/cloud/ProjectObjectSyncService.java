// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
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

    /**
     * C24 / CEO 2026-11-26: a large-file part may take many minutes on a slow link (#1764), and the repo lock
     * is held meanwhile. The desktop polls this (without the lock) to show 「正在上传大文件 12 / 30 MB」
     * instead of a silent wait. Totals grow per object as the transfer discovers what is missing.
     */
    static final class Transfer {
        final String direction;
        final java.util.concurrent.atomic.AtomicLong total = new java.util.concurrent.atomic.AtomicLong();
        final java.util.concurrent.atomic.AtomicLong done = new java.util.concurrent.atomic.AtomicLong();
        Transfer(String direction) { this.direction = direction; }
    }
    private final Map<Long, Transfer> transfers = new java.util.concurrent.ConcurrentHashMap<>();

    /** {active:false} or {active, direction: upload|download, doneBytes, totalBytes}. Never blocks. */
    public Map<String, Object> transferProgress(long project) {
        Transfer t = transfers.get(project);
        if (t == null || t.total.get() == 0) return Map.of("active", false);
        long total = t.total.get();
        return Map.of("active", true, "direction", t.direction, "doneBytes", Math.min(t.done.get(), total), "totalBytes", total);
    }

    /** Same-sized local file: assumed present for the progress total (verify still hashes it). */
    private boolean looksPresent(long project, ObjectRef object) {
        try {
            java.nio.file.Path path = repos.objects().path(project, object.sha256());
            return java.nio.file.Files.isRegularFile(path, java.nio.file.LinkOption.NOFOLLOW_LINKS)
                    && java.nio.file.Files.size(path) == object.size();
        } catch (IOException | RuntimeException e) { return false; }
    }

    long bytesToDownload(long project, Set<ObjectRef> needed) {
        long total = 0;
        for (ObjectRef object : needed) if (!looksPresent(project, object)) total += object.size();
        return total;
    }

    private static InputStream counting(InputStream in, Transfer t) {
        return new FilterInputStream(in) {
            @Override public int read() throws IOException { int b = super.read(); if (b >= 0) t.done.incrementAndGet(); return b; }
            @Override public int read(byte[] b, int off, int len) throws IOException {
                int n = super.read(b, off, len); if (n > 0) t.done.addAndGet(n); return n;
            }
        };
    }

    public ProjectObjectSyncService(ProjectRepoService repos, ObjectProvider<MobileRelayClientService> relay,
                                    ObjectMapper json) {
        this.repos = repos; this.relay = relay; this.json = json;
    }

    /**
     * One object transfer per case at a time. 交稿 pre-uploads outside the repo lock, and ending a work session
     * starts a background 交稿 too; both saw the same object as missing and PUT it twice (lane C/Q 2026-11-26).
     * The second caller now waits, then finds the object complete and skips it. Never taken inside-out with
     * the repo lock: nothing here acquires the session lock.
     */
    private final Map<Long, java.util.concurrent.locks.ReentrantLock> transferLocks = new java.util.concurrent.ConcurrentHashMap<>();

    private java.util.concurrent.locks.ReentrantLock transferLock(long project) {
        return transferLocks.computeIfAbsent(project, p -> new java.util.concurrent.locks.ReentrantLock());
    }

    public void upload(long project, String remoteUrl, String username, String token) {
        var lock = transferLock(project);
        lock.lock();
        try { uploadExclusive(project, remoteUrl, username, token); }
        finally { lock.unlock(); }
    }

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private org.springframework.beans.factory.ObjectProvider<ProjectObjectPlanService> objectPlans;

    private ProjectObjectPlanService plans() { return objectPlans == null ? null : objectPlans.getIfAvailable(); }

    /** C12: the library refused a free upload (409 FREE_LIMIT); the object is declared local-only instead. */
    static final class FreeLimitReached extends IOException { FreeLimitReached() { super("FREE_LIMIT"); } }

    private void uploadExclusive(long project, String remoteUrl, String username, String token) {
        Set<ObjectRef> refs = pushedObjects(project);
        if (refs.isEmpty()) return;
        MobileRelayClientService client = relay.getIfAvailable();
        String accountScope = client == null ? null : client.catalogAccountScope();
        // C12b：先问案件库哪些对象已经在了。同事早先传好的大文件，再次交稿时只是被历史引用，
        // 不产生新的上传，因此不需要本人开启文件云端备份；只有真要上传的对象才走同意检查。
        Map<String,String> frozenEpoch=null;
        Transfer transfer = new Transfer("upload");
        transfers.put(project, transfer);
        try {
            JsonNode caps = capabilitiesJson(remoteUrl, username, token);
            List<ObjectRef> missing = new ArrayList<>();
            Map<ObjectRef, JsonNode> states = new HashMap<>();
            for (ObjectRef ref : refs) {
                JsonNode state = responseJson(request(remoteUrl + "/awd-objects/" + ref.sha256() + "?size=" + ref.size(), username, token).GET().build());
                if (state.path("complete").asBoolean()) { forgetLocalOnly(project, ref); continue; }
                if (state.path("localOnly").asBoolean()) { recordMine(project, ref); continue; } // declared earlier
                missing.add(ref); states.put(ref, state);
            }
            if (missing.isEmpty()) return;
            boolean consent = client != null && hasConsent(client, accountScope);
            // C12: new library (free allowance fields) and no backup consent: free when it fits, else local-only
            boolean freeCapable = caps.has("freePerFileBytes") && caps.has("freePerProjectBytes") && caps.has("projectFreeUsedBytes");
            if (!consent && !freeCapable) {
                // Old library: today's behaviour (step 1): the lasting backup dialog naming the files still to upload.
                if (client == null) throw VersionException.userFacing(LangText.of(
                        "大文件已保存在本机，请开启文件云端备份后再交稿", "Large files are saved locally. Enable cloud file backup before submitting them."));
                try { requireConsent(client, accountScope); }
                catch (VersionException e) { throw largeFilesNeedBackup(project, e, new LinkedHashSet<>(missing)); }
            }
            // Smallest first, so as many files as possible fit the free allowance.
            missing.sort(java.util.Comparator.comparingLong(ObjectRef::size));
            long perFile = caps.path("freePerFileBytes").asLong(0), budget = caps.path("freePerProjectBytes").asLong(0) - caps.path("projectFreeUsedBytes").asLong(0);
            for (ObjectRef ref : missing) {
                String base = remoteUrl + "/awd-objects/" + ref.sha256();
                String plan;
                if (consent) plan = null; // paid, as today
                else if (ref.size() <= perFile && ref.size() <= budget) { plan = "free"; budget -= ref.size(); }
                else { declareLocalOnly(project, ref, base, username, token, frozenEpoch == null ? Map.of() : frozenEpoch); continue; }
                if (frozenEpoch == null) frozenEpoch=repos.cloudWriteHeaders(project,remoteUrl,username,token);
                try {
                    uploadObject(project, ref, base, username, token, frozenEpoch, states.get(ref), plan, transfer,
                            consent ? () -> requireConsent(client, accountScope) : () -> { });
                } catch (FreeLimitReached raced) {
                    // a colleague used the allowance meanwhile: this file stays local, the submit goes on
                    declareLocalOnly(project, ref, base, username, token, frozenEpoch);
                }
            }
        } catch (IOException | InterruptedException e) {
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            throw VersionException.userFacing(LangText.of(
                    "大文件尚未完整同步，原文件和版本已保存在本机，请稍后重试交稿",
                    "Large files have not finished syncing. Your local files and versions are safe; retry submitting later."));
        } finally {
            transfers.remove(project, transfer);
        }
    }

    private boolean hasConsent(MobileRelayClientService client, String scope) {
        try { requireConsent(client, scope); return true; } catch (RuntimeException e) { return false; }
    }

    private void uploadObject(long project, ObjectRef ref, String base, String username, String token, Map<String,String> frozenEpoch,
                              JsonNode state, String plan, Transfer transfer, Runnable stillAllowed) throws IOException, InterruptedException {
        repos.objects().verify(project, ref);
        Set<Integer> ready = new HashSet<>();
        state.path("parts").forEach(n -> ready.add(n.asInt(-1)));
        int count = partCount(ref);
        for (int part = 0; part < count; part++)
            if (!ready.contains(part)) transfer.total.addAndGet(ProjectObjectTransferService.partSize(ref, part));
        for (int part = 0; part < count; part++) {
            if (ready.contains(part)) continue;
            stillAllowed.run();
            long length = ProjectObjectTransferService.partSize(ref, part);
            String hash;
            try (InputStream in = partStream(project, ref, part)) { hash = LocalVersionObjectStore.fingerprint(in).sha256(); }
            final int index = part;
            var publisher = HttpRequest.BodyPublishers.fromPublisher(HttpRequest.BodyPublishers.ofInputStream(() -> {
                try { return counting(partStream(project, ref, index), transfer); }
                catch (IOException e) { throw new UncheckedIOException(e); }
            }), length);
            responseJsonOrFreeLimit(partUploadRequest(base + "/parts/" + part + "?size=" + ref.size(), username, token, frozenEpoch,
                    hash, length, publisher, plan));
        }
        stillAllowed.run();
        var complete = writeRequest(base + "/complete?size=" + ref.size(), username, token, frozenEpoch);
        if (plan != null) complete.header("X-AWD-Object-Plan", plan);
        responseJson(complete.POST(HttpRequest.BodyPublishers.noBody()).build());
        forgetLocalOnly(project, ref);
    }

    /** C12: this file stays on this computer (「仅在本机（未共享）」); the push goes ahead without it. */
    private void declareLocalOnly(long project, ObjectRef ref, String base, String username, String token,
                                  Map<String,String> frozenEpoch) throws IOException, InterruptedException {
        String path = firstPathOf(project, ref);
        String body = json.writeValueAsString(Map.of("pathHint", path == null ? "" : path));
        var builder = request(base + "/local-only?size=" + ref.size(), username, token);
        frozenEpoch.forEach(builder::header);
        responseJson(builder.header("Content-Type", "application/json").PUT(HttpRequest.BodyPublishers.ofString(body)).build());
        recordMine(project, ref);
    }

    private String firstPathOf(long project, ObjectRef ref) {
        List<String> paths = repos.objectPointerPaths(project, repos.mainBranch(), true, 1, ref::equals);
        return paths.isEmpty() ? null : paths.get(0);
    }

    private void recordMine(long project, ObjectRef ref) {
        var plans = plans();
        if (plans != null) plans.recordLocalOnly(project, ref, firstPathOf(project, ref), null, true);
    }

    private void forgetLocalOnly(long project, ObjectRef ref) {
        var plans = plans();
        if (plans != null && plans.hasLocalOnly(project)) plans.forgetLocalOnly(project, ref);
    }

    /** Names of the files this computer keeps local-only for the case (for the 交稿 result). */
    public List<String> localOnlyMine(long project) {
        var plans = plans();
        if (plans == null) return List.of();
        List<String> names = new ArrayList<>();
        for (var row : plans.localOnly(project))
            if (Boolean.TRUE.equals(row.getMine())) names.add(row.getNameHint() == null ? "" : row.getNameHint());
        return names;
    }

    public void download(long project, String remoteUrl, String username, String token, String ref) {
        var lock = transferLock(project);
        lock.lock();
        try { downloadExclusive(project, remoteUrl, username, token, ref); }
        finally { lock.unlock(); }
    }

    private void downloadExclusive(long project, String remoteUrl, String username, String token, String ref) {
        Set<ObjectRef> needed = new LinkedHashSet<>(repos.objectPointersAt(project, ref, true));
        try (var repository = repos.open(project)) {
            for (var tag : repository.getRefDatabase().getRefsByPrefix("refs/tags/"))
                needed.addAll(repos.objectPointersAt(repository, tag.getName(), true));
        } catch (IOException e) { throw new VersionException("Read version references failed", e); }
        if (needed.isEmpty()) return;
        Transfer transfer = new Transfer("download");
        // Lane C round 2: the total grew 60 → 90 MB mid-pull. Size it up front from a cheap presence check;
        // the full hash check below still decides what is downloaded.
        transfer.total.set(bytesToDownload(project, needed));
        transfers.put(project, transfer);
        try {
            for (ObjectRef object : needed) {
                try { repos.objects().verify(project, object); continue; }
                catch (IOException absentOrCorrupt) { /* Download to an atomic temporary file. */ }
                // A same-sized but corrupt local copy was not counted up front; count it now that it is re-downloaded.
                if (looksPresent(project, object)) transfer.total.addAndGet(object.size());
                capabilities(remoteUrl, username, token);
                // C12: kept on the sharer's computer: remember the placeholder, the rest of the version still comes
                JsonNode state = responseJson(request(remoteUrl + "/awd-objects/" + object.sha256() + "?size=" + object.size(), username, token).GET().build());
                if (!state.path("complete").asBoolean() && state.path("localOnly").asBoolean()) {
                    var plans = plans();
                    if (plans != null) plans.recordLocalOnly(project, object,
                            state.path("nameHint").asText(null), state.path("declaredByName").asText(null), false);
                    transfer.total.addAndGet(-object.size());
                    continue;
                }
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
                            return new DeadlineInputStream(response.body(), partTimeout(expected));
                        } catch (IOException e) { throw new UncheckedIOException(e); }
                        catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new UncheckedIOException(new IOException(e)); }
                    }
                };
                try (InputStream in = counting(joinedParts(parts), transfer)) { repos.objects().importObject(project, object, in); }
                forgetLocalOnly(project, object); // it arrived: no placeholder any more
            }
        } catch (IOException | InterruptedException | UncheckedIOException e) {
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            throw VersionException.userFacing(LangText.of(
                    "这份版本的大文件暂时无法取回，尚未替换本地文件，请稍后重试",
                    "Large files for this version are unavailable. Local files have not been replaced; please retry later."));
        } finally {
            transfers.remove(project, transfer);
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
        capabilitiesJson(url, user, token);
    }

    /** C12: the free allowance fields come with the capabilities (absent on older libraries). */
    private JsonNode capabilitiesJson(String url, String user, String token) throws IOException, InterruptedException {
        JsonNode capability = responseJson(request(url + "/awd-objects/capabilities", user, token).GET().build());
        if (capability.path("version").asInt() != 1 || capability.path("partBytes").asInt() != ProjectObjectTransferService.PART_BYTES)
            throw new IOException("Remote does not support version objects");
        return capability;
    }

    /**
     * C12：保存时就提醒，而不是等到交稿才说。主线（含历史）里有大文件、而文件云端备份没开（或云端
     * 计费不可用）时，回这些文件的路径（最多 4 个）；没有大文件、或已经可以交，回空表。
     * C12b：案件库已经有的对象交稿时不用再传，也就不需要备份——只有确实缺对象时才提醒，否则同事
     * 打开一份早有录像的案卷就会看到一条假警告。会联网，所以只在联网核对云端状态时调用。
     */
    public List<String> largeFilesBlockingSubmit(long project, String remoteUrl, String username, String token) {
        Set<ObjectRef> refs = pushedObjects(project);
        if (refs.isEmpty()) return List.of();
        MobileRelayClientService client = relay.getIfAvailable();
        try {
            if (client == null) throw new IllegalStateException("no relay");
            client.requireVersionObjectCloudConsent();
            return List.of();
        } catch (RuntimeException noBackup) { /* Blocked only if something still has to be uploaded. */ }
        Set<ObjectRef> missing;
        try {
            // C12: on a library with the free allowance, large files never block 交稿 (free or local-only)
            JsonNode caps = capabilitiesJson(remoteUrl, username, token);
            if (caps.has("freePerFileBytes")) return List.of();
            missing = missingOnServer(refs, remoteUrl, username, token);
            if (missing.isEmpty()) return List.of();
        } catch (IOException | InterruptedException e) {
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            // Unknown: keep the early warning; 交稿 itself still asks the server first.
            missing = refs;
        }
        List<String> paths = repos.objectPointerPaths(project, repos.mainBranch(), true, 4, missing::contains);
        return paths.isEmpty() ? List.of("") : paths;
    }

    /** Objects the case library doesn't hold complete. */
    private Set<ObjectRef> missingOnServer(Set<ObjectRef> refs, String remoteUrl, String username, String token)
            throws IOException, InterruptedException {
        capabilities(remoteUrl, username, token);
        Set<ObjectRef> missing = new LinkedHashSet<>();
        for (ObjectRef ref : refs) {
            JsonNode state = responseJson(request(remoteUrl + "/awd-objects/" + ref.sha256() + "?size=" + ref.size(), username, token).GET().build());
            if (!state.path("complete").asBoolean()) missing.add(ref);
        }
        return missing;
    }

    /**
     * C12：交稿被「文件云端备份」挡住时，说清是哪几个文件、该去哪里开、为什么删文件也没用——
     * 删掉只影响以后的版本，已经保存的版本里仍有它。kind 让桌面端弹一个带按钮、不会消失的说明。
     */
    private VersionException largeFilesNeedBackup(long project, VersionException cause, Set<ObjectRef> missing) {
        List<String> paths = repos.objectPointerPaths(project, repos.mainBranch(), true, 4, missing::contains);
        String names = String.join("、", paths.stream().limit(3).map(p -> p.contains("/") ? p.substring(p.lastIndexOf('/') + 1) : p).toList())
                + (paths.size() > 3 ? LangText.of(" 等", " and more") : "");
        String which = names.isBlank() ? "" : LangText.of("（" + names + "）", " (" + names.replace("、", ", ") + ")");
        return VersionException.largeFilesNeedBackup(LangText.of(
                "这份案卷里有大文件或音视频" + which + "，要先开启“文件云端备份”才能交稿。"
                        + "删掉这个文件也不行：已经保存的版本里还有它。开启后再点交稿即可，本机文件不受影响。",
                "This case file contains large or audio/video files" + which + ". Turn on cloud file backup before "
                        + "submitting. Deleting the file won't help: saved versions still contain it. "
                        + "After turning it on, submit again; your local files are unaffected."));
    }

    private void requireConsent(MobileRelayClientService client, String scope) {
        client.requireCatalogAccountScope(scope);
        client.requireVersionObjectCloudConsent();
        client.requireCatalogAccountScope(scope);
    }

    private HttpRequest.Builder request(String url, String user, String token) throws IOException {
        return staticRequest(url, user, token);
    }

    private static HttpRequest.Builder staticRequest(String url, String user, String token) throws IOException {
        URI uri = URI.create(url);
        if (!Set.of("http", "https").contains(uri.getScheme()) || uri.getUserInfo() != null)
            throw new IllegalArgumentException("Unsupported object endpoint");
        String credential = Base64.getEncoder().encodeToString(((user == null ? "" : user) + ":" + token).getBytes(StandardCharsets.UTF_8));
        var builder=HttpRequest.newBuilder(uri).timeout(CALL_TIMEOUT).header("Authorization", "Basic " + credential);
        return builder;
    }

    /** Slowest link a part must still get through: 32 KiB/s (~260 kbit/s, weak 4G or hotel Wi-Fi). */
    private static final long SLOWEST_BYTES_PER_SECOND = 32 * 1024;
    private static final Duration CALL_TIMEOUT = Duration.ofSeconds(90);

    /**
     * A part transfer's time limit. A fixed 90 s aborted every 32 MiB part below ~3 Mbit/s, so a recording
     * could never be submitted or pulled on a slow link. Bounded, so a dead link still releases the repo lock.
     */
    static Duration partTimeout(long bytes) {
        return CALL_TIMEOUT.plusSeconds(Math.max(0, bytes) / SLOWEST_BYTES_PER_SECOND);
    }

    static HttpRequest partUploadRequest(String url, String user, String token, Map<String,String> frozenEpoch,
                                         String partSha256, long length, HttpRequest.BodyPublisher body) {
        return partUploadRequest(url, user, token, frozenEpoch, partSha256, length, body, null);
    }

    static HttpRequest partUploadRequest(String url, String user, String token, Map<String,String> frozenEpoch,
                                         String partSha256, long length, HttpRequest.BodyPublisher body, String plan) {
        try {
            var builder = staticRequest(url, user, token).timeout(partTimeout(length));
            frozenEpoch.forEach(builder::header);
            if (plan != null) builder.header("X-AWD-Object-Plan", plan);
            return builder.header("Content-Type", "application/octet-stream").header("X-AWD-Part-Sha256", partSha256)
                    .PUT(body).build();
        } catch (IOException e) { throw new UncheckedIOException(e); }
    }

    private HttpRequest.Builder writeRequest(String url,String user,String token,Map<String,String> frozenEpoch) throws IOException {
        var builder=request(url,user,token);frozenEpoch.forEach(builder::header);return builder;
    }

    /** Like responseJson, but a 409 {"code":"FREE_LIMIT"} becomes {@link FreeLimitReached}. */
    private JsonNode responseJsonOrFreeLimit(HttpRequest request) throws IOException, InterruptedException {
        HttpResponse<InputStream> response = http.send(request, HttpResponse.BodyHandlers.ofInputStream());
        try (InputStream in = new DeadlineInputStream(response.body(), Duration.ofSeconds(90))) {
            byte[] payload = in.readNBytes(64 * 1024 + 1);
            if (payload.length > 64 * 1024) throw new IOException("Oversized object response");
            if (response.statusCode() == 409) {
                JsonNode body = payload.length == 0 ? null : json.readTree(payload);
                if (body != null && "FREE_LIMIT".equals(body.path("code").asText())) throw new FreeLimitReached();
            }
            if (response.statusCode() != 200) throw new IOException("Object endpoint status " + response.statusCode());
            JsonNode result = json.readTree(payload);
            if (result == null || !result.isObject() || result.has("code") && result.path("code").asInt(-1) != 0)
                throw new IOException("Invalid object response");
            return result;
        }
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
