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

    /** 律所云端：同一连接与凭据，路径固定 /api/lawfirm/cloud；只放行服务端登记过的动作，大小上限按功能；不回落本机。 */
    @Test void firmCloudUsesSameConnectionFixedPathAllowlistAndPerFeatureLimits() throws Exception {
        var cloud=mock(OfficialCloudService.class);var account=mock(AccountService.class);var service=mock(LawFirmWorkflowService.class);
        var firmCloud=mock(LawFirmCloudService.class);var feature=mock(LawFirmCloudFeature.class);
        when(firmCloud.featureOf("time.mine")).thenReturn("time");when(firmCloud.featureOf("cloud.settings.get")).thenReturn("cloud");
        when(firmCloud.registry()).thenReturn(Map.of("time",feature));
        when(feature.maxRequestBytes()).thenReturn(1024);when(feature.maxResponseBytes()).thenReturn(4096);
        var server=com.sun.net.httpserver.HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        AtomicReference<String> path=new AtomicReference<>(),token=new AtomicReference<>();AtomicInteger code=new AtomicInteger(200);
        server.createContext("/",exchange->{
            path.set(exchange.getRequestURI().getPath());token.set(exchange.getRequestHeaders().getFirst("X-Session-Id"));exchange.getRequestBody().readAllBytes();
            byte[] body="{\"code\":0,\"data\":{\"ok\":true}}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(code.get(),body.length);exchange.getResponseBody().write(body);exchange.close();
        });server.start();
        try {
            var connection=new CloudConnection();connection.setAccountFingerprint("synthetic-a");connection.setServerUrl("http://127.0.0.1:"+server.getAddress().getPort());connection.setDeviceToken("synthetic-token");
            when(cloud.connectOfficial(1L)).thenReturn(connection);when(account.accountFingerprintOrNull()).thenReturn("synthetic-a");
            var gateway=new LawFirmWorkflowGateway(true,cloud,account,service,new ObjectMapper());gateway.setFirmCloud(firmCloud);
            assertTrue(gateway.isCloudAction("time.mine"));assertFalse(gateway.isCloudAction("billing.x"));
            when(firmCloud.pluginMayCall("lawfirm-management","time.mine")).thenReturn(true);
            assertEquals(true,gateway.executeCloudForPlugin("lawfirm-management",1L,"time.mine",Map.of()).get("ok"));
            path.set(null);
            assertThrows(IllegalArgumentException.class,()->gateway.executeCloudForPlugin("pitch-materials",1L,"time.mine",Map.of()),
                    "a plugin cannot call another feature's actions");
            assertNull(path.get(),"a disallowed plugin call never leaves the machine");
            assertEquals(true,gateway.executeCloud(1L,"time.mine",Map.of()).get("ok"));
            assertEquals("/api/lawfirm/cloud",path.get());assertEquals("synthetic-token",token.get());
            assertEquals(true,gateway.executeCloud(1L,"cloud.settings.get",Map.of()).get("ok"));
            path.set(null);
            assertThrows(IllegalArgumentException.class,()->gateway.executeCloud(1L,"time.mine",Map.of("blob","x".repeat(2000))));
            assertThrows(IllegalArgumentException.class,()->gateway.executeCloud(1L,"workflowOverview",Map.of()),"conflict actions do not ride the cloud path");
            assertNull(path.get(),"oversized or unknown requests never leave the machine");
            code.set(404);
            assertTrue(assertThrows(IllegalArgumentException.class,()->gateway.executeCloud(1L,"time.mine",Map.of())).getMessage().contains("尚未升级"));
            verify(firmCloud,never()).execute(any(),any(),any());verifyNoInteractions(service);
        } finally {server.stop(0);}
    }
}
