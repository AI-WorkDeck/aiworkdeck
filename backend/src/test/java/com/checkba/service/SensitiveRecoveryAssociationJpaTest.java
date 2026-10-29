// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service;

import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.TestPropertySource;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@DataJpaTest(showSql = false)
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:h2:mem:sensitive-recovery-association;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect", "spring.jpa.hibernate.ddl-auto=create-drop"
})
class SensitiveRecoveryAssociationJpaTest {
    @Autowired ProjectFileRepository files;
    @Autowired EntityManager entityManager;
    @Autowired com.checkba.repository.ProjectRepository projects;
    @org.junit.jupiter.api.io.TempDir java.nio.file.Path directory;

    private ProjectFile file(String name) {
        var file = new ProjectFile(); file.setProjectId(2L); file.setUserId(9L);
        file.setName(name); file.setFileType(name.endsWith(".awd-recovery") ? "awd-recovery" : "txt");
        file.setFilePath("projects/2/" + name); file.setIsFolder(false); file.setSortOrder(0);
        return files.saveAndFlush(file);
    }

    @Test void associationSurvivesPersistenceContextReloadAndRenamingWithoutExposingMetadata() throws Exception {
        var document = file("redacted.txt"); var kit = file("redacted.txt.awd-recovery");
        var service = new ProjectFileService(files, null, null, null, null, null, null, null);
        service.linkSensitiveRecovery(document, kit);
        long documentId = document.getId(), kitId = kit.getId();
        entityManager.clear();
        var reopened = files.findById(documentId).orElseThrow();
        assertNotSame(document, reopened);
        assertEquals(kitId, reopened.getSensitiveRecoveryFileId());
        reopened.setName("renamed.txt"); reopened.setParentId(50L); reopened.setFilePath("projects/2/elsewhere/renamed.txt");
        files.saveAndFlush(reopened); entityManager.clear();
        var renamed = files.findById(documentId).orElseThrow();
        assertEquals(kitId, renamed.getSensitiveRecoveryFileId());
        assertFalse(new ObjectMapper().findAndRegisterModules().writeValueAsString(renamed).contains("sensitiveRecoveryFileId"));
        var fromClient = new ObjectMapper().readValue("{\"sensitiveRecoveryFileId\":999}", ProjectFile.class);
        assertNull(fromClient.getSensitiveRecoveryFileId());
    }

    @Test void recoveryAssociationCannotCrossProjects() {
        var document = file("redacted.txt"); var kit = file("material.awd-recovery"); kit.setProjectId(3L);
        var service = new ProjectFileService(files, null, null, null, null, null, null, null);
        assertThrows(IllegalArgumentException.class, () -> service.linkSensitiveRecovery(document, kit));
        assertNull(document.getSensitiveRecoveryFileId());
    }
    @Test void realLooseFileResolverStoresRecoverableCopyAndRestoresAfterDatabaseReload() throws Exception {
        var project = new com.checkba.model.entity.Project(); project.setName("Synthetic recovery workspace");
        project.setProjectType(com.checkba.model.entity.Project.LOOSE_FILES); project.setListedCompanyName("");
        project.setTargetCompanyName(""); project.setUserId(9L); projects.saveAndFlush(project);
        var original = directory.toRealPath().resolve("original.txt");
        java.nio.file.Files.writeString(original, "电话13800001111");
        var source = new ProjectFile(); source.setProjectId(project.getId()); source.setUserId(9L);
        source.setName("original.txt"); source.setFileType("txt"); source.setIsFolder(false); source.setSortOrder(0);
        source.setExternalPath(original.toString()); source.setFilePath("projects/" + project.getId() + "/loose/original.txt");
        files.saveAndFlush(source);
        var properties = new com.checkba.storage.StorageProperties();
        properties.getLocal().setRootPath(directory.resolve("managed").toString());
        properties.getLocal().setTemplatePath(directory.resolve("missing-template.docx").toString());
        var resolver = new com.checkba.storage.ProjectStorageResolver(properties, projects);
        org.springframework.test.util.ReflectionTestUtils.setField(resolver, "projectFileRepository", files);
        var local = new com.checkba.storage.LocalFileStorageService(resolver);
        var factory = mock(com.checkba.storage.StorageServiceFactory.class); when(factory.getStorageService()).thenReturn(local);
        var fileService = new ProjectFileService(files, mock(com.checkba.service.ai.ProjectRagService.class), factory,
                mock(com.checkba.version.WorkSessionService.class), mock(UserService.class), null,
                mock(com.checkba.service.telemetry.TelemetryService.class), null);
        var members = mock(ProjectMemberService.class);
        when(members.hasReadPermission(project.getId(), 9L)).thenReturn(true);
        when(members.hasWritePermission(project.getId(), 9L)).thenReturn(true);
        var users = mock(com.checkba.repository.UserRepository.class);
        var owner = new com.checkba.model.entity.User(); owner.setRole("LAWYER");
        when(users.findById(9L)).thenReturn(java.util.Optional.of(owner));
        var access = new ProjectFileAccessService(members, users, files);
        var controller = new com.checkba.controller.SensitiveController(new SensitiveService(), factory, fileService, members, access);
        try (var auth = mockStatic(com.checkba.controller.AuthController.class)) {
            auth.when(() -> com.checkba.controller.AuthController.getUserIdFromSession("s")).thenReturn(9L);
            var request = new com.checkba.controller.SensitiveController.Request(source.getId(), java.util.List.of("PHONE"), "TOKEN", null, null, "1", null);
            var response = controller.desensitizeFile(request, "s");
            assertEquals(200, response.getStatusCode().value(), String.valueOf(response.getBody()));
            var document = (ProjectFile) ((java.util.Map<?, ?>) response.getBody()).get("file");
            long id = document.getId();
            assertFalse(resolver.isExternalFileKey(document.getFilePath()));
            assertTrue(resolver.resolve(document.getFilePath()).startsWith(directory.resolve("managed")));
            assertFalse(java.nio.file.Files.readString(resolver.resolve(document.getFilePath())).contains("13800001111"));
            var kit = files.findById(document.getSensitiveRecoveryFileId()).orElseThrow();
            assertTrue(java.nio.file.Files.readString(resolver.resolve(kit.getFilePath())).startsWith("AWD-RECOVERY-1:"));
            entityManager.flush(); entityManager.clear();
            var reopened = files.findById(id).orElseThrow();
            String previousPath = reopened.getFilePath(), renamedPath = "projects/" + project.getId() + "/renamed.txt";
            local.move(previousPath, renamedPath); reopened.setFilePath(renamedPath); reopened.setName("renamed.txt");
            files.saveAndFlush(reopened); entityManager.clear();
            var restored = controller.restore(new com.checkba.controller.SensitiveController.Request(id, null, null, null, null, "1", null), "s");
            assertEquals(200, restored.getStatusCode().value(), String.valueOf(restored.getBody()));
            var restoredFile = (ProjectFile) ((java.util.Map<?, ?>) restored.getBody()).get("file");
            assertEquals(java.nio.file.Files.readString(original), java.nio.file.Files.readString(resolver.resolve(restoredFile.getFilePath())));
            try (var externalFiles = java.nio.file.Files.list(original.getParent())) {
                assertEquals(java.util.Set.of("original.txt", "managed"), externalFiles.map(path -> path.getFileName().toString()).collect(java.util.stream.Collectors.toSet()));
            }
        }
    }

}
