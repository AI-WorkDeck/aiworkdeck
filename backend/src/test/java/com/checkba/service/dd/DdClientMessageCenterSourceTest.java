// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.dd;

import com.checkba.model.entity.CloudConnection;
import com.checkba.repository.CloudConnectionRepository;
import com.checkba.service.DdClientConnectionService;
import com.checkba.service.account.AccountService;
import com.checkba.service.plugin.PluginCredentialStore;
import com.checkba.version.OfficialCloudService;
import okhttp3.RequestBody;
import org.junit.jupiter.api.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** Simulated HTTP replies pass through the real saved-session and project-bound proxy. */
class DdClientMessageCenterSourceTest {
    final PluginCredentialStore credentials=mock(PluginCredentialStore.class);
    final AccountService account=mock(AccountService.class);
    final CloudConnectionRepository clouds=mock(CloudConnectionRepository.class);
    final OfficialCloudService official=mock(OfficialCloudService.class);
    final Map<String,String> store=new HashMap<>();
    DdClientConnectionService connections;
    DdClientMessageCenterSource source;
    String goodId,badId;
    int readStatus=200;
    String readBody="{\"id\":12,\"readAt\":\"2026-10-22T12:00:00\"}";
    int readPosts;
    @BeforeEach void setup() {
        when(account.accountFingerprintOrNull()).thenReturn("synthetic-account");
        when(official.officialBaseUrl()).thenReturn("https://good.example.test");
        when(credentials.get(anyString())).thenAnswer(i->store.getOrDefault(i.getArgument(0),""));
        doAnswer(i->{store.put(i.getArgument(0),i.getArgument(1));return null;}).when(credentials).put(anyString(),anyString());
        CloudConnection bad=new CloudConnection();bad.setUserId(7L);bad.setAccountFingerprint("synthetic-account");bad.setServerUrl("https://bad.example.test");
        when(clouds.findById(2L)).thenReturn(Optional.of(bad));
        connections=new DdClientConnectionService(credentials,account,clouds,official) {
            @Override protected Reply send(String base,String session,String method,String path,RequestBody body) {
                if (path.equals("/api/auth/client-login")) return reply(200,"{\"code\":0,\"data\":{\"sessionId\":\"synthetic-session\",\"projectId\":42,\"projectName\":\"Synthetic\"}}");
                if (base.contains("bad.example")) return reply(503,"{\"error\":\"unavailable\"}");
                assertEquals("synthetic-session",session);
                if (path.startsWith("/api/dd/notifications?")) return reply(200,"["
                        +"{\"id\":12,\"requestId\":8,\"createdAtIso\":\"2026-10-22T12:00:00+08:00\",\"actionState\":\"pending\"},"
                        +"{\"id\":13,\"requestId\":8,\"createdAt\":\"2026-10-22T11:00:00\",\"readAt\":\"2026-10-22T12:00:00\",\"actionState\":\"pending\"},"
                        +"{\"id\":14,\"requestId\":8,\"createdAtIso\":\"2026-10-21T00:00:00Z\",\"actionState\":\"none\"}]");
                if (path.equals("/api/dd/notifications/12/read")) {readPosts++;return reply(readStatus,readBody);}
                if (path.equals("/api/im/action")) return reply(200,"{\"code\":0,\"data\":{\"id\":\"good-group\",\"projectId\":42,\"unreadCount\":3}}");
                throw new AssertionError("Unexpected request: "+path);
            }
        };
        goodId=connections.connect(7L,"synthetic-code",null).get("id").toString();
        badId=connections.connect(7L,"synthetic-code",2L).get("id").toString();
        source=new DdClientMessageCenterSource(connections);
    }
    DdClientConnectionService.Reply reply(int status,String body) {
        return new DdClientConnectionService.Reply(status,"application/json",null,body.getBytes(StandardCharsets.UTF_8));
    }
    @Test void failedConnectionKeepsSuccessfulMessagesAndCountsBeforeVisibleLimit() {
        var snapshot=source.list(7L,1);
        assertEquals(1,snapshot.items().size());assertEquals(2,snapshot.unread());assertEquals(2,snapshot.pending());
        assertTrue(snapshot.hasMore());assertEquals(List.of(badId),snapshot.unavailableSources());
        assertEquals(Instant.parse("2026-10-22T04:00:00Z"),snapshot.items().get(0).createdAt());
        var legacy=source.list(7L,100).items().stream().filter(e->e.id().endsWith(":13")).findFirst().orElseThrow();
        assertNull(legacy.createdAt());assertNull(legacy.readAt());assertTrue(legacy.read());
        assertTrue(source.list(8L,100).items().isEmpty());
    }
    @Test void failedConversationConnectionDoesNotHideWorkingConversation() {
        var snapshot=source.conversationSnapshot(7L);
        assertEquals(1,snapshot.items().size());assertEquals(goodId,snapshot.items().get(0).get("connectionId"));
        assertEquals(List.of(badId),snapshot.unavailableSources());
    }
    @Test void markReadRequiresMatchingReceiptAfterRemoteSuccess() {
        for (String body:List.of("{}","{\"code\":1}","{\"id\":12}","{\"id\":13,\"readAt\":\"2026-10-22T12:00:00\"}","not-json")) {
            readBody=body;assertThrows(IllegalArgumentException.class,()->source.markRead(7L,goodId+":12"));
        }
        readBody="{\"id\":12,\"readAtIso\":\"2026-10-22T12:00:00Z\"}";readStatus=500;
        assertThrows(IllegalArgumentException.class,()->source.markRead(7L,goodId+":12"));
        readStatus=200;assertDoesNotThrow(()->source.markRead(7L,goodId+":12"));
        int sent=readPosts;assertThrows(RuntimeException.class,()->source.markRead(8L,goodId+":12"));assertEquals(sent,readPosts);
        assertThrows(RuntimeException.class,()->source.markRead(7L,goodId+":99"));assertEquals(sent,readPosts);
    }
    @Test void switchedAccountDoesNotReuseSavedInvitations() {
        when(account.accountFingerprintOrNull()).thenReturn("other-account");
        assertTrue(source.list(7L,100).items().isEmpty());
        assertTrue(source.conversationSnapshot(7L).items().isEmpty());
        assertThrows(RuntimeException.class,()->source.markRead(7L,goodId+":12"));
    }
}
