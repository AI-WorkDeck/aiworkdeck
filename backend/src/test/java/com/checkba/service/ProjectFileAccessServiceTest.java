// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service;

import com.checkba.model.entity.ProjectFile;
import com.checkba.model.entity.User;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import java.util.Optional;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ProjectFileAccessServiceTest {
    ProjectMemberService members = mock(ProjectMemberService.class);
    UserRepository users = mock(UserRepository.class);
    ProjectFileRepository files = mock(ProjectFileRepository.class);
    ProjectFileAccessService access = new ProjectFileAccessService(members, users, files);
    ProjectFile file;

    @BeforeEach void setup() {
        file = new ProjectFile(); file.setId(1L); file.setProjectId(10L); file.setUserId(2L);
        when(members.hasReadPermission(10L, 7L)).thenReturn(true);
        role("USER");
    }
    void role(String role) {
        User user = new User(); user.setId(7L); user.setRole(role);
        when(users.findById(7L)).thenReturn(Optional.of(user));
    }
    @Test void internalReadOnlyMemberCanReadPrivateFile() { assertTrue(access.canRead(file, 7L)); }
    @Test void defaultsAndLegacyNullArePrivateToProjectClient() {
        when(members.isClient(10L, 7L)).thenReturn(true);
        assertFalse(file.getClientVisible()); assertFalse(access.canRead(file, 7L));
        file.setClientVisible(null); assertFalse(access.canRead(file, 7L));
        assertEquals(ProjectFileAccessService.UNAVAILABLE_MESSAGE,
                assertThrows(ProjectFileAccessService.FileAccessDeniedException.class,
                        () -> access.requireRead(file, 7L)).getMessage());
    }
    @Test void globalClientCannotBecomeStaffThroughDefaultMembership() {
        role("CLIENT"); assertFalse(access.canRead(file, 7L));
        when(members.hasWritePermission(10L, 7L)).thenReturn(true);
        file.setUserId(7L);
        assertThrows(ProjectFileAccessService.FileAccessDeniedException.class,
                () -> access.setClientVisible(file, 7L, true));
        verifyNoInteractions(files);
    }
    @Test void clientCanReadOwnUploadAndExplicitGrantCanBeRevoked() {
        role("CLIENT"); file.setUserId(7L); assertTrue(access.canRead(file, 7L));
        file.setUserId(2L); file.setClientVisible(true); assertTrue(access.canRead(file, 7L));
        file.setClientVisible(false); assertFalse(access.canRead(file, 7L));
    }
    @Test void membershipIsMandatoryEvenForOwnOrVisibleFiles() {
        when(members.hasReadPermission(10L, 7L)).thenReturn(false);
        file.setClientVisible(true); file.setUserId(7L);
        assertFalse(access.canRead(file, 7L)); assertFalse(access.canRead(file, null));
    }
    @Test void deletedFilesAreNotReadable() { file.setIsDeleted(true); assertFalse(access.canRead(file, 7L)); }
    @Test void onlyInternalWriterCanSetGrant() {
        assertThrows(ProjectFileAccessService.FileAccessDeniedException.class,
                () -> access.setClientVisible(file, 7L, true));
        assertFalse(file.getClientVisible());
        when(members.hasWritePermission(10L, 7L)).thenReturn(true);
        when(files.save(file)).thenReturn(file);
        assertTrue(access.setClientVisible(file, 7L, true).getClientVisible());
        assertFalse(access.setClientVisible(file, 7L, false).getClientVisible());
        verify(files, times(2)).save(file);
    }
    @Test void foldersCannotImplicitlyGrantAccessToDescendants() {
        when(members.hasWritePermission(10L, 7L)).thenReturn(true); file.setIsFolder(true);
        assertThrows(IllegalArgumentException.class, () -> access.setClientVisible(file, 7L, true));
        verifyNoInteractions(files);
    }
}
