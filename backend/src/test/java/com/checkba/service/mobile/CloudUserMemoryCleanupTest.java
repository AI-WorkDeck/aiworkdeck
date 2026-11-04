// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;
import com.checkba.repository.*;
import com.checkba.service.ProjectService;
import com.checkba.storage.ProjectStorageResolver;
import com.checkba.version.memory.*;
import com.checkba.model.entity.User;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class CloudUserMemoryCleanupTest {
 @TempDir Path root;
 CloudProjectCleanupService service;Path cloud,git,work,local;
 MemoryEntryRepository memories;
 @BeforeEach void setup() throws Exception {
  service=new CloudProjectCleanupService(mock(ProjectRepository.class),mock(ProjectMemberRepository.class),mock(ProjectRemoteRepository.class),mock(ProjectService.class),true,false);
  cloud=Files.createDirectories(root.resolve("cloud"));git=Files.createDirectories(cloud.resolve("repos/user-7-memory.git"));work=Files.createDirectories(cloud.resolve("repos/memory-worktrees/user-7-memory"));
  local=Files.writeString(root.resolve("local-memory.md"),"local original");Files.writeString(git.resolve("HEAD"),"history");Files.writeString(work.resolve("note.md"),"cloud note");
  var repos=mock(MemoryRepoService.class);when(repos.gitDir("user-7-memory")).thenReturn(git);when(repos.workTree("user-7-memory")).thenReturn(work);
  var storage=mock(ProjectStorageResolver.class);when(storage.globalRoot()).thenReturn(cloud);
  var users=mock(UserRepository.class);when(users.lockStorageOwner(7L)).thenReturn(Optional.of(new User()));memories=mock(MemoryEntryRepository.class);
  var em=mock(jakarta.persistence.EntityManager.class);var query=mock(jakarta.persistence.Query.class);when(em.createQuery(anyString())).thenReturn(query);when(query.setParameter(eq("owner"),eq("7"))).thenReturn(query);ReflectionTestUtils.setField(service,"memoryDb",em);
  ReflectionTestUtils.setField(service,"memoryRepos",repos);ReflectionTestUtils.setField(service,"storage",storage);ReflectionTestUtils.setField(service,"users",users);ReflectionTestUtils.setField(service,"memories",memories);ReflectionTestUtils.setField(service,"memoryRemotes",mock(MemoryRemoteRepository.class));
 }
 @Test void completedReceiptRequiresAbsentBytesAndNeverTouchesLocalMemory() throws Exception {
  assertThrows(IllegalStateException.class,()->service.deleteUserMemory(7L,true));assertTrue(Files.exists(work.resolve("note.md")));
  service.deleteUserMemory(7L,false);service.deleteUserMemory(7L,true);
  assertFalse(Files.exists(git));assertFalse(Files.exists(work));assertEquals("local original",Files.readString(local));
  verify(memories,times(2)).findByUserIdAndScopeIn(7L,MemoryRealm.USER_SCOPES);
 }
 @Test void symlinkDoesNotReachLocalFiles() throws Exception {
  Files.delete(work.resolve("note.md"));Files.delete(work);Files.createSymbolicLink(work,root);
  assertThrows(IllegalStateException.class,()->service.deleteUserMemory(7L,false));
  assertTrue(Files.exists(git.resolve("HEAD")));assertEquals("local original",Files.readString(local));verifyNoInteractions(memories);
 }
}
