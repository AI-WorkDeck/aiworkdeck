// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.im;

import com.checkba.model.entity.CloudConnection;
import com.checkba.service.account.AccountService;
import com.checkba.version.OfficialCloudService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.*;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ImGatewayServiceTest {
 HttpServer server; OfficialCloudService cloud=mock(OfficialCloudService.class);
 AccountService account=mock(AccountService.class); ImService service=mock(ImService.class);
 ObjectMapper mapper=new ObjectMapper(); ImGatewayService gateway;
 AtomicReference<String> path=new AtomicReference<>(),token=new AtomicReference<>(),body=new AtomicReference<>();
 @BeforeEach void setup() throws Exception {
  server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0); server.start();
  CloudConnection connection=new CloudConnection(); connection.setServerUrl("http://127.0.0.1:"+server.getAddress().getPort());
  connection.setDeviceToken("awdt_synthetic-test"); connection.setAccountFingerprint("owner-a");
  when(cloud.connectOfficial(7L)).thenReturn(connection); when(account.accountFingerprintOrNull()).thenReturn("owner-a");
  gateway=new ImGatewayService(true,cloud,account,service,mapper);
 }
 @AfterEach void close() {server.stop(0);}
 void reply(int status,String payload,Runnable afterRequest) {
  server.createContext("/",exchange->{path.set(exchange.getRequestURI().toString());token.set(exchange.getRequestHeaders().getFirst("X-Session-Id"));
   body.set(new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8)); afterRequest.run();
   byte[] bytes=payload.getBytes(StandardCharsets.UTF_8); exchange.sendResponseHeaders(status,bytes.length);
   exchange.getResponseBody().write(bytes); exchange.close();});
 }
 @Test void usesFixedEndpointWithDeviceTokenWithoutExposingIt() {
  reply(200,"{\"code\":0,\"data\":{\"id\":42}}",()->{});
  assertEquals(Map.of("id",42),gateway.execute(7L,"self",Map.of()));
  assertEquals("/api/im/action",path.get());assertEquals("awdt_synthetic-test",token.get());
  assertFalse(body.get().contains("awdt_")); verifyNoInteractions(service);
 }
 @Test void rejectsAccountSwitchWhileRequestWasInFlight() {
  reply(200,"{\"code\":0,\"data\":{\"id\":42}}",()->when(account.accountFingerprintOrNull()).thenReturn("owner-b"));
  assertTrue(assertThrows(IllegalArgumentException.class,()->gateway.execute(7L,"self",Map.of())).getMessage().contains("账户已变化"));
 }
 @Test void unavailableCloudIsExplicitAndNeverBecomesLocalChat() {
  reply(404,"",()->{});
  assertTrue(assertThrows(IllegalArgumentException.class,()->gateway.execute(7L,"list",Map.of())).getMessage().contains("尚未开通"));
  verifyNoInteractions(service);
 }
 @Test void rejectsUnknownActionsBeforeAnyBridge() {
  assertThrows(IllegalArgumentException.class,()->gateway.execute(7L,"https://other.invalid",Map.of()));
  verifyNoInteractions(cloud);
 }
 @Test void serverModeUsesServerIdentityWithoutMachineAccount() {
  ImGatewayService serverGateway=new ImGatewayService(false,cloud,account,service,mapper);
  when(service.execute(8L,"self",Map.of())).thenReturn(Map.of("id",8));
  assertEquals(Map.of("id",8),serverGateway.execute(8L,"self",Map.of()));
  verifyNoInteractions(cloud,account);
 }
 @Test void accountSwitchWhileConnectingCannotSendUnderNewIdentity() {
  reply(200,"{\"code\":0,\"data\":{}}",()->{});
  when(cloud.connectOfficial(7L)).thenAnswer(invocation -> {
   CloudConnection other=new CloudConnection(); other.setAccountFingerprint("owner-b");
   other.setServerUrl("http://127.0.0.1:"+server.getAddress().getPort()); other.setDeviceToken("synthetic-b");
   when(account.accountFingerprintOrNull()).thenReturn("owner-b"); return other;
  });
  assertThrows(IllegalArgumentException.class,()->gateway.executeWithinScope(7L,"owner-a","send",Map.of()));
  assertNull(path.get(),"must reject before sending an HTTP request under the other account");
 }
 @Test void accountScopeCannotBeReusedAfterSwitchOrDisconnect() {
  String scope=gateway.captureAccountScope(); gateway.assertAccountScope(scope);
  when(account.accountFingerprintOrNull()).thenReturn("owner-b");
  assertThrows(IllegalArgumentException.class,()->gateway.assertAccountScope(scope));
  when(account.accountFingerprintOrNull()).thenReturn(null);
  assertThrows(IllegalArgumentException.class,()->gateway.captureAccountScope());
  ImGatewayService serverGateway=new ImGatewayService(false,cloud,account,service,mapper);
  assertEquals("server",serverGateway.captureAccountScope()); serverGateway.assertAccountScope("server");
 }
 @Test void responseBodyThatStallsAfterHeadersIsStillBounded() throws Exception {
  java.util.concurrent.CountDownLatch release=new java.util.concurrent.CountDownLatch(1);
  java.util.concurrent.CountDownLatch headerSent=new java.util.concurrent.CountDownLatch(1);
  server.createContext("/",exchange->{
   exchange.getRequestBody().readAllBytes(); exchange.sendResponseHeaders(200,1000);
   exchange.getResponseBody().write('{'); exchange.getResponseBody().flush(); headerSent.countDown();
   try {release.await(5,java.util.concurrent.TimeUnit.SECONDS);}catch(InterruptedException e){Thread.currentThread().interrupt();}
   exchange.close();
  });
  ImGatewayService bounded=new ImGatewayService(true,cloud,account,service,mapper) {
   @Override protected java.time.Duration bodyDeadline(){return java.time.Duration.ofMillis(150);}
  };
  try {
   assertTimeoutPreemptively(java.time.Duration.ofSeconds(3),()->
    assertThrows(IllegalArgumentException.class,()->bounded.execute(7L,"self",Map.of())));
   assertEquals(0,headerSent.getCount());
   assertEquals(1,release.getCount(),"handler must still be stalled when deadline aborts the client");
  } finally {release.countDown();}
 }
}
