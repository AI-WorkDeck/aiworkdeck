// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.service.*;
import com.checkba.storage.*;
import com.checkba.version.WorkSessionService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.function.Supplier;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static org.junit.jupiter.api.Assertions.*;

class MobileCaptureMoveFilesTest {
    @TempDir Path root;
    ProjectRepository projects=mock(ProjectRepository.class);
    ProjectFileRepository files=mock(ProjectFileRepository.class);
    MobileCaptureRemovalRepository journals=mock(MobileCaptureRemovalRepository.class);
    ProjectFileService fileService=mock(ProjectFileService.class);
    StorageServiceFactory storage=mock(StorageServiceFactory.class);
    WorkSessionService sessions=mock(WorkSessionService.class);
    DdOriginalGuard originals=mock(DdOriginalGuard.class);
    ObjectMapper mapper=new ObjectMapper();
    Map<Long,ProjectFile> rows=new HashMap<>(); Map<String,MobileCaptureRemoval> saved=new HashMap<>();
    MobileCaptureMoveFiles helper; StorageService store;
    byte[] original="original capture bytes".getBytes(); String hash;
    String capture=UUID.randomUUID().toString(),request=UUID.randomUUID().toString();
    String path="projects/8/现场影像/2026-10-29/photo-deadbeef.jpg";
    @BeforeEach void setup() throws Exception {
        hash=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(original));
        Project project=new Project(); project.setId(8L);project.setUserId(1L);
        when(projects.findById(8L)).thenReturn(Optional.of(project));
        StorageProperties properties=new StorageProperties(); properties.getLocal().setRootPath(root.toString());
        store=spy(new LocalFileStorageService(new ProjectStorageResolver(properties,projects)));
        when(storage.getStorageService()).thenReturn(store);
        when(sessions.withFileContentWriteLock(eq(8L),any())).thenAnswer(i->i.getArgument(1,Supplier.class).get());
        when(files.findByProjectId(8L)).thenAnswer(i->new ArrayList<>(rows.values()));
        when(files.findById(anyLong())).thenAnswer(i->Optional.ofNullable(rows.get(i.getArgument(0))));
        when(journals.findByAccountScopeAndRequestId(anyString(),anyString())).thenAnswer(i->Optional.ofNullable(saved.get(i.getArgument(0)+":"+i.getArgument(1))));
        when(journals.saveAndFlush(any())).thenAnswer(i->{MobileCaptureRemoval row=i.getArgument(0);saved.put(row.getAccountScope()+":"+row.getRequestId(),row);return row;});
        when(fileService.forgetVanished(anyLong(),eq(1L))).thenAnswer(i->rows.remove(i.getArgument(0))!=null);
        helper=newHelper(); addFile(4L,path,capture);store.save(path,new ByteArrayInputStream(original));
    }
    MobileCaptureMoveFiles newHelper() {return new MobileCaptureMoveFiles(projects,files,journals,fileService,storage,sessions,originals,mapper);}
    ProjectFile addFile(long id,String filePath,String marker) throws Exception {
        ProjectFile file=new ProjectFile();file.setId(id);file.setProjectId(8L);file.setUserId(1L);
        file.setUid(UUID.randomUUID().toString());file.setFilePath(filePath);file.setIsFolder(false);file.setFileSize((long)original.length);
        if(marker!=null)file.setMetaJson(mapper.writeValueAsString(Map.of("mobileCaptureId",marker)));
        rows.put(id,file);return file;
    }
    MobileMediaMoveService.Command command(String action) {return new MobileMediaMoveService.Command(request,UUID.randomUUID().toString(),System.currentTimeMillis()+300000,
            action,"desktop","8",capture,hash,original.length,path.substring("projects/8/".length()),null,null);}
    @Test void verifyReadsActualBytesWithoutDeletingThem() {
        var result=helper.execute("account",1L,command("VERIFY_TARGET"),()->{});
        assertEquals(4L,result.fileId());assertEquals(hash,result.sha256());assertTrue(store.exists(path));verifyNoInteractions(journals,fileService);
    }
    @Test void changedSourceAndCorruptDestinationBothStopBeforeAnyRemoval() {
        store.save(path,new ByteArrayInputStream("different same origin".getBytes()));
        assertThrows(IllegalArgumentException.class,()->helper.execute("account",1L,command("REMOVE_SOURCE"),()->{}));
        assertThrows(IllegalArgumentException.class,()->helper.execute("account",1L,command("VERIFY_TARGET"),()->{}));
        assertTrue(store.exists(path));assertTrue(rows.containsKey(4L));assertTrue(saved.isEmpty());verifyNoInteractions(fileService);
    }
    @Test void lostAckAndRestartNeverDeletesNewFileAtOriginalName() throws Exception {
        var expected=helper.execute("account",1L,command("REMOVE_SOURCE"),()->{});
        assertFalse(store.exists(path));assertFalse(rows.containsKey(4L));assertEquals("DONE",saved.values().iterator().next().getState());
        byte[] replacement="new document placed at the old path".getBytes();
        store.save(path,new ByteArrayInputStream(replacement));ProjectFile newFile=addFile(5L,path,UUID.randomUUID().toString());
        var repeated=newHelper().execute("account",1L,command("REMOVE_SOURCE"),()->{});
        assertEquals(expected,repeated);assertEquals(newFile,rows.get(5L));
        assertArrayEquals(replacement,Files.readAllBytes(root.resolve(path)));verify(fileService,times(1)).forgetVanished(4L,1L);
    }
    @Test void crashAfterQuarantineResumesByJournalIdentity() {
        doThrow(new IllegalStateException("database unavailable")).doAnswer(i->rows.remove(i.getArgument(0))!=null)
                .when(fileService).forgetVanished(4L,1L);
        assertThrows(IllegalStateException.class,()->helper.execute("account",1L,command("REMOVE_SOURCE"),()->{}));
        assertEquals("PREPARED",saved.values().iterator().next().getState());
        assertTrue(store.exists(saved.values().iterator().next().getQuarantinePath()));
        newHelper().execute("account",1L,command("REMOVE_SOURCE"),()->{});
        assertFalse(store.exists(path));assertTrue(rows.isEmpty());
    }
    @Test void pendingQuarantineSurvivesVersionShutdownAndNeverEntersGit() throws Exception {
        doThrow(new IllegalStateException("crash after quarantine")).doAnswer(i->rows.remove(i.getArgument(0))!=null)
                .when(fileService).forgetVanished(4L,1L);
        assertThrows(IllegalStateException.class,()->helper.execute("account",1L,command("REMOVE_SOURCE"),()->{}));
        String quarantine=saved.values().iterator().next().getQuarantinePath();
        StorageProperties properties=new StorageProperties();properties.getLocal().setRootPath(root.toString());
        var repo=new com.checkba.version.ProjectRepoService(new ProjectStorageResolver(properties,projects));
        Files.writeString(root.resolve("projects/8/unrelated.txt"),"ordinary document");
        repo.init(8L,"Fixture","fixture@example.test");
        assertTrue(repo.listPaths(8L,"HEAD").contains("unrelated.txt"));
        assertTrue(repo.listPaths(8L,"HEAD").stream().noneMatch(p->p.contains(".mobile-moves")));
        var recording=new WorkSessionService(repo,mock(com.checkba.version.ProjectTreeManifestService.class),
                mock(com.checkba.version.WorkSessionRepository.class),mock(org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler.class),files,event->{});
        Files.createDirectories(root.resolve("projects/8/.awd"));Files.writeString(root.resolve("projects/8/.awd/tree.json"),"{}");
        recording.disableVersionRecording(8L);
        assertFalse(Files.exists(root.resolve("projects/8/.awd")));assertTrue(store.exists(quarantine));
        newHelper().execute("account",1L,command("REMOVE_SOURCE"),()->{});
        assertFalse(store.exists(quarantine));assertTrue(rows.isEmpty());
    }
    @Test void replacementAtOldPathDuringInterruptedRemovalIsPreserved() throws Exception {
        doThrow(new IllegalStateException("crash after quarantine")).when(fileService).forgetVanished(4L,1L);
        assertThrows(IllegalStateException.class,()->helper.execute("account",1L,command("REMOVE_SOURCE"),()->{}));
        byte[] replacement="new file before resume".getBytes();store.save(path,new ByteArrayInputStream(replacement));
        assertThrows(IllegalArgumentException.class,()->newHelper().execute("account",1L,command("REMOVE_SOURCE"),()->{}));
        assertArrayEquals(replacement,Files.readAllBytes(root.resolve(path)));assertTrue(rows.containsKey(4L));
        assertTrue(store.exists(saved.values().iterator().next().getQuarantinePath()));
        verify(fileService,times(1)).forgetVanished(4L,1L);
    }
    @Test void deletedQuarantineBeforeFinalJournalCommitCanResume() {
        doAnswer(i->{MobileCaptureRemoval journal=i.getArgument(0);
            if("DONE".equals(journal.getState())) {journal.setState("DETACHED");throw new IllegalStateException("lost commit");}
            saved.put(journal.getAccountScope()+":"+journal.getRequestId(),journal);return journal;}).when(journals).saveAndFlush(any());
        assertThrows(IllegalStateException.class,()->helper.execute("account",1L,command("REMOVE_SOURCE"),()->{}));
        store.save(path,new ByteArrayInputStream("replacement".getBytes()));
        doAnswer(i->i.getArgument(0)).when(journals).saveAndFlush(any());
        newHelper().execute("account",1L,command("REMOVE_SOURCE"),()->{});
        assertTrue(store.exists(path));verify(fileService,times(1)).forgetVanished(4L,1L);
    }
    @Test void legacyExactPathRequiresHashAndRejectsMultipleIdentityMatches() throws Exception {
        rows.get(4L).setMetaJson(null);
        assertEquals(4L,helper.execute("account",1L,command("VERIFY_TARGET"),()->{}).fileId());
        addFile(5L,path,null);
        assertThrows(IllegalArgumentException.class,()->helper.execute("account",1L,command("REMOVE_SOURCE"),()->{}));
        assertTrue(store.exists(path));verifyNoInteractions(fileService);
    }
    @Test void fullUuidProvenanceSurvivesRenameButAnotherCaptureMarkerNeverMatches() throws Exception {
        String renamed="projects/8/renamed.jpg";store.moveNew(path,renamed);rows.get(4L).setFilePath(renamed);
        assertEquals(4L,helper.execute("account",1L,command("VERIFY_TARGET"),()->{}).fileId());
        rows.get(4L).setMetaJson(mapper.writeValueAsString(Map.of("mobileCaptureId",UUID.randomUUID().toString())));
        assertThrows(IllegalArgumentException.class,()->helper.execute("account",1L,command("REMOVE_SOURCE"),()->{}));
        assertTrue(store.exists(renamed));
    }
    @Test void wrongOwnerExpiredCommandAndAccountSwitchCannotTouchBytes() {
        assertThrows(IllegalArgumentException.class,()->helper.execute("account",2L,command("REMOVE_SOURCE"),()->{}));
        var c=command("REMOVE_SOURCE");var expired=new MobileMediaMoveService.Command(c.requestId(),c.commandId(),0,c.action(),c.deviceId(),c.projectKey(),c.clientMediaId(),c.sha256(),c.fileSize(),c.relativePath(),null,null);
        assertThrows(IllegalStateException.class,()->helper.execute("account",1L,expired,()->{}));
        assertThrows(IllegalStateException.class,()->helper.execute("account",1L,c,()->{throw new IllegalStateException("account changed");}));
        assertTrue(store.exists(path));verifyNoInteractions(fileService);
    }
}
