// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version;

import com.checkba.model.entity.CloudConnection;
import com.checkba.model.entity.ProjectRemote;
import com.checkba.repository.CloudConnectionRepository;
import com.checkba.repository.ProjectRemoteRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import java.util.Optional;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class CloudSyncDdProxyTest {
    private final CloudConnectionRepository connections = mock(CloudConnectionRepository.class);
    private final ProjectRemoteRepository remotes = mock(ProjectRemoteRepository.class);
    private String lastUrl;
    private String lastToken;
    private final CloudSyncService cloud = new CloudSyncService(null, null, null, null, connections, remotes, null) {
        @Override protected RawResponse httpRaw(String method, String url, byte[] body, String type, String token) {
            lastUrl = url; lastToken = token;
            return new RawResponse(200, "application/json", null, "[]".getBytes());
        }
    };

    @BeforeEach void setup() {
        ProjectRemote remote = new ProjectRemote(); remote.setProjectId(7L); remote.setRemoteProjectId("42"); remote.setConnectionId(3L);
        CloudConnection connection = new CloudConnection(); connection.setId(3L); connection.setServerUrl("https://case.example.test"); connection.setDeviceToken("test-device-token");
        when(remotes.findByProjectId(7L)).thenReturn(Optional.of(remote));
        when(connections.findById(3L)).thenReturn(Optional.of(connection));
    }

    @Test void notificationInboxUsesRemoteProjectId() {
        cloud.proxyDd(7L, "GET", "/notifications", "", null, null);
        assertEquals("https://case.example.test/api/dd/notifications?projectId=42", lastUrl);
        assertEquals("test-device-token", lastToken);
    }

    @Test void notificationInboxCannotOverrideBoundProject() {
        cloud.proxyDd(7L, "GET", "/notifications", "projectId=8&x=hello%20world&%70rojectId=9", null, null);
        assertEquals("https://case.example.test/api/dd/notifications?projectId=42&x=hello%20world", lastUrl);
    }

    @Test void resourceOperationsAlwaysCarryBoundProject() {
        for (String path : java.util.List.of("/requests/20", "/requests/20/publish", "/items/30/file", "/jobs/test-job")) {
            cloud.proxyDd(7L, "GET", path, "projectId=99", null, null);
            assertEquals("https://case.example.test/api/dd" + path + "?projectId=42", lastUrl);
        }
    }

    @Test void projectPathRewritesOnlyTheLocalId() {
        cloud.proxyDd(7L, "GET", "/projects/7", "", null, null);
        assertEquals("https://case.example.test/api/dd/projects/42", lastUrl);
    }

    @Test void markingNotificationReadCarriesBoundProject() {
        cloud.proxyDd(7L, "POST", "/notifications/12/read", "", new byte[0], "application/json");
        assertEquals("https://case.example.test/api/dd/notifications/12/read?projectId=42", lastUrl);
    }
}
