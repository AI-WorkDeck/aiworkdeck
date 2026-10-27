// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;
import com.checkba.model.entity.*;
import com.checkba.repository.*;
import org.junit.jupiter.api.*;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class MobileCalendarPushServiceTest {
    MobileCalendarPushDeviceRepository devices=mock(MobileCalendarPushDeviceRepository.class);
    MobileCalendarDeliveryRepository deliveries=mock(MobileCalendarDeliveryRepository.class);
    MobileCalendarService calendar=mock(MobileCalendarService.class);
    UserRepository users=mock(UserRepository.class);
    MobileCalendarPushGateway gateway=mock(MobileCalendarPushGateway.class);
    PlatformTransactionManager transactions=mock(PlatformTransactionManager.class);
    MobileCalendarPushService service=new MobileCalendarPushService(devices,deliveries,calendar,users,gateway,transactions);
    MobileCalendarPushDevice device=new MobileCalendarPushDevice();
    Instant now=Instant.now();
    @BeforeEach void setup() {
        device.setInstallationId(UUID.randomUUID().toString());device.setUserId(1L);device.setToken("a".repeat(64));device.setEnvironment("sandbox");
        when(users.lockStorageOwner(1L)).thenReturn(Optional.of(new User()));
        when(devices.findByUserId(1L)).thenReturn(List.of(device));
        when(transactions.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        when(gateway.available()).thenReturn(true);
        when(calendar.settings(1L)).thenReturn(Map.of("enabled",true,"subscriptionActive",true));
    }
    Map<String,Object> event(String id,String state,long seconds) {
        return Map.of("id",id,"status",state,"remindAt",now.plusSeconds(seconds).toString());
    }
    @Test void deliveryIsDeduplicatedButReschedulingGetsANewReceipt() {
        String id=UUID.randomUUID().toString(),when=now.minusSeconds(60).toString();
        when(calendar.events(1L)).thenReturn(Map.of("events",List.of(event(id,"OPEN",-60))));
        when(gateway.send(eq(device),eq(id),anyString())).thenReturn(MobileCalendarPushGateway.Result.SENT);
        String receipt=MobileCalendarPushService.deliveryId(1L,device.getInstallationId(),id,when);
        when(deliveries.existsById(receipt)).thenReturn(false,true);
        service.sendUser(1L,now);service.sendUser(1L,now);
        verify(gateway,times(1)).send(device,id,receipt);verify(deliveries).save(argThat(r->r.getId().equals(receipt)));
        assertNotEquals(receipt,MobileCalendarPushService.deliveryId(1L,device.getInstallationId(),id,now.toString()));
    }
    @Test void completedFutureOldAndRevokedEventsNeverSend() {
        when(calendar.events(1L)).thenReturn(Map.of("events",List.of(event("done","DONE",-60),event("future","OPEN",60),event("old","OPEN",-90000))));
        service.sendUser(1L,now);verify(gateway,never()).send(any(),any(),any());
        when(calendar.events(1L)).thenReturn(Map.of("events",List.of()));service.sendUser(1L,now);
        verify(gateway,never()).send(any(),any(),any());
    }
    @Test void transientFailureDoesNotAcknowledgeAndInvalidDeviceIsRemoved() {
        when(calendar.events(1L)).thenReturn(Map.of("events",List.of(event("one","OPEN",-60))));
        when(gateway.send(any(),any(),any())).thenReturn(MobileCalendarPushGateway.Result.RETRY,MobileCalendarPushGateway.Result.INVALID_DEVICE);
        service.sendUser(1L,now);verify(deliveries,never()).save(any());
        service.sendUser(1L,now);verify(devices).delete(device);verify(deliveries,never()).save(any());
    }
    @Test void logoutCannotUnbindAnotherAccountsInstallationAndAccountSwitchClearsReceipts() {
        when(devices.findById(device.getInstallationId())).thenReturn(Optional.of(device));
        device.setUserId(2L);service.unregister(1L,device.getInstallationId());verify(devices,never()).delete(any());
        service.register(1L,device.getInstallationId(),"b".repeat(64),"production");
        assertEquals(1L,device.getUserId());assertEquals("b".repeat(64),device.getToken());
        verify(deliveries).deleteByInstallationId(device.getInstallationId());
    }
    @Test void unconfiguredServerKeepsPhoneOnLocalReminderMode() {
        when(gateway.available()).thenReturn(false);
        assertEquals(Map.of("available",false,"registered",false),service.register(1L,device.getInstallationId(),device.getToken(),"sandbox"));
        verifyNoInteractions(devices,calendar,deliveries);
    }
    @Test void malformedRegistrationNeverThrowsNullPointerOrTouchesAccountData() {
        assertThrows(IllegalArgumentException.class,()->service.register(1L,null,device.getToken(),"sandbox"));
        assertThrows(IllegalArgumentException.class,()->service.register(1L,"bad",device.getToken(),"sandbox"));
        assertThrows(IllegalArgumentException.class,()->service.register(1L,device.getInstallationId(),device.getToken(),null));
        verifyNoInteractions(devices,calendar,deliveries);
    }
}
