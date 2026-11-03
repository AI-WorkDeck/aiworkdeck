// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.market;

import com.checkba.service.account.AccountService;
import com.checkba.service.entitlement.EntitlementService;
import com.checkba.service.site.SiteProfileService;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class MarketSiteRoutingTest {
    @Test void bothOfficialRegistriesFollowCurrentSiteAndCustomRegistryStaysPinned() {
        var account = mock(AccountService.class);
        var gate = new MarketPurchaseGate(account, mock(EntitlementService.class));
        ReflectionTestUtils.setField(gate, "sites", SiteProfileService.pinnedTo("https://www.workdeck.ai"));
        assertEquals("https://www.workdeck.ai/api/registry/plugins",
                gate.registryUrl("https://www.aiworkdeck.com/api/registry/plugins", "plugins"));
        assertEquals("https://www.workdeck.ai/api/registry/skills",
                gate.registryUrl("https://www.aiworkdeck.com/api/registry/skills", "skills"));
        assertEquals("https://private.example/skills", gate.registryUrl("https://private.example/skills", "skills"));
        ReflectionTestUtils.setField(gate, "sites", SiteProfileService.pinnedTo("https://www.aiworkdeck.com"));
        assertEquals("https://www.aiworkdeck.com/api/registry/plugins",
                gate.registryUrl("https://www.workdeck.ai/api/registry/plugins", "plugins"));
    }
    @Test void rejectsStaleAccountBeforeInstallingResponse() {
        var account = mock(AccountService.class);
        var gate = new MarketPurchaseGate(account, mock(EntitlementService.class));
        var snapshot = new AccountService.ConnectionSnapshot("https://www.workdeck.ai", "test", "test", 1L);
        when(account.isCurrentConnection(snapshot)).thenReturn(true);
        assertDoesNotThrow(() -> gate.assertConnection(snapshot));
        when(account.isCurrentConnection(snapshot)).thenReturn(false);
        assertThrows(IllegalStateException.class, () -> gate.assertConnection(snapshot));
    }
}
