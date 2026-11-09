// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import com.checkba.service.ai.*;
import com.checkba.service.AppLanguageScope;
import com.checkba.service.ai.tools.ToolContext;
import dev.langchain4j.agent.tool.ToolExecutionRequest;
import dev.langchain4j.agent.tool.ToolSpecification;
import com.checkba.service.file.ProjectFileTextExtractor;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import dev.langchain4j.data.message.*;
import dev.langchain4j.model.chat.ChatLanguageModel;
import dev.langchain4j.model.openai.OpenAiChatModel;
import dev.langchain4j.model.output.Response;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.*;
import java.io.ByteArrayInputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** H2 persistence, real source bytes and actual OpenAI HTTP tool protocol; remote model answers are synthetic. */
@DataJpaTest(showSql=false)
@AutoConfigureTestDatabase(replace=AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties={"spring.datasource.url=jdbc:h2:mem:mobile-assistant;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
 "spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa","spring.datasource.password=",
 "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect","spring.jpa.hibernate.ddl-auto=create-drop"})
@Transactional(propagation=Propagation.NOT_SUPPORTED)
class MobileAssistantServiceTest {
    @Autowired MobileAssistantDesktopCopyRepository desktopCopies;
    @Autowired MobileAssistantConsentRepository consents;
    @Autowired MobileProjectSummaryRepository summaries;
    @Autowired MobileAssistantTurnRepository turns;
    @Autowired MobileProjectDirRepository directories;
    @Autowired MobileFileBackupRepository backups;
    @Autowired UserRepository users;
    @Autowired PlatformTransactionManager transactions;
    @Autowired ProjectRepository projects;
    @Autowired ProjectAiMessageRepository projectMessages;
    @Autowired UserActivityLogRepository activityLogs;
    @Autowired UserFeedbackRepository feedback;
    @Autowired jakarta.persistence.EntityManagerFactory entityManagerFactory;
    MobileBackupService backup;
    CloudStorageQuotaService quota;
    ProjectFileTextExtractor extractor;
    ChatModelFactory models;
    TokenUsageService usage;
    ToolRegistry tools;
    ChatLanguageModel model;
    MobileAssistantService service;
    Long user,other;
    String device;
    final String key="17";
    String now;

    @BeforeEach void setup() {
        user=newUser();other=newUser();device=UUID.randomUUID().toString();now=Instant.now().toString();
        backup=mock(MobileBackupService.class);quota=mock(CloudStorageQuotaService.class);models=mock(ChatModelFactory.class);
        usage=mock(TokenUsageService.class);tools=mock(ToolRegistry.class);model=mock(ChatLanguageModel.class);
        extractor=new ProjectFileTextExtractor(null,null,null,null,null);
        when(quota.subscriptionQuota(anyLong())).thenReturn(CloudStorageQuotaService.PRO_BYTES);when(quota.canRead(anyLong())).thenReturn(true);when(quota.canWrite(anyLong())).thenReturn(true);when(quota.canUse(anyLong())).thenReturn(true);
        when(backup.enabled(anyLong())).thenReturn(true);
        when(models.getPlatformChatModel(any(),any())).thenAnswer(call -> {
            assertEquals(user,PlatformAiUserScope.current());
            assertFalse(org.springframework.transaction.support.TransactionSynchronizationManager.isActualTransactionActive());
            return new ChatModelFactory.PlatformChatModel(model,"synthetic-model");
        });
        when(model.generate(any(ChatMessage[].class))).thenReturn(Response.from(AiMessage.from("合成摘要：甲方为原告，需于周五提交材料。来源：证据.txt；仅覆盖已读材料。")));
        when(model.generate(anyList(),anyList())).thenReturn(Response.from(AiMessage.from("基于已核对的资料回答。")));
        when(model.generate(anyList())).thenReturn(Response.from(AiMessage.from("基于已核对的资料回答。")));
        var safety=new MobileAssistantContentSafetyService(new com.checkba.service.UserActivityLogService(activityLogs,projects),feedback);
        service=new MobileAssistantService(consents,summaries,turns,directories,backup,quota,extractor,models,tools,usage,users,transactions,desktopCopies,safety);
        var dir=new MobileProjectDir();dir.setUserId(user);dir.setDeviceId(device);dir.setProjectKey(key);dir.setName("合成案卷");dir.setUpdatedAt(LocalDateTime.now());directories.saveAndFlush(dir);
    }
    Long newUser() {
        var row=new User();row.setUsername("mobile-agent-"+UUID.randomUUID());row.setPassword("synthetic");row.setDisplayName("合成测试用户");row.setRole("USER");
        row.setSubscriptionType("FREE");row.setFileCloudBackupEnabled(true);row.setCreatedAt(LocalDateTime.now());row.setUpdatedAt(LocalDateTime.now());return users.saveAndFlush(row).getId();
    }
    void enable() {service.settings(user,true,MobileAssistantService.CONSENT_VERSION);}
    MobileAssistantService.Snapshot snapshot(String context) {return new MobileAssistantService.Snapshot(device,key,"untrusted title",now,context);}
    MobileAssistantService.ChatInput chat(String message) {return new MobileAssistantService.ChatInput(null,UUID.randomUUID().toString(),message);}
    List<UserActivityLog> auditRows() {return activityLogs.findTop500ByUserIdOrderByTimestampDesc(user);}
    MobileFileBackup source(String text) throws Exception {
        var row=new MobileFileBackup();row.setUserId(user);row.setDeviceId(device);row.setProjectKey(key);row.setFileId(UUID.randomUUID().toString());row.setUid(UUID.randomUUID().toString());
        row.setName("证据.txt");row.setPath("证据.txt");row.setSha256(HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8))));row.setSize((long)text.getBytes(StandardCharsets.UTF_8).length);row.setStoragePath("synthetic");row.setUpdatedAt(LocalDateTime.now());backups.saveAndFlush(row);
        when(backup.content(user,device,key,row.getUid())).thenAnswer(call -> new ProjectCatalogService.Content(new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)),row.getSize()));return row;
    }

    MobileAssistantDesktopCopyService desktopExporter() {
        return new MobileAssistantDesktopCopyService(desktopCopies,service,consents,directories,users,new com.fasterxml.jackson.databind.ObjectMapper());
    }
    MobileAssistantDesktopCopyService.Request desktopRequest() {
        var target=directories.findByUserIdAndDeviceId(user,device).get(0);
        target.setProjectUid(UUID.randomUUID().toString());target.setProjectType("BLANK");target.setOwned(true);directories.saveAndFlush(target);
        return new MobileAssistantDesktopCopyService.Request(UUID.randomUUID().toString(),target.getProjectUid(),device,key);
    }
    <T> T desktopTx(java.util.function.Supplier<T> body) {
        return new org.springframework.transaction.support.TransactionTemplate(transactions).execute(status->body.get());
    }
    @Test void desktopEnvelopeContainsCompleteHistoryAndIdentityBoundHashAndAckIsIdempotent() throws Exception {
        enable();String conversation=UUID.randomUUID().toString();
        for(int i=0;i<205;i++) persistCopyTurn(conversation,"completed",i);
        var request=desktopRequest();var exporter=desktopExporter();
        var receipt=desktopTx(()->exporter.create(user,conversation,request));
        assertEquals("QUEUED",receipt.status());assertEquals(410,receipt.messageCount());
        assertEquals(0,receipt.expiresAt().getNano()%1000);
        assertEquals(receipt,desktopTx(()->exporter.create(user,conversation,request)));
        var envelope=desktopTx(()->exporter.pending(user,device)).get(0);
        var json=new com.fasterxml.jackson.databind.ObjectMapper().readTree(envelope.snapshotJson());
        assertEquals(410,json.path("messages").size());assertEquals(request.targetProjectUid(),json.path("targetProjectUid").asText());
        assertEquals(receipt.conversationId(),json.path("conversationId").asText());
        assertEquals(envelope.sha256(),HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(envelope.snapshotJson().getBytes(StandardCharsets.UTF_8))));
        var ack=new MobileAssistantDesktopCopyService.Ack(device,request.targetProjectUid(),envelope.sha256(),"DELIVERED",null);
        var delivered=desktopTx(()->exporter.ack(user,request.requestId(),ack));
        assertEquals("DELIVERED",delivered.status());assertNotNull(delivered.deliveredAt());
        assertEquals(0,delivered.deliveredAt().getNano()%1000);
        assertEquals(delivered,desktopTx(()->exporter.ack(user,request.requestId(),ack)));
        assertTrue(desktopTx(()->exporter.pending(user,device)).isEmpty());
        assertNull(desktopCopies.findByUserIdAndRequestId(user,request.requestId()).orElseThrow().getSnapshotJson());
        assertEquals(205,turns.findByUserIdAndConversationIdOrderByCreatedAtAscIdAsc(user,conversation).size());
    }
    @Test void desktopRequestRejectsForeignUnknownLegacyAndTemporaryTargetsAndConflictingRetry() {
        enable();String conversation=UUID.randomUUID().toString();persistCopyTurn(conversation,"completed",0);
        var request=desktopRequest();var exporter=desktopExporter();
        assertThrows(IllegalArgumentException.class,()->desktopTx(()->exporter.create(other,conversation,request)));
        var target=directories.findByUserIdAndDeviceId(user,device).get(0);
        for(String type:Arrays.asList(null,"SCRATCH","LOOSE_FILES")) {
            target.setProjectType(type);directories.saveAndFlush(target);
            assertThrows(IllegalArgumentException.class,()->desktopTx(()->exporter.create(user,conversation,request)));
        }
        target.setProjectType("BLANK");target.setOwned(false);directories.saveAndFlush(target);
        assertThrows(IllegalArgumentException.class,()->desktopTx(()->exporter.create(user,conversation,request)));
        target.setOwned(true);directories.saveAndFlush(target);
        desktopTx(()->exporter.create(user,conversation,request));
        var changed=new MobileAssistantDesktopCopyService.Request(request.requestId(),UUID.randomUUID().toString(),device,key);
        assertThrows(IllegalArgumentException.class,()->desktopTx(()->exporter.create(user,conversation,changed)));
        assertThrows(IllegalArgumentException.class,()->desktopTx(()->exporter.get(other,request.requestId())));
    }
    @Test void desktopPendingRechecksFrozenSourcesWithoutIncludingLaterRunningTurns() {
        enable();String conversation=UUID.randomUUID().toString();var original=persistCopyTurn(conversation,"completed",0);
        var request=desktopRequest();var exporter=desktopExporter();desktopTx(()->exporter.create(user,conversation,request));
        persistCopyTurn(conversation,"running",1);
        assertEquals(2,desktopTx(()->exporter.pending(user,device)).get(0).messageCount());
        original.setSourcesJson("[{\"id\":\"999999\",\"updatedAt\":\"old\"}]");turns.saveAndFlush(original);
        assertTrue(desktopTx(()->exporter.pending(user,device)).isEmpty());
        assertEquals("SOURCE_UNAVAILABLE",desktopTx(()->exporter.get(user,request.requestId())).error());
    }
    @Test void desktopPendingCannotReviveAfterConsentRevocationOrSendExpiredSnapshot() {
        enable();String conversation=UUID.randomUUID().toString();persistCopyTurn(conversation,"completed",0);
        var request=desktopRequest();var exporter=desktopExporter();desktopTx(()->exporter.create(user,conversation,request));
        service.settings(user,false,MobileAssistantService.CONSENT_VERSION);
        assertNull(desktopCopies.findByUserIdAndRequestId(user,request.requestId()).orElseThrow().getSnapshotJson());
        enable();
        assertTrue(desktopTx(()->exporter.pending(user,device)).isEmpty());
        assertEquals("FAILED",desktopTx(()->exporter.get(user,request.requestId())).status());
        String second=UUID.randomUUID().toString();persistCopyTurn(second,"completed",0);var next=desktopRequest();
        desktopTx(()->exporter.create(user,second,next));
        var row=desktopCopies.findByUserIdAndRequestId(user,next.requestId()).orElseThrow();row.setExpiresAt(Instant.now().minusSeconds(1));desktopCopies.saveAndFlush(row);
        assertTrue(desktopTx(()->exporter.pending(user,device)).isEmpty());
        assertEquals("EXPIRED",desktopTx(()->exporter.get(user,next.requestId())).status());
    }
    @Test void desktopAckRequiresMatchingAccountDeviceIdentityAndHash() {
        enable();String conversation=UUID.randomUUID().toString();persistCopyTurn(conversation,"completed",0);
        var request=desktopRequest();var exporter=desktopExporter();desktopTx(()->exporter.create(user,conversation,request));
        var envelope=desktopTx(()->exporter.pending(user,device)).get(0);
        var wrong=new MobileAssistantDesktopCopyService.Ack("other-device",request.targetProjectUid(),envelope.sha256(),"DELIVERED",null);
        assertThrows(IllegalArgumentException.class,()->desktopTx(()->exporter.ack(user,request.requestId(),wrong)));
        var badHash=new MobileAssistantDesktopCopyService.Ack(device,request.targetProjectUid(),"bad","DELIVERED",null);
        assertThrows(IllegalArgumentException.class,()->desktopTx(()->exporter.ack(user,request.requestId(),badHash)));
        var rejected=new MobileAssistantDesktopCopyService.Ack(device,request.targetProjectUid(),envelope.sha256(),"FAILED","TARGET_NOT_OWNED");
        assertEquals("FAILED",desktopTx(()->exporter.ack(user,request.requestId(),rejected)).status());
        assertTrue(desktopTx(()->exporter.pending(user,device)).isEmpty());
    }
    @Test void desktopEnvelopeRollbackAndConcurrentRetriesDoNotProduceDuplicateCopies() throws Exception {
        enable();String conversation=UUID.randomUUID().toString();persistCopyTurn(conversation,"completed",0);
        var request=desktopRequest();var exporter=desktopExporter();
        assertThrows(IllegalStateException.class,()->desktopTx(()->{exporter.create(user,conversation,request);throw new IllegalStateException("synthetic persistence failure");}));
        assertTrue(desktopCopies.findByUserIdAndRequestId(user,request.requestId()).isEmpty());
        var pool=java.util.concurrent.Executors.newFixedThreadPool(2);
        try {
            var a=pool.submit(()->desktopTx(()->exporter.create(user,conversation,request)));
            var b=pool.submit(()->desktopTx(()->exporter.create(user,conversation,request)));
            assertEquals(a.get(15,java.util.concurrent.TimeUnit.SECONDS).conversationId(),b.get(15,java.util.concurrent.TimeUnit.SECONDS).conversationId());
        } finally {pool.shutdownNow();}
        assertEquals(1,desktopTx(()->exporter.history(user,conversation)).size());
    }

    @Test void explicitCopyIncludesMoreThanTwentyTurnsAndPreservesOriginalHistory() {
        enable();
        String conversation=UUID.randomUUID().toString();
        for(int n=0;n<25;n++) persistCopyTurn(conversation,"completed",n);
        var target=copyTarget(user);
        var members=mock(com.checkba.service.ProjectMemberService.class);
        when(members.hasWritePermission(target.getId(),user)).thenReturn(true);
        var copies=new MobileAssistantCopyService(service,projects,members,projectMessages);
        var copied=new org.springframework.transaction.support.TransactionTemplate(transactions)
                .execute(status->copies.copy(user,conversation,target.getId()));
        assertEquals(50,copied.messageCount());assertFalse(copied.filesCopied());assertTrue(copied.sourcePreserved());
        var messages=projectMessages.findByConversationIdOrderByCreatedAtAsc(copied.conversationId());
        assertEquals(50,messages.size());assertEquals("question-0",messages.get(0).getContent());
        assertEquals("AI 生成内容，请核实后使用。\n\nanswer-24",messages.get(49).getContent());
        assertEquals(25,turns.findByUserIdAndConversationIdOrderByCreatedAtAscIdAsc(user,conversation).size());
    }
    @Test void copyRejectsRunningForeignAndRevokedSourceBeforeCreatingMessages() {
        enable();service.settings(other,true,MobileAssistantService.CONSENT_VERSION);
        String conversation=UUID.randomUUID().toString();var turn=persistCopyTurn(conversation,"running",0);
        var tx=new org.springframework.transaction.support.TransactionTemplate(transactions);
        assertThrows(IllegalArgumentException.class,()->tx.execute(status->service.readableConversationForCopy(user,conversation)));
        turn.setStatus("completed");turns.saveAndFlush(turn);
        assertThrows(IllegalArgumentException.class,()->tx.execute(status->service.readableConversationForCopy(other,conversation)));
        turn.setSourcesJson("[{\"id\":\"999999\",\"updatedAt\":\"old\"}]");turns.saveAndFlush(turn);
        assertThrows(IllegalArgumentException.class,()->tx.execute(status->service.readableConversationForCopy(user,conversation)));
    }
    Project copyTarget(Long owner) {
        var p=new Project();p.setUserId(owner);p.setName("copy target");p.setProjectType("BLANK");p.setListedCompanyName("");p.setTargetCompanyName("");p.setCreatedAt(LocalDateTime.now());
        return projects.saveAndFlush(p);
    }
    MobileAssistantTurn persistCopyTurn(String conversation,String status,int index) {
        var turn=new MobileAssistantTurn();turn.setUserId(user);turn.setConversationId(conversation);turn.setRequestId(UUID.randomUUID().toString());
        turn.setQuestion("question-"+index);turn.setAnswer("answer-"+index);turn.setStatus(status);turn.setSourcesJson("[]");turn.setCreatedAt(Instant.now().plusSeconds(index));
        return turns.saveAndFlush(turn);
    }

    @Test void backupConsentDoesNotGrantAiProcessingAndExpiredPlanCannotStart() {
        assertEquals("assistant_consent_required",service.status(user).get("reason"));
        assertThrows(IllegalArgumentException.class,()->service.snapshot(user,snapshot("摘要资料")));
        assertThrows(IllegalArgumentException.class,()->service.chat(user,chat("案件情况？")));
        assertThrows(IllegalArgumentException.class,()->service.settings(user,true,"old"));
        when(quota.subscriptionQuota(user)).thenReturn(0L);when(quota.canRead(user)).thenReturn(false);when(quota.canWrite(user)).thenReturn(false);when(quota.canUse(user)).thenReturn(false);
        assertThrows(IllegalArgumentException.class,()->service.settings(user,true,MobileAssistantService.CONSENT_VERSION));
        verifyNoInteractions(models);
    }
    @Test void cloudSummaryUsesActualBackupAndServerProjectNameAndDeduplicatesContent() throws Exception {
        enable();source("甲方张三为原告，乙方李四为被告。诉讼金额人民币123456元。");
        var initial=service.snapshot(user,snapshot("开庭：周五上午09:00"));assertPublicSources(initial);
        var captured=org.mockito.ArgumentCaptor.forClass(ChatMessage[].class);verify(model).generate(captured.capture());
        String prompt=Arrays.toString(captured.getValue());assertTrue(prompt.contains("123456"));assertTrue(prompt.contains("合成案卷"));assertFalse(prompt.contains("untrusted title"));
        now=Instant.now().plusSeconds(1).toString();assertPublicSources(service.snapshot(user,snapshot("开庭：周五上午09:00")));
        verify(model,times(1)).generate(any(ChatMessage[].class));
        assertEquals(now,summaries.findByUserIdAndDeviceIdAndProjectKey(user,device,key).orElseThrow().getSourceUpdatedAt());
    }
    private void assertPublicSources(Map<String,Object> result) {
        assertFalse(result.containsKey("sourceFingerprint"));
        @SuppressWarnings("unchecked") var list=(List<Map<String,Object>>)result.get("sources");
        assertEquals(2,list.size());assertEquals("context",list.get(0).get("id"));
        for(var source:list) {assertEquals(true,source.get("readForSummary"));assertFalse(source.containsKey("sha256"));assertTrue(Set.of("id","name","path","readForSummary").containsAll(source.keySet()));}
    }
    @Test void noMaterialsAreNotPassedOffAsGeneratedSummary() {
        enable();var result=service.snapshot(user,snapshot(""));
        assertTrue(result.get("summary").toString().contains("尚无"));verifyNoInteractions(models);
    }
    @Test void anotherAccountCannotInjectSnapshotOrReadSources() {
        enable();service.settings(other,true,MobileAssistantService.CONSENT_VERSION);
        assertThrows(IllegalArgumentException.class,()->service.snapshot(other,snapshot("other user")));
        service.snapshot(user,snapshot("专属资料"));assertTrue(service.search(other,"").isEmpty());
        verify(model,times(1)).generate(any(ChatMessage[].class));
    }
    @Test void explicitDisablePurgesDerivedDataAndPreventsSubsequentModelCalls() {
        enable();service.snapshot(user,snapshot("专属资料"));service.chat(user,chat("你好"));
        assertFalse(summaries.findByUserIdOrderByUpdatedAtDesc(user).isEmpty());
        service.settings(user,false,MobileAssistantService.CONSENT_VERSION);
        assertTrue(summaries.findByUserIdOrderByUpdatedAtDesc(user).isEmpty());assertFalse((Boolean)service.status(user).get("enabled"));
        assertThrows(IllegalArgumentException.class,()->service.search(user,""));
    }
    @Test void withdrawalDuringGenerationCannotRecreateSummary() {
        enable();when(model.generate(any(ChatMessage[].class))).thenAnswer(call -> {
            service.settings(user,false,MobileAssistantService.CONSENT_VERSION);return Response.from(AiMessage.from("迟到的结果"));
        });
        assertThrows(IllegalArgumentException.class,()->service.snapshot(user,snapshot("资料")));
        assertTrue(summaries.findByUserIdOrderByUpdatedAtDesc(user).isEmpty());
    }
    @Test void changedBackupIsMarkedStaleAndRemovedProjectIsInvisible() throws Exception {
        enable();var file=source("原资料");service.snapshot(user,snapshot("资料"));file.setSha256("b".repeat(64));backups.saveAndFlush(file);
        assertEquals("stale",service.search(user,"").get(0).get("status"));
        directories.deleteAll(directories.findByUserIdAndDeviceId(user,device));assertTrue(service.search(user,"").isEmpty());
        var cleanup=service.cleanupCandidates(user);
        assertEquals(1,cleanup.size());assertEquals(key,cleanup.get(0).get("projectKey"));
    }
    @Test void idempotentChatDoesNotChargeTwiceAndRejectsRequestIdReuse() {
        enable();var request=chat("你好");var first=service.chat(user,request);assertEquals(first,service.chat(user,request));
        verify(model,times(1)).generate(anyList(),anyList());
        assertThrows(IllegalArgumentException.class,()->service.chat(user,new MobileAssistantService.ChatInput(null,request.requestId(),"换一个问题")));
        service.settings(other,true,MobileAssistantService.CONSENT_VERSION);
        assertTrue(((List<?>)service.history(other,first.get("conversationId").toString()).get("messages")).isEmpty());
    }
    @Test void staleDesktopSnapshotCannotReplaceNewerDataEvenIfContentMatches() {
        enable();service.snapshot(user,snapshot("已更新资料"));now=Instant.now().minusSeconds(60).toString();
        assertThrows(IllegalArgumentException.class,()->service.snapshot(user,snapshot("已更新资料")));
    }
    @Test void realHttpToolRoundTripSearchesReadsAndRejectsUnadvertisedWriteTool() throws Exception {
        enable();for(int i=0;i<21;i++) source("原始依据：原告张三，被告李四；金额123456元；证据来源"+i);
        service.snapshot(user,snapshot("周五提交证据"));
        long summary=summaries.findByUserIdOrderByUpdatedAtDesc(user).get(0).getId();
        var original=summaries.findById(summary).orElseThrow();
        for(int i=0;i<21;i++) {
            var dir=new MobileProjectDir();dir.setUserId(user);dir.setDeviceId(device);dir.setProjectKey("extra"+i);dir.setName("其他合成项目"+i);dir.setUpdatedAt(LocalDateTime.now());directories.saveAndFlush(dir);
            var row=new MobileProjectSummary();row.setUserId(user);row.setDeviceId(device);row.setProjectKey(dir.getProjectKey());row.setProjectName(dir.getName());row.setSourceUpdatedAt(now);row.setSourceHash("synthetic");row.setBackupHash(original.getBackupHash());row.setContext("合成资料");row.setSummary("合成摘要");row.setSourcesJson("[]");row.setStatus("ready");row.setUpdatedAt(Instant.now().plusMillis(i));summaries.saveAndFlush(row);
        }
        assertEquals(22,service.search(user,"").size());
        @SuppressWarnings("unchecked") var allSources=(List<Map<String,Object>>)service.search(user,"合成案卷").get(0).get("sources");
        assertEquals(22,allSources.size(),"context plus all 21 files are reachable");
        String unreadId=(String)allSources.stream().filter(item -> Boolean.FALSE.equals(item.get("readForSummary"))).findFirst().orElseThrow().get("id");
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        AtomicInteger requests=new AtomicInteger();List<String> bodies=new ArrayList<>();ObjectMapper json=new ObjectMapper();
        server.createContext("/v1/chat/completions",exchange -> {
            bodies.add(new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8));int step=requests.getAndIncrement();
            Map<String,Object> message;
            if(step<4) {
                String name=step==0 ? "search_project_summaries" : step==1 ? "read_project_summary" : step==2 ? "read_project_source" : "delete_file";
                String arguments=step==0 ? "{\"query\":\"\",\"offset\":\"20\"}" : step==1 ? json.writeValueAsString(Map.of("summaryId",String.valueOf(summary),"offset","20")) : step==2 ? json.writeValueAsString(Map.of("summaryId",String.valueOf(summary),"sourceId",unreadId,"offset","0")) : "{}";
                message=Map.of("role","assistant","tool_calls",List.of(Map.of("id","call-"+step,"type","function","function",Map.of("name",name,"arguments",arguments))));
            } else message=Map.of("role","assistant","content","张三是原告，李四是被告；金额123456元。依据：合成案卷/证据.txt。");
            byte[] response=json.writeValueAsBytes(Map.of("id","synthetic-response","object","chat.completion","created",1,"model","synthetic-model","choices",List.of(Map.of("index",0,"message",message,"finish_reason",step<4 ? "tool_calls" : "stop")),"usage",Map.of("prompt_tokens",10,"completion_tokens",10,"total_tokens",20)));
            exchange.getResponseHeaders().set("Content-Type","application/json");exchange.sendResponseHeaders(200,response.length);try(var output=exchange.getResponseBody()){output.write(response);}
        });
        server.start();
        try {
            ChatLanguageModel http=OpenAiChatModel.builder().apiKey("synthetic-key").baseUrl("http://127.0.0.1:"+server.getAddress().getPort()+"/v1").modelName("synthetic-model").timeout(Duration.ofSeconds(10)).maxRetries(0).build();
            doAnswer(call -> {assertEquals(user,PlatformAiUserScope.current());return new ChatModelFactory.PlatformChatModel(http,"synthetic-model");}).when(models).getPlatformChatModel(any(),eq(3000));
            var result=service.chat(user,chat("谁是原告，金额多少？"));assertTrue(result.get("answer").toString().contains("123456"));
            assertEquals(5,requests.get());assertTrue(bodies.get(1).contains("nextOffset"));assertTrue(bodies.get(2).contains("totalSources"));assertTrue(bodies.get(3).contains("原始依据"));assertTrue(bodies.get(4).contains("tool unavailable"));
            assertEquals(2,((List<?>)result.get("sources")).size());verify(tools,never()).execute(anyString(),anyString(),any());
            directories.deleteAll(directories.findByUserIdAndDeviceId(user,device));
            var messages=(List<?>)service.history(user,result.get("conversationId").toString()).get("messages");assertEquals(1,messages.size(),"revoked source answer must not be replayed");
        } finally {server.stop(0);}
    }

    @Test void disablingStillDeletesWhenBillingIsUnavailable() {
        enable();service.snapshot(user,snapshot("专属资料"));
        when(quota.subscriptionQuota(user)).thenThrow(new MobileBillingFailureException(MobileBillingKind.UNAVAILABLE,"synthetic outage"));when(quota.canRead(user)).thenThrow(new MobileBillingFailureException(MobileBillingKind.UNAVAILABLE,"synthetic outage"));
        var result=service.settings(user,false,MobileAssistantService.CONSENT_VERSION);
        assertFalse((Boolean)result.get("consentEnabled"));assertEquals("subscription_unavailable",result.get("reason"));
        assertTrue(summaries.findByUserIdOrderByUpdatedAtDesc(user).isEmpty());
    }
    @Test void failedRequestCanRetrySameIdWithoutDuplicatingCompletedTurn() {
        enable();var input=chat("重试问题");
        when(model.generate(anyList(),anyList())).thenThrow(new IllegalStateException("synthetic network failure"));
        assertThrows(IllegalStateException.class,()->service.chat(user,input));
        var failed=service.requestStatus(user,input.requestId());assertEquals("failed",failed.get("status"));
        doReturn(Response.from(AiMessage.from("重试成功"))).when(model).generate(anyList(),anyList());
        var retried=service.chat(user,input);assertEquals("completed",retried.get("status"));assertEquals(failed.get("conversationId"),retried.get("conversationId"));
        assertEquals(retried,service.chat(user,input));
        verify(model,times(2)).generate(anyList(),anyList());
    }
    @Test void simultaneousPhonesShareRunningReceiptAndOnlyOneModelCall() throws Exception {
        enable();var input=chat("并发同一请求");
        var entered=new java.util.concurrent.CountDownLatch(1);var release=new java.util.concurrent.CountDownLatch(1);
        when(model.generate(anyList(),anyList())).thenAnswer(call -> {entered.countDown();assertTrue(release.await(10,java.util.concurrent.TimeUnit.SECONDS));return Response.from(AiMessage.from("唯一回复"));});
        var executor=java.util.concurrent.Executors.newSingleThreadExecutor();
        try {
            var first=executor.submit(()->service.chat(user,input));assertTrue(entered.await(10,java.util.concurrent.TimeUnit.SECONDS));
            var second=service.chat(user,input);assertEquals("running",second.get("status"));release.countDown();
            var completed=first.get(10,java.util.concurrent.TimeUnit.SECONDS);assertEquals(second.get("conversationId"),completed.get("conversationId"));
            assertEquals(completed,service.chat(user,input));verify(model,times(1)).generate(anyList(),anyList());
        } finally {release.countDown();executor.shutdownNow();}
    }
    @Test void consentAndValidationMessagesFollowRequestLanguage() {
        AppLanguageScope.run("en-US",()-> {
            assertTrue(service.status(user).get("notice").toString().startsWith("Enabling this feature"));
            var error=assertThrows(IllegalArgumentException.class,()->service.chat(user,chat("Hello")));
            assertEquals("Please review the notice and enable the cloud personal assistant first",error.getMessage());
            enable();
            assertEquals("A required parameter is missing",assertThrows(IllegalArgumentException.class,
                    ()->service.chat(user,new MobileAssistantService.ChatInput(null,UUID.randomUUID().toString(),""))).getMessage());
        });
        assertTrue(service.status(user).get("notice").toString().startsWith("开通后"));
    }
    @Test void pollingAnAbandonedRequestMakesTheSameIdRetryable() {
        enable();var input=chat("恢复请求");
        var row=new MobileAssistantTurn();row.setUserId(user);row.setConversationId(UUID.randomUUID().toString());
        row.setRequestId(input.requestId());row.setQuestion(input.message());row.setStatus("running");row.setCreatedAt(Instant.now().minusSeconds(901));turns.saveAndFlush(row);
        var result=service.requestStatus(user,input.requestId());assertEquals("failed",result.get("status"));assertEquals("",result.get("answer"));assertEquals(List.of(),result.get("sources"));
        var retried=service.chat(user,input);assertEquals("completed",retried.get("status"));assertEquals(row.getConversationId(),retried.get("conversationId"));
        verify(model,times(1)).generate(anyList(),anyList());
    }
    @Test void followupWithoutNewToolCallStillRevalidatesHistoricalSources() throws Exception {
        enable();service.snapshot(user,snapshot("来源事实"));
        var ref=new LinkedHashMap<>(service.search(user,"").get(0));assertFalse(ref.containsKey("sourceFingerprint"));ref.remove("summary");ref.remove("sources");
        ref.put("sourceFingerprint",summaries.findById(((Number)ref.get("id")).longValue()).orElseThrow().getBackupHash());
        var old=new MobileAssistantTurn();old.setUserId(user);old.setConversationId(UUID.randomUUID().toString());old.setRequestId(UUID.randomUUID().toString());
        old.setQuestion("原告是谁");old.setAnswer("此前回答引用的已授权事实");old.setStatus("completed");old.setSourcesJson(new ObjectMapper().writeValueAsString(List.of(ref)));old.setCreatedAt(Instant.now().minusSeconds(60));turns.saveAndFlush(old);
        when(model.generate(anyList(),anyList())).thenAnswer(call -> {
            assertTrue(call.getArgument(0).toString().contains("此前回答引用的已授权事实"));
            directories.deleteAll(directories.findByUserIdAndDeviceId(user,device));
            return Response.from(AiMessage.from("不能在撤权后传回的旧事实"));
        });
        var input=new MobileAssistantService.ChatInput(old.getConversationId(),UUID.randomUUID().toString(),"根据刚才的事实继续解释");
        assertThrows(IllegalArgumentException.class,()->service.chat(user,input));
        assertEquals("failed",service.requestStatus(user,input.requestId()).get("status"));
    }
    @Test void sourceChangedDuringReadIsNotSentToNextModelRound() throws Exception {
        enable();var file=source("SHOULD_NOT_REACH_NEXT_ROUND");service.snapshot(user,snapshot("项目资料"));
        String id=String.valueOf(service.search(user,"").get(0).get("id"));
        when(backup.content(user,device,key,file.getUid())).thenAnswer(call -> {
            file.setSha256("b".repeat(64));backups.saveAndFlush(file);
            return new ProjectCatalogService.Content(new ByteArrayInputStream("SHOULD_NOT_REACH_NEXT_ROUND".getBytes(StandardCharsets.UTF_8)),file.getSize());
        });
        AtomicInteger calls=new AtomicInteger();
        when(model.generate(anyList(),anyList())).thenAnswer(call -> {
            if(calls.getAndIncrement()==0) return Response.from(AiMessage.from(List.of(ToolExecutionRequest.builder().id("read").name("read_project_source")
                    .arguments(new ObjectMapper().writeValueAsString(Map.of("summaryId",id,"sourceId",file.getUid(),"offset","0"))).build())));
            assertFalse(call.getArgument(0).toString().contains("SHOULD_NOT_REACH_NEXT_ROUND"));
            assertTrue(call.getArgument(0).toString().contains("source or query unavailable"));
            return Response.from(AiMessage.from("材料发生变化，暂不能确认。"));
        });
        assertEquals("completed",service.chat(user,chat("读取该来源")).get("status"));assertEquals(2,calls.get());
    }
    @Test void existingExternalWhitelistRunsWithAuthenticatedAccountScope() {
        enable();
        var names=List.of("law_search","law_search_keyword","law_recognition","get_law_article","qichacha_query","qichacha_ipr");
        for(String name:names) {
            var spec=ToolSpecification.builder().name(name).description("Synthetic existing tool").build();
            when(tools.resolve(name)).thenReturn(Optional.of(new ToolRegistry.RegisteredTool(new Object(),null,spec,null,false)));
        }
        when(tools.execute(anyString(),anyString(),any())).thenAnswer(call -> {
            assertEquals(user,PlatformAiUserScope.current());ToolContext ctx=call.getArgument(2);
            assertEquals(user,ctx.userId());assertNull(ctx.projectId());
            assertTrue(names.contains(call.getArgument(0)));return new ToolRegistry.ToolResult("Synthetic authorized external result",null,true);
        });
        AtomicInteger calls=new AtomicInteger();
        when(model.generate(anyList(),anyList())).thenAnswer(call -> {
            List<ToolSpecification> specs=call.getArgument(1);assertEquals(9,specs.size());
            assertTrue(specs.stream().noneMatch(spec -> "delete_file".equals(spec.name())));
            if(calls.getAndIncrement()==0) return Response.from(AiMessage.from(names.stream().map(name -> ToolExecutionRequest.builder().id(name).name(name).arguments("{}").build()).toList()));
            assertTrue(call.getArgument(0).toString().contains("Synthetic authorized external result"));return Response.from(AiMessage.from("外部查询完成"));
        });
        assertEquals("completed",service.chat(user,chat("检查法律与企业信息")).get("status"));
        verify(tools,times(6)).execute(anyString(),anyString(),any());assertNull(PlatformAiUserScope.current());
    }

    @Test void lateTimedOutAttemptCannotReplaceTheRetryOrMarkItFailed() throws Exception {
        enable();var input=chat("恢复同一个请求");
        var entered=new java.util.concurrent.CountDownLatch(1);var release=new java.util.concurrent.CountDownLatch(1);var calls=new AtomicInteger();
        when(model.generate(anyList(),anyList())).thenAnswer(call -> {
            if(calls.getAndIncrement()==0) {entered.countDown();assertTrue(release.await(10,java.util.concurrent.TimeUnit.SECONDS));return Response.from(AiMessage.from("旧尝试迟到"));}
            return Response.from(AiMessage.from("重试结果保留"));
        });
        var executor=java.util.concurrent.Executors.newSingleThreadExecutor();
        try {
            var first=executor.submit(()->service.chat(user,input));assertTrue(entered.await(10,java.util.concurrent.TimeUnit.SECONDS));
            var row=turns.findByUserIdAndRequestId(user,input.requestId()).orElseThrow();row.setCreatedAt(Instant.now().minusSeconds(901));turns.saveAndFlush(row);
            assertEquals("failed",service.requestStatus(user,input.requestId()).get("status"));
            var retried=service.chat(user,input);assertEquals("重试结果保留",retried.get("answer"));
            release.countDown();var late=assertThrows(java.util.concurrent.ExecutionException.class,()->first.get(10,java.util.concurrent.TimeUnit.SECONDS));assertInstanceOf(IllegalArgumentException.class,late.getCause());
            assertEquals(retried,service.requestStatus(user,input.requestId()));assertEquals(retried,service.chat(user,input));assertEquals(2,calls.get());
        } finally {release.countDown();executor.shutdownNow();}
    }
    @Test void requestPersistenceContextCannotCacheConsentAcrossConcurrentWithdrawal() throws Exception {
        enable();
        var em=entityManagerFactory.createEntityManager();
        org.springframework.transaction.support.TransactionSynchronizationManager.bindResource(entityManagerFactory,new org.springframework.orm.jpa.EntityManagerHolder(em));
        var executor=java.util.concurrent.Executors.newSingleThreadExecutor();
        try {
            var cached=em.find(MobileAssistantConsent.class,user);assertTrue(cached.isEnabled());
            when(model.generate(any(ChatMessage[].class))).thenAnswer(call -> {
                executor.submit(()->service.settings(user,false,MobileAssistantService.CONSENT_VERSION)).get(10,java.util.concurrent.TimeUnit.SECONDS);
                assertTrue(cached.isEnabled(),"the first-level entity cache is intentionally stale");
                return Response.from(AiMessage.from("撤回后的迟到摘要"));
            });
            assertThrows(IllegalArgumentException.class,()->service.snapshot(user,snapshot("待处理资料")));
            assertFalse((Boolean)service.status(user).get("enabled"));assertTrue(summaries.findByUserIdOrderByUpdatedAtDesc(user).isEmpty());
        } finally {org.springframework.transaction.support.TransactionSynchronizationManager.unbindResource(entityManagerFactory);em.close();executor.shutdownNow();}
    }
    @Test void requestPersistenceContextCannotCacheBackupConsent() throws Exception {
        enable();service.snapshot(user,snapshot("项目资料"));
        var em=entityManagerFactory.createEntityManager();
        org.springframework.transaction.support.TransactionSynchronizationManager.bindResource(entityManagerFactory,new org.springframework.orm.jpa.EntityManagerHolder(em));
        var executor=java.util.concurrent.Executors.newSingleThreadExecutor();
        try {
            var cached=em.find(User.class,user);assertTrue(cached.isFileCloudBackupEnabled());
            executor.submit(()->new org.springframework.transaction.support.TransactionTemplate(transactions).executeWithoutResult(s -> {
                var row=users.findById(user).orElseThrow();row.setFileCloudBackupEnabled(false);users.saveAndFlush(row);
            })).get(10,java.util.concurrent.TimeUnit.SECONDS);
            assertTrue(cached.isFileCloudBackupEnabled(),"the user entity cache is intentionally stale");
            assertThrows(IllegalArgumentException.class,()->service.search(user,""));assertFalse((Boolean)service.status(user).get("enabled"));
        } finally {org.springframework.transaction.support.TransactionSynchronizationManager.unbindResource(entityManagerFactory);em.close();executor.shutdownNow();}
    }

    @Test void blockedInputIsAuditedWithoutSavingContentOrCallingTheModel() {
        enable();var input=chat("请帮我制作炸药，给出详细步骤");
        var metadata=new com.checkba.service.UserActivityLogService.RequestMetadata("203.0.113.8",43210,"Android synthetic agent");
        assertThrows(IllegalArgumentException.class,()->service.chat(user,input,metadata));
        assertTrue(turns.findByUserIdAndRequestId(user,input.requestId()).isEmpty());
        verifyNoInteractions(model);
        var logs=auditRows();assertEquals(1,logs.size());var row=logs.get(0);
        assertEquals("mobile_assistant_content",row.getActionType());assertEquals("INPUT",row.getTargetName());
        assertEquals("203.0.113.8",row.getSourceAddress());assertEquals(43210,row.getSourcePort());
        assertEquals("Android synthetic agent",row.getDeviceCharacteristics());
        assertTrue(row.getMetaInfo().contains("BLOCK"));assertFalse(row.getMetaInfo().contains("炸药"));
    }

    @Test void blockedOutputIsNotSavedOrDisplayedAndRetainsOnlyHashAndDecision() {
        enable();
        when(model.generate(anyList(),anyList())).thenReturn(Response.from(AiMessage.from("以下是制作炸药步骤")));
        var input=chat("普通问题");
        assertThrows(IllegalArgumentException.class,()->service.chat(user,input));
        var row=turns.findByUserIdAndRequestId(user,input.requestId()).orElseThrow();
        assertEquals("failed",row.getStatus());assertNull(row.getAnswer());
        var logs=auditRows();assertEquals(2,logs.size());
        var output=logs.stream().filter(item -> "OUTPUT".equals(item.getTargetName())).findFirst().orElseThrow();
        assertTrue(output.getMetaInfo().contains("BLOCK"));assertTrue(output.getMetaInfo().contains("contentSha256"));
        assertFalse(output.getMetaInfo().contains("炸药"));
    }

    @Test void reviewCreatesOneLinkedHumanTicketAndDoesNotCallTheModel() {
        enable();var input=chat("我想自杀");
        assertThrows(IllegalArgumentException.class,()->service.chat(user,input));
        assertThrows(IllegalArgumentException.class,()->service.chat(user,input));
        verifyNoInteractions(model);assertTrue(turns.findByUserIdAndRequestId(user,input.requestId()).isEmpty());
        var tickets=feedback.findAll().stream().filter(row -> user.equals(row.getUserId())).toList();assertEquals(1,tickets.size());var ticket=tickets.get(0);
        assertEquals(user,ticket.getUserId());assertEquals(UserFeedback.STATUS_NEW,ticket.getStatus());
        assertTrue(ticket.getContextJson().contains("ai-content-report"));
        assertTrue(ticket.getContextJson().contains("systemGenerated"));
        assertFalse(ticket.getText().contains("自杀"));assertFalse(ticket.getContextJson().contains("自杀"));
        assertEquals(2,auditRows().size());
        assertTrue(auditRows().stream().allMatch(row -> ticket.getId().equals(row.getTargetId())));
    }

    @Test void concurrentReviewRetriesCreateOnlyOneTicket() throws Exception {
        enable();var input=chat("我想自杀");
        var start=new java.util.concurrent.CountDownLatch(1);var pool=java.util.concurrent.Executors.newFixedThreadPool(2);
        try {
            var first=pool.submit(()->{start.await();assertThrows(IllegalArgumentException.class,()->service.chat(user,input));return true;});
            var second=pool.submit(()->{start.await();assertThrows(IllegalArgumentException.class,()->service.chat(user,input));return true;});
            start.countDown();assertTrue(first.get(10,java.util.concurrent.TimeUnit.SECONDS));assertTrue(second.get(10,java.util.concurrent.TimeUnit.SECONDS));
            assertEquals(1,feedback.findAll().stream().filter(row -> user.equals(row.getUserId())).count());
            assertTrue(turns.findByUserIdAndRequestId(user,input.requestId()).isEmpty());verifyNoInteractions(model);
        } finally {pool.shutdownNow();}
    }

}
