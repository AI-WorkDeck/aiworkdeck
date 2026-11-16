// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.im;

import com.checkba.model.entity.*;
import com.checkba.repository.*;
import jakarta.persistence.EntityManagerFactory;
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;

/** The panel polls every 3 seconds: the statements one poll costs must not grow with the page it returns. */
@DataJpaTest(showSql=false)
@AutoConfigureTestDatabase(replace=AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties={
 "spring.datasource.url=jdbc:h2:mem:im-poll-query-count;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1",
 "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
 "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect", "spring.jpa.hibernate.ddl-auto=create-drop",
 "spring.jpa.properties.hibernate.generate_statistics=true"
})
@Import({ImService.class, com.checkba.service.ProjectMemberService.class})
@Transactional(propagation=Propagation.NOT_SUPPORTED)
class ImPollQueryCountTest {
 @Autowired ImService service;
 @Autowired UserRepository users;
 @Autowired AccountBindingRepository bindings;
 @Autowired ProjectRepository projects;
 @Autowired ProjectMemberRepository projectMembers;
 @Autowired EntityManagerFactory emf;
 Statistics stats;
 Long owner, lawyer, client;
 Map<Long,String> names=new HashMap<>();
 String id;

 @BeforeEach void setup() {
  ReflectionTestUtils.setField(service,"agents",mock(ImAgentService.class));
  ReflectionTestUtils.setField(ReflectionTestUtils.getField(service,"projectPermissions"),"accountBaseUrl","https://accounts.example.test");
  stats=emf.unwrap(SessionFactory.class).getStatistics(); stats.setStatisticsEnabled(true);
  owner=user("负责人"); lawyer=user("协办律师"); client=user("客户");
  for (Long u : List.of(owner, lawyer, client)) bind(u);
  var project=new Project(); project.setName("轮询项目"); project.setProjectType("TEST"); project.setListedCompanyName("合成公司"); project.setTargetCompanyName("合成标的"); project.setUserId(owner);
  long projectId=projects.saveAndFlush(project).getId();
  member(projectId, lawyer, "PARTICIPANT"); member(projectId, client, "CLIENT");
  id=call(owner,"projectGroup",Map.of("projectId",projectId)).get("id").toString();
  call(lawyer,"projectGroup",Map.of("projectId",projectId)); call(client,"projectGroup",Map.of("projectId",projectId));
 }

 @Test void pagePollCostDoesNotGrowWithTheMessagesItReturns() {
  fill(5);
  long lawyerSmall=count(() -> recent(lawyer)), clientSmall=count(() -> recent(client));
  fill(50);
  long lawyerLarge=count(() -> recent(lawyer)), clientLarge=count(() -> recent(client));
  System.out.printf("POLLCOST recent page: lawyer %d -> %d, client %d -> %d statements (5 -> 50 messages)%n", lawyerSmall, lawyerLarge, clientSmall, clientLarge);
  assertEquals(lawyerSmall, lawyerLarge); assertEquals(clientSmall, clientLarge);
  // Before batching this was 82 (lawyer) / 68 (client) for 50 messages: one binding lookup per message, two per attachment.
  assertTrue(lawyerLarge <= 12, "recent page statements: " + lawyerLarge);
  assertTrue(clientLarge <= 12, "recent page statements: " + clientLarge);
 }

 @Test @SuppressWarnings("unchecked") void batchedPageRendersWhatPerMessageLookupsDid() {
  fill(20);
  for (Long viewer : List.of(lawyer, client)) {
   for (Map<String,Object> m : (List<Map<String,Object>>)recent(viewer).get("messages")) {
    Long sender=((Number)m.get("senderId")).longValue();
    assertEquals(names.get(sender), m.get("senderName"));
    assertEquals("https://accounts.example.test/api/avatar/poll-"+sender, m.get("senderAvatarUrl"));
    var file=(Map<String,Object>)m.get("attachment");
    if (file == null) continue;
    // Lawyer uploads are not opened to clients: the client sees the placeholder and no metadata.
    if (viewer.equals(client)) assertEquals(Map.of("id",file.get("id"),"available",false,"message",ImService.FILE_UNAVAILABLE), file);
    else { assertEquals(true, file.get("available")); assertEquals(sender.equals(lawyer), file.get("canManageAccess")); }
   }
  }
 }

 @Test @SuppressWarnings("unchecked") void unchangedPollReadsNoMessageRowsAndKeepsItsRevision() {
  fill(50);
  var page=recent(client); String revision=(String)page.get("revision"); assertNotNull(revision);
  long last=lastId(client);
  stats.clear();
  var delta=call(client,"messages",Map.of("conversationId",id,"afterId",last,"limit",50));
  long statements=stats.getPrepareStatementCount();
  assertEquals(List.of(), delta.get("messages"));
  assertEquals(0, stats.getEntityStatistics(ImMessage.class.getName()).getLoadCount(), "no message row is read");
  assertEquals(0, stats.getEntityStatistics(ImAttachment.class.getName()).getLoadCount());
  assertTrue(statements <= 8, "delta statements: " + statements);
  assertEquals(revision, delta.get("revision"), "nothing changed, so the panel can skip the recent page");
  call(lawyer,"send",Map.of("conversationId",id,"clientMessageId","new-one","text","新消息"));
  var next=call(client,"messages",Map.of("conversationId",id,"afterId",last,"limit",50));
  assertEquals(1, ((List<?>)next.get("messages")).size(), "new messages arrive through the delta");
 }

 @Test @SuppressWarnings("unchecked") void revisionChangesWheneverAShownMessageCouldRenderDifferently() {
  fill(6);
  var file=((List<Map<String,Object>>)recent(owner).get("messages")).stream().map(m -> (Map<String,Object>)m.get("attachment"))
    .filter(Objects::nonNull).filter(a -> Boolean.TRUE.equals(a.get("canManageAccess"))).findFirst().orElseThrow();
  String clientBefore=revision(client), lawyerBefore=revision(lawyer);
  call(owner,"fileAccess",Map.of("conversationId",id,"attachmentId",file.get("id"),"clientVisible",true));
  assertNotEquals(clientBefore, revision(client)); assertNotEquals(lawyerBefore, revision(lawyer));
  assertTrue(((List<Map<String,Object>>)recent(client).get("messages")).stream().map(m -> (Map<String,Object>)m.get("attachment"))
    .anyMatch(a -> a != null && file.get("id").equals(a.get("id")) && Boolean.TRUE.equals(a.get("available"))));
  // Becoming a client of the project changes what every attachment shows, without any IM write.
  String lawyerNow=revision(lawyer);
  var row=projectMembers.findAll().stream().filter(m -> m.getUserId().equals(lawyer)).findFirst().orElseThrow();
  row.setRole("CLIENT"); projectMembers.saveAndFlush(row);
  assertNotEquals(lawyerNow, revision(lawyer));
 }

 /** The 0.2.6 panel tick (self, list, delta, read, recent, read) still works and costs much less; the new panel skips most of it. */
 @Test void legacyPanelTickStaysBounded() {
  fill(50);
  long last=lastId(lawyer);
  long tick=count(() -> {
   call(lawyer,"self",Map.of()); call(lawyer,"list",Map.of());
   call(lawyer,"messages",Map.of("conversationId",id,"afterId",last,"limit",50));
   call(lawyer,"read",Map.of("conversationId",id,"lastReadId",last));
   recent(lawyer);
   call(lawyer,"read",Map.of("conversationId",id,"lastReadId",last));
  });
  long quiet=count(() -> { call(lawyer,"self",Map.of()); call(lawyer,"list",Map.of()); call(lawyer,"messages",Map.of("conversationId",id,"afterId",last,"limit",50)); });
  System.out.printf("POLLCOST tick with 50 messages: legacy panel %d statements (113 before), unchanged tick of the new panel %d%n", tick, quiet);
  assertTrue(tick <= 45, "legacy tick statements: " + tick);
  assertTrue(quiet <= 17, "quiet tick statements: " + quiet);
 }

 Map<String,Object> recent(Long viewer) { return call(viewer,"messages",Map.of("conversationId",id,"limit",50)); }
 String revision(Long viewer) { return (String)call(viewer,"messages",Map.of("conversationId",id,"afterId",lastId(viewer),"limit",50)).get("revision"); }
 int messageCount = 0;
 void fill(int target) {
  List<Long> senders=List.of(owner, lawyer, client);
  while (messageCount < target) {
   Long sender=senders.get(messageCount % 3);
   if (messageCount % 5 == 0 && !sender.equals(client)) {
    var file=call(sender,"upload",Map.of("conversationId",id,"clientMessageId","f"+messageCount,"name","材料"+messageCount+".txt","base64",Base64.getEncoder().encodeToString(("x"+messageCount).getBytes())));
    call(sender,"send",Map.of("conversationId",id,"clientMessageId","f"+messageCount,"attachmentId",file.get("id")));
   } else call(sender,"send",Map.of("conversationId",id,"clientMessageId","m"+messageCount,"text","合成消息 "+messageCount));
   messageCount++;
  }
 }
 @SuppressWarnings("unchecked") long lastId(Long viewer) {
  var rows=(List<Map<String,Object>>)call(viewer,"messages",Map.of("conversationId",id,"limit",1)).get("messages");
  return ((Number)rows.get(rows.size()-1).get("id")).longValue();
 }
 long count(Runnable poll) { stats.clear(); poll.run(); return stats.getPrepareStatementCount(); }
 @SuppressWarnings("unchecked") Map<String,Object> call(Long user,String action,Map<String,Object> p) { return (Map<String,Object>)service.execute(user,action,p); }
 void member(long projectId, Long user, String role) {
  var m=new ProjectMember(); m.setProjectId(projectId); m.setUserId(user); m.setRole(role); projectMembers.saveAndFlush(m);
 }
 void bind(Long user) {
  var b=new AccountBinding(); b.setUserId(user); b.setExternalAccountId("poll-"+user); b.setCreatedAt(LocalDateTime.now()); bindings.saveAndFlush(b);
 }
 Long user(String name) {
  User u=new User(); u.setUsername("im-poll-"+UUID.randomUUID()); u.setPassword("not-a-credential");
  u.setDisplayName(name); u.setRole("USER"); u.setSubscriptionType("FREE");
  u.setCreatedAt(LocalDateTime.now()); u.setUpdatedAt(LocalDateTime.now()); Long saved=users.saveAndFlush(u).getId(); names.put(saved, name); return saved;
 }
}
