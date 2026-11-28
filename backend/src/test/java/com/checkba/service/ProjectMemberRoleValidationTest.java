// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/** Lane C retest 0.91.1: a member can only be added with a real project role. */
class ProjectMemberRoleValidationTest {
    @Test
    void onlyProjectRolesAreAccepted() {
        assertEquals("PARTICIPANT", ProjectMemberService.assignableRole(null));
        assertEquals("PARTICIPANT", ProjectMemberService.assignableRole(" "));
        assertEquals("ADMIN", ProjectMemberService.assignableRole("admin"));
        assertEquals("READ_ONLY", ProjectMemberService.assignableRole("READ_ONLY"));
        for (String bad : new String[] {"MEMBER", "OWNER", "CLIENT", "CLIENT_NAMED", "superuser"}) {
            assertThrows(IllegalArgumentException.class, () -> ProjectMemberService.assignableRole(bad), bad);
        }
    }
}
