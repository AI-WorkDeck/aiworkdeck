// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.mobile;

import lombok.extern.slf4j.Slf4j;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

/**
 * 本地盘实现：行为与抽象前的 MobileRelayStoreService 逐字一致
 * （blob 落 {root}/mobile-relay/{userId}/{clientMediaId}，locator = 绝对路径）。
 * desktop/prod profile 与全部测试默认走它。
 */
@Slf4j
public final class MobileRelayLocalBlobStore implements MobileRelayBlobStore {

    private final Path relayRoot;

    public MobileRelayLocalBlobStore(String storageRoot) {
        this.relayRoot = Path.of(storageRoot, "mobile-relay").toAbsolutePath().normalize();
    }

    @Override
    public StoredBlob put(Long userId, String clientMediaId, InputStream content, long declaredSize) {
        Path userDir = relayRoot.resolve(String.valueOf(userId)).normalize();
        Path blob = userDir.resolve(clientMediaId).normalize();
        if (!blob.startsWith(userDir) || !blob.getParent().equals(userDir)) {
            throw new IllegalArgumentException("Invalid clientMediaId");
        }
        try {
            Files.createDirectories(blob.getParent());
            long size = Files.copy(content, blob, StandardCopyOption.REPLACE_EXISTING);
            return new StoredBlob(blob.toString(), size);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @Override
    public StoredBlob putPersistent(Long userId, String blobId, InputStream content, long declaredSize) {
        Path backupRoot = relayRoot.resolveSibling("mobile-backup").toAbsolutePath().normalize();
        Path userDir = backupRoot.resolve(String.valueOf(userId)).normalize();
        Path blob = userDir.resolve(blobId).normalize();
        if (!blob.startsWith(userDir) || !blob.getParent().equals(userDir)) {
            throw new IllegalArgumentException("Invalid blobId");
        }
        try {
            Files.createDirectories(blob.getParent());
            return new StoredBlob(blob.toString(), Files.copy(content, blob, StandardCopyOption.REPLACE_EXISTING));
        } catch (IOException e) {
            long size=0;try { if (Files.exists(blob)) size=Files.size(blob); } catch (IOException ignored) { size=Math.max(0,declaredSize); }
            throw new PersistentWriteException(new StoredBlob(blob.toString(),size),e);
        }
    }

    @Override
    public boolean ownedLocator(Long userId,String locator) {
        if(userId==null || locator==null) return false;
        try {
            Path path=Path.of(locator).toAbsolutePath();
            if(!path.equals(path.normalize())) return false;
            Path relay=relayRoot.resolve(userId.toString()), backup=relayRoot.resolveSibling("mobile-backup").resolve(userId.toString());
            if(!relay.equals(path.getParent()) && !backup.equals(path.getParent())) return false;
            for(Path current=path;current!=null && current.startsWith(relayRoot.getParent());current=current.getParent())
                if(Files.isSymbolicLink(current)) return false;
            return true;
        } catch(RuntimeException invalid) { return false; }
    }

    @Override
    public InputStream open(String locator) throws IOException {
        return Files.newInputStream(safeLocatorPath(locator));
    }

    @Override
    public boolean exists(String locator) {
        return Files.exists(safeLocatorPath(locator));
    }

    @Override
    public void deleteQuietly(String locator) {
        try {
            Files.deleteIfExists(safeLocatorPath(locator));
        } catch (IOException e) {
            log.warn("删除中转 blob 失败，留给 TTL/生命周期兜底: {}", locator, e);
        }
    }

    private Path safeLocatorPath(String locator) {
        Path p = Path.of(locator).toAbsolutePath().normalize();
        Path storageRoot = relayRoot.getParent() != null ? relayRoot.getParent() : relayRoot;
        if (!p.startsWith(storageRoot)) {
            throw new IllegalArgumentException("Invalid mobile relay locator");
        }
        return p;
    }
}
