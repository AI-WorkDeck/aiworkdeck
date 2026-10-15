// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;

import com.checkba.config.ReviewAccountGate;
import com.checkba.service.AuthAbuseGuard;
import com.checkba.service.UserService;
import com.checkba.service.UserSessionService;
import com.checkba.service.mail.MailAuthService;
import com.checkba.service.sms.SmsAuthService;
import com.checkba.service.mobile.MobileBillingClient;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.util.ReflectionTestUtils;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class AuthControllerOfficialPasswordTest {
    @Test
    void officialLegacyEntrypointsCannotSendCodesCreateUsersOrIssueSessions() {
        UserService users = mock(UserService.class);
        UserSessionService sessions = mock(UserSessionService.class);
        SmsAuthService sms = mock(SmsAuthService.class);
        MailAuthService mail = mock(MailAuthService.class);
        MobileBillingClient billing = mock(MobileBillingClient.class);
        AuthController controller = new AuthController(users, null, null, null,
                new AuthAbuseGuard(false, "closed"), null, sms, mail, null, sessions,
                false, null, null, billing);
        ReflectionTestUtils.setField(controller, "officialPasswordLoginRequired", true);
        MockHttpServletRequest http = new MockHttpServletRequest();
        AuthController.SmsLoginRequest sr = new AuthController.SmsLoginRequest();
        sr.setPhone("13800000000"); sr.setCode("123456");
        AuthController.MailLoginRequest mr = new AuthController.MailLoginRequest();
        mr.setEmail("synthetic@example.test"); mr.setCode("123456");
        for (Map<String, Object> result : java.util.List.of(
                controller.smsLoginSendCode(sr, http), controller.smsLoginVerify(sr, http),
                controller.mailLoginSendCode(mr, http), controller.mailLoginVerify(mr, http),
                controller.wxPhoneLogin(new AuthController.WxPhoneLoginRequest(), http))) {
            assertEquals(1, result.get("code"));
            assertEquals("password_login_required", result.get("kind"));
            assertFalse(result.containsKey("data"));
        }
        verifyNoInteractions(users, sessions, sms, mail, billing);
    }

    @Test
    void configuredReviewIdentityStillRunsExistingVerificationAndNeverBypassesIt() {
        MailAuthService mail = mock(MailAuthService.class);
        UserSessionService sessions = mock(UserSessionService.class);
        when(mail.verifySigninCode(anyString(), anyString())).thenThrow(new IllegalArgumentException("invalid code"));
        AuthController controller = new AuthController(mock(UserService.class), null, null, null,
                new AuthAbuseGuard(false, "closed"), null, null, mail, null, sessions,
                false, null, null, null);
        ReflectionTestUtils.setField(controller, "officialPasswordLoginRequired", true);
        ReflectionTestUtils.setField(controller, "reviewAccountGate",
                new ReviewAccountGate("review@example.test", "123456"));
        AuthController.MailLoginRequest request = new AuthController.MailLoginRequest();
        request.setEmail("review@example.test"); request.setCode("999999");
        Map<String, Object> result = controller.mailLoginVerify(request, new MockHttpServletRequest());
        assertEquals(1, result.get("code"));
        assertEquals("invalid code", result.get("message"));
        verify(mail).verifySigninCode("review@example.test", "999999");
        verifyNoInteractions(sessions);
    }
}
