// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;
import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.service.ProjectService;
import com.checkba.storage.ProjectStorageResolver;
import com.checkba.version.memory.MemoryRepoService;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.util.ReflectionTestUtils;
import java.nio.file.Path;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
@DataJpaTest(showSql=false)
@AutoConfigureTestDatabase(replace=AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties={"spring.datasource.url=jdbc:h2:mem:cloud-memory-cleanup;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1","spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa","spring.datasource.password=","spring.jpa.database-platform=org.hibernate.dialect.H2Dialect","spring.jpa.hibernate.ddl-auto=create-drop"})
class CloudMemoryDocumentCleanupPersistenceTest {
 @Autowired EntityManager em;@Autowired MemoryDocumentRepository documents;@Autowired MemoryDocumentSpaceRepository spaces;
 @TempDir Path root;
 String create(String scope,String owner) {
  var space=new MemoryDocumentSpace();space.setId(UUID.randomUUID().toString());space.setScope(scope);space.setOwnerKey(owner);space.setLabel("synthetic");spaces.saveAndFlush(space);
  var doc=new MemoryDocument();doc.setSpaceId(space.getId());doc.setPath("note.md");doc.setTitle("synthetic");doc.setContent("private content");documents.saveAndFlush(doc);return space.getId();
 }
 @Test void personalCleanupDoesNotDeleteOrganizationOtherUserOrProjectDocuments() {
  String own=create("user","7"),other=create("user","8"),organization=create("organization","7"),project=create("project","7");
  var service=new CloudProjectCleanupService(mock(ProjectRepository.class),mock(ProjectMemberRepository.class),mock(ProjectRemoteRepository.class),mock(ProjectService.class),true,false);
  var repos=mock(MemoryRepoService.class);when(repos.gitDir("user-7-memory")).thenReturn(root.resolve("repos/user-7-memory.git"));when(repos.workTree("user-7-memory")).thenReturn(root.resolve("repos/memory-worktrees/user-7-memory"));
  var storage=mock(ProjectStorageResolver.class);when(storage.globalRoot()).thenReturn(root);
  var users=mock(UserRepository.class);when(users.lockStorageOwner(7L)).thenReturn(Optional.of(new User()));
  ReflectionTestUtils.setField(service,"memoryRepos",repos);ReflectionTestUtils.setField(service,"storage",storage);ReflectionTestUtils.setField(service,"users",users);ReflectionTestUtils.setField(service,"memories",mock(MemoryEntryRepository.class));ReflectionTestUtils.setField(service,"memoryRemotes",mock(MemoryRemoteRepository.class));ReflectionTestUtils.setField(service,"memoryDb",em);
  service.deleteUserMemory(7L,true);em.flush();em.clear();
  assertTrue(spaces.findById(own).isEmpty());assertTrue(documents.findBySpaceIdAndDeletedFalseOrderByPathAsc(own).isEmpty());
  for(String id:List.of(other,organization,project)){assertTrue(spaces.findById(id).isPresent());assertEquals(1,documents.findBySpaceIdAndDeletedFalseOrderByPathAsc(id).size());}
 }
}
