// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import java.net.InetSocketAddress;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class CloudSyncEpochHttpTest {
 @Test void oneExplicitOperationPinsPostDeleteAndRawAndClearsScopeAfterFailure() throws Exception {
  List<String> observed=new ArrayList<>();
  HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
  server.createContext("/",exchange->{
   observed.add(exchange.getRequestHeaders().getFirst("X-Cloud-Epoch"));
   exchange.getRequestBody().readAllBytes();
   byte[] body="{}".getBytes();exchange.sendResponseHeaders(200,body.length);
   exchange.getResponseBody().write(body);exchange.close();
  });server.start();
  try {
   var service=new CloudSyncService(null,null,null,null,null,null,null);
   String url="http://127.0.0.1:"+server.getAddress().getPort()+"/";
   assertThrows(IllegalStateException.class,()->service.withCloudEpoch(Map.of("X-Cloud-Epoch","8"),()->{
    service.httpPost(url,"{}","synthetic");service.httpDelete(url,"synthetic");
    service.httpRaw("PUT",url,new byte[0],null,"synthetic");
    throw new IllegalStateException("simulated later operation failure");
   }));
   assertNull(CloudGitEpochClient.explicitEpoch.get());
   service.httpPost(url,"{}","synthetic");
   assertEquals(Arrays.asList("8","8","8",null),observed);
  } finally {server.stop(0);}
 }
 @Test void privateOriginsNeverPerformOfficialBillingHandshake() {
  var service=new CloudSyncService(null,null,null,null,null,null,null);
  assertTrue(service.accountCloudEpoch("http://127.0.0.1:1","synthetic").isEmpty());
  assertTrue(service.accountCloudEpoch("https://case.aiworkdeck.com.evil.invalid","synthetic").isEmpty());
 }
 @Test void onlyAnExpiredSessionAsksForReconnectServerFailuresCarryTheServerMessage() throws Exception {
  assertEquals(Map.of("X-Cloud-Epoch","7"),CloudSyncService.epochFromCloudState(200,"{\"cloudAccess\":{\"epoch\":7}}"));
  for(var expired:List.of(new Object[]{401,"{}"},new Object[]{403,""},new Object[]{200,"{\"code\":4010,\"message\":\"请先登录\"}"})) {
   var e=assertThrows(VersionException.class,()->CloudSyncService.epochFromCloudState((int)expired[0],(String)expired[1]));
   assertEquals(VersionException.CLOUD_RECONNECT_REQUIRED,e.getKind());
  }
  var ledger=assertThrows(VersionException.class,()->CloudSyncService.epochFromCloudState(200,"{\"code\":5000,\"message\":\"官网账本暂不可用\"}"));
  assertNull(ledger.getKind());assertTrue(ledger.isUserFacing());assertEquals("官网账本暂不可用",ledger.getMessage());
  for(var broken:List.of(new Object[]{502,"bad gateway"},new Object[]{200,"{}"},new Object[]{200,"{\"code\":5000}"})) {
   var e=assertThrows(VersionException.class,()->CloudSyncService.epochFromCloudState((int)broken[0],(String)broken[1]));
   assertNull(e.getKind());assertTrue(e.isUserFacing());
  }
 }
}
