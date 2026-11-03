// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.service.ai.*;
import com.checkba.service.mobile.CloudStorageQuotaService;
import com.checkba.storage.*;
import com.checkba.version.WorkSessionService;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.*;
import org.springframework.transaction.annotation.*;
import org.springframework.transaction.support.TransactionTemplate;
import java.util.*;
import java.time.LocalDateTime;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@DataJpaTest(showSql=false)
@AutoConfigureTestDatabase(replace=AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties={"spring.datasource.url=jdbc:h2:mem:scratch-copy-test;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa","spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect","spring.jpa.hibernate.ddl-auto=create-drop"})
@Transactional(propagation=Propagation.NOT_SUPPORTED)
class ScratchTransferServiceTest {
    @Autowired ProjectRepository projects;
    @Autowired ProjectFileRepository files;
    @Autowired ProjectAiMessageRepository messages;
    @Autowired ProjectAiMessageAttachmentRepository attachments;
    @Autowired PlatformTransactionManager transactions;
    ProjectFileService fileService;
    ProjectMemberService members;
    AgentOrchestrator orchestrator;
    AgentInboxService inbox;
    ScratchTransferService service;
    Map<String,byte[]> bytes;
    StorageService storage;
    Long source,target,fileId;
    String conversation;

    @BeforeEach void setup() throws Exception {
        fileService=mock(ProjectFileService.class); members=mock(ProjectMemberService.class);
        orchestrator=mock(AgentOrchestrator.class); inbox=mock(AgentInboxService.class);
        when(inbox.conversationLock(anyString())).thenReturn(new Object());
        when(members.hasWritePermission(anyLong(),eq(7L))).thenReturn(true);
        var work=mock(WorkSessionService.class);
        doAnswer(i->{i.getArgument(1,Runnable.class).run();return null;}).when(work).runLocked(anyLong(),any());
        var factory=mock(StorageServiceFactory.class);storage=mock(StorageService.class);
        when(factory.getStorageService()).thenReturn(storage);bytes=new HashMap<>();
        when(storage.exists(anyString())).thenAnswer(i->bytes.containsKey(i.getArgument(0)));
        when(storage.getSize(anyString())).thenAnswer(i->{var value=bytes.get(i.getArgument(0));if(value==null)throw new StorageException("missing");return (long)value.length;});
        when(storage.load(anyString())).thenAnswer(i->{var value=bytes.get(i.getArgument(0));if(value==null)throw new StorageException("missing");return new org.springframework.core.io.ByteArrayResource(value);});
        when(storage.save(anyString(),any())).thenAnswer(i->{bytes.put(i.getArgument(0),i.getArgument(1,java.io.InputStream.class).readAllBytes());return i.getArgument(0);});
        doAnswer(i->{String from=i.getArgument(0),to=i.getArgument(1);if(bytes.containsKey(to))throw new StorageException("exists");bytes.put(to,bytes.remove(from));return null;}).when(storage).moveNew(anyString(),anyString());
        doAnswer(i->{bytes.remove(i.getArgument(0));return null;}).when(storage).delete(anyString());
        var tx=new TransactionTemplate(transactions);
        tx.executeWithoutResult(status->{
            source=project(Project.SCRATCH);target=project("BLANK");
            ProjectFile file=new ProjectFile();file.setSortOrder(0);file.setProjectId(source);file.setUserId(7L);file.setName("evidence.txt");
            file.setFilePath("projects/"+source+"/evidence.txt");file.setFileType("txt");file.setFileSize(8L);file.setCreatedAt(LocalDateTime.now());file.setIsFolder(false);
            fileId=files.save(file).getId();bytes.put(file.getFilePath(),"original".getBytes());
            conversation="conv-"+UUID.randomUUID();
            ProjectAiMessage message=new ProjectAiMessage();message.setProjectId(source);message.setUserId(7L);message.setRole("USER");
            message.setConversationId(conversation);message.setContent("/api/files/"+fileId+"/download");message.setCreatedAt(LocalDateTime.now());message=messages.save(message);
            var attachment=new ProjectAiMessageAttachment();attachment.setMessageId(message.getId());attachment.setFileId(fileId.toString());attachment.setName("evidence.txt");attachment.setKind("file");attachments.save(attachment);
        });
        when(fileService.createFolder(anyLong(),any(),anyString(),anyLong())).thenAnswer(i->{
            ProjectFile file=new ProjectFile();file.setSortOrder(0);file.setProjectId(i.getArgument(0));file.setParentId(i.getArgument(1));file.setName(i.getArgument(2));file.setIsFolder(true);file.setUserId(7L);file.setCreatedAt(LocalDateTime.now());return files.save(file);
        });
        when(fileService.createFile(anyLong(),anyLong(),anyString(),anyString(),anyLong(),anyString(),isNull(),anyLong())).thenAnswer(i->{
            ProjectFile file=new ProjectFile();file.setSortOrder(0);file.setProjectId(i.getArgument(0));file.setParentId(i.getArgument(1));file.setName(i.getArgument(2));file.setFileType(i.getArgument(3));file.setFileSize(i.getArgument(4));file.setFilePath(i.getArgument(5));file.setIsFolder(false);file.setUserId(7L);file.setCreatedAt(LocalDateTime.now());return files.save(file);
        });
        service=new ScratchTransferService(projects,files,messages,attachments,fileService,members,factory,
                mock(CloudStorageQuotaService.class),work,inbox,orchestrator,transactions);
    }
    private Long project(String type) {Project p=new Project();p.setName(type);p.setProjectType(type);p.setUserId(7L);p.setListedCompanyName("");p.setTargetCompanyName("");p.setCreatedAt(LocalDateTime.now());return projects.save(p).getId();}
    private ScratchTransferService.Request request() {return new ScratchTransferService.Request(source,target,List.of(),List.of(conversation));}

    @Test void copiesConversationWithAttachmentBytesAndNewReferencesKeepingOriginals() {
        var result=service.copy(7L,request());assertEquals("copy",result.mode());assertTrue(result.sourcePreserved());
        Long newFile=result.fileIdMap().get(fileId);assertNotNull(newFile);assertNotEquals(fileId,newFile);
        var copied=messages.findByConversationIdOrderByCreatedAtAsc(result.conversationIdMap().get(conversation));
        assertEquals(1,copied.size());assertEquals(target,copied.get(0).getProjectId());assertEquals("/api/files/"+newFile+"/download",copied.get(0).getContent());
        assertEquals(newFile.toString(),attachments.findByMessageIdInOrderByIdAsc(List.of(copied.get(0).getId())).get(0).getFileId());
        assertArrayEquals("original".getBytes(),bytes.get(files.findById(newFile).orElseThrow().getFilePath()));
        assertTrue(files.findById(fileId).isPresent());assertEquals(1,messages.findByConversationIdOrderByCreatedAtAsc(conversation).size());
    }
    @Test void runningConversationIsRejectedBeforeWrites() {
        when(orchestrator.activeRunId(conversation)).thenReturn("running");
        assertThrows(IllegalArgumentException.class,()->service.copy(7L,request()));verifyNoInteractions(fileService);
    }
    @Test void wrongUserAndDestinationPermissionAreRejected() {
        assertThrows(IllegalArgumentException.class,()->service.copy(8L,request()));
        when(members.hasWritePermission(target,7L)).thenReturn(false);
        assertThrows(IllegalArgumentException.class,()->service.copy(7L,request()));verifyNoInteractions(fileService);
    }
    @Test void partialByteFailureRollsBackRowsAndRemovesOnlyNewBytes() {
        doAnswer(i->{
            bytes.put(i.getArgument(0), "partial".getBytes());
            throw new StorageException("injected write failure");
        }).when(storage).save(anyString(),any());
        var original=new HashMap<>(bytes);
        assertThrows(IllegalStateException.class,()->service.copy(7L,request()));
        assertEquals(original.keySet(),bytes.keySet());
        assertTrue(files.findByProjectIdAndIsDeletedFalseOrderBySortOrderAsc(target).isEmpty());
        assertTrue(files.findById(fileId).isPresent());
    }

    @Test void competingDestinationIsNeverOverwrittenOrDeleted() {
        String[] competing = new String[1];
        doAnswer(i->{competing[0]=i.getArgument(1);bytes.put(competing[0],"other writer".getBytes());throw new StorageException("already exists");})
                .when(storage).moveNew(anyString(),anyString());
        assertThrows(IllegalStateException.class,()->service.copy(7L,request()));
        assertArrayEquals("other writer".getBytes(),bytes.get(competing[0]));
        assertTrue(files.findByProjectIdAndIsDeletedFalseOrderBySortOrderAsc(target).isEmpty());
    }

    @Test void messageFailureRollsBackRowsAndAllNewBytes() {
        var failing=mock(ProjectAiMessageRepository.class, org.mockito.AdditionalAnswers.delegatesTo(messages));
        doThrow(new IllegalStateException("injected persistence failure")).when(failing).save(any());
        org.springframework.test.util.ReflectionTestUtils.setField(service,"messages",failing);
        Map<String,byte[]> original=new HashMap<>(bytes);
        assertThrows(IllegalStateException.class,()->service.copy(7L,request()));
        assertTrue(files.findByProjectIdAndIsDeletedFalseOrderBySortOrderAsc(target).isEmpty());
        assertEquals(original.keySet(),bytes.keySet());
        assertEquals(1,messages.findByConversationIdOrderByCreatedAtAsc(conversation).size());
    }
}
