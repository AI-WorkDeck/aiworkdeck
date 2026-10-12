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

    @Test void damagedPartAndCompletedReplicaCanBothBeRetried() throws Exception {
        var objects = objects(); var service = new ProjectObjectTransferService(objects, mock(CloudStorageQuotaService.class));
        byte[] content = {1, 2, 3}; var ref = LocalVersionObjectStore.fingerprint(new ByteArrayInputStream(content));
        service.putPart(1, ref, 0, ref.sha256(), new ByteArrayInputStream(content));
        Path part = objects.path(1, ref.sha256()).getParent().getParent().getParent()
                .resolve("transfers").resolve(ref.sha256()).resolve("0.part");
        Files.write(part, new byte[]{7, 8, 9});
        assertThrows(IOException.class, () -> service.complete(1, ref));
        assertEquals(java.util.List.of(), service.status(1, ref).get("parts"));
        service.putPart(1, ref, 0, ref.sha256(), new ByteArrayInputStream(content));
        service.complete(1, ref);
        Files.write(objects.path(1, ref.sha256()), new byte[]{7, 8, 9});
        assertEquals(false, service.status(1, ref).get("complete"));
        service.putPart(1, ref, 0, ref.sha256(), new ByteArrayInputStream(content));
        service.complete(1, ref);
        objects.verify(1, ref);
    }

    @Test void fullQuotaAllowsRepairOnlyAfterActualCorruptionIsVerified() throws Exception {
        var objects = objects(); var quota = mock(CloudStorageQuotaService.class);
        var service = new ProjectObjectTransferService(objects, quota);
        byte[] content = {1, 2, 3};
        var ref = objects.put(1, new ByteArrayInputStream(content));
        Files.write(objects.path(1, ref.sha256()), new byte[]{7, 8, 9});
        doAnswer(call -> {
            long additional = call.getArgument(1);
            if (objects.usageBytes(1) + additional > content.length)
                throw new IllegalArgumentException("quota");
            return null;
        }).when(quota).requireProjectCapacity(eq(1L), anyLong());

        // A read-only status check never removes the damaged replica.
        assertEquals(false, service.status(1, ref).get("complete"));
        assertArrayEquals(new byte[]{7, 8, 9}, Files.readAllBytes(objects.path(1, ref.sha256())));
        service.putPart(1, ref, 0, ref.sha256(), new ByteArrayInputStream(content));
        service.complete(1, ref);
        objects.verify(1, ref);
        assertEquals(content.length, objects.usageBytes(1));
        verify(quota).lockProjectForWrite(1L);
        verify(quota).requireProjectCapacity(1L, 3L);
    }

    @Test void incorrectClientSizeCannotDeleteValidReplicaOrEarnQuotaCredit() throws Exception {
        var objects = objects(); var quota = mock(CloudStorageQuotaService.class);
        var service = new ProjectObjectTransferService(objects, quota);
        byte[] original = {1, 2, 3};
        var ref = objects.put(1, new ByteArrayInputStream(original));
        byte[] incoming = {4, 5, 6, 7};
        var claimed = new LocalVersionObjectStore.ObjectRef(ref.sha256(), incoming.length);
        var incomingRef = LocalVersionObjectStore.fingerprint(new ByteArrayInputStream(incoming));

        assertEquals(false, service.status(1, claimed).get("complete"));
        assertThrows(IOException.class, () -> service.putPart(1, claimed, 0, incomingRef.sha256(),
                new ByteArrayInputStream(incoming)));
        objects.verify(1, ref);
        assertEquals(original.length, objects.usageBytes(1));
        verifyNoInteractions(quota);
    }

    @Test void replacingAnExistingPartChargesOnlyActualGrowth() throws Exception {
        var objects = objects(); var quota = mock(CloudStorageQuotaService.class);
        var service = new ProjectObjectTransferService(objects, quota);
        byte[] content = {1, 2, 3};
        var ref = LocalVersionObjectStore.fingerprint(new ByteArrayInputStream(content));
        service.putPart(1, ref, 0, ref.sha256(), new ByteArrayInputStream(content));
        Path part = objects.projectRoot(1).resolve("transfers").resolve(ref.sha256()).resolve("0.part");
        clearInvocations(quota);
        // Same-sized damaged bytes can be replaced at a full quota.
        Files.write(part, new byte[]{7, 8, 9});
        service.putPart(1, ref, 0, ref.sha256(), new ByteArrayInputStream(content));
        verify(quota).requireProjectCapacity(1L, 0L);
        clearInvocations(quota);
        // A truncated part consumes only the newly added bytes.
        Files.write(part, new byte[]{7});
        service.putPart(1, ref, 0, ref.sha256(), new ByteArrayInputStream(content));
        verify(quota).requireProjectCapacity(1L, 2L);
        clearInvocations(quota);
        service.putPart(1, ref, 0, ref.sha256(), new ByteArrayInputStream(content));
        verifyNoInteractions(quota);
        service.complete(1, ref);
        objects.verify(1, ref);
    }

    @Test void transferStillRejectsSymlinksInsideTheStorageBoundary() throws Exception {
        var objects = objects(); var service = new ProjectObjectTransferService(objects, mock(CloudStorageQuotaService.class));
        Path project = objects.projectRoot(1);
        Files.createDirectories(project.getParent());
        Path outside = Files.createDirectory(root.resolve("outside"));
        Files.createSymbolicLink(project, outside);
        byte[] content = {1, 2, 3};
        var ref = LocalVersionObjectStore.fingerprint(new ByteArrayInputStream(content));
        assertThrows(IOException.class, () -> service.putPart(1, ref, 0, ref.sha256(), new ByteArrayInputStream(content)));
        try (var files = Files.list(outside)) { assertEquals(0, files.count()); }
    }

}
