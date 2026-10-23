// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.lawfirm;
import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.repository.lawfirm.*;
import com.checkba.service.ProjectMemberService;
import com.checkba.service.collab.*;
import com.checkba.service.messagecenter.MessageCenterService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.annotation.*;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@DataJpaTest(showSql=false)
@AutoConfigureTestDatabase(replace=AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties={"spring.datasource.url=jdbc:h2:mem:lawfirm-workflow;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
        "spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa","spring.datasource.password=",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect","spring.jpa.hibernate.ddl-auto=create-drop"})
@Import({LawFirmWorkflowService.class,LawFirmAuthority.class,LawFirmConflictEngine.class,MessageCenterService.class,LawFirmMessageAccessPolicy.class,ObjectMapper.class})
@Transactional(propagation=Propagation.NOT_SUPPORTED)
class LawFirmWorkflowTest {
    @Autowired LawFirmWorkflowService workflow;
    @Autowired LawFirmMessageAccessPolicy accessPolicy;
    @SpyBean MessageCenterService center;
    @SpyBean LawFirmWorkflowScopeRepository scopes;
    @Autowired LawFirmWorkflowRepository records;
    @Autowired LawFirmCommitteeAppointmentRepository appointments;
    @Autowired AccountBindingRepository bindings;
    @Autowired UserRepository users;
    @MockBean AccountDirectoryClient directory;
    @MockBean ProjectMemberService projectPermissions;
    final Map<String,OrgMembership> membership=new ConcurrentHashMap<>();
    Long admin,applicant,lawyer,committee,outsider;
    String firm;
    @BeforeEach void setUp() {
        firm="firm-"+UUID.randomUUID();
        admin=user(true,firm);applicant=user(false,firm);lawyer=user(false,firm);committee=user(false,firm);outsider=user(true,"other-"+firm);
        when(directory.configured()).thenReturn(true);
        when(directory.lookupByAccountId(anyString(),anyString())).thenAnswer(call -> {
            String me=call.getArgument(0),candidate=call.getArgument(1);
            return new DirectoryReply(membership.containsKey(candidate),new DirectoryAccount(candidate,candidate,"合成律师 "+candidate,null),
                    membership.getOrDefault(me,OrgMembership.NONE),membership.getOrDefault(candidate,OrgMembership.NONE));
        });
    }
    Long user(boolean manager,String scope) {
        User user=new User();user.setUsername("lawfirm-test-"+UUID.randomUUID());user.setDisplayName("合成律师");user.setPassword("synthetic");user.setRole("USER");user.setSubscriptionType("FREE");user.setCreatedAt(LocalDateTime.now());user.setUpdatedAt(LocalDateTime.now());
        Long id=users.saveAndFlush(user).getId();AccountBinding b=new AccountBinding();b.setUserId(id);b.setExternalAccountId("account-"+id);b.setCreatedAt(LocalDateTime.now());bindings.saveAndFlush(b);
        membership.put(b.getExternalAccountId(),new OrgMembership("team-"+scope,scope,manager));return id;
    }
    Map<String,Object> call(Long user,String action,Map<String,Object> p){return workflow.execute(user,action,p);}
    Map<String,Object> appoint(){return call(admin,"workflowAppoint",Map.of("userId",committee));}
    void accept(){var a=appoint();call(committee,"workflowAppointmentDecision",Map.of("recordId",a.get("id"),"expectedVersion",a.get("version"),"decision","ACCEPTED"));}
    Map<String,Object> draft(){return new LinkedHashMap<>(Map.of("requestId",UUID.randomUUID().toString(),"title","合成新案","clientName","合成甲方","counterpartyName","合成乙方",
            "leadId",applicant,"committeeId",committee,"related",List.of(Map.of("userId",lawyer,"summary","仅向关联律师提供的合成摘要"))));}
    @SuppressWarnings("unchecked") List<Map<String,Object>> inbox(Long user){return (List<Map<String,Object>>)center.list(user,100,false).get("notifications");}
    @SuppressWarnings("unchecked") List<Map<String,Object>> clearances(Map<String,Object> record){return (List<Map<String,Object>>)record.get("clearances");}

    @Test void fourIdentitiesMustAcceptAndConfirmTheirOwnActionsAndReadingDoesNotApprove() {
        assertThrows(IllegalArgumentException.class,()->call(applicant,"workflowAppoint",Map.of("userId",committee)));
        var a=appoint();String aid=(String)a.get("id");
        assertEquals("PENDING",a.get("state"));assertEquals(1,inbox(committee).size());
        center.read(committee,(String)inbox(committee).get(0).get("id"),false);
        assertEquals("PENDING",appointments.findById(aid).orElseThrow().getState());
        assertThrows(IllegalArgumentException.class,()->call(admin,"workflowAppointmentDecision",Map.of("recordId",aid,"expectedVersion",a.get("version"),"decision","ACCEPTED")));
        assertThrows(IllegalArgumentException.class,()->call(applicant,"workflowSubmit",draft()));
        call(committee,"workflowAppointmentDecision",Map.of("recordId",aid,"expectedVersion",a.get("version"),"decision","ACCEPTED"));
        var record=call(applicant,"workflowSubmit",draft());String id=(String)record.get("id");
        assertEquals("PENDING_LAWYER_CLEARANCE",record.get("status"));assertEquals(1,inbox(lawyer).size());
        assertThrows(IllegalArgumentException.class,()->call(admin,"workflowClearance",Map.of("recordId",id,"decision","APPROVED","comment","冒名")));
        assertThrows(IllegalStateException.class,()->call(committee,"workflowReview",Map.of("recordId",id,"decision","APPROVED","comment","过早")));
        var lawyerView=call(lawyer,"workflowDetail",Map.of("recordId",id));assertFalse(lawyerView.containsKey("clientName"));assertEquals(1,clearances(lawyerView).size());
        assertEquals(Map.of("title","合成新案","clientName","合成甲方","counterpartyName","合成乙方"),lawyerView.get("consultationContext"));
        assertFalse(record.containsKey("consultationContext"),"Only an actual consultation recipient receives the dedicated context");
        assertThrows(IllegalArgumentException.class,()->call(admin,"workflowDetail",Map.of("recordId",id)));
        var response=call(lawyer,"workflowClearance",Map.of("recordId",id,"decision","APPROVED_WITH_WALL","comment","合成核查条件"));
        assertEquals("PENDING_COMMITTEE_REVIEW",response.get("status"));
        var done=call(committee,"workflowReview",Map.of("recordId",id,"decision","APPROVED","comment","已人工核查条件"));assertEquals("APPROVED",done.get("status"));
        assertEquals("APPROVED",call(committee,"workflowReview",Map.of("recordId",id,"decision","APPROVED","comment","已人工核查条件")).get("status"));
        assertEquals(2,inbox(applicant).size());assertTrue(inbox(applicant).stream().allMatch(n->"done".equals(n.get("actionState"))));
    }

    @Test void crossFirmAndRevokedCommitteeCannotReadOrActAndNamesDoNotConferIdentity() {
        accept();var payload=draft();payload.put("leadId",outsider);
        assertThrows(IllegalArgumentException.class,()->call(applicant,"workflowSubmit",payload));
        var record=call(applicant,"workflowSubmit",draft());String id=(String)record.get("id");
        assertThrows(IllegalArgumentException.class,()->call(outsider,"workflowDetail",Map.of("recordId",id)));
        assertThrows(IllegalArgumentException.class,()->call(applicant,"workflowAppoint",Map.of("userId",outsider)));
        var forged=draft();forged.remove("leadId");forged.put("leadLawyerName","合成管理员");
        assertThrows(IllegalArgumentException.class,()->call(applicant,"workflowSubmit",forged));
        call(lawyer,"workflowClearance",Map.of("recordId",id,"decision","APPROVED","comment","确认"));
        call(admin,"workflowAppoint",Map.of("userId",committee,"decision","REVOKE"));
        assertThrows(IllegalArgumentException.class,()->call(committee,"workflowReview",Map.of("recordId",id,"decision","APPROVED","comment","撤权后操作")));
        assertTrue(inbox(committee).stream().noneMatch(n->"COMMITTEE_REVIEW".equals(n.get("kind"))));
        membership.put("account-"+lawyer,new OrgMembership("new-team","other-firm",false));
        assertTrue(inbox(lawyer).isEmpty());assertThrows(IllegalArgumentException.class,()->call(lawyer,"workflowDetail",Map.of("recordId",id)));
    }

    @Test void oldAppointmentLinkShowsRevokedRecordAndCannotAcceptIt() {
        var appointment=appoint();String id=(String)appointment.get("id");
        String oldNotice=(String)inbox(committee).get(0).get("id");
        call(admin,"workflowAppoint",Map.of("userId",committee,"decision","REVOKE"));
        assertEquals("REVOKED",appointments.findById(id).orElseThrow().getState());
        assertEquals("cancelled",inbox(committee).stream().filter(n->oldNotice.equals(n.get("id"))).findFirst().orElseThrow().get("actionState"));
        assertThrows(IllegalStateException.class,()->call(committee,"workflowAppointmentDecision",Map.of("recordId",id,"expectedVersion",appointment.get("version"),"decision","ACCEPTED")));
    }
    @Test void accessPolicyPropagatesDirectoryAndUnexpectedOutagesButDeniesActualRevocation() {
        String event="workflow/"+UUID.randomUUID()+"/committee";
        when(directory.configured()).thenReturn(false);
        assertThrows(DirectoryUnavailableException.class,()->accessPolicy.canAccess(committee,event));
        when(directory.configured()).thenReturn(true);
        membership.put("account-"+committee,OrgMembership.NONE);
        assertFalse(accessPolicy.canAccess(committee,event));
        doThrow(new DirectoryUnavailableException("合成目录故障")).when(directory).lookupByAccountId(anyString(),anyString());
        assertThrows(DirectoryUnavailableException.class,()->accessPolicy.canAccess(committee,event));
        doThrow(new IllegalStateException("合成未知服务故障")).when(directory).lookupByAccountId(anyString(),anyString());
        assertThrows(IllegalStateException.class,()->accessPolicy.canAccess(committee,event));
    }

    @Test void revokedAndReissuedAppointmentRejectsOldVersionWhileExactSuccessfulRetryIsIdempotent() {
        var original=appoint();String id=(String)original.get("id");
        var oldRequest=Map.<String,Object>of("recordId",id,"expectedVersion",original.get("version"),"decision","ACCEPTED");
        assertThrows(IllegalArgumentException.class,()->call(committee,"workflowAppointmentDecision",Map.of("recordId",id,"decision","ACCEPTED")));
        call(admin,"workflowAppoint",Map.of("userId",committee,"decision","REVOKE"));
        var reissued=appoint();assertEquals(id,reissued.get("id"));
        assertThrows(IllegalStateException.class,()->call(committee,"workflowAppointmentDecision",oldRequest));
        assertEquals("PENDING",appointments.findById(id).orElseThrow().getState());
        var currentRequest=Map.<String,Object>of("recordId",id,"expectedVersion",reissued.get("version"),"decision","ACCEPTED");
        var accepted=call(committee,"workflowAppointmentDecision",currentRequest);
        assertEquals("ACCEPTED",accepted.get("state"));
        assertEquals(accepted,call(committee,"workflowAppointmentDecision",currentRequest));
        assertThrows(IllegalStateException.class,()->call(committee,"workflowAppointmentDecision",oldRequest));
        assertEquals(1,inbox(admin).stream().filter(n->"COMMITTEE_RECEIPT".equals(n.get("kind"))).count());
    }

    @Test void failedMessagePublicationRollsBackWorkflowAndClearance() {
        accept();var payload=draft();String id=(String)payload.get("requestId");
        doThrow(new IllegalStateException("合成消息存储故障")).when(center).publishAuthorizedBusiness(eq("lawfirm"),anyString(),eq(applicant),anyList(),isNull(),anyString(),anyString(),anyString(),anyString(),anyString(),anyMap());
        assertThrows(IllegalStateException.class,()->call(applicant,"workflowSubmit",payload));
        assertFalse(records.existsById(id));assertTrue(inbox(lawyer).isEmpty());
    }

    @Test void duplicateConcurrentSubmitClearanceAndReviewDeliverOnlyOnce() throws Exception {
        accept();var p=draft();List<Map<String,Object>> submitted=parallel(()->call(applicant,"workflowSubmit",p));
        assertEquals(submitted.get(0).get("id"),submitted.get(1).get("id"));String id=(String)submitted.get(0).get("id");
        assertEquals(1,records.findByFirmIdOrderByCreatedAtDesc(firm).size());assertEquals(1,inbox(lawyer).size());
        parallel(()->call(lawyer,"workflowClearance",Map.of("recordId",id,"decision","APPROVED","comment","同一确认")));
        parallel(()->call(committee,"workflowReview",Map.of("recordId",id,"decision","APPROVED","comment","同一终审")));
        assertEquals("APPROVED",records.findById(id).orElseThrow().getStatus());assertEquals(2,inbox(applicant).size());
        p.put("title","变更后的另一个申请");assertThrows(IllegalArgumentException.class,()->call(applicant,"workflowSubmit",p));
    }
    @Test void automaticScanUsesOnlyExplicitSameFirmWorkflowAndPersonalSummaries() {
        accept();var first=draft();first.put("related",List.of());first.put("leadId",lawyer);
        first.put("title","仅原承办律师可见的合成旧案名称");
        call(lawyer,"workflowSubmit",first);
        var next=draft();next.put("related",List.of());next.put("clientName","合成乙方");next.put("counterpartyName","合成甲方");
        var result=call(applicant,"workflowSubmit",next);
        assertEquals("PENDING_LAWYER_CLEARANCE",result.get("status"));assertEquals(lawyer,clearances(result).get(0).get("targetId"));
        assertFalse(clearances(result).get(0).get("summary").toString().contains(first.get("title").toString()));
        assertFalse(clearances(result).get(0).get("summary").toString().contains("合成甲方"));
        var committeeView=call(committee,"workflowDetail",Map.of("recordId",result.get("id")));
        assertFalse(clearances(committeeView).get(0).get("summary").toString().contains(first.get("title").toString()));
        var personal=call(lawyer,"workflowDetail",Map.of("recordId",result.get("id")));
        assertEquals(Map.of("title","合成新案","clientName","合成乙方","counterpartyName","合成甲方"),personal.get("consultationContext"));
        assertTrue(clearances(personal).get(0).get("summary").toString().contains(first.get("title").toString()));
        assertTrue(clearances(personal).get(0).get("summary").toString().contains("命中主体"));
        var nextFirm=draft();nextFirm.put("leadId",outsider);
        assertThrows(IllegalArgumentException.class,()->call(applicant,"workflowSubmit",nextFirm));
    }
    @Test void firstScopeCreationAndDifferentApplicantsAndCommitteesSerializeConflictScanning() throws Exception {
        accept();var secondAppointment=call(admin,"workflowAppoint",Map.of("userId",admin));
        call(admin,"workflowAppointmentDecision",Map.of("recordId",secondAppointment.get("id"),"expectedVersion",secondAppointment.get("version"),"decision","ACCEPTED"));
        var first=draft();first.put("related",List.of());
        var second=draft();second.put("related",List.of());second.put("leadId",lawyer);second.put("committeeId",admin);second.put("clientName","合成乙方");second.put("counterpartyName","合成甲方");
        CountDownLatch firstLookups=new CountDownLatch(2);
        java.util.concurrent.atomic.AtomicInteger calls=new java.util.concurrent.atomic.AtomicInteger();
        doAnswer(invocation->{
            Object found=scopes.findById(firm).isPresent();
            if(calls.incrementAndGet()<=2){assertEquals(false,found);firstLookups.countDown();assertTrue(firstLookups.await(10,TimeUnit.SECONDS));}
            return found;
        }).when(scopes).existsById(firm);
        ExecutorService pool=Executors.newFixedThreadPool(2);
        try {
            var a=pool.submit(()->call(applicant,"workflowSubmit",first));var b=pool.submit(()->call(lawyer,"workflowSubmit",second));
            var results=List.of(a.get(30,TimeUnit.SECONDS),b.get(30,TimeUnit.SECONDS));
            assertEquals(2,records.findByFirmIdOrderByCreatedAtDesc(firm).size());
            assertTrue(scopes.findById(firm).isPresent());
            assertEquals(1,results.stream().filter(r->"PENDING_LAWYER_CLEARANCE".equals(r.get("status"))).count());
        } finally {pool.shutdownNow();}
    }
    private List<Map<String,Object>> parallel(Callable<Map<String,Object>> task)throws Exception {
        ExecutorService pool=Executors.newFixedThreadPool(2);CountDownLatch gate=new CountDownLatch(1);
        try {Callable<Map<String,Object>> start=()->{gate.await();return task.call();};var a=pool.submit(start);var b=pool.submit(start);gate.countDown();return List.of(a.get(30,TimeUnit.SECONDS),b.get(30,TimeUnit.SECONDS));}
        finally{pool.shutdownNow();}
    }
}
