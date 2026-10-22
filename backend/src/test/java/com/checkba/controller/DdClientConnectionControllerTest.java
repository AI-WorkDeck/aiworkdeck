// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.controller;

import com.checkba.service.DdClientConnectionService;
import okhttp3.MultipartBody;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.junit.jupiter.api.Assertions.*;

class DdClientConnectionControllerTest {
    @Test void multipartUsesUploadHandlerAndPreservesBothFilesAndConsent() throws Exception {
        var service = mock(DdClientConnectionService.class);
        when(service.proxy(anyLong(), anyString(), anyString(), anyString(), anyLong(), any()))
                .thenReturn(new DdClientConnectionService.Reply(200, "application/json", null, "{}".getBytes()));
        var mvc = MockMvcBuilders.standaloneSetup(new DdClientConnectionController(service)).build();
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession("local-session")).thenReturn(1L);
            mvc.perform(multipart("/api/dd-client/connections/test/dd/items/7/submissions")
                    .file(new MockMultipartFile("files", "one.pdf", "application/pdf", new byte[]{1}))
                    .file(new MockMultipartFile("files", "two.jpg", "image/jpeg", new byte[]{2}))
                    .param("requestId", "8").param("idempotencyKey", "retry-1").param("aiConsent", "true")
                    .header("X-Session-Id", "local-session"))
                    .andExpect(status().isOk());
        }
        var body = ArgumentCaptor.forClass(okhttp3.RequestBody.class);
        verify(service).proxy(eq(1L), eq("test"), eq("POST"), eq("/items/7/submissions"), eq(8L), body.capture());
        assertInstanceOf(MultipartBody.class, body.getValue());
        var buffer = new okio.Buffer(); body.getValue().writeTo(buffer); var encoded = buffer.readUtf8();
        assertTrue(encoded.contains("name=\"aiConsent\"")); assertTrue(encoded.contains("true"));
        assertTrue(encoded.contains("one.pdf")); assertTrue(encoded.contains("two.jpg")); assertTrue(encoded.contains("retry-1"));
    }
    @Test void unauthenticatedReadCannotTouchStoredConnections() throws Exception {
        var service = mock(DdClientConnectionService.class);
        var mvc = MockMvcBuilders.standaloneSetup(new DdClientConnectionController(service)).build();
        try (var auth = mockStatic(AuthController.class)) {
            auth.when(() -> AuthController.getUserIdFromSession(null)).thenReturn(null);
            mvc.perform(get("/api/dd-client/connections")).andExpect(status().isUnauthorized());
        }
        verifyNoInteractions(service);
    }
}
