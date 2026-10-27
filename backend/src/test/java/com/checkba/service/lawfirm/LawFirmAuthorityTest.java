// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.lawfirm;

import com.checkba.model.entity.AccountBinding;
import com.checkba.repository.AccountBindingRepository;
import com.checkba.service.collab.*;
import org.junit.jupiter.api.*;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import java.util.Optional;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class LawFirmAuthorityTest {
    final AccountBindingRepository bindings=mock(AccountBindingRepository.class);
    final AccountDirectoryClient directory=mock(AccountDirectoryClient.class);
    final LawFirmAuthority authority=new LawFirmAuthority(bindings,directory);
    @BeforeEach void setUp() {
        AccountBinding binding=new AccountBinding();binding.setUserId(1L);binding.setExternalAccountId("synthetic-account");
        when(bindings.findByUserId(1L)).thenReturn(Optional.of(binding));when(directory.configured()).thenReturn(true);
    }
    @AfterEach void clearRequest(){RequestContextHolder.resetRequestAttributes();}
    DirectoryReply reply(OrgMembership scope){return new DirectoryReply(true,new DirectoryAccount("synthetic-account","synthetic","合成账户",null),scope,scope);}
    @Test void reusesOnlyCurrentHttpRequestAndNextRequestObservesRevocation() {
        when(directory.lookupByAccountId("synthetic-account","synthetic-account"))
                .thenReturn(reply(new OrgMembership("synthetic-team","synthetic-firm",true)),reply(OrgMembership.NONE));
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(new MockHttpServletRequest()));
        for(int i=0;i<1000;i++) assertTrue(authority.current(1L).firmAdmin());
        verify(directory,times(1)).lookupByAccountId("synthetic-account","synthetic-account");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(new MockHttpServletRequest()));
        assertThrows(IllegalArgumentException.class,()->authority.current(1L));
        verify(directory,times(2)).lookupByAccountId("synthetic-account","synthetic-account");
    }
    @Test void callsOutsideHttpRequestDoNotRetainMembership() {
        when(directory.lookupByAccountId("synthetic-account","synthetic-account"))
                .thenReturn(reply(new OrgMembership("synthetic-team","synthetic-firm",true)),reply(OrgMembership.NONE));
        assertTrue(authority.current(1L).firmAdmin());assertThrows(IllegalArgumentException.class,()->authority.current(1L));
        verify(directory,times(2)).lookupByAccountId("synthetic-account","synthetic-account");
    }
    @Test void unconfiguredDirectoryIsAnOutageRatherThanAnAccessDenial() {
        when(directory.configured()).thenReturn(false);
        assertThrows(DirectoryUnavailableException.class,()->authority.current(1L));
        verify(directory,never()).lookupByAccountId(anyString(),anyString());
        when(directory.configured()).thenReturn(true);when(bindings.findByUserId(1L)).thenReturn(Optional.empty());
        assertThrows(LawFirmAuthority.AccessDenied.class,()->authority.current(1L));
    }
}
