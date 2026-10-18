// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.*;
import java.security.MessageDigest;
import java.util.*;

/** Explicit host approval for remote services only; never authorizes JARs or local processes. */
public final class PluginDevTrustService {
    public static final String MARKER = ".awd-service-trust";
    private static final int MAX_MANIFEST_BYTES = 1024 * 1024;
    private PluginDevTrustService() {}
    public record Status(boolean devInstalled, boolean trusted) {}

    /** Called by runtime gates; malformed/missing/changed installations always fail closed. */
    public static boolean isServiceTrusted(PluginService plugins, String pluginId) {
        try { return status(plugins, pluginId).trusted(); }
        catch (RuntimeException unavailable) { return false; }
    }

    public static Status status(PluginService plugins, String pluginId) {
        var meta = requirePlugin(plugins, pluginId);
        if (!plugins.isDevInstalled(pluginId)) return new Status(false, true);
        try {
            Path directory = directory(plugins, pluginId);
            Path marker = directory.resolve(MARKER);
            boolean trusted = false;
            if (Files.isRegularFile(marker, LinkOption.NOFOLLOW_LINKS)) {
                String stored;
                try (FileChannel input = FileChannel.open(marker, StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS)) {
                    if (input.size() != 65) return new Status(true, false);
                    ByteBuffer bytes = ByteBuffer.allocate(66);
                    while (input.read(bytes) > 0) { if (!bytes.hasRemaining()) return new Status(true, false); }
                    stored = new String(bytes.array(), 0, bytes.position(), StandardCharsets.US_ASCII);
                }
                trusted = stored.matches("[0-9a-f]{64}\\n") && stored.equals(digest(directory.resolve("manifest.json")) + "\n");
            }
            return new Status(true, trusted && plugins.getPlugin(pluginId) == meta && plugins.isDevInstalled(pluginId));
        } catch (IOException e) { return new Status(true, false); }
    }

    /** Controller must authenticate the administrator before invoking this mutation. */
    public static Status setTrusted(PluginService plugins, String pluginId, boolean trusted) {
        synchronized (plugins) {
            requirePlugin(plugins, pluginId);
            if (!plugins.isDevInstalled(pluginId)) throw new IllegalArgumentException("Remote-service approval is only needed for development plugins");
            Path temporary = null;
            try {
                Path directory = directory(plugins, pluginId);
                Path marker = directory.resolve(MARKER);
                if (!trusted) {
                    // Deleting a symlink removes only the link, never its target.
                    Files.deleteIfExists(marker);
                    return new Status(true, false);
                }
                if (Files.isSymbolicLink(marker)) throw new IllegalArgumentException("Invalid development trust marker");
                String hash = digest(directory.resolve("manifest.json"));
                if (Files.getFileStore(directory).supportsFileAttributeView(PosixFileAttributeView.class)) {
                    temporary = Files.createTempFile(directory, MARKER + "-", ".tmp",
                            PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
                } else {
                    temporary = Files.createTempFile(directory, MARKER + "-", ".tmp");
                    AclFileAttributeView acl = Files.getFileAttributeView(temporary, AclFileAttributeView.class, LinkOption.NOFOLLOW_LINKS);
                    if (acl == null) throw new IOException("Private file permissions are unavailable");
                    acl.setAcl(List.of(AclEntry.newBuilder().setType(AclEntryType.ALLOW).setPrincipal(Files.getOwner(temporary))
                            .setPermissions(EnumSet.allOf(AclEntryPermission.class)).build()));
                }
                try (FileChannel output = FileChannel.open(temporary, StandardOpenOption.WRITE, LinkOption.NOFOLLOW_LINKS)) {
                    ByteBuffer bytes = StandardCharsets.US_ASCII.encode(hash + "\n");
                    while (bytes.hasRemaining()) output.write(bytes);
                    output.force(true);
                }
                if (!hash.equals(digest(directory.resolve("manifest.json")))) throw new IllegalStateException("Plugin changed during approval; review it again");
                Files.move(temporary, marker, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
                return status(plugins, pluginId);
            } catch (IOException e) {
                throw new IllegalStateException("Unable to update development service approval");
            } finally {
                if (temporary != null) try { Files.deleteIfExists(temporary); } catch (IOException ignored) { /* no approved marker was weakened */ }
            }
        }
    }

    private static PluginService.PluginMetadata requirePlugin(PluginService plugins, String pluginId) {
        if (pluginId == null || !pluginId.matches("[a-z0-9][a-z0-9-]{1,49}")) throw new IllegalArgumentException("Invalid plugin id");
        var meta = plugins.getPlugin(pluginId);
        if (meta == null) throw new NoSuchElementException("Plugin not found");
        return meta;
    }
    private static Path directory(PluginService plugins, String pluginId) throws IOException {
        var file = plugins.getPluginDir(pluginId);
        if (file == null) throw new IOException("Plugin directory is unavailable");
        Path directory = file.toPath().toAbsolutePath().normalize();
        if (!pluginId.equals(directory.getFileName().toString()) || Files.isSymbolicLink(directory)
                || !Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS)
                || !Files.isRegularFile(directory.resolve(".awd-dev"), LinkOption.NOFOLLOW_LINKS)
                || !Files.isRegularFile(directory.resolve("manifest.json"), LinkOption.NOFOLLOW_LINKS)) {
            throw new IOException("Invalid development plugin directory");
        }
        return directory;
    }
    private static String digest(Path manifest) throws IOException {
        try (FileChannel input = FileChannel.open(manifest, StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS)) {
            if (input.size() > MAX_MANIFEST_BYTES) throw new IOException("Manifest exceeds size limit");
            MessageDigest hash = MessageDigest.getInstance("SHA-256");
            ByteBuffer buffer = ByteBuffer.allocate(8192);
            int total = 0, count;
            while ((count = input.read(buffer)) != -1) {
                total += count;
                if (total > MAX_MANIFEST_BYTES) throw new IOException("Manifest exceeds size limit");
                buffer.flip(); hash.update(buffer); buffer.clear();
            }
            return HexFormat.of().formatHex(hash.digest());
        } catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
}
