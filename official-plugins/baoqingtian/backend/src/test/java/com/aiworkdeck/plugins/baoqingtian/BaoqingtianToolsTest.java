// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.aiworkdeck.plugins.baoqingtian;

import com.checkba.plugin.api.*;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import java.lang.reflect.Proxy;
import java.util.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.spec.*;
import javax.crypto.*;
import javax.crypto.spec.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import static org.junit.jupiter.api.Assertions.*;

class BaoqingtianToolsTest {
    record Call(String method, String path, String token, JsonNode body) {}
    static class Fake implements BaoqingtianTools.Transport {
        List<Call> calls = new ArrayList<>();
        String note = "{\"id\":\"9007199254740993\",\"lawyerId\":\"99\",\"type\":\"TEXT\",\"title\":\"原稿\",\"content\":\"正文\",\"status\":\"DRAFT\"}";
        String list = "{\"list\":[],\"total\":0}";
        int status = 200, remoteCode;
        boolean timeout, rejected, notLawyer, overrideWrite;
        String writeReply;
        String certStatus = "cert_succeed";
        Runnable onRequest = () -> {};
        public BaoqingtianTools.Reply request(String method, String path, String token, JsonNode body) throws Exception {
            calls.add(new Call(method, path, token, body));
            onRequest.run();
            if (timeout && (path.endsWith("/add") || path.endsWith("/edit"))) throw new java.net.http.HttpTimeoutException("do not leak TOKEN phone");
            if (overrideWrite && (path.endsWith("/add") || path.endsWith("/edit"))) return new BaoqingtianTools.Reply(status, writeReply);
            String data = "null";
            if (path.endsWith("phoneSmsLogin")) data = "{\"token\":\"SECRET\"}";
            else if (path.endsWith("user/info")) data = "{\"id\":\"99\",\"nickName\":\"律师\",\"type\":" + (notLawyer ? 0 : 1) + "}";
            else if (path.contains("/detail?")) data = note;
            else if (path.endsWith("lawyer/page") || path.endsWith("listAllCases")) data = list;
            else if (path.endsWith("/cert/status")) data = "{\"status\":\"" + certStatus + "\"}";
            else if (path.endsWith("/add")) data = "{\"noteId\":\"901\"}";
            else if (path.endsWith("listEnable")) data = "[{\"id\":\"2\",\"name\":\"劳动\"}]";
            else if (path.endsWith("/edit")) data = "{\"isSuccess\":" + !rejected + "}";
            return new BaoqingtianTools.Reply(path.endsWith("/cert/status") ? 200 : status, "{\"code\":" + remoteCode + ",\"msg\":\"PRIVATE_REMOTE_RESPONSE\",\"data\":" + data + "}");
        }
    }
    static class Fixture {
        Fake remote = new Fake();
        long user = 1;
        boolean member = true;
        BaoqingtianTools tools = new BaoqingtianTools(remote);
        PublicKey publicKey;
        String lastOuterResponse;
        Fixture() {
            Files files = (Files) Proxy.newProxyInstance(getClass().getClassLoader(), new Class[]{Files.class}, (p,m,a) -> {
                if (!member) throw new IllegalStateException("private membership"); return List.of();
            });
            tools.setHost((PluginHost) Proxy.newProxyInstance(getClass().getClassLoader(), new Class[]{PluginHost.class}, (p,m,a) -> switch (m.getName()) {
                case "call" -> new ToolCall(10L, "", user, ""); case "files" -> files; default -> null;
            }));
        }
        JsonNode run(String action, String args) throws Exception {
            if (publicKey == null) {
                JsonNode pub = BaoqingtianTools.JSON.readTree(tools.baoqingtian_action("transport_key", "{}"));
                if (!pub.path("ok").asBoolean()) return pub;
                publicKey = KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(Base64.getDecoder().decode(pub.path("data").path("publicKey").asText())));
            }
            ClientRequest request = encrypt(publicKey,action,BaoqingtianTools.JSON.readTree(args));
            lastOuterResponse = tools.baoqingtian_action("secure",request.envelope.toString());
            JsonNode outer = BaoqingtianTools.JSON.readTree(lastOuterResponse);
            if (!outer.path("ok").asBoolean()) return outer;
            return decrypt(request,outer.path("data"));
        }
        JsonNode begin(String input) throws Exception {
            var args=(com.fasterxml.jackson.databind.node.ObjectNode)BaoqingtianTools.JSON.readTree(input);
            args.put("operationId",UUID.randomUUID().toString()).put("type","IMAGE");
            args.set("files",BaoqingtianTools.JSON.valueToTree(List.of(Map.of("name","a.png","size",16,"mime","image/png"))));
            return run("note_begin",args.toString());
        }
        void login() throws Exception { assertTrue(run("login", "{\"mobile\":\"13800000000\",\"authCode\":\"123456\"}").path("ok").asBoolean()); }
    }
    record ClientRequest(ObjectNode envelope, SecretKey key, String nonce) {}
    static ClientRequest encrypt(PublicKey publicKey,String action,JsonNode args) throws Exception {
        SecureRandom random=new SecureRandom();byte[] rawKey=new byte[32],iv=new byte[12],nonceBytes=new byte[32];random.nextBytes(rawKey);random.nextBytes(iv);random.nextBytes(nonceBytes);
        String nonce=Base64.getEncoder().encodeToString(nonceBytes);SecretKey key=new SecretKeySpec(rawKey,"AES");
        Cipher rsa=Cipher.getInstance("RSA/ECB/OAEPPadding");rsa.init(Cipher.ENCRYPT_MODE,publicKey,new OAEPParameterSpec("SHA-256","MGF1",MGF1ParameterSpec.SHA256,PSource.PSpecified.DEFAULT));
        Cipher aes=Cipher.getInstance("AES/GCM/NoPadding");aes.init(Cipher.ENCRYPT_MODE,key,new GCMParameterSpec(128,iv));aes.updateAAD(("bqt:v1:request:"+nonce).getBytes(StandardCharsets.UTF_8));
        ObjectNode payload=BaoqingtianTools.JSON.createObjectNode().put("action",action).put("expiresAt",System.currentTimeMillis()+5*60*1000);payload.set("args",args);
        ObjectNode envelope=BaoqingtianTools.JSON.createObjectNode().put("v",1).put("nonce",nonce).put("key",Base64.getEncoder().encodeToString(rsa.doFinal(rawKey)))
            .put("iv",Base64.getEncoder().encodeToString(iv)).put("data",Base64.getEncoder().encodeToString(aes.doFinal(payload.toString().getBytes(StandardCharsets.UTF_8))));
        return new ClientRequest(envelope,key,nonce);
    }
    static JsonNode decrypt(ClientRequest request,JsonNode response) throws Exception {
        assertEquals(request.nonce,response.path("nonce").asText());Cipher aes=Cipher.getInstance("AES/GCM/NoPadding");
        aes.init(Cipher.DECRYPT_MODE,request.key,new GCMParameterSpec(128,Base64.getDecoder().decode(response.path("iv").asText())));
        aes.updateAAD(("bqt:v1:response:"+request.nonce).getBytes(StandardCharsets.UTF_8));
        return BaoqingtianTools.JSON.readTree(aes.doFinal(Base64.getDecoder().decode(response.path("data").asText())));
    }
    @Test void pcSmsAndLoginContractNeverReturnsToken() throws Exception {
        Fixture f = new Fixture();
        assertTrue(f.run("sms", "{\"countryCode\":\"+852\",\"mobile\":\"61234567\"}").path("data").path("sent").asBoolean());
        assertEquals("/bqt/unapp/pagehome/fetchSmsCode/61234567?countryCode=%2B852&type=lawyer_login", f.remote.calls.getFirst().path);
        f.login(); Call login = f.remote.calls.get(1);
        assertEquals("lawyer_login", login.body.path("authCodeType").asText()); assertFalse(login.body.has("type"));
        JsonNode status = f.run("status", "{}"); assertEquals("99", status.path("data").path("accountId").asText()); assertFalse(status.toString().contains("SECRET"));
    }
    @Test void identityAndMembershipAreRequiredAndSessionsAreIsolated() throws Exception {
        Fixture f = new Fixture(); f.login(); f.user = 2;
        assertFalse(f.run("status", "{}").path("data").path("connected").asBoolean());
        assertEquals("auth_required", f.run("notes", "{}").path("errorCode").asText());
        f.user = 1; f.member = false; int count = f.remote.calls.size();
        assertFalse(f.run("note_status", "{\"id\":\"1\",\"status\":\"deleted\",\"confirmed\":true}").path("ok").asBoolean()); assertEquals(count, f.remote.calls.size());
    }
    @Test void nonLawyerCannotCreateSession() throws Exception {
        Fixture f = new Fixture(); f.remote.notLawyer = true;
        assertEquals("not_lawyer", f.run("login", "{\"mobile\":\"13800000000\",\"authCode\":\"123456\"}").path("errorCode").asText());
        assertFalse(f.run("status", "{}").path("data").path("connected").asBoolean());
    }
    @Test void unauthorizedResponseDropsOnlyCurrentSession() throws Exception {
        Fixture f = new Fixture(); f.login(); f.user = 2; f.login(); f.user = 1; f.remote.status = 401;
        assertEquals("auth_required", f.run("notes", "{}").path("errorCode").asText()); f.remote.status = 200;
        assertFalse(f.run("status", "{}").path("data").path("connected").asBoolean()); f.user = 2;
        assertTrue(f.run("status", "{}").path("data").path("connected").asBoolean());
    }
    @Test void detailAndWritesRejectForeignOwnerWithoutMutation() throws Exception {
        Fixture f = new Fixture(); f.login(); f.remote.note = f.remote.note.replace("\"99\"", "\"100\"");
        for (String action : List.of("note_detail", "note_save", "note_status")) {
            assertEquals("not_owner", f.run(action, "{\"id\":\"9007199254740993\",\"title\":\"标题\",\"content\":\"正文\",\"status\":\"private\"}").path("errorCode").asText());
        }
        assertTrue(f.remote.calls.stream().noneMatch(c -> c.path.endsWith("/edit") || c.path.endsWith("/changeStatus")));
    }
    @Test void mediaEditPreservesPayloadAndUsesEditNotAdd() throws Exception {
        Fixture f = new Fixture(); f.login();
        f.remote.note = "{\"id\":\"9007199254740993\",\"lawyerId\":\"99\",\"type\":\"IMAGE\",\"content\":[\"https://example/a\",\"https://example/b\"],\"cover\":\"cover\",\"topicId\":\"12\",\"productId\":\"13\",\"status\":\"PRIVATE\",\"hotSpot\":{\"uid\":\"h1\"}}";
        assertTrue(f.run("note_save", "{\"id\":\"9007199254740993\",\"title\":\"改标题\",\"content\":\"新描述\",\"status\":\"private\"}").path("ok").asBoolean());
        Call c = f.remote.calls.getLast(); assertEquals("/bqt/lawyer/note/edit", c.path);
        assertEquals("https://example/a;https://example/b", c.body.path("content").asText()); assertEquals("新描述", c.body.path("description").asText());
        assertEquals("cover", c.body.path("cover").asText()); assertEquals("12", c.body.path("topicId").asText()); assertEquals("13", c.body.path("productId").asText());
        assertEquals("h1", c.body.path("hotSpot").path("uid").asText()); assertEquals("9007199254740993", c.body.path("noteId").asText());
    }
    @Test void newDraftRequiresMediaBusinessAndUsesUploadPendingFlag() throws Exception {
        Fixture f = new Fixture(); f.login();
        assertEquals("media_required", f.run("note_save", "{\"title\":\"标题\",\"content\":\"正文\",\"confirmed\":true}").path("errorCode").asText());
        assertFalse(f.begin("{\"title\":\"标题\",\"content\":\"正文\",\"confirmed\":true}").path("ok").asBoolean());
        assertTrue(f.begin("{\"title\":\"标题\",\"content\":\"正文\",\"businessId\":\"2\",\"confirmed\":true}").path("ok").asBoolean());
        Call c = f.remote.calls.getLast(); assertEquals("/bqt/lawyer/note/add",c.path); assertEquals("DRAFT",c.body.path("status").asText()); assertEquals("Y",c.body.path("isNoteDraft").asText()); assertFalse(c.body.has("lawyerId"));
    }
    @Test void publishAndDeleteNeedExplicitConfirmation() throws Exception {
        Fixture f = new Fixture(); f.login(); int n = f.remote.calls.size();
        assertEquals("confirmation_required", f.run("note_save", "{\"id\":\"9007199254740993\",\"title\":\"标题\",\"content\":\"正文\",\"status\":\"published\"}").path("errorCode").asText());
        assertEquals("confirmation_required", f.run("note_status", "{\"id\":\"9007199254740993\",\"status\":\"deleted\"}").path("errorCode").asText()); assertEquals(n,f.remote.calls.size());
    }
    @Test void failedWriteAndUnknownOutcomeNeverBecomeSuccessOrRetry() throws Exception {
        Fixture f = new Fixture(); f.login(); f.remote.rejected = true;
        assertEquals("remote_rejected", f.run("note_save", "{\"id\":\"9007199254740993\",\"title\":\"标题\",\"content\":\"正文\"}").path("errorCode").asText());
        f.remote.timeout = true; int count = f.remote.calls.size();
        JsonNode result = f.begin("{\"title\":\"标题\",\"content\":\"正文\",\"businessId\":\"2\",\"confirmed\":true}");
        assertEquals("outcome_unknown",result.path("errorCode").asText()); assertEquals(count+2,f.remote.calls.size()); assertFalse(result.toString().contains("TOKEN"));
    }
    @Test void casesSupportBothEnvelopesAndBoundedPagination() throws Exception {
        Fixture f = new Fixture(); f.login();
        f.remote.list = "{\"list\":[{\"id\":\"9007199254740993\",\"demand\":\"合同争议\"}],\"total\":41}";
        assertTrue(f.run("cases", "{\"page\":2}").path("data").path("hasMore").asBoolean());
        assertEquals(20,f.remote.calls.getLast().body.path("limit").asInt());
        f.remote.list = "{\"caseList\":"+f.remote.list+"}";
        JsonNode r=f.run("cases", "{\"page\":3}").path("data"); assertFalse(r.path("hasMore").asBoolean()); assertEquals("9007199254740993",r.path("items").get(0).path("id").asText());
    }
    @Test void businessTypesUseLiveEnabledList() throws Exception {
        Fixture f = new Fixture(); f.login(); assertEquals("2",f.run("business_types", "{}").path("data").path("items").get(0).path("id").asText());
        assertEquals("GET",f.remote.calls.getLast().method); assertEquals("/bqt/sys/lawBusinessType/listEnable",f.remote.calls.getLast().path);
    }
    @Test void noteSearchUsesServerKeywordAndRejectsExcessBeforeRequest() throws Exception {
        Fixture f = new Fixture(); f.login();
        assertTrue(f.run("notes", "{\"page\":2,\"keyword\":\" 合同争议 \"}").path("ok").asBoolean());
        Call c = f.remote.calls.getLast();
        assertEquals("合同争议", c.body.path("keyword").asText());
        assertEquals(2, c.body.path("pageNum").asInt()); assertEquals(20, c.body.path("pageSize").asInt());
        int n = f.remote.calls.size();
        for (String keyword : List.of("x".repeat(201), "x".repeat(300))) {
            assertEquals("invalid_params", f.run("notes", BaoqingtianTools.JSON.createObjectNode().put("keyword", keyword).toString()).path("errorCode").asText());
        }
        assertEquals("invalid_params", f.run("notes", "{\"keyword\":42}").path("errorCode").asText());
        assertEquals(n, f.remote.calls.size());
        assertTrue(f.run("notes", "{\"keyword\":\"   \"}").path("ok").asBoolean());
        assertFalse(f.remote.calls.getLast().body.has("keyword"));
    }
    @Test void missingNewIdIsUnknownWithoutRetry() throws Exception {
        Fixture f = new Fixture(); f.login(); f.remote.overrideWrite = true;
        for (String data : List.of("null", "{}", "{\"noteId\":null}", "{\"noteId\":\"\"}")) {
            f.remote.writeReply = "{\"code\":0,\"data\":" + data + "}";
            int count = f.remote.calls.size();
            JsonNode result = f.begin("{\"title\":\"标题\",\"content\":\"正文\",\"businessId\":\"2\",\"confirmed\":true}");
            assertEquals("outcome_unknown", result.path("errorCode").asText());
            assertFalse(result.path("ok").asBoolean()); assertEquals(count + 2, f.remote.calls.size());
        }
    }
    @Test void missingEditAcknowledgementIsUnknownWithoutRetry() throws Exception {
        Fixture f = new Fixture(); f.login(); f.remote.overrideWrite = true;
        for (String data : List.of("null", "{}", "{\"success\":true}", "{\"isSuccess\":null}", "{\"isSuccess\":\"false\"}")) {
            f.remote.writeReply = "{\"code\":0,\"data\":" + data + "}";
            int count = f.remote.calls.size();
            JsonNode result = f.run("note_save", "{\"id\":\"9007199254740993\",\"title\":\"标题\",\"content\":\"正文\"}");
            assertEquals("outcome_unknown", result.path("errorCode").asText());
            assertFalse(result.path("ok").asBoolean()); assertEquals(count + 2, f.remote.calls.size());
        }
    }
    @Test void oversizedMissingMalformedOrServerErrorWriteResponseIsUnknown() throws Exception {
        Fixture f = new Fixture(); f.login(); f.remote.overrideWrite = true;
        List<String> responses = new ArrayList<>(List.of("x".repeat(BaoqingtianTools.MAX_RESPONSE + 1), "not json", "{}"));
        responses.add(null);
        for (String response : responses) {
            f.remote.writeReply = response;
            int count = f.remote.calls.size();
            JsonNode result = f.begin("{\"title\":\"标题\",\"content\":\"正文\",\"businessId\":\"2\",\"confirmed\":true}");
            assertEquals("outcome_unknown", result.path("errorCode").asText());
            assertFalse(result.path("ok").asBoolean()); assertEquals(count + 2, f.remote.calls.size());
        }
        f.remote.status = 503;
        assertEquals("outcome_unknown", f.begin("{\"title\":\"标题\",\"content\":\"正文\",\"businessId\":\"2\",\"confirmed\":true}").path("errorCode").asText());
    }

    @Test void imageAndVideoTitleOnlyEditsAllowEmptyDescriptionAndKeepMedia() throws Exception {
        for (String type : List.of("IMAGE", "VIDEO")) {
            Fixture f = new Fixture(); f.login();
            String media = type.equals("IMAGE") ? "https://example/a;https://example/b" : "https://example/video.mp4";
            f.remote.note = BaoqingtianTools.JSON.createObjectNode().put("id", "9007199254740993").put("lawyerId", "99")
                .put("type", type).put("title", "旧标题").put("content", media).put("description", "").put("cover", "cover").put("status", "PRIVATE").toString();
            JsonNode result = f.run("note_save", "{\"id\":\"9007199254740993\",\"title\":\"新标题\",\"content\":\"\",\"status\":\"private\"}");
            assertTrue(result.path("ok").asBoolean(), result.toString());
            Call c = f.remote.calls.getLast(); assertEquals("/bqt/lawyer/note/edit", c.path);
            assertEquals(type, c.body.path("type").asText()); assertEquals(media, c.body.path("content").asText());
            assertEquals("", c.body.path("description").asText()); assertEquals("新标题", c.body.path("title").asText());
            assertEquals("cover", c.body.path("cover").asText());
            int count = f.remote.calls.size();
            String oversized = BaoqingtianTools.JSON.createObjectNode().put("id", "9007199254740993").put("title", "新标题").put("content", "x".repeat(50_001)).put("status", "private").toString();
            assertEquals("invalid_params", f.run("note_save", oversized).path("errorCode").asText()); assertEquals(count, f.remote.calls.size());
        }
    }
    @Test void newAndExistingTextNotesStillRejectEmptyOrWhitespaceBody() throws Exception {
        Fixture f = new Fixture(); f.login();
        for (boolean edit : List.of(false, true)) {
            for (String content : List.of("", "   ")) {
                var args = BaoqingtianTools.JSON.createObjectNode().put("title", "标题").put("content", content).put("businessId", "2").put("confirmed", true);
                if (edit) args.put("id", "9007199254740993");
                int count = f.remote.calls.size();
                assertEquals(edit ? "invalid_params" : "media_required", f.run("note_save", args.toString()).path("errorCode").asText());
                assertEquals(count + (edit ? 1 : 0), f.remote.calls.size());
                assertTrue(f.remote.calls.stream().noneMatch(c -> c.path.endsWith("/add") || c.path.endsWith("/edit")));
            }
        }
    }

    @Test void newNoteChecksCertificationBeforeWriting() throws Exception {
        for (String status : List.of("not_cert", "cert_reviewing", "uncert", "cert_failed", "")) {
            Fixture f = new Fixture(); f.login(); f.remote.certStatus = status;
            JsonNode result = f.begin("{\"title\":\"标题\",\"content\":\"正文\",\"businessId\":\"2\",\"confirmed\":true}");
            assertEquals("certification_required", result.path("errorCode").asText());
            assertTrue(f.remote.calls.stream().noneMatch(c -> c.path.endsWith("/add")));
            Call c = f.remote.calls.getLast(); assertEquals("/bqt/lawyer/cert/status", c.path); assertEquals("POST", c.method); assertEquals("{}", c.body.toString());
        }
    }
    @Test void knownPreflightRejectionsAreActionableAndUnknownWriteCodesAreUncertain() throws Exception {
        Fixture f = new Fixture(); f.login(); f.remote.overrideWrite = true;
        for (int code : List.of(21055, 21107, 99999)) {
            f.remote.writeReply = "{\"code\":" + code + ",\"msg\":\"SECRET_TOKEN_PRIVATE_MATERIAL\",\"data\":null}";
            int count = f.remote.calls.size();
            JsonNode result = f.begin("{\"title\":\"标题\",\"content\":\"正文\",\"businessId\":\"2\",\"confirmed\":true}");
            assertEquals(code == 21055 ? "certification_required" : code == 21107 ? "invalid_business" : "outcome_unknown", result.path("errorCode").asText());
            assertTrue(result.path("error").asText().contains(String.valueOf(code))); assertFalse(result.toString().contains("SECRET_TOKEN_PRIVATE_MATERIAL"));
            assertEquals(count + 2, f.remote.calls.size());
        }
        f.remote.writeReply = "{\"code\":21008,\"msg\":\"PRIVATE\"}";
        assertEquals("auth_required", f.begin("{\"title\":\"标题\",\"content\":\"正文\",\"businessId\":\"2\",\"confirmed\":true}").path("errorCode").asText());
        assertFalse(f.run("status", "{}").path("data").path("connected").asBoolean());
    }

    @Test void readErrorsExposeOnlyNumericCodeNotRemoteMessage() throws Exception {
        Fixture f = new Fixture(); f.login(); f.remote.remoteCode = 29999;
        JsonNode result = f.run("notes", "{}");
        assertEquals("remote_error", result.path("errorCode").asText()); assertTrue(result.path("error").asText().contains("29999"));
        assertFalse(result.toString().contains("PRIVATE_REMOTE_RESPONSE"));
        f.remote.status = 403;
        assertTrue(f.run("notes", "{}").path("error").asText().contains("HTTP 403"));
    }

    @Test void fixedValidationMessagesProduceControlledFieldHints() throws Exception {
        Fixture f = new Fixture(); f.login(); f.remote.overrideWrite = true;
        Map<String, String> expected = Map.of("笔记标题不能为空", "标题", "笔记类型不能为空", "类型", "内容不能为空", "正文", "笔记状态不能为空", "状态", "请选择正确的草稿标识", "草稿", "必须指定业务类型", "业务类型");
        for (int code : List.of(10029, 10003)) {
            for (var entry : expected.entrySet()) {
                f.remote.writeReply = BaoqingtianTools.JSON.createObjectNode().put("code", code).put("msg", entry.getKey()).put("private", "UNRELATED_SECRET").toString();
                JsonNode result = f.begin("{\"title\":\"标题\",\"content\":\"正文\",\"businessId\":\"2\",\"confirmed\":true}");
                assertEquals("invalid_params", result.path("errorCode").asText());
                assertTrue(result.path("error").asText().contains(entry.getValue())); assertTrue(result.path("error").asText().contains(String.valueOf(code)));
                assertFalse(result.toString().contains("UNRELATED_SECRET"));
            }
        }
    }
    @Test void validationCodeDoesNotAllowPartialMatchesOrSecretMessages() throws Exception {
        Fixture f = new Fixture(); f.login(); f.remote.overrideWrite = true;
        for (int code : List.of(10029, 10003, 99999)) {
            for (String message : List.of("PRIVATE_TOKEN_PHONE", "笔记标题不能为空 PRIVATE_TOKEN_PHONE", "PRIVATE_TOKEN_PHONE内容不能为空", "必须指定业务类型\nPRIVATE_TOKEN_PHONE", " 内容不能为空")) {
                f.remote.writeReply = BaoqingtianTools.JSON.createObjectNode().put("code", code).put("msg", message).toString();
                JsonNode result = f.begin("{\"title\":\"标题\",\"content\":\"正文\",\"businessId\":\"2\",\"confirmed\":true}");
                assertEquals("outcome_unknown", result.path("errorCode").asText());
                assertTrue(result.path("error").asText().contains(String.valueOf(code))); assertFalse(result.toString().contains("PRIVATE_TOKEN_PHONE"));
                assertFalse(result.path("error").asText().contains(message));
            }
        }
        f.remote.writeReply = "{\"code\":99999,\"msg\":\"内容不能为空\"}";
        assertEquals("outcome_unknown", f.begin("{\"title\":\"标题\",\"content\":\"正文\",\"businessId\":\"2\",\"confirmed\":true}").path("errorCode").asText());
    }

    @Test void plaintextBusinessRequestsFailClosed() throws Exception {
        Fixture f=new Fixture();
        for(String action:List.of("sms","login","status","notes","media_upload")) {
            JsonNode result=BaoqingtianTools.JSON.readTree(f.tools.baoqingtian_action(action,"{}"));
            assertEquals("secure_required",result.path("errorCode").asText());
        }
        assertEquals(0,f.remote.calls.size());
    }
    @Test void bridgeOutputsEncryptPrivateSuccessAndBusinessErrors() throws Exception {
        Fixture f=new Fixture();f.login();
        assertFalse(f.lastOuterResponse.contains("SECRET"));assertFalse(f.lastOuterResponse.contains("律师"));
        assertTrue(f.run("status","{}").path("data").path("connected").asBoolean());assertFalse(f.lastOuterResponse.contains("accountId"));
        JsonNode error=f.run("note_save","{\"title\":\"秘密标题\",\"content\":\"私人正文\"}");
        assertEquals("media_required",error.path("errorCode").asText());assertFalse(f.lastOuterResponse.contains("media_required"));assertFalse(f.lastOuterResponse.contains("私人正文"));
    }
    @Test void encryptedPayloadDoesNotBypassMembershipNestedActionOrInnerLimits() throws Exception {
        Fixture f=new Fixture();f.login();int n=f.remote.calls.size();f.member=false;
        assertFalse(f.run("notes","{}").path("ok").asBoolean());assertFalse(f.lastOuterResponse.contains("unavailable"));assertEquals(n,f.remote.calls.size());
        f.member=true;
        assertFalse(f.run("secure","{}").path("ok").asBoolean());
        String large=BaoqingtianTools.JSON.createObjectNode().put("keyword","x".repeat(100_001)).toString();
        assertEquals("invalid_params",f.run("notes",large).path("errorCode").asText());assertFalse(f.lastOuterResponse.contains("invalid_params"));assertEquals(n,f.remote.calls.size());
        assertEquals("upload_not_found",f.run("media_upload",BaoqingtianTools.JSON.createObjectNode().put("base64","a".repeat(120_000)).toString()).path("errorCode").asText());
    }
    @Test void oversizedOuterAndMalformedEnvelopeNeverReachBusiness() throws Exception {
        Fixture f=new Fixture();
        for(String input:List.of("{}","not-json","x".repeat(9*1024*1024+1))) {
            assertEquals("secure_invalid",BaoqingtianTools.JSON.readTree(f.tools.baoqingtian_action("secure",input)).path("errorCode").asText());
        }
        assertEquals(0,f.remote.calls.size());
    }

    @Test void sequentialRequestsShareDeadlineAndNextCallGetsFreshBudget() throws Exception {
        Fixture f = new Fixture();
        var clock = new java.util.concurrent.atomic.AtomicLong();
        f.remote.onRequest = () -> clock.addAndGet(java.time.Duration.ofSeconds(25).toNanos());
        try (CallDeadline ignored = CallDeadline.open(clock::get)) {
            JsonNode result = f.run("login", "{\"mobile\":\"13800000000\",\"authCode\":\"123456\"}");
            assertEquals("request_not_sent", result.path("errorCode").asText());
            assertEquals(2, f.remote.calls.size()); // No third request once the shared budget is exhausted.
        }
        f.remote.onRequest = () -> {};
        f.login();
    }

    @Test void apiAndCosTimeoutCapsShrinkAgainstOneMonotonicBudget() {
        var clock = new java.util.concurrent.atomic.AtomicLong();
        try (CallDeadline ignored = CallDeadline.open(clock::get)) {
            assertEquals(25_000, CallDeadline.remainingMillis(25_000));
            clock.addAndGet(java.time.Duration.ofSeconds(24).toNanos());
            assertEquals(26_000, CallDeadline.remainingMillis(45_000));
            try (CallDeadline nested = CallDeadline.open()) {
                clock.addAndGet(java.time.Duration.ofSeconds(25).toNanos());
                assertEquals(1_000, CallDeadline.remainingMillis(30_000));
            }
            clock.addAndGet(java.time.Duration.ofSeconds(1).toNanos());
            assertEquals("request_not_sent", assertThrows(BaoqingtianTools.Failure.class, () -> CallDeadline.remainingMillis(30_000)).code);
        }
        assertEquals(30_000, CallDeadline.remainingMillis(30_000));
    }

}
