// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;
import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class MobileCalendarServiceTest {
    MobileCalendarConsentRepository consents=mock(MobileCalendarConsentRepository.class);
    MobileCalendarSnapshotRepository snapshots=mock(MobileCalendarSnapshotRepository.class);
    MobileProjectDirRepository dirs=mock(MobileProjectDirRepository.class);
    UserRepository users=mock(UserRepository.class);
    CloudStorageQuotaService quota=mock(CloudStorageQuotaService.class);
    MobileCalendarService service=new MobileCalendarService(consents,snapshots,dirs,users,quota,new ObjectMapper());
    MobileCalendarConsent consent=new MobileCalendarConsent();
    Map<String,MobileCalendarSnapshot> stored=new HashMap<>();
    final String source=Instant.now().minusSeconds(60).toString();
    @BeforeEach void setup() {
        consent.setUserId(1L);consent.setEnabled(true);
        when(consents.findById(1L)).thenAnswer(i->Optional.of(consent));
        when(users.lockStorageOwner(1L)).thenReturn(Optional.of(new User()));
        when(quota.persistentQuota(1L)).thenReturn(1000L);
        var dir=new MobileProjectDir();dir.setUserId(1L);dir.setDeviceId("desktop");dir.setProjectKey("42");dir.setName("Project A");
        when(dirs.findByUserIdAndDeviceId(1L,"desktop")).thenReturn(List.of(dir));
        when(dirs.findByUserIdOrderByUpdatedAtDesc(1L)).thenReturn(List.of(dir));
        when(snapshots.findByUserIdAndDeviceId(eq(1L),anyString())).thenAnswer(i->Optional.ofNullable(stored.get(i.getArgument(1))));
        when(snapshots.save(any())).thenAnswer(i->{MobileCalendarSnapshot r=i.getArgument(0);stored.put(r.getDeviceId(),r);return r;});
        when(snapshots.findByUserId(1L)).thenAnswer(i->new ArrayList<>(stored.values()));
    }
    Map<String,Object> task(String time,String status) {
        Map<String,Object> row=new HashMap<>(Map.of("projectKey","42","taskId","7","title","Review contract",
                "dueDate","2026-11-02","status",status,"remindBefore",60,"files",List.of(Map.of("fileId","8","fileName","Draft.docx"))));
        if(time!=null) row.put("dueTime",time);return row;
    }
    @SuppressWarnings("unchecked") List<Map<String,Object>> events() { return (List<Map<String,Object>>)service.events(1L).get("events"); }
    @Test void noUploadOrReadWithoutExplicitConsentAndActiveSubscription() {
        consent.setEnabled(false);
        assertThrows(IllegalArgumentException.class,()->service.replace(1L,"desktop","Asia/Shanghai",source,List.of(task(null,"OPEN"))));
        assertEquals(List.of(),events());verify(snapshots,never()).save(any());
        consent.setEnabled(true);when(quota.persistentQuota(1L)).thenReturn(0L);
        assertThrows(IllegalArgumentException.class,()->service.replace(1L,"desktop","Asia/Shanghai",source,List.of(task(null,"OPEN"))));
        assertEquals(List.of(),events());
    }
    @Test void canonicalTimeZoneAndAllDayReminderAreIndependentOfServerZone() {
        service.replace(1L,"desktop","Asia/Shanghai",source,List.of(task(null,"OPEN")));
        assertEquals("2026-11-02T00:00:00Z",events().get(0).get("remindAt"));
        assertEquals("Project A",events().get(0).get("projectName"));
        assertEquals("Asia/Shanghai",events().get(0).get("timeZone"));
        service.replace(1L,"desktop","America/New_York",Instant.now().toString(),List.of(task("09:00","OPEN")));
        assertEquals("2026-11-02T13:00:00Z",events().get(0).get("remindAt"));
    }
    @Test void completionAndDeletionCancelRemindersAndStaleSnapshotsCannotResurrect() {
        service.replace(1L,"desktop","Asia/Shanghai",source,List.of(task(null,"OPEN")));
        String newer=Instant.now().minusSeconds(10).toString();
        service.replace(1L,"desktop","Asia/Shanghai",newer,List.of(task(null,"DONE")));
        assertNull(events().get(0).get("remindAt"));
        assertEquals(false,service.replace(1L,"desktop","Asia/Shanghai",source,List.of(task(null,"OPEN"))).get("accepted"));
        assertNull(events().get(0).get("remindAt"));
        service.replace(1L,"desktop","Asia/Shanghai",Instant.now().toString(),List.of());assertTrue(events().isEmpty());
    }
    @Test void sameLocalIdsDoNotCollideAndUnknownOrRevokedProjectNeverLeaks() {
        assertNotEquals(MobileCalendarService.eventId("a","42","7"),MobileCalendarService.eventId("b","42","7"));
        var bad=task(null,"OPEN");bad.put("projectKey","other");
        assertThrows(IllegalArgumentException.class,()->service.replace(1L,"desktop","UTC",source,List.of(bad)));
        service.replace(1L,"desktop","UTC",source,List.of(task(null,"OPEN")));
        when(dirs.findByUserIdOrderByUpdatedAtDesc(1L)).thenReturn(List.of());assertTrue(events().isEmpty());
        when(users.lockStorageOwner(2L)).thenReturn(Optional.of(new User()));
        assertEquals(List.of(),service.events(2L).get("events"));verify(snapshots,never()).findByUserId(2L);
    }
    @Test void invalidSnapshotDoesNotReplaceGoodData() {
        service.replace(1L,"desktop","UTC",source,List.of(task(null,"OPEN")));
        var invalid=task(null,"OPEN");invalid.put("remindBefore",-1);
        assertThrows(IllegalArgumentException.class,()->service.replace(1L,"desktop","UTC",Instant.now().toString(),List.of(invalid)));
        assertEquals(1,events().size());
        assertThrows(IllegalArgumentException.class,()->service.replace(1L,"desktop","UTC",Instant.now().toString(),List.of(task(null,"OPEN"),task(null,"OPEN"))));
        assertEquals(1,events().size());
    }
    @Test void revocationWorksDuringBillingOutageAndDeletesSnapshots() {
        when(quota.persistentQuota(1L)).thenThrow(new MobileBillingFailureException(MobileBillingKind.UNAVAILABLE,"offline"));
        var result=service.settings(1L,false,MobileCalendarService.CONSENT_VERSION);
        assertFalse(consent.isEnabled());assertEquals(false,result.get("subscriptionAvailable"));
        verify(snapshots).deleteByUserId(1L);
        assertThrows(IllegalArgumentException.class,()->service.settings(1L,true,"old"));
    }
    @Test void malformedTimesReturnValidationErrorsAndMultilineTitlesRemainReadable() {
        assertThrows(IllegalArgumentException.class,()->service.replace(1L,"desktop",null,source,List.of()));
        assertThrows(IllegalArgumentException.class,()->service.replace(1L,"desktop","Bad/Zone",source,List.of()));
        assertThrows(IllegalArgumentException.class,()->service.replace(1L,"desktop","UTC","bad",List.of()));
        var task=task("99:00","OPEN");
        assertThrows(IllegalArgumentException.class,()->service.replace(1L,"desktop","UTC",source,List.of(task)));
        task.put("dueTime","09:00");task.put("dueDate","2026-13-40");
        assertThrows(IllegalArgumentException.class,()->service.replace(1L,"desktop","UTC",source,List.of(task)));
        task.put("dueDate","2026-11-02");task.put("title","Review draft\nwith client");
        service.replace(1L,"desktop","UTC",source,List.of(task));
        assertEquals("Review draft\nwith client",events().get(0).get("title"));
    }
    @Test void truncationIsExplicitAndExactlyFiveThousandIsNotTruncated() {
        var full=service.replace(1L,"desktop","UTC",source,List.of(task(null,"OPEN")),false);
        assertEquals(false,full.get("truncated"));
        var capped=service.replace(1L,"desktop","UTC",Instant.now().toString(),List.of(task(null,"OPEN")),true);
        assertEquals(true,capped.get("truncated"));
        assertEquals(true,service.events(1L).get("truncated"));
    }
}
