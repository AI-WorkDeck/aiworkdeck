// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.im;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.service.ai.*;
import com.checkba.service.ai.memory.document.*;
import com.checkba.service.file.ProjectFileTextExtractor;
import dev.langchain4j.data.message.*;
import dev.langchain4j.model.chat.ChatLanguageModel;
import dev.langchain4j.model.output.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.*;
import org.springframework.transaction.annotation.*;

import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** Real H2 persistence and IM authorization; only model/remote scope responses are synthetic. */
@DataJpaTest(showSql=false)
@AutoConfigureTestDatabase(replace=AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties={
 "spring.datasource.url=jdbc:h2:mem:im-agent-test;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
 "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
 "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect", "spring.jpa.hibernate.ddl-auto=create-drop"
})
@Import(ImService.class)
@Transactional(propagation=Propagation.NOT_SUPPORTED)
class ImAgentServiceTest {
    @Autowired ImService im;
    @Autowired ImConversationRepository conversations;
    @Autowired ImMemberRepository members;
    @Autowired ImMessageRepository messages;
    @Autowired ImAttachmentRepository attachments;
    @Autowired ImAgentTurnRepository turns;
    @Autowired UserRepository users;
    @Autowired ProjectRepository projectRepository;
    com.checkba.service.ProjectMemberService projectPermissions;
    Set<String> projectAccess;
    @Autowired PlatformTransactionManager transactions;
    MemoryOrganizationGateway memory;
    ChatModelFactory models;
    TokenUsageService usage;
    ChatLanguageModel model;
    ImAgentService agent;
    Deque<Runnable> jobs;
    Map<Long,List<MemorySpaceView>> allowed;
    AtomicReference<String> prompt;
    Long owner,colleague,client,stranger;
    String project,team;

    @BeforeEach void setup() {
        owner=user("负责人");colleague=user("同事");client=user("客户");stranger=user("局外人");
        project=UUID.randomUUID().toString();team="team:"+UUID.randomUUID();
        memory=mock(MemoryOrganizationGateway.class);models=mock(ChatModelFactory.class);usage=mock(TokenUsageService.class);model=mock(ChatLanguageModel.class);
        jobs=new java.util.concurrent.ConcurrentLinkedDeque<>();allowed=new HashMap<>();prompt=new AtomicReference<>();
        when(memory.listSpaces(anyLong())).thenAnswer(call -> allowed.getOrDefault(call.getArgument(0),List.of()));
        when(models.getPlatformChatModel(any(Duration.class),eq(1800))).thenReturn(new ChatModelFactory.PlatformChatModel(model,"synthetic-model"));
        when(model.generate(any(ChatMessage[].class))).thenAnswer(call -> {
            assertEquals(owner,PlatformAiUserScope.current());
            assertFalse(org.springframework.transaction.support.TransactionSynchronizationManager.isActualTransactionActive(), "model call must not hold a DB transaction");
            prompt.set(Arrays.toString(call.getArguments()));
            return Response.from(AiMessage.from("已经根据本群材料整理。"),new dev.langchain4j.model.output.TokenUsage(30,10));
        });
        agent=new ImAgentService(conversations,members,messages,attachments,turns,users,memory,models,usage,transactions,
                new ProjectFileTextExtractor(null,null,null,null,null),jobs::add);
        ReflectionTestUtils.setField(im,"agents",agent);
        projectPermissions=mock(com.checkba.service.ProjectMemberService.class); projectAccess=new HashSet<>();
        when(projectPermissions.hasReadPermission(anyLong(),anyLong())).thenAnswer(call -> projectAccess.contains(call.getArgument(0)+":"+call.getArgument(1)));
        ReflectionTestUtils.setField(im,"projectPermissions",projectPermissions);
        ReflectionTestUtils.setField(agent,"projectPermissions",projectPermissions);
    }

    Long user(String name) {
        User user=new User();user.setUsername("im-agent-"+UUID.randomUUID());user.setPassword("synthetic-password");
        user.setDisplayName(name);user.setRole("USER");user.setSubscriptionType("FREE");
        user.setCreatedAt(LocalDateTime.now());user.setUpdatedAt(LocalDateTime.now());return users.saveAndFlush(user).getId();
    }
    @SuppressWarnings("unchecked") Map<String,Object> call(Long user,String action,Map<String,Object> params) {return (Map<String,Object>)im.execute(user,action,params);}
    Map<String,Object> ensure(Long user,String scope,String key,boolean privateChat) {return call(user,"ensureAgent",Map.of("scope",scope,"scopeKey",key,"title","合成项目沟通","private",privateChat));}
    String group() {return (String)ensure(owner,"project",project,false).get("id");}
    String invite(String id,String role) {return (String)call(owner,"invite",Map.of("conversationId",id,"role",role)).get("code");}
    void join(Long user,String id,String role) {call(user,"join",Map.of("code",invite(id,role)));}
    long send(Long user,String id,String text) {return ((Number)call(user,"send",Map.of("conversationId",id,"clientMessageId",UUID.randomUUID().toString(),"text",text)).get("id")).longValue();}
    Map<String,Object> reply(Long user,String id,long source) {return call(user,"agentReply",Map.of("conversationId",id,"messageId",source));}
    @SuppressWarnings("unchecked") List<Map<String,Object>> history(Long user,String id) {return (List<Map<String,Object>>)call(user,"messages",Map.of("conversationId",id)).get("messages");}
    void grant(Long user,String scope,String key) {allowed.put(user,List.of(new MemorySpaceView(key,scope,"合成团队",true,true,true,null)));}
    String file(String id,String name,String text,boolean visible) {
        Map<String,Object> uploaded=call(owner,"upload",Map.of("conversationId",id,"name",name,"base64",Base64.getEncoder().encodeToString(text.getBytes(StandardCharsets.UTF_8))));
        String aid=(String)uploaded.get("id");
        if(visible)call(owner,"fileAccess",Map.of("conversationId",id,"attachmentId",aid,"clientVisible",true));
        call(owner,"send",Map.of("conversationId",id,"clientMessageId",UUID.randomUUID().toString(),"attachmentId",aid));return aid;
    }

    Long boundProject() {
        Project p=new Project(); p.setName("真实权限项目"); p.setProjectType("TEST"); p.setListedCompanyName("合成公司"); p.setTargetCompanyName("合成标的"); p.setUserId(owner);
        Long id=projectRepository.saveAndFlush(p).getId(); projectAccess.add(id+":"+owner); projectAccess.add(id+":"+client);
        when(projectPermissions.isClient(id,client)).thenReturn(true); return id;
    }
    String bindPrivate(Long projectId) {
        String id=(String)ensure(owner,"project",project,true).get("id");
        var bound=call(owner,"ensureAgent",Map.of("scope","project","scopeKey",project,"title","绑定私聊","private",true,"projectId",projectId));
        assertEquals(id,bound.get("id")); assertEquals(projectId,bound.get("projectId"));
        assertNull(conversations.findById(id).orElseThrow().getProjectId());
        assertEquals(projectId,conversations.findById(id).orElseThrow().getAgentProjectId()); return id;
    }

    @Test void realProjectGroupIncludesAssistantAndClientsCanOnlyReadSharedReplies() {
        Long projectId=boundProject(); String id=(String)call(owner,"projectGroup",Map.of("projectId",projectId)).get("id");
        assertEquals(id,ensure(owner,"project","project:"+projectId,false).get("id"));
        var clientGroup=call(client,"projectGroup",Map.of("projectId",projectId)); assertEquals(false,clientGroup.get("canRequestAgent"));
        assertEquals("project:"+projectId,((Map<?,?>)clientGroup.get("agent")).get("scopeKey"));
        file(id,"内部草案.txt","不可外发的内部材料",false); file(id,"共同材料.txt","共同可见的资料",true);
        long clientMessage=send(client,id,"客户的真人消息"); assertThrows(IllegalArgumentException.class,()->reply(client,id,clientMessage));
        long source=send(owner,id,"请分析共同材料"); reply(owner,id,source); jobs.remove().run();
        assertTrue(prompt.get().contains("共同可见的资料")); assertFalse(prompt.get().contains("不可外发的内部材料"));
        assertEquals("AGENT",history(client,id).get(history(client,id).size()-1).get("actorType"));
    }

    @Test void revokedBoundProjectBeforeGenerationNeverCallsModel() {
        Long projectId=boundProject(); String id=(String)call(owner,"projectGroup",Map.of("projectId",projectId)).get("id");
        long source=send(owner,id,"权限可撤销"); reply(owner,id,source); projectAccess.remove(projectId+":"+owner); jobs.remove().run();
        assertEquals("failed",turns.findById(source).orElseThrow().getStatus()); verify(models,never()).getPlatformChatModel(any(),anyInt());
    }

    @Test void oldPrivateChatCanBindOnceAndRevocationBeforeGenerationBlocksModelAndEveryAction() {
        Long projectId=boundProject(); String id=bindPrivate(projectId); long source=send(owner,id,"私有资料问题");
        call(owner,"agentReply",Map.of("conversationId",id,"messageId",source,"projectContext","仅本人的授权资料"));
        projectAccess.remove(projectId+":"+owner); jobs.remove().run();
        assertEquals("failed",turns.findById(source).orElseThrow().getStatus()); verify(models,never()).getPlatformChatModel(any(),anyInt());
        assertThrows(IllegalArgumentException.class,()->history(owner,id));
        assertThrows(IllegalArgumentException.class,()->ensure(owner,"project",project,true));
    }

    @Test void boundPrivateRevocationDuringGenerationPreventsDeliveryAndCannotRebind() {
        Long projectId=boundProject(); String id=bindPrivate(projectId); Long other=boundProject();
        assertThrows(IllegalArgumentException.class,()->call(owner,"ensureAgent",Map.of("scope","project","scopeKey",project,"title","改绑","private",true,"projectId",other)));
        assertEquals(projectId,conversations.findById(id).orElseThrow().getAgentProjectId());
        when(model.generate(any(ChatMessage[].class))).thenAnswer(call -> {projectAccess.remove(projectId+":"+owner);return Response.from(AiMessage.from("不得送达"));});
        long source=send(owner,id,"私聊问题"); reply(owner,id,source); jobs.remove().run();
        assertEquals("failed",turns.findById(source).orElseThrow().getStatus());
        assertEquals(1,messages.findByConversationIdAndIdGreaterThanOrderByIdAsc(id,0,org.springframework.data.domain.PageRequest.of(0,100)).getTotalElements());
    }

    @Test void boundPrivateDowngradeWhileQueuedNeverCallsModel() {
        Long projectId=boundProject(); String id=bindPrivate(projectId); long source=send(owner,id,"私有资料问题");
        call(owner,"agentReply",Map.of("conversationId",id,"messageId",source,"projectContext","排队前的内部材料"));
        when(projectPermissions.isClient(projectId,owner)).thenReturn(true); jobs.remove().run();
        assertEquals("failed",turns.findById(source).orElseThrow().getStatus()); verify(models,never()).getPlatformChatModel(any(),anyInt());
        assertEquals(false,call(owner,"agentInfo",Map.of("conversationId",id)).get("canRequestAgent"));
        assertThrows(IllegalArgumentException.class,()->reply(owner,id,source));
    }

    @Test void boundPrivateDowngradeDuringGenerationNeverDeliversReply() {
        Long projectId=boundProject(); String id=bindPrivate(projectId);
        when(model.generate(any(ChatMessage[].class))).thenAnswer(call -> {
            when(projectPermissions.isClient(projectId,owner)).thenReturn(true);
            return Response.from(AiMessage.from("不得向降权后的用户交付"));
        });
        long source=send(owner,id,"私有资料问题"); reply(owner,id,source); jobs.remove().run();
        assertEquals("failed",turns.findById(source).orElseThrow().getStatus());
        assertEquals(1,history(owner,id).size());
    }

    @Test void projectGroupIsUniqueAndKnowingUuidDoesNotGrantMembership() {
        String id=group();assertEquals(id,ensure(owner,"project",project,false).get("id"));
        assertThrows(IllegalArgumentException.class,()->ensure(stranger,"project",project,false));
        assertThrows(IllegalArgumentException.class,()->call(stranger,"agentInfo",Map.of("conversationId",id)));
        join(colleague,id,"MEMBER");assertEquals(id,ensure(colleague,"project",project,false).get("id"));
        var directory=call(owner,"members",Map.of("conversationId",id));assertEquals(2,directory.get("humanCount"));
        assertEquals(3,((List<?>)directory.get("members")).size());assertFalse(users.existsById(0L));
        assertEquals(2,members.countByConversationId(id));
    }

    @Test void ownerCannotOrphanTheFixedProjectAgentOrPrivateAgent() {
        String id=group();assertThrows(IllegalArgumentException.class,()->call(owner,"leave",Map.of("conversationId",id)));
        assertEquals(id,ensure(owner,"project",project,false).get("id"));
        String privateId=(String)ensure(owner,"project",project,true).get("id");
        assertThrows(IllegalArgumentException.class,()->call(owner,"leave",Map.of("conversationId",privateId)));
        assertEquals(privateId,ensure(owner,"project",project,true).get("id"));
        join(colleague,id,"MEMBER");call(colleague,"leave",Map.of("conversationId",id));
        assertThrows(IllegalArgumentException.class,()->ensure(colleague,"project",project,false));
    }

    @Test void privateConversationsHaveSeparateHistoriesAndCannotInviteOtherPeople() {
        String shared=group();String a=(String)ensure(owner,"project",project,true).get("id");String b=(String)ensure(colleague,"project",project,true).get("id");
        assertNotEquals(shared,a);assertNotEquals(a,b);assertEquals("AGENT_DIRECT",ensure(owner,"project",project,true).get("type"));
        send(owner,a,"仅我与助手的讨论");assertTrue(history(owner,shared).isEmpty());assertTrue(history(colleague,b).isEmpty());
        assertThrows(IllegalArgumentException.class,()->history(colleague,a));assertThrows(IllegalArgumentException.class,()->invite(a,"MEMBER"));
        long source=send(owner,a,"读取我提供的项目材料");call(owner,"agentReply",Map.of("conversationId",a,"messageId",source,"projectContext","私聊项目资料"));jobs.remove().run();
        assertTrue(prompt.get().contains("私聊项目资料"));
    }

    @Test void sharedReplyHasAiIdentityIsIdempotentAndUsesOnlySharedAttachments() {
        String id=group();join(client,id,"CLIENT");
        file(id,"内部草稿.txt","内部绝密正文",false);file(id,"已开放文件.txt","群公开附件正文",true);
        long source=send(owner,id,"请总结现有讨论");
        var accepted=call(owner,"agentReply",Map.of("conversationId",id,"messageId",source,"projectContext","禁止进入群的个人材料"));
        assertEquals("queued",accepted.get("status"));assertEquals("queued",reply(owner,id,source).get("status"));assertEquals(1,jobs.size());
        jobs.remove().run();assertEquals("completed",reply(owner,id,source).get("status"));assertTrue(jobs.isEmpty());
        assertTrue(prompt.get().contains("群公开附件正文"));assertFalse(prompt.get().contains("内部草稿"));assertFalse(prompt.get().contains("内部绝密正文"));assertFalse(prompt.get().contains("禁止进入群的个人材料"));
        var rows=history(client,id);var last=rows.get(rows.size()-1);assertEquals("AGENT",last.get("actorType"));assertEquals(0L,last.get("senderId"));assertEquals("项目助手",last.get("agentName"));
        verify(model,times(1)).generate(any(ChatMessage[].class));verify(usage).recordPlatformUsage(isNull(),eq(owner),eq("synthetic-model"),any(),eq(id));assertNull(PlatformAiUserScope.current());
    }

    @Test void internalAttachmentsAreExcludedEvenBeforeAnyClientHasJoined() {
        String id=group();file(id,"内部姓名.txt","不能进入永久群回复",false);long source=send(owner,id,"总结");reply(owner,id,source);jobs.remove().run();
        assertFalse(prompt.get().contains("内部姓名"));assertFalse(prompt.get().contains("不能进入永久群回复"));
    }

    @Test void teamScopeComesFromAuthorityAndRevocationImmediatelyBlocksAllActions() {
        assertTrue(((List<?>)call(owner,"agentScopes",Map.of()).get("agents")).isEmpty());
        assertThrows(IllegalArgumentException.class,()->ensure(owner,"team",team,false));
        grant(owner,"team",team);grant(colleague,"team",team);
        String id=(String)ensure(owner,"team",team,false).get("id");assertEquals(id,ensure(colleague,"team",team,false).get("id"));
        assertThrows(IllegalArgumentException.class,()->ensure(owner,"firm",team,false));
        assertThrows(IllegalArgumentException.class,()->invite(id,"MEMBER"));
        allowed.remove(colleague);assertThrows(IllegalArgumentException.class,()->history(colleague,id));
        assertTrue(((List<?>)call(colleague,"list",Map.of()).get("conversations")).isEmpty());
    }

    @Test void teamAgentReadsOnlyItsScopeAndRechecksMembershipAfterModelReturns() {
        grant(owner,"team",team);String id=(String)ensure(owner,"team",team,false).get("id");
        when(memory.read(owner,team,MemoryDocumentService.INDEX_PATH)).thenReturn(new MemoryFileView("remember.md","团队","本团队共享约定",1,null,false));
        when(model.generate(any(ChatMessage[].class))).thenAnswer(call -> {prompt.set(Arrays.toString(call.getArguments()));allowed.remove(owner);return Response.from(AiMessage.from("不应送达"));});
        long source=send(owner,id,"本团队怎么协作");reply(owner,id,source);jobs.remove().run();
        assertEquals("failed",turns.findById(source).orElseThrow().getStatus());assertTrue(prompt.get().contains("本团队共享约定"));
        assertEquals(1,messages.findByConversationIdAndIdGreaterThanOrderByIdAsc(id,0,org.springframework.data.domain.PageRequest.of(0,100)).getTotalElements());
        verify(memory).read(owner,team,MemoryDocumentService.INDEX_PATH);
    }

    @Test void removingRequesterDuringModelCallPreventsDelivery() {
        String id=group();join(colleague,id,"MEMBER");long source=send(colleague,id,"问题");
        when(model.generate(any(ChatMessage[].class))).thenAnswer(call -> {im.execute(owner,"removeMember",Map.of("conversationId",id,"userId",colleague));return Response.from(AiMessage.from("不应送达"));});
        reply(colleague,id,source);jobs.remove().run();assertEquals("failed",turns.findById(source).orElseThrow().getStatus());assertEquals(1,history(owner,id).size());
    }

    @Test void attachmentAccessChangeDuringModelCallPreventsDelivery() {
        String id=group();String aid=file(id,"公开.txt","可撤销材料",true);long source=send(owner,id,"分析附件");
        when(model.generate(any(ChatMessage[].class))).thenAnswer(call -> {im.execute(owner,"fileAccess",Map.of("conversationId",id,"attachmentId",aid,"clientVisible",false));return Response.from(AiMessage.from("不应送达"));});
        reply(owner,id,source);jobs.remove().run();assertEquals("failed",turns.findById(source).orElseThrow().getStatus());assertEquals(2,history(owner,id).size());
    }

    @Test void failureCanRetrySameMessageAndRestartDoesNotLeaveRunningForever() {
        String id=group();long source=send(owner,id,"问题");
        when(model.generate(any(ChatMessage[].class))).thenThrow(new IllegalStateException("synthetic model error"));reply(owner,id,source);jobs.remove().run();assertEquals("failed",turns.findById(source).orElseThrow().getStatus());
        when(model.generate(any(ChatMessage[].class))).thenReturn(Response.from(AiMessage.from("已恢复")));reply(owner,id,source);jobs.remove().run();assertEquals("completed",turns.findById(source).orElseThrow().getStatus());assertEquals(2,history(owner,id).size());
        long pending=send(owner,id,"下一问");reply(owner,id,pending);agent.recoverInterrupted();assertEquals("failed",turns.findById(pending).orElseThrow().getStatus());jobs.remove().run();assertEquals(3,history(owner,id).size());
    }

    @Test void simultaneousRequestsInDifferentConversationsAdmitOnlyOneForTheSameUser() throws Exception {
        String a=group(),b=(String)ensure(owner,"project",UUID.randomUUID().toString(),false).get("id");
        long first=send(owner,a,"第一处问题"),second=send(owner,b,"第二处问题");
        var workers=java.util.concurrent.Executors.newFixedThreadPool(2);
        var start=new java.util.concurrent.CountDownLatch(1);
        try {
            var one=workers.submit(()->{start.await();try {reply(owner,a,first);return true;}catch(IllegalArgumentException busy){return false;}});
            var two=workers.submit(()->{start.await();try {reply(owner,b,second);return true;}catch(IllegalArgumentException busy){return false;}});
            start.countDown();
            assertNotEquals(one.get(15,java.util.concurrent.TimeUnit.SECONDS),two.get(15,java.util.concurrent.TimeUnit.SECONDS));
            assertEquals(1,jobs.size());
            assertEquals(1,java.util.stream.Stream.of(first,second).filter(turns::existsById).count());
            jobs.remove().run();verify(models,times(1)).getPlatformChatModel(any(Duration.class),eq(1800));
            verify(models,never()).getChatModel(any(),any(Duration.class),any());
        } finally {workers.shutdownNow();}
    }

    @Test void unavailablePlatformAccountFailsWithoutFallingBackToGeneralModel() {
        String id=group();long source=send(owner,id,"问题");
        when(models.getPlatformChatModel(any(Duration.class),eq(1800))).thenThrow(new com.checkba.service.account.AccountException(
                com.checkba.service.account.AccountException.Kind.CONFLICT,"synthetic unavailable account"));
        reply(owner,id,source);jobs.remove().run();
        var turn=turns.findById(source).orElseThrow();assertEquals("failed",turn.getStatus());assertTrue(turn.getError().contains("额度"));
        assertEquals(1,history(owner,id).size());verifyNoInteractions(model,usage);
        verify(models,never()).getChatModel(any(),any(Duration.class),any());
    }

    @Test void sourceMessageOwnershipAndConversationAreBothRequiredAndLegacyHumanRowsStillRender() {
        String id=group();join(colleague,id,"MEMBER");long source=send(owner,id,"旧消息");
        ImMessage old=messages.findById(source).orElseThrow();old.setActorType(null);messages.saveAndFlush(old);
        assertEquals("HUMAN",history(owner,id).get(0).get("actorType"));
        assertThrows(IllegalArgumentException.class,()->reply(colleague,id,source));
        String another=(String)ensure(owner,"project",UUID.randomUUID().toString(),false).get("id");assertThrows(IllegalArgumentException.class,()->reply(owner,another,source));assertTrue(jobs.isEmpty());
    }
}
