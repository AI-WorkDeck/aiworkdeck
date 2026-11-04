// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version;
import org.junit.jupiter.api.Test;
import java.io.IOException;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

class CloudGitEpochClientTest {
 private static final String REPO="https://case.aiworkdeck.com/git/12.git";
 @Test void freezesEachRepositoryAndCredentialAndSharesObjectTransfers() throws Exception {
  AtomicInteger requests=new AtomicInteger();
  var client=new CloudGitEpochClient((uri,user,token)->{
   assertTrue(uri.getPath().endsWith(".git/awd-cloud-state"));assertEquals("alice",user);
   return new CloudGitEpochClient.Reply(200,"{\"cloudAccess\":{\"epoch\":"+requests.incrementAndGet()+"}}");
  });
  assertEquals("1",client.resolve(REPO,"alice","token").get("X-Cloud-Epoch"));
  assertEquals("1",client.resolve(REPO+"/awd-objects/hash/parts/0?size=10","alice","token").get("X-Cloud-Epoch"));
  assertEquals("2",client.resolve(REPO.replace("12.git","13.git"),"alice","token").get("X-Cloud-Epoch"));
  assertEquals("3",client.resolve(REPO,"alice","other").get("X-Cloud-Epoch"));
  assertEquals("1",client.resolve(REPO,"alice","token").get("X-Cloud-Epoch"));
  assertEquals(3,requests.get());
 }
 @Test void skipsPrivateServersAndLookalikeHostsWithoutSendingCredentials() throws Exception {
  var client=new CloudGitEpochClient((uri,user,token)->{fail("must not send credentials");return null;});
  for(String url:new String[]{"https://case.aiworkdeck.com.evil.invalid/git/12.git","http://case.aiworkdeck.com/git/12.git","https://private.example/git/12.git","https://case.workdeck.ai:8443/git/12.git"})
   assertTrue(client.resolve(url,"alice","token").isEmpty());
 }
 @Test void onlyActual404IsLegacyCompatibility() throws Exception {
  AtomicInteger calls=new AtomicInteger();
  var legacy=new CloudGitEpochClient((uri,user,token)->{calls.incrementAndGet();return new CloudGitEpochClient.Reply(404,"");});
  assertTrue(legacy.resolve(REPO,"alice","token").isEmpty());assertTrue(legacy.resolve(REPO,"alice","token").isEmpty());assertEquals(1,calls.get());
  for(int status:new int[]{301,401,403,429,500}) {
   var denied=new CloudGitEpochClient((uri,user,token)->new CloudGitEpochClient.Reply(status,"{}"));
   assertThrows(IOException.class,()->denied.resolve(REPO,"alice","token"));
  }
  for(String body:new String[]{"{}","{\"cloudAccess\":{\"epoch\":-1}}","{\"cloudAccess\":{\"epoch\":1.5}}","{\"cloudAccess\":{\"epoch\":\"2\"}}"}) {
   var invalid=new CloudGitEpochClient((uri,user,token)->new CloudGitEpochClient.Reply(200,body));
   assertThrows(IOException.class,()->invalid.resolve(REPO,"alice","token"));
  }
 }
 @Test void persistedFenceSurvivesRestartAndOnlyExplicitReconnectCanAcceptNewEpoch(@org.junit.jupiter.api.io.TempDir java.nio.file.Path temp) throws Exception {
  AtomicInteger epoch=new AtomicInteger(4),reads=new AtomicInteger();
  CloudGitEpochClient.Reader reader=(uri,user,token)->{reads.incrementAndGet();return new CloudGitEpochClient.Reply(200,"{\"cloudAccess\":{\"epoch\":"+epoch.get()+"}}");};
  var config=new org.eclipse.jgit.storage.file.FileBasedConfig(temp.resolve("config").toFile(),org.eclipse.jgit.util.FS.DETECTED);
  var first=new CloudGitEpochClient(reader);
  assertThrows(VersionException.class,()->first.verifyConfig(config,REPO,"alice","synthetic-secret"));
  assertEquals(0,reads.get(),"old unbound remotes cannot bootstrap a new permission in the background");
  first.bindConfig(config,REPO,"alice","synthetic-secret");
  assertFalse(java.nio.file.Files.readString(temp.resolve("config")).contains("synthetic-secret"));
  var reopened=new org.eclipse.jgit.storage.file.FileBasedConfig(temp.resolve("config").toFile(),org.eclipse.jgit.util.FS.DETECTED);reopened.load();
  var restarted=new CloudGitEpochClient(reader);
  assertEquals("4",restarted.verifyConfig(reopened,REPO,"alice","synthetic-secret").get("X-Cloud-Epoch"));
  epoch.set(6);
  var stale=assertThrows(VersionException.class,()->restarted.verifyConfig(reopened,REPO+"/awd-objects/hash/parts/0","alice","synthetic-secret"));
  assertTrue(stale.isUserFacing());
  reopened.load();assertEquals("4",reopened.getString("remote","origin","awdCloudEpoch"));
  assertThrows(VersionException.class,()->restarted.verifyConfig(reopened,REPO,"alice","different-secret"));
  restarted.bindConfig(reopened,REPO,"alice","synthetic-secret");
  assertEquals("6",restarted.verifyConfig(reopened,REPO,"alice","synthetic-secret").get("X-Cloud-Epoch"));
 }
 @Test void persistentLegacyBindingNeverAutomaticallyUpgradesAfterServerRollout(@org.junit.jupiter.api.io.TempDir java.nio.file.Path temp) throws Exception {
  AtomicInteger status=new AtomicInteger(404);
  var client=new CloudGitEpochClient((uri,user,token)->new CloudGitEpochClient.Reply(status.get(),"{\"cloudAccess\":{\"epoch\":1}}"));
  var config=new org.eclipse.jgit.storage.file.FileBasedConfig(temp.resolve("config").toFile(),org.eclipse.jgit.util.FS.DETECTED);
  client.bindConfig(config,REPO,"a","token");
  assertTrue(client.verifyConfig(config,REPO,"a","token").isEmpty());
  status.set(200);assertThrows(VersionException.class,()->client.verifyConfig(config,REPO,"a","token"));
  assertEquals("legacy",config.getString("remote","origin","awdCloudEpoch"));
  assertTrue(client.verifyConfig(config,"https://private.invalid/git/12.git","a","token").isEmpty());
 }

 @Test void explicitConnectionDoesNotAdoptEpochChangedMidChain(@org.junit.jupiter.api.io.TempDir java.nio.file.Path temp) throws Exception {
  var client=new CloudGitEpochClient((uri,user,token)->new CloudGitEpochClient.Reply(200,"{\"cloudAccess\":{\"epoch\":5}}"));
  var config=new org.eclipse.jgit.storage.file.FileBasedConfig(temp.resolve("config").toFile(),org.eclipse.jgit.util.FS.DETECTED);
  CloudGitEpochClient.explicitEpoch.set(java.util.Map.of("X-Cloud-Epoch","4"));
  try {assertThrows(VersionException.class,()->client.bindConfig(config,REPO,"a","token"));
   assertNull(config.getString("remote","origin","awdCloudEpoch"));
  } finally {CloudGitEpochClient.explicitEpoch.remove();}
 }

}
