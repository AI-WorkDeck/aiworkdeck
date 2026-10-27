// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;
import com.checkba.model.entity.Project;
import com.checkba.repository.ProjectRepository;
import com.checkba.service.*;
import com.checkba.service.account.AccountService;
import com.checkba.service.task.ProjectTaskService;
import com.checkba.storage.StorageServiceFactory;
import com.fasterxml.jackson.databind.*;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;
import java.net.InetSocketAddress;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class MobileWorkspaceSyncHttpTest {
    @TempDir Path home;
    HttpServer server;
    MobileRelayClientService client;
    AccountService account=mock(AccountService.class);
    ProjectRepository projects=mock(ProjectRepository.class);
    ProjectTaskService tasks=mock(ProjectTaskService.class);
    ProjectProfileService profiles=mock(ProjectProfileService.class);
    ObjectMapper json=new ObjectMapper();
    List<JsonNode> calendar=new CopyOnWriteArrayList<>(), summaries=new CopyOnWriteArrayList<>();
    volatile boolean enabled=true, subscribed=true, switchAccount=false;
    volatile boolean switchDuringDirectory=false, failFirstSummary=false, truncateDirectory=false, staleSummary=false;
    List<String> directoryTokens=new CopyOnWriteArrayList<>(), requestPaths=new CopyOnWriteArrayList<>();
    @BeforeEach void setup() throws Exception {
        when(account.currentKeyOrNull()).thenReturn("awdk_fixture");
        when(account.accountFingerprintOrNull()).thenReturn("fixture-owner");
        var identity=mock(LocalIdentityService.class);when(identity.localUserId()).thenReturn(7L);
        var project=new Project();project.setId(42L);project.setName("Synthetic project");project.setUserId(7L);
        when(projects.findByUserIdOrderByCreatedAtDesc(7L)).thenReturn(List.of(project));
        when(tasks.listByProject(42L,null,null)).thenReturn(List.of(Map.of("id",3L,"title","Review draft","dueDate",LocalDate.of(2026,11,2),
                "dueTime",LocalTime.of(9,30),"status","OPEN","remindBefore",60,"files",List.of(Map.of("fileId",4L,"fileName","Draft.docx")))));
        when(profiles.getProfile(42L)).thenReturn(List.of(Map.of("key","client","value","Synthetic client")));
        Files.writeString(home.resolve("mobile-relay.json"),"{\"deviceId\":\"fixture-device\",\"token\":\"awdt_fixture\",\"accountFingerprint\":\"fixture-owner\"}");
        server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/api/mobile",ex->{
            String path=ex.getRequestURI().getPath();
            requestPaths.add(ex.getRequestMethod()+" "+path);
            String body=new String(ex.getRequestBody().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);
            Object data=Map.of();
            if(path.equals("/api/mobile/projects")) {
                directoryTokens.add(ex.getRequestHeaders().getFirst("X-Session-Id"));
                if(switchDuringDirectory) when(account.accountFingerprintOrNull()).thenReturn("different-owner");
            } else if(path.endsWith("/settings") || path.endsWith("/status")) {
                data=Map.of("enabled",enabled,"subscriptionActive",subscribed,"backupEnabled",true);
                if(switchAccount) when(account.accountFingerprintOrNull()).thenReturn("different-owner");
            } else if(path.equals("/api/mobile/calendar/snapshots")) calendar.add(json.readTree(body));
            else if(path.equals("/api/mobile/assistant/snapshots") && "PUT".equals(ex.getRequestMethod())) summaries.add(json.readTree(body));
            else if(path.equals("/api/mobile/assistant/summaries")) data=staleSummary
                    && "includeRemoved=true".equals(ex.getRequestURI().getQuery())
                    ? List.of(Map.of("deviceId","fixture-device","projectKey","99","summary","Deleted project")) : List.of();
            Map<String,Object> envelope=new LinkedHashMap<>(Map.of("code",0,"data",data));
            if(path.equals("/api/mobile/projects") && truncateDirectory) envelope.putAll(Map.of("truncated",true,"count",1,"totalCount",2));
            if(path.equals("/api/mobile/assistant/snapshots") && failFirstSummary && json.readTree(body).path("projectKey").asText().equals("42")) envelope.put("code",1);
            byte[] response=json.writeValueAsBytes(envelope);
            ex.getResponseHeaders().set("Content-Type","application/json");ex.sendResponseHeaders(200,response.length);
            ex.getResponseBody().write(response);ex.close();
        });server.start();
        client=new MobileRelayClientService(true,true,"http://127.0.0.1:"+server.getAddress().getPort(),"",home.toString(),
                account,identity,projects,mock(ProjectFileService.class),mock(StorageServiceFactory.class),mock(ProjectAiMessageService.class),mock(DesktopRefHandler.class));
        ReflectionTestUtils.setField(client,"mobileTasks",tasks);ReflectionTestUtils.setField(client,"mobileProfiles",profiles);
    }
    @AfterEach void cleanup() {if(server!=null) server.stop(0);}
    @Test void realHttpPublishesCompleteTypedCalendarAndOnlyProjectFactsForSummary() {
        client.syncMobileCalendar();client.syncMobileAssistant();
        assertEquals(1,calendar.size());var event=calendar.get(0).path("events").get(0);
        assertEquals("42",event.path("projectKey").asText());assertEquals("3",event.path("taskId").asText());
        assertEquals("2026-11-02",event.path("dueDate").asText());assertEquals("09:30",event.path("dueTime").asText());
        assertEquals("4",event.path("files").get(0).path("fileId").asText());
        assertNotNull(ZoneId.of(calendar.get(0).path("timeZone").asText()));
        assertEquals(1,summaries.size());assertTrue(summaries.get(0).path("context").asText().contains("Synthetic client"));
        assertFalse(summaries.get(0).has("sources"));assertFalse(summaries.get(0).toString().contains("awdk_fixture"));
    }
    @Test void absentConsentOrExpiredSubscriptionDoesNotEvenReadLocalProjectContent() {
        enabled=false;client.syncMobileCalendar();client.syncMobileAssistant();verifyNoInteractions(tasks,profiles);
        enabled=true;subscribed=false;client.syncMobileCalendar();client.syncMobileAssistant();verifyNoInteractions(tasks,profiles);
        assertTrue(calendar.isEmpty());assertTrue(summaries.isEmpty());
    }
    @Test void accountChangeBetweenStatusAndUploadCannotPublishOldContent() {
        switchAccount=true;client.syncMobileCalendar();assertTrue(calendar.isEmpty());verifyNoInteractions(tasks);
    }
    @Test void incompleteLocalReadNeverReplacesRemoteSnapshotWithAnEmptyList() {
        when(tasks.listByProject(42L,null,null)).thenThrow(new IllegalStateException("read failed"));
        client.syncMobileCalendar();assertTrue(calendar.isEmpty());
    }
    @Test void accountSwitchDuringDirectoryCannotReadOrPublishOldAccountContent() {
        switchDuringDirectory=true;
        client.syncMobileCalendar();
        assertEquals(List.of("awdt_fixture"),directoryTokens);
        assertTrue(calendar.isEmpty());verifyNoInteractions(tasks,profiles);
    }
    @Test void oneRejectedSummaryDoesNotStarveLaterProjects() {
        addSecondProject();failFirstSummary=true;
        client.syncMobileAssistant();
        assertEquals(List.of("42","43"),summaries.stream().map(s -> s.path("projectKey").asText()).toList());
    }
    @Test void truncatedDirectoryPublishesOnlyAcceptedProjectsWithoutFailingTheWholeSnapshot() {
        addSecondProject();truncateDirectory=true;
        client.syncMobileCalendar();client.syncMobileAssistant();
        assertEquals(1,calendar.size());assertEquals(1,calendar.get(0).path("events").size());
        assertEquals(List.of("42"),summaries.stream().map(s -> s.path("projectKey").asText()).toList());
        verify(tasks,never()).listByProject(43L,null,null);
    }
    @Test void emptyLocalInstanceCannotEraseAnotherInstancesCalendarOrSummaries() {
        when(projects.findByUserIdOrderByCreatedAtDesc(7L)).thenReturn(List.of());
        client.syncMobileCalendar();client.syncMobileAssistant();
        assertTrue(calendar.isEmpty());assertTrue(summaries.isEmpty());assertTrue(directoryTokens.isEmpty());
        verifyNoInteractions(tasks,profiles);
    }
    @Test void summariesAreReadBeforeDirectoryReplacementSoDeletedProjectsAreCleaned() {
        staleSummary=true;
        client.syncMobileAssistant();
        int oldSummaries=requestPaths.indexOf("GET /api/mobile/assistant/summaries");
        int newDirectory=requestPaths.indexOf("PUT /api/mobile/projects");
        assertTrue(oldSummaries>=0 && newDirectory>oldSummaries,requestPaths.toString());
        assertTrue(requestPaths.contains("DELETE /api/mobile/assistant/snapshots"),requestPaths.toString());
    }
    @Test void calendarSnapshotCapsAtFiveThousandAndMarksTruncation() {
        List<Map<String,Object>> history=new ArrayList<>(java.util.Collections.nCopies(5000,
                Map.of("id",3L,"projectId",42L,"title","Completed history","dueDate",LocalDate.of(2020,1,1),"status","DONE")));
        history.add(Map.of("id",9L,"projectId",42L,"title","Upcoming deadline","dueDate",LocalDate.of(2026,11,2),"status","OPEN","remindBefore",60));
        when(tasks.listByProject(42L,null,null)).thenReturn(history);
        client.syncMobileCalendar();
        assertEquals(1,calendar.size());
        assertEquals(5000,calendar.get(0).path("events").size());
        assertTrue(calendar.get(0).path("truncated").asBoolean());
        assertEquals("9",calendar.get(0).path("events").get(0).path("taskId").asText(),"活动提醒必须优先于已完成历史");
        assertEquals("OPEN",calendar.get(0).path("events").get(0).path("status").asText());
    }
    private void addSecondProject() {
        var first=projects.findByUserIdOrderByCreatedAtDesc(7L).get(0);
        var second=new Project();second.setId(43L);second.setName("Second synthetic project");second.setUserId(7L);
        when(projects.findByUserIdOrderByCreatedAtDesc(7L)).thenReturn(List.of(first,second));
        when(tasks.listByProject(43L,null,null)).thenReturn(List.of(Map.of("id",5L,"title","Second task","dueDate",LocalDate.of(2026,11,3),"status","OPEN")));
        when(profiles.getProfile(43L)).thenReturn(List.of());
    }
}
