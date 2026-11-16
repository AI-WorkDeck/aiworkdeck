// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller;

import com.checkba.model.entity.ProjectMember;
import com.checkba.model.entity.User;
import com.checkba.service.AuthAbuseGuard;
import com.checkba.service.ClientInvitationService;
import com.checkba.service.ProjectMemberService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 项目成员名单不对客户开放：客户（访问码进来的 CLIENT）门户与客户工作区都不读这张表，
 * 名单里有律师的用户名、官网账户 id、头像地址（内含账户 id）以及同项目的其他客户。
 * 客户调用直接拒绝，且不碰名单数据；律师照旧拿完整名单。
 */
class ProjectMemberClientRosterTest {

    private static final long PROJECT = 7L;
    private static final long LAWYER = 1L;
    private static final long CLIENT = 3L;

    private ProjectMemberService pms;
    private ProjectMemberController controller;
    private MockedStatic<AuthController> auth;

    @BeforeEach
    void setUp() {
        pms = mock(ProjectMemberService.class);
        controller = new ProjectMemberController(pms, mock(ClientInvitationService.class), mock(AuthAbuseGuard.class));
        auth = mockStatic(AuthController.class);
        auth.when(() -> AuthController.getUserIdFromSession("lawyer")).thenReturn(LAWYER);
        auth.when(() -> AuthController.getUserIdFromSession("client")).thenReturn(CLIENT);
        when(pms.hasReadPermission(PROJECT, LAWYER)).thenReturn(true);
        when(pms.hasReadPermission(PROJECT, CLIENT)).thenReturn(true);
        when(pms.isClient(PROJECT, CLIENT)).thenReturn(true);
    }

    @AfterEach
    void tearDown() {
        auth.close();
    }

    @Test
    @DisplayName("客户读成员名单被拒，且不查名单、不取账户 id")
    void clientCannotReadRoster() {
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> controller.getMembers(PROJECT, "client"));
        String message = String.valueOf(e.getMessage());
        // 掉线判定子串红线：命中会让前端把客户会话清掉
        assertFalse(message.contains("登录") || message.contains("未授权") || message.contains("请先"), message);
        verify(pms, never()).getMembers(anyLong());
        verify(pms, never()).getMemberUsers(anyLong());
        verify(pms, never()).accountIdFor(any(), any());
    }

    @Test
    @DisplayName("律师照旧拿完整名单（含 username / accountId）")
    void staffStillGetsFullRoster() {
        ProjectMember m = new ProjectMember();
        m.setId(5L);
        m.setProjectId(PROJECT);
        m.setUserId(LAWYER);
        m.setRole("ADMIN");
        User u = new User();
        u.setId(LAWYER);
        u.setUsername("lawyer_a");
        u.setDisplayName("律师甲");
        when(pms.getMembers(PROJECT)).thenReturn(List.of(m));
        when(pms.getMemberUsers(PROJECT)).thenReturn(List.of(u));
        when(pms.accountIdFor(u, LAWYER)).thenReturn("acct-1");

        Map<String, Object> res = controller.getMembers(PROJECT, "lawyer");

        assertEquals(0, res.get("code"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> rows = (List<Map<String, Object>>) res.get("data");
        assertEquals(1, rows.size());
        assertEquals("lawyer_a", rows.get(0).get("username"));
        assertEquals("acct-1", rows.get(0).get("accountId"));
        assertEquals("ADMIN", rows.get(0).get("role"));
    }
}
