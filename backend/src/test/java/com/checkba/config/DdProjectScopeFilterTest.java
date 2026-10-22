// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.config;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.version.CloudSyncService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.web.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class DdProjectScopeFilterTest {
    private final DdRequestRepository requests = mock(DdRequestRepository.class);
    private final DdItemRepository items = mock(DdItemRepository.class);
    private final DdNotificationRepository notifications = mock(DdNotificationRepository.class);
    private final DdAiJobRepository jobs = mock(DdAiJobRepository.class);
    private final DdProjectScopeFilter filter = new DdProjectScopeFilter(requests, items, notifications, jobs, false);

    @BeforeEach void setup() {
        DdRequest request = new DdRequest(); request.setId(20L); request.setProjectId(42L);
        when(requests.findById(20L)).thenReturn(Optional.of(request));
        DdItem item = new DdItem(); item.setId(30L); item.setDdRequestId(20L);
        when(items.findById(30L)).thenReturn(Optional.of(item));
        DdNotification notification = new DdNotification(); notification.setId(40L); notification.setProjectId(42L);
        when(notifications.findById(40L)).thenReturn(Optional.of(notification));
        DdAiJob job = new DdAiJob(); job.setId("job-id"); job.setProjectId(42L);
        when(jobs.findById("job-id")).thenReturn(Optional.of(job));
    }

    @ParameterizedTest
    @ValueSource(strings = {"/requests/20", "/requests/20/publish", "/items/30/file", "/items/30/submissions/4/files/5", "/jobs/job-id", "/notifications/40/read", "/projects/42"})
    void refusesResourcesOutsideBoundProject(String suffix) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/dd" + suffix);
        request.setQueryString("projectId=99");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();
        filter.doFilter(request, response, chain);
        assertEquals(403, response.getStatus());
        assertNull(chain.getRequest());
    }

    @Test void matchingScopeKeepsUploadBytesAndStillRunsControllerAuthorization() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/dd/items/30/submissions");
        request.setQueryString("projectId=42");
        request.setContentType("multipart/form-data; boundary=test-boundary");
        byte[] body = "--test-boundary\r\nraw-upload-bytes".getBytes(StandardCharsets.UTF_8);
        request.setContent(body);
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilter(request, response, (req, resp) -> {
            assertArrayEquals(body, req.getInputStream().readAllBytes());
            ((jakarta.servlet.http.HttpServletResponse) resp).setStatus(401);
        });
        assertEquals(401, response.getStatus());
    }

    @Test void unscopedDirectRequestAndLocalRequestRemainSubjectToExistingControllers() throws Exception {
        MockFilterChain direct = new MockFilterChain();
        filter.doFilter(new MockHttpServletRequest("GET", "/api/dd/requests/20"), new MockHttpServletResponse(), direct);
        assertNotNull(direct.getRequest());
        MockHttpServletRequest local = new MockHttpServletRequest("GET", "/api/dd/requests/20");
        local.setQueryString("projectId=7");
        MockFilterChain chain = new MockFilterChain();
        new DdProjectScopeFilter(requests, items, notifications, jobs, true).doFilter(local, new MockHttpServletResponse(), chain);
        assertNotNull(chain.getRequest());
        verifyNoInteractions(requests, items, notifications, jobs);
    }

    @ParameterizedTest
    @ValueSource(strings = {"projectId=42&projectId=99", "projectId=abc", "projectId=-1", "projectId=%XX"})
    void invalidOrAmbiguousScopeDoesNotReachController(String query) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/dd/requests/20");
        request.setQueryString(query);
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();
        filter.doFilter(request, response, chain);
        assertEquals(400, response.getStatus()); assertNull(chain.getRequest());
    }

    @Test void desktopProxyCannotBorrowOwnersTokenForAnotherProject() {
        ProjectRemote binding = new ProjectRemote(); binding.setProjectId(7L); binding.setRemoteProjectId("99"); binding.setConnectionId(1L);
        CloudConnection connection = new CloudConnection(); connection.setServerUrl("https://case.example.test"); connection.setDeviceToken("owner-token");
        ProjectRemoteRepository remotes = mock(ProjectRemoteRepository.class);
        CloudConnectionRepository connections = mock(CloudConnectionRepository.class);
        when(remotes.findByProjectId(7L)).thenReturn(Optional.of(binding));
        when(connections.findById(1L)).thenReturn(Optional.of(connection));
        AtomicBoolean controllerReached = new AtomicBoolean();
        CloudSyncService desktop = new CloudSyncService(null, null, null, null, connections, remotes, null) {
            @Override protected RawResponse httpRaw(String method, String url, byte[] body, String type, String token) {
                assertEquals("owner-token", token);
                URI uri = URI.create(url);
                MockHttpServletRequest request = new MockHttpServletRequest(method, uri.getPath());
                request.setQueryString(uri.getRawQuery());
                MockHttpServletResponse response = new MockHttpServletResponse();
                try { filter.doFilter(request, response, (req, resp) -> controllerReached.set(true)); }
                catch (Exception error) { throw new AssertionError(error); }
                return new RawResponse(response.getStatus(), response.getContentType(), null, response.getContentAsByteArray());
            }
        };
        var result = desktop.proxyDd(7L, "POST", "/requests/20/publish", "projectId=42", new byte[0], "application/json");
        assertEquals(403, result.status());
        assertFalse(controllerReached.get());
    }
}
