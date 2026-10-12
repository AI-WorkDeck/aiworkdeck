// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version.cloud;

import com.checkba.service.mobile.CloudStorageQuotaService;
import com.checkba.storage.ProjectStorageResolver;
import com.checkba.storage.StorageProperties;
import com.checkba.version.objects.LocalVersionObjectStore;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.io.*;
import java.nio.file.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ProjectObjectTransferServiceTest {
    @TempDir Path root;
    LocalVersionObjectStore objects() {
        StorageProperties props = new StorageProperties(); props.getLocal().setRootPath(root.toString());
        return new LocalVersionObjectStore(new ProjectStorageResolver(props, null));
    }

    @Test void invalidOrIncompleteBytesNeverBecomeAnObjectAndValidRetryIsIdempotent() throws Exception {
        var objects = objects(); var quota = mock(CloudStorageQuotaService.class);
        var service = new ProjectObjectTransferService(objects, quota);
        byte[] content = "完整合成视频".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        var ref = LocalVersionObjectStore.fingerprint(new ByteArrayInputStream(content));
        assertThrows(IOException.class, () -> service.complete(1, ref));
        assertThrows(IOException.class, () -> service.putPart(1, ref, 0, ref.sha256(), new ByteArrayInputStream(new byte[content.length])));
        assertFalse(Files.exists(objects.path(1, ref.sha256())));
        assertThrows(IOException.class, () -> service.putPart(1, ref, 0, ref.sha256(), new ByteArrayInputStream(new byte[content.length + 1])));
        service.putPart(1, ref, 0, ref.sha256(), new ByteArrayInputStream(content));
        service.putPart(1, ref, 0, ref.sha256(), new ByteArrayInputStream(content));
        assertEquals(java.util.List.of(0), service.status(1, ref).get("parts"));
        service.complete(1, ref);
        assertEquals(true, service.status(1, ref).get("complete"));
        objects.verify(1, ref);
        service.complete(1, ref);
        assertThrows(IOException.class, () -> objects.verify(2, ref));
    }

    @Test void quotaFailureAndInvalidPathsWriteNothing() throws Exception {
        var objects = objects(); var quota = mock(CloudStorageQuotaService.class);
        var service = new ProjectObjectTransferService(objects, quota);
        byte[] content = {1, 2, 3};
        var ref = LocalVersionObjectStore.fingerprint(new ByteArrayInputStream(content));
        doThrow(new IllegalArgumentException("quota")).when(quota).requireProjectCapacity(1L, 3L);
        assertThrows(IllegalArgumentException.class, () -> service.putPart(1, ref, 0, ref.sha256(), new ByteArrayInputStream(content)));
        assertTrue(objects.list(1).isEmpty());
        assertThrows(IllegalArgumentException.class, () -> new LocalVersionObjectStore.ObjectRef("../private", 3));
        assertThrows(IllegalArgumentException.class, () -> ProjectObjectTransferService.partSize(ref, -1));
        assertThrows(IllegalArgumentException.class, () -> ProjectObjectTransferService.partSize(ref, 1));
    }
}
