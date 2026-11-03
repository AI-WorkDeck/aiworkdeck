// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;

import com.checkba.model.entity.Project;
import com.checkba.repository.*;
import com.checkba.service.LocalIdentityService;
import com.checkba.service.account.AccountService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import java.time.Instant;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@DataJpaTest
@AutoConfigureTestDatabase(replace=AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties={"spring.datasource.url=jdbc:h2:mem:desktop-assistant-copy;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1","spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa","spring.datasource.password=","spring.jpa.database-platform=org.hibernate.dialect.H2Dialect","spring.jpa.hibernate.ddl-auto=create-drop"})
@Transactional(propagation=Propagation.NOT_SUPPORTED)
class DesktopAssistantCopyImportServiceTest {
    @Autowired ProjectRepository projects;
    @Autowired ProjectAiMessageRepository messages;
    @Autowired DesktopAssistantCopyReceiptRepository receipts;
    @Autowired PlatformTransactionManager transactions;
    @Autowired javax.sql.DataSource dataSource;
    @org.junit.jupiter.api.io.TempDir java.nio.file.Path stateDir;
    final ObjectMapper mapper=new ObjectMapper();
    AccountService accounts;LocalIdentityService identity;DesktopAssistantCopyImportService service;
    Project project;DesktopAssistantCopyImportService.Session session;
    @BeforeEach void setup(){
        receipts.deleteAll();messages.deleteAll();projects.deleteAll();
        accounts=mock(AccountService.class);identity=mock(LocalIdentityService.class);
        when(accounts.currentAccountIdOrNull()).thenReturn("website-user-a");when(accounts.accountFingerprintOrNull()).thenReturn("fingerprint-a");
        when(accounts.connectionVersion()).thenReturn(4L);when(identity.localUserId()).thenReturn(7L);
        service=new DesktopAssistantCopyImportService(accounts,identity,projects,messages,receipts,mapper,transactions);
        project=new Project();project.setName("Formal");project.setProjectType("BLANK");project.setListedCompanyName("");project.setTargetCompanyName("");project.setUserId(7L);
        project=projects.saveAndFlush(project);
        session=new DesktopAssistantCopyImportService.Session("https://relay.test","website-user-a","fingerprint-a",4L,"device-a",7L);
    }
    ObjectNode envelope(int count)throws Exception{
        String conversation=UUID.randomUUID().toString();
        ObjectNode snapshot=mapper.createObjectNode().put("version",1).put("sourceConversationId","source-assistant-chat")
                .put("conversationId",conversation).put("targetProjectUid",project.getUid()).put("targetDeviceId","device-a")
                .put("targetProjectKey",project.getId().toString());
        var rows=snapshot.putArray("messages");for(int i=0;i<count;i++){
            var row=rows.addObject().put("role",i%2==0?"USER":"ASSISTANT").put("content","完整消息 "+i).put("createdAt","2026-11-01T00:00:00Z");
            row.putArray("attachments").addObject().put("fileId",999);row.put("sourceChannel","office-word");row.put("toolCalls","ignored");
        }
        String json=mapper.writeValueAsString(snapshot);
        return mapper.createObjectNode().put("requestId",UUID.randomUUID().toString()).put("conversationId",conversation)
                .put("targetProjectUid",project.getUid()).put("targetDeviceId","device-a").put("targetProjectKey",project.getId().toString())
                .put("snapshotJson",json).put("sha256",DesktopAssistantCopyImportService.sha256(json)).put("messageCount",count)
                .put("expiresAt",Instant.now().plusSeconds(3600).toString());
    }
    @Test void importsWholeTranscriptAndReceiptAtomicallyAndDeletionNeverResurrectsIt()throws Exception{
        ObjectNode payload=envelope(241);var receipt=service.importCopy(session,payload);
        assertEquals(241,messages.count());assertEquals(1,receipts.count());
        var rows=messages.findByConversationIdOrderByCreatedAtAsc(receipt.getConversationId());
        assertEquals("完整消息 240",rows.get(240).getContent());assertEquals(7L,rows.get(0).getUserId());
        for(var row:rows){assertNull(row.getSourceChannel());assertNull(row.getSourceMessageId());assertNull(row.getAttachments());assertNull(row.getDisplayContent());assertNull(row.getReasoning());}
        assertTrue(rows.get(240).getCreatedAt().isAfter(rows.get(0).getCreatedAt()));
        assertEquals(receipt.getId(),service.importCopy(session,payload).getId());assertEquals(241,messages.count());
        new TransactionTemplate(transactions).executeWithoutResult(s->messages.deleteByConversationId(receipt.getConversationId()));
        assertEquals(0,messages.count());service.importCopy(session,payload);assertEquals(0,messages.count());assertEquals(1,receipts.count());
        projects.deleteById(project.getId());
        assertEquals(receipt.getId(),service.importCopy(session,payload).getId());
        assertEquals(0,messages.count()); // A lost ACK remains a factual delivery after the user deletes the target too.
    }
    @Test void receiptFailureRollsBackEveryInsertedMessage()throws Exception{
        var payload=envelope(230);
        sql("ALTER TABLE desktop_assistant_copy_receipt ADD CONSTRAINT reject_large_import CHECK (message_count < 200)");
        try { assertThrows(org.springframework.dao.DataAccessException.class,()->service.importCopy(session,payload)); }
        finally { sql("ALTER TABLE desktop_assistant_copy_receipt DROP CONSTRAINT reject_large_import"); }
        assertEquals(0,messages.count());assertEquals(0,receipts.count());
        service.importCopy(session,payload);assertEquals(230,messages.count());assertEquals(1,receipts.count());
    }
    void sql(String command)throws Exception{try(var connection=dataSource.getConnection();var statement=connection.createStatement()){statement.execute(command);}}
    @Test void rejectsHashTargetOwnerSpecialWorkspaceAndAccountChangesWithoutPartialImport()throws Exception{
        var badHash=envelope(2);badHash.put("sha256","0".repeat(64));assertThrows(DesktopAssistantCopyImportService.Rejected.class,()->service.importCopy(session,badHash));
        var payload=envelope(2);
        project.setUid(UUID.randomUUID().toString());projects.saveAndFlush(project);
        assertThrows(DesktopAssistantCopyImportService.Rejected.class,()->service.importCopy(session,payload));
        for(String type:new String[]{Project.SCRATCH,Project.LOOSE_FILES}){
            project.setProjectType(type);projects.saveAndFlush(project);var p=envelope(2);
            assertThrows(DesktopAssistantCopyImportService.Rejected.class,()->service.importCopy(session,p));
        }
        project.setProjectType("BLANK");project.setUserId(8L);projects.saveAndFlush(project);var other=envelope(2);
        assertThrows(DesktopAssistantCopyImportService.Rejected.class,()->service.importCopy(session,other));
        when(accounts.connectionVersion()).thenReturn(5L);
        assertThrows(IllegalStateException.class,()->service.importCopy(session,other));
        assertEquals(0,messages.count());assertEquals(0,receipts.count());
    }
    @Test void stableAccountReceiptSurvivesCredentialRotationAndSeparatesSites()throws Exception{
        var payload=envelope(2);var first=service.importCopy(session,payload);
        when(accounts.accountFingerprintOrNull()).thenReturn("rotated-key");when(accounts.connectionVersion()).thenReturn(5L);
        var renewed=new DesktopAssistantCopyImportService.Session(session.site(),session.accountId(),"rotated-key",5L,session.deviceId(),7L);
        assertEquals(first.getId(),service.importCopy(renewed,payload).getId());assertEquals(2,messages.count());
        var otherSite=new DesktopAssistantCopyImportService.Session("https://other.test",session.accountId(),"rotated-key",5L,session.deviceId(),7L);
        assertThrows(DesktopAssistantCopyImportService.Rejected.class,()->service.importCopy(otherSite,payload));
        assertEquals(1,receipts.count());
    }
    @Test void realHttpAckLossRetriesWithoutDuplicatesEvenAfterConversationDeletion()throws Exception{
        try(var relay=new RelayHarness()){
            relay.pending.set(envelope(241));relay.ackStatus=503;
            relay.client.pollAssistantCopies();assertEquals(241,messages.count());assertEquals(1,receipts.count());
            assertEquals(241,relay.rowsVisibleAtAck.get());assertEquals("DELIVERED",relay.acks.get(0).path("status").asText());
            relay.ackStatus=200;relay.client.pollAssistantCopies();assertEquals(241,messages.count());assertEquals(2,relay.acks.size());
            new TransactionTemplate(transactions).executeWithoutResult(t->messages.deleteByConversationId(relay.pending.get().path("conversationId").asText()));
            relay.client.pollAssistantCopies();assertEquals(0,messages.count());assertEquals(3,relay.acks.size());assertEquals(1,receipts.count());
        }
    }
    @Test void realHttpDistinguishesPermanentRejectionFromDatabaseFailureAndFencesAccountSwitch()throws Exception{
        try(var relay=new RelayHarness()){
            var invalid=envelope(230);invalid.put("sha256","0".repeat(64));relay.pending.set(invalid);
            relay.client.pollAssistantCopies();assertEquals("FAILED",relay.acks.get(0).path("status").asText());assertEquals(0,messages.count());
            relay.acks.clear();relay.pending.set(envelope(230));
            sql("ALTER TABLE desktop_assistant_copy_receipt ADD CONSTRAINT reject_http_import CHECK (message_count < 200)");
            try{relay.client.pollAssistantCopies();assertEquals(0,messages.count());assertTrue(relay.acks.isEmpty());}
            finally{sql("ALTER TABLE desktop_assistant_copy_receipt DROP CONSTRAINT reject_http_import");}
            relay.switchAccountOnPending=true;relay.client.pollAssistantCopies();assertEquals(0,messages.count());assertTrue(relay.acks.isEmpty());
        }
    }
    @Test void unavailableNewEndpointDoesNotStopOfficeQueuePolling()throws Exception{
        try(var relay=new RelayHarness()){
            relay.pendingStatus=404;relay.client.pollInbox();relay.client.pollInbox();
            assertEquals(2,relay.officeRequests.get());assertTrue(relay.acks.isEmpty());assertEquals(0,messages.count());
        }
    }
    @Test void projectLockHolderCanCheckAccountWhileImporterWaitsWithoutMonitorInversion() throws Exception {
        var payload=envelope(2);
        var projectLocked=new java.util.concurrent.CountDownLatch(1);
        var importerAtProjectLock=new java.util.concurrent.CountDownLatch(1);
        var observedProjects=mock(ProjectRepository.class,org.mockito.AdditionalAnswers.delegatesTo(projects));
        doAnswer(call->{
            importerAtProjectLock.countDown();
            assertFalse(Thread.holdsLock(accounts),"Never wait for a DB project lock while holding the account monitor");
            assertFalse(Thread.holdsLock(identity),"Never wait for a DB project lock while holding the identity monitor");
            return projects.lockForImWrite(call.getArgument(0));
        }).when(observedProjects).lockForImWrite(project.getId());
        var importer=new DesktopAssistantCopyImportService(accounts,identity,observedProjects,messages,receipts,mapper,transactions);
        var pool=java.util.concurrent.Executors.newFixedThreadPool(2,r->{var t=new Thread(r);t.setDaemon(true);return t;});
        try {
            var im=pool.submit(()->new TransactionTemplate(transactions).execute(status->{
                projects.lockForImWrite(project.getId()).orElseThrow();projectLocked.countDown();
                try { assertTrue(importerAtProjectLock.await(5,java.util.concurrent.TimeUnit.SECONDS)); }
                catch(InterruptedException e){Thread.currentThread().interrupt();throw new IllegalStateException(e);}
                // Same lock ordering as ImProjectFiles.ensureIdentity -> gateway.assertAccountScope.
                synchronized(accounts){assertEquals(session.fingerprint(),accounts.accountFingerprintOrNull());}
                return true;
            }));
            assertTrue(projectLocked.await(5,java.util.concurrent.TimeUnit.SECONDS));
            var copy=pool.submit(()->importer.importCopy(session,payload));
            assertTrue(im.get(10,java.util.concurrent.TimeUnit.SECONDS));
            assertEquals(2,copy.get(10,java.util.concurrent.TimeUnit.SECONDS).getMessageCount());
            assertEquals(2,messages.count());assertEquals(1,receipts.count());
        } finally {pool.shutdownNow();}
    }
    @Test void actualCommitKeepsBothIdentitiesFrozenAndOwnsTransactionEvenInsideOuterTransaction() throws Exception {
        var payload=envelope(2);
        var switchAttempt=new java.util.concurrent.CountDownLatch(1);
        var switched=new java.util.concurrent.CountDownLatch(1);
        var pool=java.util.concurrent.Executors.newSingleThreadExecutor(r->{var t=new Thread(r);t.setDaemon(true);return t;});
        java.util.concurrent.atomic.AtomicReference<java.util.concurrent.Future<?>> switcher=new java.util.concurrent.atomic.AtomicReference<>();
        PlatformTransactionManager observed=new PlatformTransactionManager(){
            @Override public org.springframework.transaction.TransactionStatus getTransaction(org.springframework.transaction.TransactionDefinition definition){
                assertEquals(org.springframework.transaction.TransactionDefinition.PROPAGATION_REQUIRES_NEW,definition.getPropagationBehavior());
                return transactions.getTransaction(definition);
            }
            @Override public void commit(org.springframework.transaction.TransactionStatus status){
                assertTrue(status.isNewTransaction());assertTrue(Thread.holdsLock(accounts));assertTrue(Thread.holdsLock(identity));
                switcher.set(pool.submit(()->{
                    switchAttempt.countDown();
                    synchronized(accounts){synchronized(identity){
                        when(accounts.connectionVersion()).thenReturn(5L);when(identity.localUserId()).thenReturn(8L);switched.countDown();
                    }}
                }));
                try {assertTrue(switchAttempt.await(5,java.util.concurrent.TimeUnit.SECONDS));}
                catch(InterruptedException e){Thread.currentThread().interrupt();throw new IllegalStateException(e);}
                assertEquals(1,switched.getCount());
                transactions.commit(status);
                assertEquals(1,switched.getCount(),"Neither identity can switch before the actual commit finishes");
            }
            @Override public void rollback(org.springframework.transaction.TransactionStatus status){transactions.rollback(status);}
        };
        var importer=new DesktopAssistantCopyImportService(accounts,identity,projects,messages,receipts,mapper,observed);
        try {
            // Outer rollback must not turn the acknowledged imported receipt into uncommitted data.
            new TransactionTemplate(transactions).executeWithoutResult(outer->{importer.importCopy(session,payload);outer.setRollbackOnly();});
            switcher.get().get(5,java.util.concurrent.TimeUnit.SECONDS);
            assertEquals(0,switched.getCount());assertEquals(2,messages.count());assertEquals(1,receipts.count());
            assertThrows(IllegalStateException.class,()->importer.importCopy(session,payload));
        } finally {pool.shutdownNow();}
    }

    class RelayHarness implements AutoCloseable {
        final com.sun.net.httpserver.HttpServer server;
        final MobileRelayClientService client;
        final java.util.concurrent.atomic.AtomicReference<ObjectNode> pending=new java.util.concurrent.atomic.AtomicReference<>();
        final java.util.List<com.fasterxml.jackson.databind.JsonNode> acks=new java.util.concurrent.CopyOnWriteArrayList<>();
        final java.util.concurrent.atomic.AtomicInteger officeRequests=new java.util.concurrent.atomic.AtomicInteger();
        final java.util.concurrent.atomic.AtomicLong rowsVisibleAtAck=new java.util.concurrent.atomic.AtomicLong();
        volatile int ackStatus=200,pendingStatus=200;volatile boolean switchAccountOnPending;
        RelayHarness()throws Exception{
            server=com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1",0),0);
            server.createContext("/",exchange->{
                String path=exchange.getRequestURI().getPath(),body="[]";int status=200;
                if(path.equals("/api/mobile/assistant/desktop-copies/pending")){
                    if(switchAccountOnPending)when(accounts.accountFingerprintOrNull()).thenReturn("other-account");
                    status=pendingStatus;var result=mapper.createObjectNode().put("code",0);var data=result.putArray("data");if(pending.get()!=null)data.add(pending.get());body=result.toString();
                }else if(path.startsWith("/api/mobile/assistant/desktop-copies/")&&path.endsWith("/ack")){
                    acks.add(mapper.readTree(exchange.getRequestBody()));rowsVisibleAtAck.set(messages.count());status=ackStatus;body="{\"code\":0,\"data\":{}}";
                }else if(path.equals("/api/mobile/conversations/inbox")){officeRequests.incrementAndGet();}
                else if(!path.equals("/api/mobile/inbox")){status=404;}
                byte[] bytes=body.getBytes(java.nio.charset.StandardCharsets.UTF_8);exchange.sendResponseHeaders(status,bytes.length);exchange.getResponseBody().write(bytes);exchange.close();
            });server.start();
            when(accounts.currentKeyOrNull()).thenReturn("awdk_synthetic");
            java.nio.file.Files.writeString(stateDir.resolve("mobile-relay.json"),"{\"deviceId\":\"device-a\",\"token\":\"awdt_synthetic\",\"accountFingerprint\":\"fingerprint-a\"}");
            client=new MobileRelayClientService(true,true,"http://127.0.0.1:"+server.getAddress().getPort(),"https://www.aiworkdeck.com",stateDir.toString(),
                    accounts,identity,projects,mock(com.checkba.service.ProjectFileService.class),mock(com.checkba.storage.StorageServiceFactory.class),
                    mock(com.checkba.service.ProjectAiMessageService.class),mock(DesktopRefHandler.class));
            org.springframework.test.util.ReflectionTestUtils.setField(client,"assistantCopyImporter",service);
        }
        public void close(){server.stop(0);}
    }

}
