// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;

import com.checkba.model.entity.DesktopAssistantCopyReceipt;
import com.checkba.repository.DesktopAssistantCopyReceiptRepository;
import com.checkba.repository.ProjectRepository;
import com.checkba.service.LocalIdentityService;
import com.checkba.service.account.AccountService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import java.net.InetSocketAddress;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** Real HTTP plus committed receipt storage: retry does not depend on retained cloud payloads. */
@DataJpaTest
@AutoConfigureTestDatabase(replace=AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties={"spring.datasource.url=jdbc:h2:mem:desktop-assistant-ack;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1","spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa","spring.datasource.password=","spring.jpa.database-platform=org.hibernate.dialect.H2Dialect","spring.jpa.hibernate.ddl-auto=create-drop"})
@Transactional(propagation=Propagation.NOT_SUPPORTED)
class DesktopAssistantCopyAcknowledgementTest {
    @Autowired DesktopAssistantCopyReceiptRepository receipts;
    @TempDir Path stateDir;
    HttpServer server;
    AccountService accounts;
    LocalIdentityService identity;
    MobileRelayClientService client;
    DesktopAssistantCopyImportService importer;
    final List<String> acks=new java.util.concurrent.CopyOnWriteArrayList<>();
    String base;
    volatile int ackStatus=200;
    volatile boolean switchDuringAck;

    @BeforeEach void setup()throws Exception {
        receipts.deleteAll();
        accounts=mock(AccountService.class);identity=mock(LocalIdentityService.class);
        when(accounts.currentKeyOrNull()).thenReturn("awdk_synthetic");
        when(accounts.currentAccountIdOrNull()).thenReturn("account-a");
        when(accounts.accountFingerprintOrNull()).thenReturn("fingerprint-a");
        when(accounts.connectionVersion()).thenReturn(4L);when(identity.localUserId()).thenReturn(7L);
        importer=mock(DesktopAssistantCopyImportService.class);
        server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/",exchange->{
            String path=exchange.getRequestURI().getPath();String body="{\"code\":0,\"data\":[]}";int status=200;
            if(path.endsWith("/ack")) {
                acks.add(new String(exchange.getRequestBody().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8));status=ackStatus;
                body="{\"code\":0,\"data\":{\"status\":\"DELIVERED\"}}";
                if(switchDuringAck){when(accounts.accountFingerprintOrNull()).thenReturn("fingerprint-b");when(accounts.currentAccountIdOrNull()).thenReturn("account-b");}
            }
            byte[] bytes=body.getBytes(java.nio.charset.StandardCharsets.UTF_8);exchange.sendResponseHeaders(status,bytes.length);exchange.getResponseBody().write(bytes);exchange.close();
        });server.start();base="http://127.0.0.1:"+server.getAddress().getPort();
        Files.writeString(stateDir.resolve("mobile-relay.json"),"{\"deviceId\":\"device-a\",\"token\":\"awdt_synthetic\",\"accountFingerprint\":\"fingerprint-a\"}");
        client=newClient();
    }
    private MobileRelayClientService newClient() {
        var relay=new MobileRelayClientService(true,true,base,"https://www.aiworkdeck.com",stateDir.toString(),accounts,identity,
                mock(ProjectRepository.class),mock(com.checkba.service.ProjectFileService.class),mock(com.checkba.storage.StorageServiceFactory.class),
                mock(com.checkba.service.ProjectAiMessageService.class),mock(DesktopRefHandler.class));
        ReflectionTestUtils.setField(relay,"assistantCopyImporter",importer);ReflectionTestUtils.setField(relay,"assistantCopyReceipts",receipts);return relay;
    }
    @AfterEach void stop(){if(server!=null)server.stop(0);}
    private DesktopAssistantCopyReceipt receipt(String account,String site,String device) {
        var row=new DesktopAssistantCopyReceipt();String request=UUID.randomUUID().toString();
        row.setAccountScope(DesktopAssistantCopyImportService.sha256(site+"\n"+account));row.setId(DesktopAssistantCopyImportService.sha256(row.getAccountScope()+"\n"+request));
        row.setRequestId(request);row.setTargetDeviceId(device);row.setProjectId(1L);row.setProjectUid(UUID.randomUUID().toString());
        row.setConversationId(UUID.randomUUID().toString());row.setSha256("a".repeat(64));row.setMessageCount(250);
        row.setImportedAt(LocalDateTime.now(ZoneOffset.UTC).minusDays(40));return receipts.saveAndFlush(row);
    }
    @Test void expiredCloudPayloadAndEmptyPendingStillAcknowledgeCommittedReceipt()throws Exception {
        var row=receipt("account-a",base,"device-a");client.pollAssistantCopies();
        assertEquals(1,acks.size());var ack=new ObjectMapper().readTree(acks.get(0));assertEquals("DELIVERED",ack.path("status").asText());
        assertEquals(row.getSha256(),ack.path("sha256").asText());assertNotNull(receipts.findById(row.getId()).orElseThrow().getAcknowledgedAt());
        client.pollAssistantCopies();assertEquals(1,acks.size());verify(importer,never()).importCopy(any(),any());
    }
    @Test void lostAckSurvivesClientRestartAndRetriesUntilCloudAccepts() {
        var row=receipt("account-a",base,"device-a");ackStatus=503;client.pollAssistantCopies();
        assertNull(receipts.findById(row.getId()).orElseThrow().getAcknowledgedAt());
        client=newClient();ackStatus=200;client.pollAssistantCopies();assertEquals(2,acks.size());
        assertNotNull(receipts.findById(row.getId()).orElseThrow().getAcknowledgedAt());
    }
    @Test void otherAccountSiteAndDeviceReceiptsNeverLeaveCurrentScope() {
        receipt("account-b",base,"device-a");receipt("account-a","https://other.example","device-a");receipt("account-a",base,"device-b");
        client.pollAssistantCopies();assertTrue(acks.isEmpty());
    }
    @Test void accountSwitchDuringAckDoesNotMarkReceiptAcknowledged() {
        var row=receipt("account-a",base,"device-a");switchDuringAck=true;client.pollAssistantCopies();
        assertEquals(1,acks.size());assertNull(receipts.findById(row.getId()).orElseThrow().getAcknowledgedAt());
    }
}
