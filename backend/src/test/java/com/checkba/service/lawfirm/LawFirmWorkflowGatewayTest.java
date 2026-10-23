// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.lawfirm;

import com.checkba.model.entity.CloudConnection;
import com.checkba.service.account.AccountService;
import com.checkba.version.OfficialCloudService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.atomic.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class LawFirmWorkflowGatewayTest {
    @Test void officialRelayUsesFixedPathAndRejectsAccountSwitchOrMissingCloudApiWithoutLocalFallback() throws Exception {
        var cloud=mock(OfficialCloudService.class);var account=mock(AccountService.class);var service=mock(LawFirmWorkflowService.class);
        var server=com.sun.net.httpserver.HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        AtomicReference<String> identity=new AtomicReference<>("synthetic-a"),path=new AtomicReference<>(),token=new AtomicReference<>();
        AtomicInteger responseCode=new AtomicInteger(200);AtomicBoolean switchAccount=new AtomicBoolean(false);
        server.createContext("/",exchange->{
            path.set(exchange.getRequestURI().getPath());token.set(exchange.getRequestHeaders().getFirst("X-Session-Id"));exchange.getRequestBody().readAllBytes();
            if(switchAccount.get())identity.set("synthetic-b");
            byte[] body="{\"code\":0,\"data\":{\"records\":[]}}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(responseCode.get(),body.length);exchange.getResponseBody().write(body);exchange.close();
        });server.start();
        try {
            var connection=new CloudConnection();connection.setAccountFingerprint("synthetic-a");connection.setServerUrl("http://127.0.0.1:"+server.getAddress().getPort());connection.setDeviceToken("synthetic-token");
            when(cloud.connectOfficial(1L)).thenReturn(connection);when(account.accountFingerprintOrNull()).thenAnswer(i->identity.get());
            var gateway=new LawFirmWorkflowGateway(true,cloud,account,service,new ObjectMapper());
            assertNotNull(gateway.execute(1L,"workflowOverview",Map.of()).get("records"));
            assertEquals("/api/lawfirm/workflow",path.get());assertEquals("synthetic-token",token.get());
            switchAccount.set(true);
            assertThrows(IllegalArgumentException.class,()->gateway.execute(1L,"workflowOverview",Map.of()));
            switchAccount.set(false);identity.set("synthetic-a");responseCode.set(404);
            assertTrue(assertThrows(IllegalArgumentException.class,()->gateway.execute(1L,"workflowOverview",Map.of())).getMessage().contains("尚未升级"));
            verifyNoInteractions(service);
        } finally {server.stop(0);}
    }
    @Test void disconnectedLocalAccountNeverUsesLocalWorkflowService() {
        var cloud=mock(OfficialCloudService.class);var account=mock(AccountService.class);var service=mock(LawFirmWorkflowService.class);
        var gateway=new LawFirmWorkflowGateway(true,cloud,account,service,new ObjectMapper());
        assertThrows(IllegalArgumentException.class,()->gateway.execute(1L,"workflowOverview",Map.of()));
        verifyNoInteractions(cloud,service);
    }
}
