// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.im;

import com.checkba.model.entity.Project;
import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectRepository;
import com.checkba.service.ProjectFileService;
import com.checkba.service.ProjectFileAccessService;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.mobile.ProjectCatalogService;
import com.checkba.storage.StorageService;
import com.checkba.storage.StorageServiceFactory;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ByteArrayResource;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class ImProjectFilesTest {
    final ImGatewayService gateway = mock(ImGatewayService.class);
    final ProjectMemberService access = mock(ProjectMemberService.class);
    final ProjectRepository projects = mock(ProjectRepository.class);
    final ProjectFileService files = mock(ProjectFileService.class);
    final ProjectFileAccessService fileAccess = mock(ProjectFileAccessService.class);
    final ProjectCatalogService catalog = mock(ProjectCatalogService.class);
    final StorageServiceFactory factory = mock(StorageServiceFactory.class);
    final StorageService storage = mock(StorageService.class);
    final ObjectMapper json = new ObjectMapper();
    final Map<String, ProjectFile> tree = new HashMap<>();
    final Map<Long, String> dirs = new HashMap<>();
    final Map<String, byte[]> content = new HashMap<>();
    final String conversation = UUID.randomUUID().toString(), attachment = UUID.randomUUID().toString();
    final String projectUid = UUID.randomUUID().toString();
    ImProjectFiles service;
    long nextId = 10;

    @BeforeEach void setup() throws Exception {
        service = new ImProjectFiles(gateway, access, projects, files, fileAccess, catalog, factory, json);
        when(access.hasReadPermission(1L, 2L)).thenReturn(true);
        when(access.hasWritePermission(1L, 2L)).thenReturn(true);
        Project project = new Project(); project.setId(1L); project.setUid(projectUid);
        when(projects.findById(1L)).thenReturn(Optional.of(project));
        when(projects.lockForImWrite(1L)).thenReturn(Optional.of(project));
        when(catalog.ensureProjectUid(project)).thenReturn(projectUid);
        when(catalog.ensureFileUid(any())).thenAnswer(i -> ((ProjectFile)i.getArgument(0)).getUid());
        when(factory.getStorageService()).thenReturn(storage);
        when(gateway.captureAccountScope()).thenReturn("account-A");
        when(storage.exists(anyString())).thenAnswer(i -> content.containsKey(i.getArgument(0)));
        doAnswer(i -> { content.put(i.getArgument(1), content.remove(i.getArgument(0))); return null; }).when(storage).move(anyString(),anyString());
        doAnswer(i -> { content.remove(i.getArgument(0)); return null; }).when(storage).delete(anyString());
        when(files.findByRelativePath(eq(1L), anyString())).thenAnswer(i -> Optional.ofNullable(tree.get(i.getArgument(1))));
        when(files.ensureFolderPath(eq(1L), eq(2L), anyList())).thenAnswer(i -> {
            String dir = String.join("/", i.<List<String>>getArgument(2));
            ProjectFile folder = new ProjectFile(); folder.setId(nextId++); dirs.put(folder.getId(), dir); return folder;
        });
        when(files.createFile(eq(1L), anyLong(), anyString(), anyString(), anyLong(), isNull(), isNull(), eq(2L), any())).thenAnswer(i -> {
            ProjectFile file = new ProjectFile(); file.setId(nextId++); file.setUid(UUID.randomUUID().toString());
            file.setName(i.getArgument(2)); file.setFileSize(i.getArgument(4));
            file.setProjectId(1L); file.setIsFolder(false);
            file.setFilePath(dirs.get(i.getArgument(1)) + "/" + file.getName()); tree.put(file.getFilePath(), file); return file;
        });
        when(storage.save(anyString(), any(InputStream.class))).thenAnswer(i -> {
            content.put(i.getArgument(0), ((InputStream)i.getArgument(1)).readAllBytes()); return i.getArgument(0);
        });
        when(storage.load(anyString())).thenAnswer(i -> new ByteArrayResource(content.get(i.getArgument(0))));
        when(gateway.executeWithinScope(2L,"account-A", "members", Map.of("conversationId", conversation))).thenReturn(Map.of("members", List.of()));
    }

    @Test void deniesProjectReadOrWriteBeforeAnyRemoteAction() {
        when(access.hasWritePermission(1L,2L)).thenReturn(false);
        assertThrows(IllegalArgumentException.class, () -> service.execute(2L,1L,"import",Map.of("conversationId",conversation,"attachmentId",attachment)));
        verifyNoInteractions(gateway);
    }

    @Test void verifiesDigestAndPreservesEditsAndStableIdentityOnRepeatedImport() throws Exception {
        byte[] original = "a contract".getBytes(StandardCharsets.UTF_8);
        when(gateway.executeWithinScope(2L,"account-A","download",Map.of("conversationId",conversation,"attachmentId",attachment)))
                .thenReturn(Map.of("name","contract.txt","base64",Base64.getEncoder().encodeToString(original),"sha256",ImProjectFiles.sha256(original)));
        Map<String,Object> first = result(service.execute(2L,1L,"import",Map.of("conversationId",conversation,"attachmentId",attachment)));
        String path = (String) first.get("path"); assertArrayEquals(original,content.get(path));
        content.put(path,"user revision".getBytes(StandardCharsets.UTF_8));
        Map<String,Object> second = result(service.execute(2L,1L,"import",Map.of("conversationId",conversation,"attachmentId",attachment)));
        assertEquals(first.get("uid"),second.get("uid")); assertEquals("user revision",new String(content.get(path),StandardCharsets.UTF_8));
        Map<?,?> provenance=json.readValue(content.get("项目沟通/"+conversation+"/来源/"+attachment+".json"),Map.class);
        assertEquals(attachment,provenance.get("attachmentId")); assertEquals(first.get("uid"),provenance.get("fileUid"));
        verify(gateway,times(2)).executeWithinScope(2L,"account-A","members",Map.of("conversationId",conversation));
    }

    @Test void rejectsCorruptAttachmentBeforeWritingProjectFiles() {
        when(gateway.executeWithinScope(eq(2L),eq("account-A"),eq("download"),anyMap())).thenReturn(Map.of("name","a.txt","base64","YWJj","sha256","wrong"));
        assertThrows(IllegalArgumentException.class, () -> service.execute(2L,1L,"import",Map.of("conversationId",conversation,"attachmentId",attachment)));
        assertTrue(tree.isEmpty()); verify(storage,never()).save(anyString(),any());
    }

    @Test void bindingInGitRetainsOriginalIdentityAfterDatabaseProjectUidChanges() {
        Map<String,Object> first=result(service.execute(2L,1L,"binding",Map.of("conversationId",conversation)));
        when(catalog.ensureProjectUid(any())).thenReturn(UUID.randomUUID().toString());
        assertEquals(first,service.execute(2L,1L,"binding",Map.of("conversationId",conversation)));
        assertEquals(projectUid,first.get("projectUid"));
    }

    @Test void assistantIdentityUsesGitMarkerAfterCloneChangesDatabaseUid() {
        assertEquals(projectUid, service.ensureIdentity(2L, 1L, "account-A"));
        when(catalog.ensureProjectUid(any())).thenReturn(UUID.randomUUID().toString());
        assertEquals(projectUid, service.ensureIdentity(2L, 1L, "account-A"));
        verify(catalog, times(1)).ensureProjectUid(any());
        verify(gateway, never()).executeWithinScope(any(), anyString(), anyString(), anyMap());
    }

    @Test void readonlyMemberCanReuseIdentityButCannotCreateIt() {
        when(access.hasWritePermission(1L, 2L)).thenReturn(false);
        assertThrows(IllegalArgumentException.class, () -> service.ensureIdentity(2L, 1L, "account-A"));
        when(access.hasWritePermission(1L, 2L)).thenReturn(true);
        service.ensureIdentity(2L, 1L, "account-A");
        when(access.hasWritePermission(1L, 2L)).thenReturn(false);
        assertEquals(projectUid, service.ensureIdentity(2L, 1L, "account-A"));
    }

    @Test void privateReplyIdentityReadNeverCreatesFiles() {
        assertThrows(IllegalArgumentException.class, () -> service.readIdentity(2L, 1L, "account-A"));
        assertTrue(content.isEmpty());
        service.ensureIdentity(2L, 1L, "account-A");
        when(access.hasWritePermission(1L, 2L)).thenReturn(false);
        clearInvocations(storage, files, catalog);
        assertEquals(projectUid, service.readIdentity(2L, 1L, "account-A"));
        verify(storage, never()).save(anyString(), any());
        verifyNoInteractions(catalog);
    }

    @Test void exportStartsAtOldestAndArchivesEveryPageWithMessageUids() throws Exception {
        Map<String,Object> a=Map.of("id",1,"uid",UUID.randomUUID().toString(),"text","first");
        Map<String,Object> b=Map.of("id",2,"uid",UUID.randomUUID().toString(),"text","last");
        when(gateway.executeWithinScope(eq(2L),eq("account-A"),eq("messages"),anyMap())).thenAnswer(i -> {
            Map<?,?> p=i.getArgument(3);
            return ((Number)p.get("afterId")).longValue()==0 ? Map.of("messages",List.of(a),"hasMore",true)
                    : Map.of("messages",List.of(b),"hasMore",false);
        });
        Map<String,Object> out=result(service.execute(2L,1L,"export",Map.of("conversationId",conversation)));
        Map<?,?> archive=json.readValue(content.get(out.get("path")),Map.class);
        assertEquals(List.of(a,b),archive.get("messages")); assertEquals(2,out.get("messageCount"));
        assertEquals(projectUid,archive.get("projectUid"));
    }

    @Test void newConversationAfterGitCloneUsesTheSameProjectIdentity() {
        service.execute(2L,1L,"binding",Map.of("conversationId",conversation));
        when(catalog.ensureProjectUid(any())).thenReturn(UUID.randomUUID().toString());
        String secondConversation=UUID.randomUUID().toString();
        Map<String,Object> next=result(service.execute(2L,1L,"binding",Map.of("conversationId",secondConversation)));
        assertEquals(projectUid,next.get("projectUid"));
    }

    @Test void accountSwitchBetweenMembershipAndWriteAbortsBeforeAnyFile() {
        doNothing().doThrow(new IllegalArgumentException("账户已变化")).when(gateway).assertAccountScope("account-A");
        assertThrows(IllegalArgumentException.class,()->service.execute(2L,1L,"binding",Map.of("conversationId",conversation)));
        assertTrue(content.isEmpty());
    }

    @Test void failedArchiveRollsBackPhysicalFilesInAnActualTransaction() {
        var source=new org.springframework.jdbc.datasource.DriverManagerDataSource("jdbc:h2:mem:im-rollback;DB_CLOSE_DELAY=-1", "sa", "");
        var transaction=new org.springframework.transaction.support.TransactionTemplate(new org.springframework.jdbc.datasource.DataSourceTransactionManager(source));
        when(gateway.executeWithinScope(eq(2L),eq("account-A"),eq("messages"),anyMap())).thenThrow(new IllegalArgumentException("remote unavailable"));
        assertThrows(IllegalArgumentException.class,()->transaction.execute(status -> service.execute(2L,1L,"export",Map.of("conversationId",conversation))));
        assertTrue(content.isEmpty(), "failed export must not leave files for Git to capture");
    }

    @Test void archiveByteBudgetAbortsWithoutLeavingFiles() {
        var source=new org.springframework.jdbc.datasource.DriverManagerDataSource("jdbc:h2:mem:im-budget;DB_CLOSE_DELAY=-1", "sa", "");
        var transaction=new org.springframework.transaction.support.TransactionTemplate(new org.springframework.jdbc.datasource.DataSourceTransactionManager(source));
        when(gateway.executeWithinScope(eq(2L),eq("account-A"),eq("messages"),anyMap())).thenAnswer(i -> {
            long cursor=((Number)((Map<?,?>)i.getArgument(3)).get("afterId")).longValue();
            var batch=new ArrayList<Map<String,Object>>();
            for (int j=1;j<=100;j++) batch.add(Map.of("id",cursor+j,"text","文".repeat(8000)));
            return Map.of("messages",batch,"hasMore",true);
        });
        var error=assertThrows(IllegalArgumentException.class,()->transaction.execute(status -> service.execute(2L,1L,"export",Map.of("conversationId",conversation))));
        assertTrue(error.getMessage().contains("16 MiB"));
        assertTrue(content.isEmpty());
    }

    @Test void pathTraversalAndMissingProjectFileCannotBeSent() {
        assertThrows(IllegalArgumentException.class, () -> service.execute(2L,1L,"sendFile",Map.of("conversationId",conversation,"path","../secret","clientMessageId","retry")));
        verify(gateway,never()).executeWithinScope(eq(2L),eq("account-A"),eq("upload"),anyMap());
        assertThrows(IllegalArgumentException.class,()->ImProjectFiles.safeName("../x.txt"));
    }
    @Test void projectQuoteRequiresFileAccessAndCarriesStableSourceIdentity() {
        ProjectFile file = new ProjectFile(); file.setId(9L); file.setUid(UUID.randomUUID().toString());
        file.setProjectId(1L); file.setName("draft.txt"); file.setFilePath("draft.txt"); file.setIsFolder(false);
        tree.put("draft.txt", file); content.put("draft.txt", new byte[]{65});
        var params = Map.<String,Object>of("conversationId", conversation, "path", "draft.txt", "clientMessageId", "quote-1");
        doThrow(new IllegalArgumentException("抱歉文件还在准备中，请联系您的律师。")).when(fileAccess).requireRead(file,2L);
        assertThrows(IllegalArgumentException.class, () -> service.execute(2L,1L,"sendFile",params));
        verify(gateway,never()).executeWithinScope(eq(2L),eq("account-A"),eq("upload"),anyMap());
        doNothing().when(fileAccess).requireRead(file,2L);
        when(gateway.executeWithinScope(eq(2L),eq("account-A"),eq("upload"),anyMap())).thenReturn(Map.of("id", attachment));
        service.execute(2L,1L,"sendFile",params);
        verify(gateway).executeWithinScope(2L,"account-A","upload",Map.of("conversationId",conversation,"name","draft.txt","base64","QQ==",
                "clientMessageId","quote-1","source",Map.of("projectUid",projectUid,"fileUid",file.getUid())));
        assertTrue(content.containsKey("项目沟通/项目标识.json"), "first quote must persist project identity in Git");
    }

    @SuppressWarnings("unchecked") Map<String,Object> result(Object value) { return (Map<String,Object>)value; }
}
