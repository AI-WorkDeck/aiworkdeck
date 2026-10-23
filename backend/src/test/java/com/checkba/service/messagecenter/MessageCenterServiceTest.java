// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.messagecenter;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.service.ProjectMemberService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.annotation.*;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@DataJpaTest(showSql=false)
@AutoConfigureTestDatabase(replace=AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties={"spring.datasource.url=jdbc:h2:mem:message-center;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
        "spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa","spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect","spring.jpa.hibernate.ddl-auto=create-drop"})
@Import({MessageCenterService.class,MessageCenterServiceTest.Config.class})
@Transactional(propagation=Propagation.NOT_SUPPORTED)
class MessageCenterServiceTest {
    static final AtomicBoolean firmAccess=new AtomicBoolean(true);
    static final java.util.concurrent.atomic.AtomicReference<String> failingPolicyKey=new java.util.concurrent.atomic.AtomicReference<>();
    static final java.util.concurrent.atomic.AtomicReference<MessageCenterSource.Snapshot> sourceSnapshot=
            new java.util.concurrent.atomic.AtomicReference<>(new MessageCenterSource.Snapshot(List.of(),0,0));
    @TestConfiguration static class Config {
        @Bean ObjectMapper mapper() { return new ObjectMapper().findAndRegisterModules(); }
        @Bean MessageCenterSource partialSource() { return new MessageCenterSource() {
            public String id() { return "synthetic-dd"; }
            public boolean localOnly() { return true; }
            public Snapshot list(Long user,int limit) { return sourceSnapshot.get(); }
            public void markRead(Long user,String item) { throw new UnsupportedOperationException(); }
            public Map<String,Object> target(Long user,String item) { throw new UnsupportedOperationException(); }
        }; }
        @Bean MessageCenterAccessPolicy policy() { return new MessageCenterAccessPolicy() {
            public String sourceId() { return "lawfirm"; }
            public boolean canAccess(Long user,String key) {
                if (key.equals(failingPolicyKey.get())) throw new com.checkba.service.collab.DirectoryUnavailableException("synthetic directory unavailable");
                return firmAccess.get();
            }
        }; }
    }
    @Autowired MessageCenterService service;
    @Autowired UserRepository users;
    @Autowired ProjectRepository projects;
    @Autowired ProjectMemberRepository members;
    @Autowired MessageCenterNoticeRepository notices;
    @MockBean ProjectMemberService permissions;
    Long owner,colleague,outsider,projectId;
    @BeforeEach void setup() {
        firmAccess.set(true);failingPolicyKey.set(null);sourceSnapshot.set(new MessageCenterSource.Snapshot(List.of(),0,0)); owner=user(); colleague=user(); outsider=user();
        Project p=new Project(); p.setName("合成项目"); p.setProjectType("TEST"); p.setUserId(owner);
        p.setListedCompanyName("甲"); p.setTargetCompanyName("乙"); projectId=projects.saveAndFlush(p).getId();
        ProjectMember m=new ProjectMember(); m.setUserId(colleague); m.setProjectId(projectId); m.setRole("PARTICIPANT"); members.saveAndFlush(m);
        when(permissions.hasReadPermission(eq(projectId),anyLong())).thenReturn(true);
        when(permissions.hasWritePermission(projectId,owner)).thenReturn(true);
    }
    Long user() {
        User u=new User(); u.setUsername("message-test-"+UUID.randomUUID()); u.setPassword("synthetic");u.setRole("USER");u.setDisplayName("合成通知用户");
        u.setSubscriptionType("FREE");u.setCreatedAt(LocalDateTime.now());u.setUpdatedAt(LocalDateTime.now()); return users.saveAndFlush(u).getId();
    }
    Map<String,Object> payload(String key) { return Map.of("eventKey",key,"title","请核对合成事项","actionState","pending",
            "target",Map.of("kind","plugin","pluginId","example-plugin","recordId","case-1")); }
    @SuppressWarnings("unchecked") List<Map<String,Object>> list(Long user) { return (List<Map<String,Object>>)service.list(user,100,false).get("notifications"); }
    @Test void selfPublishCannotForgeSourceOrRecipientAndOtherAccountsCannotRead() {
        Map<String,Object> row=service.publishToSelf("example-plugin",owner,payload("one")); String id=(String)row.get("id");
        assertEquals("PLUGIN",row.get("sourceKind")); assertEquals("plugin.example-plugin",row.get("sourceId"));
        assertEquals(1,list(owner).size()); assertTrue(list(colleague).isEmpty());
        assertThrows(IllegalArgumentException.class,()->service.read(colleague,id,false));
        assertThrows(IllegalArgumentException.class,()->service.target(colleague,id,false));
        for (String field:List.of("sourceKind","sourceId","sourceName","recipientId","recipients","senderId","userId")) {
            Map<String,Object> forged=new HashMap<>(payload(field));forged.put(field,"forged");
            assertThrows(IllegalArgumentException.class,()->service.publishToSelf("example-plugin",owner,forged));
        }
    }
    @Test void readDoesNotCompleteBusinessAndRetryDoesNotResurrectIt() {
        String id=(String)service.publishToSelf("example-plugin",owner,payload("pending")).get("id");
        service.read(owner,id,false); var row=list(owner).get(0);assertNotNull(row.get("readAt"));assertEquals("pending",row.get("actionState"));
        service.resolveOwn("example-plugin",owner,"pending","done");
        service.publishToSelf("example-plugin",owner,payload("pending"));
        assertEquals("done",list(owner).get(0).get("actionState"));assertEquals(1,list(owner).size());
        assertThrows(IllegalArgumentException.class,()->service.resolveOwn("another-plugin",owner,"pending","done"));
    }
    @Test void parallelRetryPersistsOneDeliveryAndChangedPayloadIsRejected() throws Exception {
        ExecutorService pool=Executors.newFixedThreadPool(2);CountDownLatch gate=new CountDownLatch(1);
        try {
            Callable<Object> task=()->{gate.await();return service.publishToSelf("example-plugin",owner,payload("same")).get("id");};
            Future<Object> a=pool.submit(task),b=pool.submit(task);gate.countDown(); assertEquals(a.get(20,TimeUnit.SECONDS),b.get(20,TimeUnit.SECONDS));
        } finally {pool.shutdownNow();}
        assertEquals(1,list(owner).size());Map<String,Object> changed=new HashMap<>(payload("same"));changed.put("title","changed");
        assertThrows(IllegalArgumentException.class,()->service.publishToSelf("example-plugin",owner,changed));
    }
    @Test void projectPublisherRequiresRealMembershipEvenWhenBroadReadPermissionReturnsTrue() {
        assertThrows(IllegalArgumentException.class,()->publishProject(List.of(outsider)));
        assertTrue(list(outsider).isEmpty());
        var delivered=publishProject(List.of(colleague));assertEquals(1,delivered.size());assertEquals(1,list(colleague).size());
        members.delete(members.findByProjectIdAndUserId(projectId,colleague).orElseThrow());
        assertTrue(list(colleague).isEmpty());
        assertThrows(IllegalArgumentException.class,()->service.target(colleague,(String)delivered.get(0).get("id"),false));
        when(permissions.hasWritePermission(projectId,owner)).thenReturn(false);
        assertThrows(IllegalArgumentException.class,()->publishProject(List.of(owner)));
    }
    List<Map<String,Object>> publishProject(List<Long> recipients) {
        return service.publishBusiness("workflow","材料核对",owner,recipients,projectId,"event-1","review","核对材料","","pending",
                Map.of("kind","dd","projectId",projectId,"recordId","item-1"));
    }
    @Test void firmNoticesRecheckAuthorityBeforeExposingHistoricalTitleOrTarget() {
        var delivered=service.publishAuthorizedBusiness("lawfirm","律所利冲",owner,List.of(colleague),null,"case-1","review","敏感合成标题","","pending",
                Map.of("kind","plugin","pluginId","lawfirm-management","recordId","case-1"));
        assertEquals(1,list(colleague).size());firmAccess.set(false);assertTrue(list(colleague).isEmpty());
        assertThrows(IllegalArgumentException.class,()->service.read(colleague,(String)delivered.get(0).get("id"),false));
        assertThrows(IllegalArgumentException.class,()->service.publishAuthorizedBusiness("unknown","未知",owner,List.of(colleague),null,"x","review","title","","none",Map.of()));
    }
    @Test void genericProjectPublishRejectsBothProjectAndGlobalClients() {
        when(permissions.isClient(projectId,colleague)).thenReturn(true);
        assertThrows(IllegalArgumentException.class,()->publishProject(List.of(colleague)));
        when(permissions.isClient(projectId,colleague)).thenReturn(false);
        User u=users.findById(colleague).orElseThrow();u.setRole("CLIENT");users.saveAndFlush(u);
        assertThrows(IllegalArgumentException.class,()->publishProject(List.of(colleague)));
        assertTrue(list(colleague).isEmpty());
    }
    @Test void downgradeToClientHidesPreviouslyDeliveredInternalProjectNotices() {
        String id=(String)publishProject(List.of(colleague)).get(0).get("id");assertEquals(1,list(colleague).size());
        when(permissions.isClient(projectId,colleague)).thenReturn(true);assertTrue(list(colleague).isEmpty());
        assertThrows(IllegalArgumentException.class,()->service.target(colleague,id,false));
        when(permissions.isClient(projectId,colleague)).thenReturn(false);
        User u=users.findById(colleague).orElseThrow();u.setRole("CLIENT");users.saveAndFlush(u);
        assertTrue(list(colleague).isEmpty());assertThrows(IllegalArgumentException.class,()->service.read(colleague,id,false));
    }
    @Test void pluginTargetsCannotExecuteUrlsOrPretendToOpenAnotherPlugin() {
        for (Map<String,Object> target:List.of(Map.<String,Object>of("kind","plugin","pluginId","other-plugin"),
                Map.<String,Object>of("kind","plugin","pluginId","example-plugin","url","https://invalid.example"),
                Map.<String,Object>of("kind","plugin","pluginId","example-plugin","projectId",projectId),
                Map.<String,Object>of("kind","im","conversationId","someone-else"))) {
            Map<String,Object> p=new HashMap<>(payload(UUID.randomUUID().toString()));p.put("target",target);
            assertThrows(IllegalArgumentException.class,()->service.publishToSelf("example-plugin",owner,p));
        }
        assertTrue(list(owner).isEmpty());
    }
    @Test void databaseUniquenessSeparatesPluginAndAccountNamespaces() {
        String a=(String)service.publishToSelf("example-plugin",owner,payload("same-key")).get("id");
        String b=(String)service.publishToSelf("example-plugin",colleague,payload("same-key")).get("id");
        assertNotEquals(a,b);Map<String,Object> p=new HashMap<>(payload("same-key"));p.remove("target");
        service.publishToSelf("second-plugin",owner,p);assertEquals(2,list(owner).size());assertEquals(1,list(colleague).size());
    }
    @Test void sourcePartialCountsAndLegacyReadStateSurviveProjection() {
        var entry=new MessageCenterSource.Entry("connection:1","synthetic-dd","Synthetic","NOTICE","Legacy time","",
                null,null,null,null,null,"none",Map.of(),true);
        sourceSnapshot.set(new MessageCenterSource.Snapshot(List.of(entry),2,3,List.of("failed-connection"),true));
        var result=service.list(owner,1,true);
        var rows=(List<?>)result.get("notifications");var row=(Map<?,?>)rows.get(0);
        assertEquals("local:synthetic-dd:connection:1",row.get("id"));assertEquals(true,row.get("read"));
        assertNull(row.get("createdAt"));assertNull(row.get("readAt"));
        assertEquals(Map.of("unreadNotifications",2L,"pending",3L),result.get("counts"));
        assertEquals(List.of("synthetic-dd:failed-connection"),result.get("unavailableSources"));assertEquals(true,result.get("hasMore"));
    }
    @Test void policyOutageHidesWholeSourceButKeepsOtherSourcesAndReadFailureIsNotAcknowledged() {
        var failed=service.publishAuthorizedBusiness("lawfirm","律所利冲",owner,List.of(colleague),null,"failed-policy","review","不可核验的标题","","pending",Map.of());
        service.publishAuthorizedBusiness("lawfirm","律所利冲",owner,List.of(colleague),null,"healthy-policy","review","同来源标题","","pending",Map.of());
        String pluginId=(String)service.publishToSelf("example-plugin",colleague,payload("unrelated-plugin")).get("id");
        assertEquals(3,list(colleague).size());
        failingPolicyKey.set("failed-policy");
        var result=service.list(colleague,100,false);
        assertEquals(List.of("lawfirm"),result.get("unavailableSources"));
        assertEquals(1,((List<?>)result.get("notifications")).size());assertEquals(pluginId,list(colleague).get(0).get("id"));
        assertEquals(Map.of("unreadNotifications",1L,"pending",1L),result.get("counts"));
        String failedId=(String)failed.get(0).get("id");
        var readError=assertThrows(IllegalArgumentException.class,()->service.read(colleague,failedId,false));
        assertTrue(readError.getMessage().contains("暂时无法核对"));
        assertThrows(IllegalArgumentException.class,()->service.target(colleague,failedId,false));
        assertNull(notices.findById(failedId.substring(7)).orElseThrow().getReadAt());
        service.read(colleague,pluginId,false);
        result=service.list(colleague,100,false);
        assertEquals(0L,((Map<?,?>)result.get("counts")).get("unreadNotifications"));
        assertEquals(List.of("lawfirm"),result.get("unavailableSources"));
        failingPolicyKey.set(null);assertEquals(3,list(colleague).size());
    }
}
