// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version.cloud;

import com.checkba.model.entity.ProjectObjectLocalOnly;
import com.checkba.model.entity.User;
import com.checkba.repository.UserRepository;
import com.checkba.version.ProjectRepoService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * W note 5 (C12 spec; CEO-approved 0.92 item 4): on the case server (web workbench) a declared local-only
 * file showed the anonymous 「仅在同事的电脑上」: the server's declaration rows carry the declaring user's id,
 * not a display name, so localOnlyEntries never sent sharedBy. Resolve it like ProjectObjectController.status.
 */
class LocalOnlyEntriesSharerNameTest {

    @SuppressWarnings("unchecked")
    @Test
    void serverDeclarationsNameTheSharer() {
        ProjectRepoService repos = mock(ProjectRepoService.class);
        when(repos.mainBranch()).thenReturn("refs/heads/master");
        when(repos.objectPointerPaths(eq(7L), anyString(), eq(false), anyInt(), any()))
                .thenReturn(List.of("证据/庭审录像.mp4"));
        var sync = new ProjectObjectSyncService(repos, mock(ObjectProvider.class), new ObjectMapper());

        ProjectObjectLocalOnly row = new ProjectObjectLocalOnly();
        row.setProjectId(7L); row.setObjectSha("a".repeat(64)); row.setObjectSize(60L << 20);
        row.setDeclaredBy(31L);                      // server row: an id, no display name, mine unset
        ProjectObjectPlanService plans = mock(ProjectObjectPlanService.class);
        when(plans.hasLocalOnly(7L)).thenReturn(true);
        when(plans.localOnly(7L)).thenReturn(List.of(row));
        ObjectProvider<ProjectObjectPlanService> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(plans);
        ReflectionTestUtils.setField(sync, "objectPlans", provider);

        UserRepository users = mock(UserRepository.class);
        User shen = new User(); shen.setId(31L); shen.setUsername("shen"); shen.setDisplayName("沈砚");
        when(users.findById(31L)).thenReturn(Optional.of(shen));
        ReflectionTestUtils.setField(sync, "users", users);

        List<Map<String, Object>> entries = sync.localOnlyEntries(7L);
        assertEquals(1, entries.size());
        assertEquals("沈砚", entries.get(0).get("sharedBy"), "the web placeholder says whose computer it is on");
        assertEquals(false, entries.get(0).get("mine"));
    }
}
