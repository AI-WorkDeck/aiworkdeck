// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.im;

import com.checkba.model.entity.User;
import com.checkba.repository.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.*;
import java.util.*;
import java.util.concurrent.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import org.springframework.test.util.ReflectionTestUtils;

@DataJpaTest(showSql=false)
@AutoConfigureTestDatabase(replace=AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties={
 "spring.datasource.url=jdbc:h2:mem:im-service-test;MODE=PostgreSQL;NON_KEYWORDS=VALUE;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000",
 "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa", "spring.datasource.password=",
 "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect", "spring.jpa.hibernate.ddl-auto=create-drop"
})
@Import({ImService.class, com.checkba.service.ProjectMemberService.class})
@Transactional(propagation=Propagation.NOT_SUPPORTED)
class ImServiceTest {
 @Autowired ImService service;
 @Autowired UserRepository users;
 @Autowired ImInvitationRepository invitations;
 @Autowired ImMessageRepository messages;
 @Autowired AccountBindingRepository accountBindings;
 @Autowired ProjectRepository projects;
 @Autowired ProjectMemberRepository projectMembers;
 Long owner, colleague, client, stranger;

 @BeforeEach void setup() { ReflectionTestUtils.setField(service,"agents",mock(ImAgentService.class)); owner=user("负责人"); colleague=user("跨律所律师"); client=user("客户"); stranger=user("局外人"); }
 @Test void projectGroupUsesRealMembershipAndRevocationClosesAllConversationPaths() {
  var project=new com.checkba.model.entity.Project(); project.setName("合成项目群"); project.setProjectType("TEST"); project.setListedCompanyName("合成公司"); project.setTargetCompanyName("合成标的"); project.setUserId(owner);
  long projectId=projects.saveAndFlush(project).getId();
  var member=new com.checkba.model.entity.ProjectMember(); member.setProjectId(projectId); member.setUserId(client); member.setRole("CLIENT");
  member=projectMembers.saveAndFlush(member);
  var group=call(client,"projectGroup",Map.of("projectId",projectId)); String id=group.get("id").toString();
  assertEquals(projectId,group.get("projectId")); assertEquals("CLIENT",group.get("role"));
  assertEquals("project:"+projectId,((Map<?,?>)group.get("agent")).get("scopeKey")); assertEquals(false,group.get("canRequestAgent"));
  assertEquals(id,call(owner,"ensureAgent",Map.of("scope","project","scopeKey","project:"+projectId,"private",false)).get("id"));
  assertEquals(3,((List<?>)call(owner,"members",Map.of("conversationId",id)).get("members")).size());
  assertEquals(id,call(owner,"projectGroup",Map.of("projectId",projectId)).get("id"));
  assertThrows(IllegalArgumentException.class,()->call(stranger,"projectGroup",Map.of("projectId",projectId)));
  assertThrows(IllegalArgumentException.class,()->call(owner,"invite",Map.of("conversationId",id,"role","CLIENT")));
  send(client,id,"customer-note","合成客户问题");
  projectMembers.delete(member); projectMembers.flush();
  assertTrue(((List<?>)call(client,"list",Map.of()).get("conversations")).isEmpty());
  for(String action:List.of("messages","members","send","read"))
   assertThrows(IllegalArgumentException.class,()->call(client,action,Map.of("conversationId",id,"clientMessageId","revoked","text","x")));
 }
 @Test void projectGroupCreationRacesResolveToOneGroup() throws Exception {
  var project=new com.checkba.model.entity.Project(); project.setName("并发项目群"); project.setProjectType("TEST"); project.setListedCompanyName("合成公司"); project.setTargetCompanyName("合成标的"); project.setUserId(owner);
  long projectId=projects.saveAndFlush(project).getId();
  var member=new com.checkba.model.entity.ProjectMember(); member.setProjectId(projectId); member.setUserId(client); member.setRole("CLIENT"); projectMembers.saveAndFlush(member);
  ExecutorService workers=Executors.newFixedThreadPool(2); CountDownLatch start=new CountDownLatch(1);
  try {
   Future<Object> a=workers.submit(()->{start.await();return call(owner,"projectGroup",Map.of("projectId",projectId)).get("id");});
   Future<Object> b=workers.submit(()->{start.await();return call(client,"projectGroup",Map.of("projectId",projectId)).get("id");}); start.countDown();
   assertEquals(a.get(20,TimeUnit.SECONDS),b.get(20,TimeUnit.SECONDS));
  } finally {workers.shutdownNow();}
 }
 Long user(String name) {
  User u=new User(); u.setUsername("im-test-"+UUID.randomUUID()); u.setPassword("not-a-credential");
  u.setDisplayName(name); u.setRole("USER"); u.setSubscriptionType("FREE");
  u.setCreatedAt(LocalDateTime.now()); u.setUpdatedAt(LocalDateTime.now()); return users.saveAndFlush(u).getId();
 }
 @SuppressWarnings("unchecked") Map<String,Object> call(Long user,String action,Map<String,Object> p) { return (Map<String,Object>)service.execute(user,action,p); }
 String create(String type) { return (String)call(owner,"create",Map.of("title","合成案件沟通","type",type)).get("id"); }
 String invite(String id,String role) { return (String)call(owner,"invite",Map.of("conversationId",id,"role",role)).get("code"); }
 void join(Long user,String id,String role) { call(user,"join",Map.of("code",invite(id,role))); }
 Map<String,Object> send(Long user,String id,String key,String text) { return call(user,"send",Map.of("conversationId",id,"clientMessageId",key,"text",text)); }

 @Test void messageAvatarsUseAccountBindingAndUploadedAvatarPrecedence() {
  var binding=new com.checkba.model.entity.AccountBinding(); binding.setUserId(owner); binding.setExternalAccountId("synthetic-avatar-"+owner); binding.setCreatedAt(LocalDateTime.now()); accountBindings.saveAndFlush(binding);
  var policy=ReflectionTestUtils.getField(service,"projectPermissions");
  ReflectionTestUtils.setField(policy,"accountBaseUrl","https://accounts.example.test");
  String id=create("GROUP");
  assertEquals("https://accounts.example.test/api/avatar/synthetic-avatar-"+owner,send(owner,id,"bound-avatar","合成消息").get("senderAvatarUrl"));
  User user=users.findById(owner).orElseThrow(); user.setAvatarUrl("https://files.example.test/uploaded.png"); users.saveAndFlush(user);
  assertEquals("https://files.example.test/uploaded.png",send(owner,id,"uploaded-avatar","后续消息").get("senderAvatarUrl"));
 }
 @Test void crossOrganizationMembersAndClientsChatWithoutProjectMembership() {
  String id=create("GROUP"); join(colleague,id,"MEMBER"); join(client,id,"CLIENT");
  var sent=send(client,id,"one","客户材料说明"); assertEquals(client,sent.get("senderId"));
  assertEquals("客户",sent.get("senderName"));
  assertEquals(1,((List<?>)call(colleague,"messages",Map.of("conversationId",id)).get("messages")).size());
  assertThrows(IllegalArgumentException.class,()->call(stranger,"messages",Map.of("conversationId",id)));
  assertThrows(IllegalArgumentException.class,()->call(client,"invite",Map.of("conversationId",id,"role","MEMBER")));
 }
 @Test void invitationsAreSingleUseExpiringAndDirectIsLimitedToTwo() {
  String id=create("DIRECT"); String code=invite(id,"MEMBER"); call(colleague,"join",Map.of("code",code));
  assertThrows(IllegalArgumentException.class,()->call(stranger,"join",Map.of("code",code)));
  assertThrows(IllegalArgumentException.class,()->invite(id,"CLIENT"));
  String group=create("GROUP"); String expired=invite(group,"CLIENT");
  var row=invitations.findById(ImService.sha(expired.getBytes(java.nio.charset.StandardCharsets.UTF_8))).orElseThrow();
  row.setExpiresAt(Instant.now().minusSeconds(1)); invitations.saveAndFlush(row);
  assertThrows(IllegalArgumentException.class,()->call(client,"join",Map.of("code",expired)));
 }
 @Test void concurrentInvitationRedemptionHasExactlyOneWinner() throws Exception {
  String id=create("GROUP"), code=invite(id,"MEMBER"); CountDownLatch start=new CountDownLatch(1);
  ExecutorService workers=Executors.newFixedThreadPool(2);
  try {
   List<Future<Boolean>> results=new ArrayList<>();
   for(Long user:List.of(colleague,client)) results.add(workers.submit(()->{ start.await(); try {call(user,"join",Map.of("code",code)); return true;} catch(IllegalArgumentException e){return false;} }));
   start.countDown(); int winners=0; for(var result:results) if(result.get(20,TimeUnit.SECONDS)) winners++;
   assertEquals(1,winners);
   assertEquals(2,((List<?>)call(owner,"members",Map.of("conversationId",id)).get("members")).size());
  } finally {workers.shutdownNow();}
 }
 @Test void duplicateSendIsIdempotentButChangedPayloadIsRejected() {
  String id=create("GROUP"); var first=send(owner,id,"stable-key","第一次"); var retry=send(owner,id,"stable-key","第一次");
  assertEquals(first.get("id"),retry.get("id")); assertEquals(first.get("uid"),retry.get("uid"));
  assertThrows(IllegalArgumentException.class,()->send(owner,id,"stable-key","换了正文"));
  assertEquals(1,((List<?>)call(owner,"messages",Map.of("conversationId",id)).get("messages")).size());
 }
 @Test void concurrentSendsWithSameClientKeyPersistOnce() throws Exception {
  String id=create("GROUP"); ExecutorService workers=Executors.newFixedThreadPool(2); CountDownLatch start=new CountDownLatch(1);
  try {
   Callable<Object> send=()->{start.await(); return send(owner,id,"same","重复请求").get("id");};
   Future<Object> a=workers.submit(send),b=workers.submit(send); start.countDown();
   assertEquals(a.get(20,TimeUnit.SECONDS),b.get(20,TimeUnit.SECONDS));
   assertEquals(1,((List<?>)call(owner,"messages",Map.of("conversationId",id)).get("messages")).size());
  } finally {workers.shutdownNow();}
 }
 @Test void paginationAndReadCursorStayInsideConversation() {
  String id=create("GROUP"); join(colleague,id,"MEMBER"); var a=send(owner,id,"a","a"); var b=send(owner,id,"b","b"); send(owner,id,"c","c");
  var page=call(colleague,"messages",Map.of("conversationId",id,"limit",2)); assertEquals(true,page.get("hasMore"));
  var oldest=call(colleague,"messages",Map.of("conversationId",id,"afterId",0,"limit",1));
  assertEquals(a.get("id"),((Map<?,?>)((List<?>)oldest.get("messages")).get(0)).get("id"));
  var more=call(colleague,"messages",Map.of("conversationId",id,"afterId",b.get("id"))); assertEquals(1,((List<?>)more.get("messages")).size());
  call(colleague,"read",Map.of("conversationId",id,"lastReadId",b.get("id")));
  assertEquals(b.get("id"),call(colleague,"read",Map.of("conversationId",id,"lastReadId",a.get("id"))).get("lastReadId"));
  String other=create("GROUP"); var foreign=send(owner,other,"foreign","foreign");
  assertThrows(IllegalArgumentException.class,()->call(colleague,"read",Map.of("conversationId",id,"lastReadId",foreign.get("id"))));
 }
 @Test void attachmentsRequireMembershipAndConversationAndRemovalRevokesImmediately() {
  String id=create("GROUP"); join(client,id,"CLIENT"); byte[] original="合成文件".getBytes(java.nio.charset.StandardCharsets.UTF_8);
  var attachment=call(owner,"upload",Map.of("conversationId",id,"clientMessageId","file","name","../../合同.txt","base64",Base64.getEncoder().encodeToString(original)));
  assertEquals("合同.txt",attachment.get("name")); assertEquals(ImService.sha(original),attachment.get("sha256"));
  var duplicate=call(owner,"upload",Map.of("conversationId",id,"clientMessageId","file","name","合同.txt","base64",Base64.getEncoder().encodeToString(original)));
  assertEquals(attachment.get("id"),duplicate.get("id"));
  var fileMessage=call(owner,"send",Map.of("conversationId",id,"clientMessageId","file","attachmentId",attachment.get("id")));
  assertEquals(attachment,fileMessage.get("attachment"));
  assertEquals(ImService.FILE_UNAVAILABLE,assertThrows(IllegalArgumentException.class,()->call(client,"download",Map.of("conversationId",id,"attachmentId",attachment.get("id")))).getMessage());
  call(owner,"fileAccess",Map.of("conversationId",id,"attachmentId",attachment.get("id"),"clientVisible",true));
  assertArrayEquals(original,Base64.getDecoder().decode((String)call(client,"download",Map.of("conversationId",id,"attachmentId",attachment.get("id"))).get("base64")));
  String other=create("GROUP");
  assertThrows(IllegalArgumentException.class,()->call(owner,"download",Map.of("conversationId",other,"attachmentId",attachment.get("id"))));
  assertThrows(IllegalArgumentException.class,()->call(client,"send",Map.of("conversationId",id,"clientMessageId","stolen","attachmentId",attachment.get("id"))));
  call(owner,"removeMember",Map.of("conversationId",id,"userId",client));
  assertThrows(IllegalArgumentException.class,()->call(client,"download",Map.of("conversationId",id,"attachmentId",attachment.get("id"))));
  assertThrows(IllegalArgumentException.class,()->send(client,id,"removed","still here"));
 }
 @Test void binaryAttachmentAboveDialectLobThresholdRoundTripsWithoutTruncation() {
  String id=create("GROUP");byte[] bytes=new byte[1024*1024+31];new Random(1250).nextBytes(bytes);
  var file=call(owner,"upload",Map.of("conversationId",id,"name","合成数据.bin","base64",Base64.getEncoder().encodeToString(bytes)));
  assertArrayEquals(bytes,Base64.getDecoder().decode((String)call(owner,"download",Map.of("conversationId",id,"attachmentId",file.get("id"))).get("base64")));
 }
 @Test void invalidAndOversizedUploadsFailBeforeStorage() {
  String id=create("GROUP");
  assertThrows(IllegalArgumentException.class,()->call(owner,"upload",Map.of("conversationId",id,"name","x","base64","%invalid")));
  assertThrows(IllegalArgumentException.class,()->call(owner,"upload",Map.of("conversationId",id,"name","x","base64","A".repeat(((ImService.MAX_FILE_BYTES+2)/3)*4+1))));
  assertThrows(IllegalArgumentException.class,()->call(owner,"upload",Map.of("conversationId",id,"name","..","base64","YQ==")));
 }
 @Test void leavingRevokesAccessAndOwnerMustNotOrphanMembers() {
  String id=create("GROUP"); join(colleague,id,"MEMBER");
  assertThrows(IllegalArgumentException.class,()->call(owner,"leave",Map.of("conversationId",id)));
  call(colleague,"leave",Map.of("conversationId",id));
  assertThrows(IllegalArgumentException.class,()->call(colleague,"members",Map.of("conversationId",id)));
  call(owner,"leave",Map.of("conversationId",id));
  assertThrows(IllegalArgumentException.class,()->call(owner,"messages",Map.of("conversationId",id)));
 }
 @Test void fileAccessDefaultsToInternalAndGrantThenRevokeControlsBothMetadataAndBytes() {
  String id=create("GROUP");join(client,id,"CLIENT");join(colleague,id,"MEMBER");
  Map<String,Object> source=Map.of("projectUid",UUID.randomUUID().toString(),"fileUid",UUID.randomUUID().toString());
  var attachment=call(owner,"upload",Map.of("conversationId",id,"name","内部草稿.docx","base64","YQ==","source",source));
  String aid=(String)attachment.get("id");
  assertEquals(false,attachment.get("clientVisible"));assertEquals(source,attachment.get("source"));
  call(owner,"send",Map.of("conversationId",id,"clientMessageId","internal","attachmentId",aid));
  Map<?,?> hidden=attachmentFor(client,id);
  assertEquals(Map.of("id",aid,"available",false,"message",ImService.FILE_UNAVAILABLE),hidden);
  assertThrows(IllegalArgumentException.class,()->call(client,"download",Map.of("conversationId",id,"attachmentId",aid)));
  assertEquals(true,attachmentFor(colleague,id).get("available"));assertEquals(false,attachmentFor(colleague,id).get("canManageAccess"));
  assertThrows(IllegalArgumentException.class,()->call(colleague,"fileAccess",Map.of("conversationId",id,"attachmentId",aid,"clientVisible",true)));
  assertThrows(IllegalArgumentException.class,()->call(owner,"fileAccess",Map.of("conversationId",id,"attachmentId",aid,"clientVisible","true")));
  call(owner,"fileAccess",Map.of("conversationId",id,"attachmentId",aid,"clientVisible",true));
  assertEquals("内部草稿.docx",attachmentFor(client,id).get("name"));
  assertEquals(false,attachmentFor(client,id).get("canManageAccess"));
  assertEquals("YQ==",call(client,"download",Map.of("conversationId",id,"attachmentId",aid)).get("base64"));
  call(owner,"fileAccess",Map.of("conversationId",id,"attachmentId",aid,"clientVisible",false));
  assertEquals(false,attachmentFor(client,id).get("available"));
  assertEquals(ImService.FILE_UNAVAILABLE,assertThrows(IllegalArgumentException.class,()->call(client,"download",Map.of("conversationId",id,"attachmentId",aid))).getMessage());
 }
 @Test void globalClientCannotGainInternalAccessByAcceptingMemberInvitation() {
  User global=users.findById(client).orElseThrow();global.setRole("CLIENT");users.saveAndFlush(global);
  String id=create("GROUP");join(client,id,"MEMBER");
  var file=call(owner,"upload",Map.of("conversationId",id,"name","内部.txt","base64","YQ=="));
  call(owner,"send",Map.of("conversationId",id,"clientMessageId","internal","attachmentId",file.get("id")));
  assertEquals(false,attachmentFor(client,id).get("available"));
  assertThrows(IllegalArgumentException.class,()->call(client,"fileAccess",Map.of("conversationId",id,"attachmentId",file.get("id"),"clientVisible",true)));
  assertThrows(IllegalArgumentException.class,()->call(client,"download",Map.of("conversationId",id,"attachmentId",file.get("id"))));
 }
 @Test void clientOwnUploadIsReadableOnlyToSelfAndInternalMembersByDefault() {
  String id=create("GROUP");join(client,id,"CLIENT");join(stranger,id,"CLIENT");join(colleague,id,"MEMBER");
  var file=call(client,"upload",Map.of("conversationId",id,"name","客户证据.txt","base64","YQ=="));
  assertEquals(true,file.get("available"));assertEquals(false,file.get("canManageAccess"));
  call(client,"send",Map.of("conversationId",id,"clientMessageId","evidence","attachmentId",file.get("id")));
  assertEquals(true,attachmentFor(client,id).get("available"));assertEquals(true,attachmentFor(colleague,id).get("available"));
  assertEquals(false,attachmentFor(stranger,id).get("available"));
  assertThrows(IllegalArgumentException.class,()->call(client,"fileAccess",Map.of("conversationId",id,"attachmentId",file.get("id"),"clientVisible",true)));
  call(owner,"fileAccess",Map.of("conversationId",id,"attachmentId",file.get("id"),"clientVisible",true));
  assertEquals(true,attachmentFor(stranger,id).get("available"));
 }
 @Test void uploadRetriesReuseOnlyTheirOwnKeyAndRejectChangedContentOrSource() {
  String id=create("GROUP"), projectUid=UUID.randomUUID().toString(),fileUid=UUID.randomUUID().toString();
  Map<String,Object> params=Map.of("conversationId",id,"clientMessageId","retry-key","name","同名.txt","base64","YQ==","source",Map.of("projectUid",projectUid,"fileUid",fileUid));
  var first=call(owner,"upload",params);assertEquals(first.get("id"),call(owner,"upload",params).get("id"));
  for (Map.Entry<String,Object> change : Map.<String,Object>of("name","不同名.txt","base64","Yg==",
      "source",Map.of("projectUid",projectUid,"fileUid",UUID.randomUUID().toString())).entrySet()) {
   var changed=new HashMap<>(params);changed.put(change.getKey(),change.getValue());
   assertEquals("文件重试标识已用于其他内容",assertThrows(IllegalArgumentException.class,()->call(owner,"upload",changed)).getMessage());
  }
  var withoutSource=new HashMap<>(params);withoutSource.remove("source");
  assertThrows(IllegalArgumentException.class,()->call(owner,"upload",withoutSource));
  var withoutKey=new HashMap<>(params);withoutKey.remove("clientMessageId");
  assertNotEquals(call(owner,"upload",withoutKey).get("id"),call(owner,"upload",withoutKey).get("id"));
  join(colleague,id,"MEMBER");
  assertNotEquals(first.get("id"),call(colleague,"upload",params).get("id"));
 }
 @Test void newFileSendDoesNotInheritPreviouslyGrantedCustomerAccess() {
  String id=create("GROUP");join(client,id,"CLIENT");
  var params=new HashMap<String,Object>(Map.of("conversationId",id,"clientMessageId","first","name","同名.txt","base64","YQ=="));
  var first=call(owner,"upload",params);
  call(owner,"send",Map.of("conversationId",id,"clientMessageId","first","attachmentId",first.get("id")));
  call(owner,"fileAccess",Map.of("conversationId",id,"attachmentId",first.get("id"),"clientVisible",true));
  assertEquals(first.get("id"),call(owner,"upload",params).get("id"));
  params.put("clientMessageId","second");
  var second=call(owner,"upload",params);assertNotEquals(first.get("id"),second.get("id"));
  assertEquals(false,second.get("clientVisible"));
  call(owner,"send",Map.of("conversationId",id,"clientMessageId","second","attachmentId",second.get("id")));
  assertEquals("YQ==",call(client,"download",Map.of("conversationId",id,"attachmentId",first.get("id"))).get("base64"));
  assertEquals(ImService.FILE_UNAVAILABLE,assertThrows(IllegalArgumentException.class,()->call(client,"download",Map.of("conversationId",id,"attachmentId",second.get("id")))).getMessage());
  var rows=(List<?>)call(client,"messages",Map.of("conversationId",id)).get("messages");
  assertEquals(Map.of("id",second.get("id"),"available",false,"message",ImService.FILE_UNAVAILABLE),((Map<?,?>)rows.get(1)).get("attachment"));
 }
 Map<?,?> attachmentFor(Long user,String conversationId) {
  var rows=(List<?>)call(user,"messages",Map.of("conversationId",conversationId)).get("messages");
  return (Map<?,?>)((Map<?,?>)rows.get(0)).get("attachment");
}
}
