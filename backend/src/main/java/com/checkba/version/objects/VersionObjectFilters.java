// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.version.objects;

import org.eclipse.jgit.attributes.FilterCommand;
import org.eclipse.jgit.attributes.FilterCommandRegistry;
import org.eclipse.jgit.lib.Constants;
import org.eclipse.jgit.lib.ObjectId;
import org.eclipse.jgit.lib.ObjectLoader;
import org.eclipse.jgit.lib.Repository;
import org.eclipse.jgit.util.TemporaryBuffer;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Path;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/** JGit adapters: status only fingerprints; staging persists; checkout decodes declared paths only. */
public final class VersionObjectFilters {
    private static final String CLEAN = "jgit://awd/clean";
    private static final String MEDIA = "jgit://awd/media";
    private static final Set<String> MEDIA_EXTENSIONS = Set.of("mp3", "mp4", "m4a", "m4v", "wav", "webm",
            "mov", "avi", "mkv", "ogg", "oga", "ogv", "flac", "aac", "wma", "wmv", "aiff", "aif",
            "opus", "amr", "3gp", "mpeg", "mpg");
    private static final ThreadLocal<Boolean> STAGING = ThreadLocal.withInitial(() -> false);
    private static final ThreadLocal<Map<String, Set<LocalVersionObjectStore.ObjectRef>>> MATERIALIZING =
            ThreadLocal.withInitial(Map::of);
    private static final Map<Path, Context> CONTEXTS = new ConcurrentHashMap<>();
    private record Context(LocalVersionObjectStore store, long projectId, long threshold,
                           Map<ObjectId, LocalVersionObjectStore.ObjectRef> legacyHashes) {}

    static {
        FilterCommandRegistry.register(CLEAN, (repo, in, out) -> clean(repo, in, out, false, null));
        FilterCommandRegistry.register(MEDIA, (repo, in, out) -> clean(repo, in, out, true, null));
    }

    private VersionObjectFilters() {}

    public static void install(Repository repo, LocalVersionObjectStore store, long projectId, long threshold)
            throws IOException {
        Path key = repo.getDirectory().toPath().toAbsolutePath().normalize();
        Context previous = CONTEXTS.get(key);
        CONTEXTS.put(key, new Context(store, projectId, threshold,
                previous == null ? new ConcurrentHashMap<>() : previous.legacyHashes()));
        var config = repo.getConfig();
        // Commands are registered in-process, never executed by a shell.
        config.setString("filter", "awd-content", "clean", CLEAN);
        config.setBoolean("filter", "awd-content", "required", true);
        config.setString("filter", "awd-media", "clean", MEDIA);
        config.setBoolean("filter", "awd-media", "required", true);
        var rules = new java.util.ArrayList<org.eclipse.jgit.attributes.AttributesRule>();
        rules.add(new org.eclipse.jgit.attributes.AttributesRule("*", "filter=awd-content -text"));
        for (String extension : MEDIA_EXTENSIONS.stream().sorted().toList()) {
            StringBuilder pattern = new StringBuilder("*.");
            for (char c : extension.toCharArray()) {
                if (Character.isLetter(c)) pattern.append('[').append(c).append(Character.toUpperCase(c)).append(']');
                else pattern.append(c);
            }
            rules.add(new org.eclipse.jgit.attributes.AttributesRule(pattern.toString(), "filter=awd-media -text"));
        }
        Set<String> paths = new java.util.TreeSet<>(MATERIALIZING.get().keySet());
        var index = repo.readDirCache();
        for (int i = 0; i < index.getEntryCount(); i++) paths.add(index.getEntry(i).getPathString());
        for (String path : paths) {
            if (path.startsWith(".awd/")) continue;
            String name = "awd-path-" + ObjectId.fromRaw(sha1((key + "\n" + path).getBytes(StandardCharsets.UTF_8))).name();
            String clean = "jgit://awd/" + name + "/clean";
            String smudge = "jgit://awd/" + name + "/smudge";
            FilterCommandRegistry.register(clean, (r, in, out) -> clean(r, in, out, isMedia(path), path));
            FilterCommandRegistry.register(smudge, (r, in, out) -> smudge(r, in, out, path));
            config.setString("filter", name, "clean", clean);
            config.setString("filter", name, "smudge", smudge);
            config.setBoolean("filter", name, "required", true);
            rules.add(new org.eclipse.jgit.attributes.AttributesRule(quotePattern(path), "filter=" + name + " -text"));
        }
        rules.add(new org.eclipse.jgit.attributes.AttributesRule(".awd/**", "-filter"));
        if (!(repo instanceof VersionObjectRepository versionRepo)) {
            throw new IOException("Version repository adapter is required");
        }
        versionRepo.setVersionRules(rules);
    }

    private static byte[] sha1(byte[] input) {
        try { return java.security.MessageDigest.getInstance("SHA-1").digest(input); }
        catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }

    private static String quotePattern(String path) {
        StringBuilder escaped = new StringBuilder("/");
        for (char c : path.toCharArray()) {
            if ("\\*?[".indexOf(c) >= 0) escaped.append('\\');
            escaped.append(c);
        }
        return escaped.toString();
    }

    private static boolean isMedia(String path) {
        int dot = path.lastIndexOf('.');
        return dot >= 0 && MEDIA_EXTENSIONS.contains(path.substring(dot + 1).toLowerCase(java.util.Locale.ROOT));
    }

    public interface Action<T> { T run() throws Exception; }

    public static <T> T staging(Action<T> action) throws Exception {
        boolean previous = STAGING.get();
        STAGING.set(true);
        try { return action.run(); }
        finally { STAGING.set(previous); }
    }

    /** Insert verified historical bytes using the new-snapshot rules, never the working file or old index. */
    public static ObjectId insertSnapshot(Repository repo, String relativePath, InputStream source) throws IOException {
        TemporaryBuffer.LocalFile encoded = new TemporaryBuffer.LocalFile(null);
        boolean previous = STAGING.get();
        STAGING.set(true);
        try (source) {
            // null deliberately bypasses legacy-index preservation. The caller is creating a new
            // baseline, while the current index may already contain the edited working bytes.
            if (relativePath.startsWith(".awd/")) {
                source.transferTo(encoded);
                encoded.close();
            } else clean(repo, source, encoded, isMedia(relativePath), null).run();
            try (InputStream input = encoded.openInputStream(); var inserter = repo.newObjectInserter()) {
                ObjectId blob = inserter.insert(Constants.OBJ_BLOB, encoded.length(), input);
                inserter.flush();
                return blob;
            }
        } finally { STAGING.set(previous); encoded.destroy(); }
    }

    public static <T> T materializing(Repository repo, Map<String, Set<LocalVersionObjectStore.ObjectRef>> paths,
                                     Action<T> action) throws Exception {
        Map<String, Set<LocalVersionObjectStore.ObjectRef>> previous = MATERIALIZING.get();
        MATERIALIZING.set(paths);
        Context context = context(repo);
        try {
            install(repo, context.store(), context.projectId(), context.threshold());
            return action.run();
        } finally {
            MATERIALIZING.set(previous);
            install(repo, context.store(), context.projectId(), context.threshold());
        }
    }

    private static Context context(Repository repo) throws IOException {
        Context context = CONTEXTS.get(repo.getDirectory().toPath().toAbsolutePath().normalize());
        if (context == null) throw new IOException("Version object storage is not initialized");
        return context;
    }

    private static FilterCommand clean(Repository repo, InputStream in, OutputStream out, boolean media, String path) {
        return new FilterCommand(in, out) {
            @Override public int run() throws IOException {
                Context context = context(repo);
                TemporaryBuffer.LocalFile buffer = new TemporaryBuffer.LocalFile(null);
                try {
                    if (media) {
                        writePointer(repo, context, path, in, out);
                        return -1;
                    }
                    byte[] chunk = new byte[64 * 1024];
                    int n;
                    while (buffer.length() <= context.threshold() && (n = in.read(chunk)) != -1) buffer.write(chunk, 0, n);
                    buffer.close();
                    boolean external = buffer.length() > context.threshold();
                    if (!external && buffer.length() <= VersionObjectPointer.MAX_BYTES) {
                        external = VersionObjectPointer.parse(buffer.toByteArray()) != null;
                    }
                    if (external) {
                        try (InputStream source = new java.io.SequenceInputStream(buffer.openInputStream(), in)) {
                            writePointer(repo, context, path, source, out);
                        }
                    } else buffer.writeTo(out, null);
                    return -1;
                } finally { buffer.destroy(); in.close(); out.close(); }
            }
        };
    }

    private static void writePointer(Repository repo, Context context, String path,
                                     InputStream input, OutputStream output) throws IOException {
        var object = STAGING.get() ? context.store().put(context.projectId(), input)
                : LocalVersionObjectStore.fingerprint(input);
        // A historical raw blob must remain clean after checkout, even if today's routing would externalize it.
        var entry = path == null ? null : repo.readDirCache().getEntry(path);
        if (entry != null && entry.getStage() == 0) {
            ObjectLoader old = repo.open(entry.getObjectId());
            boolean pointerShaped = old.getSize() <= VersionObjectPointer.MAX_BYTES
                    && VersionObjectPointer.parse(old.getBytes()) != null;
            boolean oldPointer = pointerShaped && headHasObjectFormat(repo);
            if (!oldPointer && (!pointerShaped || !STAGING.get()) && old.getSize() == object.size()) {
                var oldHash = context.legacyHashes().get(entry.getObjectId());
                if (oldHash == null) {
                    try (InputStream source = old.openStream()) { oldHash = LocalVersionObjectStore.fingerprint(source); }
                    context.legacyHashes().put(entry.getObjectId().copy(), oldHash);
                }
                if (oldHash.equals(object)) { old.copyTo(output); return; }
            }
        }
        output.write(VersionObjectPointer.encode(object));
    }

    private static boolean headHasObjectFormat(Repository repo) throws IOException {
        ObjectId head = repo.resolve(Constants.HEAD);
        if (head == null) return false;
        try (var walk = new org.eclipse.jgit.revwalk.RevWalk(repo)) {
            return walk.parseCommit(head).getFullMessage().lines().anyMatch("X-AWD-Object-Format: 1"::equals);
        }
    }

    private static FilterCommand smudge(Repository repo, InputStream in, OutputStream out, String path) {
        return new FilterCommand(in, out) {
            @Override public int run() throws IOException {
                try {
                    byte[] prefix = in.readNBytes(VersionObjectPointer.MAX_BYTES + 1);
                    var pointer = VersionObjectPointer.parse(prefix);
                    if (pointer == null || !MATERIALIZING.get().getOrDefault(path, Set.of()).contains(pointer)) {
                        out.write(prefix);
                        in.transferTo(out);
                    } else {
                        Context context = context(repo);
                        context.store().verify(context.projectId(), pointer);
                        try (InputStream source = context.store().open(context.projectId(), pointer.sha256())) {
                            source.transferTo(out);
                        }
                    }
                    return -1;
                } finally { in.close(); out.close(); }
            }
        };
    }
}
