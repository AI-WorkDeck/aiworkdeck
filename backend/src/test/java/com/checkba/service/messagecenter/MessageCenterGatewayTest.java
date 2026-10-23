// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.messagecenter;

import com.checkba.model.entity.*;
import com.checkba.repository.ProjectRemoteRepository;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.account.AccountService;
import com.checkba.service.im.*;
import com.checkba.version.OfficialCloudService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.ObjectProvider;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class MessageCenterGatewayTest {
    MessageCenterService service=mock(MessageCenterService.class);
    ImGatewayService im=mock(ImGatewayService.class);
    OfficialCloudService cloud=mock(OfficialCloudService.class);
    AccountService account=mock(AccountService.class);
    ProjectRemoteRepository remotes=mock(ProjectRemoteRepository.class);
    ProjectMemberService members=mock(ProjectMemberService.class);
    MessageCenterSource dd=mock(MessageCenterSource.class);
    ObjectMapper mapper=new ObjectMapper().findAndRegisterModules();
    @SuppressWarnings("unchecked") ObjectProvider<MessageCenterSource> sources=mock(ObjectProvider.class);
    @SuppressWarnings("unchecked") ObjectProvider<ImProjectActionHandler> handlers=mock(ObjectProvider.class);
    @BeforeEach void setup() {
        when(sources.orderedStream()).thenAnswer(i->java.util.stream.Stream.of(dd));
        when(dd.id()).thenReturn("dd-client");when(dd.localOnly()).thenReturn(true);when(dd.conversations(7L)).thenReturn(List.of());
        when(dd.conversationSnapshot(7L)).thenAnswer(i->new MessageCenterSource.ConversationSnapshot(dd.conversations(7L),List.of()));
        when(handlers.iterator()).thenAnswer(i->Collections.emptyIterator());
        when(service.list(eq(7L),anyInt(),eq(true))).thenAnswer(i->empty());when(account.accountFingerprintOrNull()).thenReturn("scope-a");
        when(im.captureAccountScope()).thenReturn("scope-a");
        CloudConnection c=new CloudConnection();c.setId(9L);c.setUserId(7L);c.setAccountFingerprint("scope-a");
        when(cloud.connectOfficial(7L)).thenReturn(c);
    }
    Map<String,Object> empty() { return new LinkedHashMap<>(Map.of("notifications",new ArrayList<>(),"counts",Map.of("unreadNotifications",0,"pending",0),"hasMore",false,"unavailableSources",List.of())); }
    MessageCenterGateway gateway(java.util.function.Supplier<Object> response) {
        return new MessageCenterGateway(true,service,im,cloud,account,sources,handlers,mapper,remotes,members) {
            @Override protected Object remote(Long userId,String action,Map<String,Object> p) { return response.get(); }
        };
    }
    @Test void independentCustomerConnectionRemainsVisibleWithoutOfficialAccount() {
        when(account.accountFingerprintOrNull()).thenReturn(null);
        when(dd.conversations(7L)).thenReturn(List.of(Map.of("id","customer-chat","sourceId","dd-client","connectionId","saved-invite","unreadCount",3)));
        var gateway=gateway(()->{throw new IllegalArgumentException("请先连接账户");});
        var result=MessageCenterGateway.map(gateway.execute(7L,"list",Map.of(),null));
        assertEquals("unavailable",result.get("cloudStatus"));assertEquals(1,((List<?>)result.get("conversations")).size());
        assertEquals(3L,MessageCenterGateway.map(result.get("counts")).get("unreadMessages"));
    }
    @Test void customerMessagesUseSavedConnectionAndNeverOfficialIdentity() {
        when(account.accountFingerprintOrNull()).thenReturn(null);
        when(dd.im(7L,"self",Map.of("connectionId","saved"))).thenReturn(Map.of("id",22L));
        Object result=gateway(()->{throw new AssertionError("must not forward customer session");}).execute(7L,"ddClientIm",
                Map.of("connectionId","saved","action","self","params",Map.of()),null);
        assertEquals(Map.of("id",22L),result);verifyNoInteractions(im);
    }
    @Test void accountSwitchDiscardsLateMailboxAndCustomerActionResults() {
        AtomicReference<String> scope=new AtomicReference<>("scope-a");when(account.accountFingerprintOrNull()).thenAnswer(i->scope.get());
        var gateway=gateway(()->{scope.set("scope-b");return empty();});
        assertThrows(IllegalArgumentException.class,()->gateway.execute(7L,"list",Map.of(),null));
        scope.set("scope-a");when(dd.im(eq(7L),eq("messages"),anyMap())).thenAnswer(i->{scope.set("scope-b");return Map.of("messages",List.of());});
        assertThrows(IllegalArgumentException.class,()->gateway.execute(7L,"ddClientIm",Map.of("connectionId","saved","action","messages"),null));
    }
    @Test void cloudProjectIdNeverOpensSameNumberedUnrelatedLocalProject() {
        var gateway=gateway(()->Map.of("kind","dd","projectId",41,"recordId","request-1"));
        when(remotes.findByConnectionIdAndRemoteProjectId(9L,"41")).thenReturn(Optional.empty());
        assertThrows(IllegalArgumentException.class,()->gateway.execute(7L,"target",Map.of("id","dd:1"),null));
        ProjectRemote remote=new ProjectRemote();remote.setProjectId(301L);remote.setConnectionId(9L);remote.setRemoteProjectId("41");
        when(remotes.findByConnectionIdAndRemoteProjectId(9L,"41")).thenReturn(Optional.of(remote));
        when(members.hasReadPermission(301L,7L)).thenReturn(true);
        var target=MessageCenterGateway.map(gateway.execute(7L,"target",Map.of("id","dd:1"),null));
        assertEquals(301L,target.get("projectId"));assertEquals("cloud:41",target.get("projectKey"));
        when(members.hasReadPermission(301L,7L)).thenReturn(false);
        assertThrows(IllegalArgumentException.class,()->gateway.execute(7L,"target",Map.of("id","dd:1"),null));
    }
    @Test void localTargetsStayLocalAndCoreCannotSpoofPluginPublishing() {
        when(service.target(7L,"local:dd-client:c-1:n-2",true)).thenReturn(Map.of("kind","dd-client","connectionId","c-1"));
        var gateway=gateway(()->{throw new AssertionError("must stay local");});
        assertEquals("dd-client",MessageCenterGateway.map(gateway.execute(7L,"target",Map.of("id","local:dd-client:c-1:n-2"),null)).get("kind"));
        assertThrows(IllegalArgumentException.class,()->gateway.execute(7L,"pluginPublish",Map.of(),null));
    }
    @Test void materialCannotBeInjectedIntoCoreAgentRepliesWithoutProjectHost() {
        when(im.execute(7L,"agentInfo",Map.of("conversationId","shared"))).thenReturn(Map.of("agent",Map.of("scope","project","private",false)));
        when(im.execute(7L,"agentReply",Map.of("conversationId","shared","messageId",2))).thenReturn(Map.of("accepted",true));
        var gateway=gateway(()->empty());
        gateway.execute(7L,"im",Map.of("action","agentReply","params",Map.of("conversationId","shared","messageId",2,"projectContext","untrusted")),null);
        verify(im).execute(7L,"agentReply",Map.of("conversationId","shared","messageId",2));
        when(im.execute(7L,"agentInfo",Map.of("conversationId","private"))).thenReturn(Map.of("agent",Map.of("scope","project","private",true)));
        assertThrows(IllegalArgumentException.class,()->gateway.execute(7L,"im",Map.of("action","agentReply","params",Map.of("conversationId","private","messageId",3)),null));
    }
    @Test void officialRelayUsesOnlyFixedEndpointAndChecksAccountAfterActualHttp() throws Exception {
        var server=com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1",0),0);
        AtomicReference<String> path=new AtomicReference<>();AtomicReference<String> token=new AtomicReference<>();
        AtomicReference<String> requestBody=new AtomicReference<>();
        server.createContext("/",exchange->{
            path.set(exchange.getRequestURI().getPath()); token.set(exchange.getRequestHeaders().getFirst("X-Session-Id"));
            requestBody.set(new String(exchange.getRequestBody().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8));
            byte[] result="{\"code\":0,\"data\":{\"id\":\"notice:synthetic\"}}".getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200,result.length);exchange.getResponseBody().write(result);exchange.close();
        });server.start();
        try {
            CloudConnection c=cloud.connectOfficial(7L);c.setServerUrl("http://127.0.0.1:"+server.getAddress().getPort());c.setDeviceToken("synthetic-session");
            var gateway=new MessageCenterGateway(true,service,im,cloud,account,sources,handlers,mapper,remotes,members);
            assertEquals("notice:synthetic",MessageCenterGateway.map(gateway.publishPlugin(7L,"example-plugin",Map.of("eventKey","e","title","t"))).get("id"));
            assertEquals("/api/message-center/action",path.get());assertEquals("synthetic-session",token.get());
            assertTrue(requestBody.get().contains("pluginPublish"));verify(im).assertAccountScope("scope-a");
            doThrow(new IllegalArgumentException("账户已变化")).when(im).assertAccountScope("scope-a");
            assertThrows(IllegalArgumentException.class,()->gateway.publishPlugin(7L,"example-plugin",Map.of("eventKey","f","title","t")));
        } finally {server.stop(0);}
    }
    @Test void localProjectGroupUsesAuthoritativeRemoteBindingInsteadOfPayloadId() {
        var gateway=gateway(()->empty());
        when(members.hasReadPermission(301L,7L)).thenReturn(true);
        ProjectRemote remote=new ProjectRemote();remote.setProjectId(301L);remote.setConnectionId(9L);remote.setRemoteProjectId("41");
        when(remotes.findByProjectId(301L)).thenReturn(Optional.of(remote));
        when(im.executeWithinScope(7L,"scope-a","projectGroup",Map.of("projectId",41L))).thenReturn(Map.of("id","group"));
        assertEquals(Map.of("id","group","localProjectId",301L),gateway.execute(7L,"im",Map.of("action","projectGroup","params",Map.of("projectId",999)),301L));
        verify(im).executeWithinScope(7L,"scope-a","projectGroup",Map.of("projectId",41L));
        assertThrows(IllegalArgumentException.class,()->gateway.execute(7L,"im",Map.of("action","projectGroup","params",Map.of("projectId",41)),null));
        remote.setConnectionId(10L);
        assertThrows(IllegalArgumentException.class,()->gateway.execute(7L,"im",Map.of("action","projectGroup"),301L));
    }
    @Test void badgeCountsFlagPartialFailureInsteadOfClaimingZeroUnread() {
        var gateway=gateway(()->{throw new IllegalArgumentException("云端暂不可用");});
        when(dd.conversations(7L)).thenReturn(List.of(Map.of("id","customer-chat","unreadCount",2)));
        var counts=MessageCenterGateway.map(gateway.execute(7L,"counts",Map.of(),null));
        assertEquals(true,counts.get("partial"));assertEquals(2L,counts.get("unreadMessages"));
        assertEquals("unavailable",counts.get("cloudStatus"));assertFalse(counts.containsKey("notifications"));
    }
    @Test void partialCustomerConnectionsKeepTheirSuccessfulConversationsAndCounts() {
        doReturn(new MessageCenterSource.ConversationSnapshot(
                List.of(Map.of("id","good","unreadCount",4)),List.of("failed-connection")))
                .when(dd).conversationSnapshot(7L);
        var result=MessageCenterGateway.map(gateway(()->empty()).execute(7L,"list",Map.of(),null));
        assertEquals(1,((List<?>)result.get("conversations")).size());
        assertEquals(List.of("dd-client:failed-connection"),result.get("unavailableSources"));
        assertEquals(4L,MessageCenterGateway.map(result.get("counts")).get("unreadMessages"));
        var counts=MessageCenterGateway.map(gateway(()->empty()).execute(7L,"counts",Map.of(),null));
        assertEquals(true,counts.get("partial"));assertEquals(4L,counts.get("unreadMessages"));
    }
    @Test void connectedCloudWithUnavailablePolicyNeverClaimsCompleteZeroCounts() {
        var cloudResult=empty();cloudResult.put("unavailableSources",List.of("lawfirm"));
        var counts=MessageCenterGateway.map(gateway(()->cloudResult).execute(7L,"counts",Map.of(),null));
        assertEquals("connected",counts.get("cloudStatus"));assertEquals(true,counts.get("partial"));
        assertEquals(0L,counts.get("unreadNotifications"));assertEquals(List.of("lawfirm"),counts.get("unavailableSources"));
    }
}
