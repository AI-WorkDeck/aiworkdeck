// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.service.mobile.CloudStorageQuotaService;
import com.checkba.storage.*;
import com.checkba.version.*;
import com.checkba.version.memory.*;
import jakarta.persistence.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.test.util.ReflectionTestUtils;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class OwnedCloudProjectDeletionTest {
 @TempDir Path root;
 ProjectService service;Project project;ProjectFile file;
 ProjectRepository projects;ProjectFileRepository files;ProjectMemberRepository members;
 ProjectRemoteRepository remotes;CloudStorageQuotaService quota;
 ApplicationEventPublisher events;Path cloud, local, projectDir, gitDir, memoryDir, memoryWork;
 @BeforeEach void setup() throws Exception {
  cloud=Files.createDirectories(root.resolve("official-cloud"));local=Files.writeString(root.resolve("local-original.docx"),"local content");
  projectDir=Files.createDirectories(cloud.resolve("projects/1"));gitDir=Files.createDirectories(cloud.resolve("repos/project-1.git"));
  memoryDir=Files.createDirectories(cloud.resolve("repos/memory-1.git"));memoryWork=Files.createDirectories(cloud.resolve("repos/memory-worktrees/1"));
  Files.writeString(projectDir.resolve("sample.txt"),"cloud copy");Files.writeString(gitDir.resolve("HEAD"),"cloud history");
  Files.writeString(memoryDir.resolve("HEAD"),"cloud memory");Files.writeString(memoryWork.resolve("summary.md"),"cloud summary");
  projects=mock(ProjectRepository.class);files=mock(ProjectFileRepository.class);members=mock(ProjectMemberRepository.class);
  remotes=mock(ProjectRemoteRepository.class);quota=mock(CloudStorageQuotaService.class);events=mock(ApplicationEventPublisher.class);
  var users=mock(UserRepository.class);when(users.lockStorageOwner(7L)).thenReturn(Optional.of(new User()));
  var resolver=mock(ProjectStorageResolver.class);when(resolver.globalRoot()).thenReturn(cloud);when(resolver.projectRoot(1L)).thenReturn(projectDir);
  var repo=mock(ProjectRepoService.class,RETURNS_DEEP_STUBS);when(repo.gitDir(1L)).thenReturn(gitDir);when(repo.objects().projectRoot(1L)).thenReturn(cloud.resolve("version-objects/project-1"));
  var memory=mock(MemoryRepoService.class);when(memory.gitDir(anyString())).thenReturn(memoryDir);when(memory.workTree(anyString())).thenReturn(memoryWork);
  service=new ProjectService(projects,members,users,files,mock(ProjectProfileFieldRepository.class),mock(TushareService.class),mock(ProjectVariableService.class),mock(com.checkba.service.telemetry.TelemetryService.class),resolver,repo,memory,mock(MemoryRemoteRepository.class),mock(CompletionEntryRepository.class),events);
  var sessions=mock(WorkSessionService.class);doAnswer(c->{c.<Runnable>getArgument(1).run();return null;}).when(sessions).runProjectDeletion(anyLong(),any());
  var em=mock(EntityManager.class);var query=mock(Query.class);when(em.createQuery(anyString())).thenReturn(query);when(query.setParameter(anyString(),any())).thenReturn(query);
  var storage=mock(StorageService.class);doAnswer(c->{Files.deleteIfExists(cloud.resolve(c.<String>getArgument(0)));return null;}).when(storage).delete(anyString());
  var factory=mock(StorageServiceFactory.class);when(factory.getStorageService()).thenReturn(storage);
  ReflectionTestUtils.setField(service,"workSessions",sessions);ReflectionTestUtils.setField(service,"entityManager",em);ReflectionTestUtils.setField(service,"cloudStorageQuota",quota);ReflectionTestUtils.setField(service,"storageServiceFactory",factory);ReflectionTestUtils.setField(service,"cloudProjectRemotes",remotes);
  when(quota.isEnabled()).thenReturn(true);
  project=new Project();project.setId(1L);project.setUid("project-uid");project.setUserId(7L);project.setCloudBillingOwnerId(7L);project.setCloudOwnership("PERSONAL");
  when(em.find(Project.class,1L,LockModeType.PESSIMISTIC_WRITE)).thenReturn(project);
  file=new ProjectFile();file.setIsFolder(false);file.setFilePath("projects/1/sample.txt");when(files.findByProjectId(1L)).thenReturn(List.of(file));
 }
 @Test void removesOnlyCloudBytesAndNeverPublishesOrdinaryDeletion() throws Exception {
  byte[] before=Files.readAllBytes(local);service.deleteOwnedCloudProject(1L,7L,"project-uid");
  for(Path p:List.of(projectDir,gitDir,memoryDir,memoryWork))assertFalse(Files.exists(p));
  assertArrayEquals(before,Files.readAllBytes(local));verify(projects).deleteById(1L);verifyNoInteractions(events);
 }
 @Test void sharedOrUnknownOwnershipCannotStartDeleting() throws Exception {
  var collaborator=new ProjectMember();collaborator.setUserId(8L);when(members.findByProjectId(1L)).thenReturn(List.of(collaborator));
  assertThrows(IllegalStateException.class,()->service.deleteOwnedCloudProject(1L,7L,"project-uid"));
  when(members.findByProjectId(1L)).thenReturn(List.of());project.setCloudBillingOwnerId(null);
  assertThrows(IllegalStateException.class,()->service.deleteOwnedCloudProject(1L,7L,"project-uid"));
  assertTrue(Files.exists(projectDir.resolve("sample.txt")));verify(projects,never()).deleteById(anyLong());verifyNoInteractions(events);
 }
 @Test void persistedTraversalAndSymlinkCannotReachLocalOriginal() throws Exception {
  file.setFilePath("projects/1/../../local-original.docx");
  assertThrows(IllegalStateException.class,()->service.deleteOwnedCloudProject(1L,7L,"project-uid"));
  file.setFilePath("projects/1/link.docx");Files.createSymbolicLink(projectDir.resolve("link.docx"),local);
  assertThrows(IllegalStateException.class,()->service.deleteOwnedCloudProject(1L,7L,"project-uid"));
  assertEquals("local content",Files.readString(local));assertTrue(Files.exists(projectDir.resolve("sample.txt")));verifyNoInteractions(events);
 }
 @Test void localDeploymentOrLocalRootCannotBeCleaned() {
  project.setLocalRoot(local.toString());assertThrows(IllegalStateException.class,()->service.deleteOwnedCloudProject(1L,7L,"project-uid"));
  project.setLocalRoot(null);ReflectionTestUtils.setField(service,"localMode",true);
  assertThrows(IllegalStateException.class,()->service.deleteOwnedCloudProject(1L,7L,"project-uid"));verify(projects,never()).deleteById(anyLong());
 }
 @Test void completedReceiptReconcilesOnlyAlreadyMissingCloudBytes() throws Exception {
  assertThrows(IllegalStateException.class,()->service.reconcileCompletedCloudProject(1L,7L,"project-uid"));
  verify(projects,never()).deleteById(anyLong());
  service.deleteOwnedCloudProject(1L,7L,"project-uid");
  service.reconcileCompletedCloudProject(1L,7L,"project-uid");
  assertEquals("local content",Files.readString(local));verify(projects,times(2)).deleteById(1L);verifyNoInteractions(events);
 }
}
