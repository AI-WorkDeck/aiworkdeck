// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.plugin;

import com.checkba.model.entity.MessageCenterNotice;
import com.checkba.plugin.api.ToolCall;
import com.checkba.repository.MessageCenterNoticeRepository;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.ai.PluginService;
import com.checkba.service.messagecenter.MessageCenterGateway;
import com.checkba.service.messagecenter.MessageCenterService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** Facade boundaries only; persistence, identity and delivery are tested in MessageCenterServiceTest. */
class PluginNotificationServiceTest {
    PluginService plugins=mock(PluginService.class);
    MessageCenterGateway gateway=mock(MessageCenterGateway.class);
    MessageCenterService messages=mock(MessageCenterService.class);
    MessageCenterNoticeRepository notices=mock(MessageCenterNoticeRepository.class);
    ProjectMemberService members=mock(ProjectMemberService.class);
    PluginNotificationService service=new PluginNotificationService(plugins,gateway,messages,notices,members);
    ToolCall call=new ToolCall(5L,"conversation",10L,null);
    PluginService.PluginMetadata plugin=new PluginService.PluginMetadata();
    Map<String,Object> input=Map.of("eventKey","event-1","title","待确认事项","target",Map.of("kind","plugin","pluginId","test-plugin","view","review"));

    @BeforeEach void setup() {
        plugin.setName("合成插件");plugin.setPermissions(List.of("notifications"));
        when(plugins.getPlugin("test-plugin")).thenReturn(plugin);
        when(plugins.isEnabled("test-plugin")).thenReturn(true);
        when(members.hasWritePermission(5L,10L)).thenReturn(true);
        when(members.hasReadPermission(5L,20L)).thenReturn(true);
        when(messages.targetMap(any())).thenAnswer(inv -> inv.getArgument(0));
    }

    @Test void currentUserDeliveryIsHostBoundAndRevocationAppliesImmediately() {
        when(gateway.publishPlugin(10L,"test-plugin",input)).thenReturn(Map.of("id","notice-1"));
        assertEquals("notice-1",service.publish("test-plugin",call,input).get("id"));
        verify(gateway).publishPlugin(10L,"test-plugin",input);
        when(plugins.revokedReason("test-plugin")).thenReturn("revoked");
        assertThrows(IllegalArgumentException.class,()->service.publish("test-plugin",call,input));
        assertThrows(IllegalArgumentException.class,()->service.resolve("test-plugin",call,"event-1","done"));
        verifyNoMoreInteractions(gateway);
    }

    @Test void notificationPermissionAndLiveToolContextAreRequired() {
        assertThrows(IllegalArgumentException.class,()->service.publish("test-plugin",null,input));
        plugin.setPermissions(List.of("im"));
        assertThrows(IllegalArgumentException.class,()->service.publish("test-plugin",call,input));
        verifyNoInteractions(gateway);
    }

    @Test void projectDeliveryCannotCrossLocalCloudIdentityOrToolScope() {
        service.localMode=true;
        assertThrows(IllegalArgumentException.class,()->service.publishProject("test-plugin",call,5L,List.of(20L),input));
        service.localMode=false;
        assertThrows(IllegalArgumentException.class,()->service.publishProject("test-plugin",call,6L,List.of(20L),input));
        assertThrows(IllegalArgumentException.class,()->service.publishProject("test-plugin",call,5L,List.of(21L),input));
        verify(messages,never()).publishBusiness(any(),any(),any(),any(),any(),any(),any(),any(),any(),any(),any());
    }

    @Test void targetIsBoundToPluginAndAuthoritativeProject() {
        service.publishProject("test-plugin",call,5L,List.of(20L),input);
        verify(messages).publishBusiness(eq("plugin-test-plugin"),eq("插件 · 合成插件"),eq(10L),eq(List.of(20L)),eq(5L),
                eq("event-1"),eq("notification"),eq("待确认事项"),eq(""),eq("none"),
                eq(Map.of("kind","plugin","pluginId","test-plugin","view","review","projectId",5L)));
        var wrong=new HashMap<>(input);wrong.put("target",Map.of("kind","plugin","pluginId","other-plugin"));
        assertThrows(IllegalArgumentException.class,()->service.publishProject("test-plugin",call,5L,List.of(20L),wrong));
        wrong.put("target",Map.of("kind","plugin","pluginId","test-plugin","projectId",6L));
        assertThrows(IllegalArgumentException.class,()->service.publishProject("test-plugin",call,5L,List.of(20L),wrong));
    }

    @Test void resolveValidatesEveryDeliveryBeforeChangingAnyAndRechecksMembership() {
        var notice=new MessageCenterNotice();notice.setProjectId(6L);
        when(notices.findByRecipientIdAndSourceIdAndEventKey(20L,"plugin-test-plugin","event-1")).thenReturn(Optional.of(notice));
        assertThrows(IllegalArgumentException.class,()->service.resolveProject("test-plugin",call,5L,List.of(20L),"event-1","done"));
        verify(messages,never()).updateBusinessState(any(),any(),any(),any());
        notice.setProjectId(5L);service.resolveProject("test-plugin",call,5L,List.of(20L),"event-1","done");
        verify(messages).updateBusinessState("plugin-test-plugin","event-1",List.of(20L),"done");
        when(members.hasReadPermission(5L,20L)).thenReturn(false);
        assertThrows(IllegalArgumentException.class,()->service.resolveProject("test-plugin",call,5L,List.of(20L),"event-1","done"));
    }
}
