// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.controller.ai;

import com.checkba.controller.AuthController;
import com.checkba.controller.ImController;
import com.checkba.service.ai.PluginService;
import com.checkba.service.im.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.mock.web.MockHttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ImPluginControllerTest {
 PluginService plugins=mock(PluginService.class); ImGatewayService gateway=mock(ImGatewayService.class);
 ObjectMapper mapper=new ObjectMapper();
 @SuppressWarnings("unchecked") ObjectProvider<ImProjectActionHandler> handlers=mock(ObjectProvider.class);
 PluginImController controller=new PluginImController(plugins,gateway,mapper,handlers);
 MockHttpServletRequest request(String json) {var r=new MockHttpServletRequest();r.setContent(json.getBytes(StandardCharsets.UTF_8));return r;}
 void enable(String... permissions) {var plugin=new PluginService.PluginMetadata(); plugin.setPermissions(List.of(permissions)); when(plugins.getPlugin("project-im")).thenReturn(plugin);when(plugins.isEnabled("project-im")).thenReturn(true);}
 @Test void noProjectIsRequiredForMessagingAndIdentityIsServerOwned() throws Exception {
  enable("im"); when(handlers.iterator()).thenReturn(Collections.emptyIterator()); when(gateway.execute(5L,"self",Map.of())).thenReturn(Map.of("id",55));
  try(var auth=mockStatic(AuthController.class)) {
   auth.when(()->AuthController.getUserIdFromSession("session")).thenReturn(5L);
   var result=controller.action("project-im",request("{\"action\":\"self\",\"params\":{}}"),"session");
   assertEquals(Map.of("id",55),result.get("data"));
  }
 }
 @Test void pluginPermissionAndEnabledStateAreEnforcedBeforeGateway() {
  enable("file_read");
  try(var auth=mockStatic(AuthController.class)) {
   auth.when(()->AuthController.getUserIdFromSession("session")).thenReturn(5L);
   assertThrows(IllegalArgumentException.class,()->controller.action("project-im",request("{}"),"session"));
   enable("im");when(plugins.isEnabled("project-im")).thenReturn(false);
   assertThrows(IllegalArgumentException.class,()->controller.action("project-im",request("{}"),"session"));
   verifyNoInteractions(gateway);
  }
 }
 @Test void projectActionsRequireAdditionalFilePermissionAndAcceptStringId() throws Exception {
  ImProjectActionHandler handler=mock(ImProjectActionHandler.class);when(handler.supports("import")).thenReturn(true);
  enable("im"); when(handlers.iterator()).thenAnswer(i->List.of(handler).iterator());
  try(var auth=mockStatic(AuthController.class)) {
   auth.when(()->AuthController.getUserIdFromSession("session")).thenReturn(5L);
   String json="{\"action\":\"import\",\"projectId\":\"123\",\"params\":{}}";
   assertThrows(IllegalArgumentException.class,()->controller.action("project-im",request(json),"session"));
   verify(handler,never()).execute(any(),any(),any(),any());
   enable("im","file_write"); when(handler.execute(5L,123L,"import",Map.of())).thenReturn(Map.of("ok",true));
   assertEquals(Map.of("ok",true),controller.action("project-im",request(json),"session").get("data"));
  }
 }
 @Test void invalidProjectIdsAndOversizedBodiesFailClosed() {
  assertEquals(123L,PluginImController.projectId("123"));
  for(Object id:List.of(-1,1.5,"1/../2","9223372036854775808")) assertThrows(IllegalArgumentException.class,()->PluginImController.projectId(id));
  var oversized=new MockHttpServletRequest();oversized.setContent(new byte[ImGatewayService.MAX_JSON_BYTES+1]);
  assertThrows(IllegalArgumentException.class,()->ImController.readBody(oversized,mapper));
  assertThrows(IllegalArgumentException.class,()->ImController.readBody(request("null"),mapper));
 }
 @Test void agentReplyRequiresAiAndReadPermissionsWithoutGrantingWriteAccess() throws Exception {
  ImProjectActionHandler handler=mock(ImProjectActionHandler.class);when(handler.supports("agentReply")).thenReturn(true);
  when(handlers.iterator()).thenAnswer(i->List.of(handler).iterator());
  try(var auth=mockStatic(AuthController.class)) {
   auth.when(()->AuthController.getUserIdFromSession("session")).thenReturn(5L);
   String json="{\"action\":\"agentReply\",\"projectId\":123,\"params\":{\"messageId\":4}}";
   enable("im","file_read");
   assertThrows(IllegalArgumentException.class,()->controller.action("project-im",request(json),"session"));
   enable("im","ai");
   assertThrows(IllegalArgumentException.class,()->controller.action("project-im",request(json),"session"));
   verifyNoInteractions(gateway);
   verify(handler,never()).execute(any(),any(),any(),any());
   enable("im","ai","file_read");
   when(handler.execute(5L,123L,"agentReply",Map.of("messageId",4))).thenReturn(Map.of("accepted",true));
   assertEquals(Map.of("accepted",true),controller.action("project-im",request(json),"session").get("data"));
  }
 }
 @Test void assistantIdentityInitializationRequiresPluginWritePermission() throws Exception {
  ImProjectActionHandler handler=mock(ImProjectActionHandler.class);
  when(handler.supports(anyString())).thenReturn(true);
  when(handlers.iterator()).thenAnswer(i->List.of(handler).iterator());
  try(var auth=mockStatic(AuthController.class)) {
   auth.when(()->AuthController.getUserIdFromSession("session")).thenReturn(5L);
   for(String action:List.of("agentScopes","ensureAgent")) {
    String json="{\"action\":\""+action+"\",\"projectId\":123,\"params\":{}}";
    enable("im","file_read");
    assertThrows(IllegalArgumentException.class,()->controller.action("project-im",request(json),"session"));
    enable("im","file_read","file_write");
    when(handler.execute(5L,123L,action,Map.of())).thenReturn(Map.of("ok",true));
    assertEquals(Map.of("ok",true),controller.action("project-im",request(json),"session").get("data"));
   }
  }
 }
}
