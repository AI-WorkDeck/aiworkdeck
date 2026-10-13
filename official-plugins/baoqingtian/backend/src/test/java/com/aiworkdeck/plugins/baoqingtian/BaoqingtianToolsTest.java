// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.aiworkdeck.plugins.baoqingtian;

import com.checkba.plugin.api.*;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import java.lang.reflect.Proxy;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class BaoqingtianToolsTest {
    record Call(String method, String path, String token, JsonNode body) {}
    static class Fake implements BaoqingtianTools.Transport {
        List<Call> calls = new ArrayList<>();
        String note = "{\"id\":\"9007199254740993\",\"lawyerId\":\"99\",\"type\":\"TEXT\",\"title\":\"原稿\",\"content\":\"正文\",\"status\":\"DRAFT\"}";
        String list = "{\"list\":[],\"total\":0}";
        int status = 200;
        boolean timeout, rejected, notLawyer, overrideWrite;
        String writeReply;
        public BaoqingtianTools.Reply request(String method, String path, String token, JsonNode body) throws Exception {
            calls.add(new Call(method, path, token, body));
            if (timeout) throw new java.net.http.HttpTimeoutException("do not leak TOKEN phone");
            if (overrideWrite && (path.endsWith("/add") || path.endsWith("/edit"))) return new BaoqingtianTools.Reply(status, writeReply);
            String data = "null";
            if (path.endsWith("phoneSmsLogin")) data = "{\"token\":\"SECRET\"}";
            else if (path.endsWith("user/info")) data = "{\"id\":\"99\",\"nickName\":\"律师\",\"type\":" + (notLawyer ? 0 : 1) + "}";
            else if (path.contains("/detail?")) data = note;
            else if (path.endsWith("lawyer/page") || path.endsWith("listAllCases")) data = list;
            else if (path.endsWith("/add")) data = "{\"noteId\":\"901\"}";
            else if (path.endsWith("listEnable")) data = "[{\"id\":\"2\",\"name\":\"劳动\"}]";
            else if (path.endsWith("/edit")) data = "{\"isSuccess\":" + !rejected + "}";
            return new BaoqingtianTools.Reply(status, "{\"code\":0,\"data\":" + data + "}");
        }
    }
    static class Fixture {
        Fake remote = new Fake();
        long user = 1;
        boolean member = true;
        BaoqingtianTools tools = new BaoqingtianTools(remote);
        Fixture() {
            Files files = (Files) Proxy.newProxyInstance(getClass().getClassLoader(), new Class[]{Files.class}, (p,m,a) -> {
                if (!member) throw new IllegalStateException("private membership"); return List.of();
            });
            tools.setHost((PluginHost) Proxy.newProxyInstance(getClass().getClassLoader(), new Class[]{PluginHost.class}, (p,m,a) -> switch (m.getName()) {
                case "call" -> new ToolCall(10L, "", user, ""); case "files" -> files; default -> null;
            }));
        }
        JsonNode run(String action, String args) throws Exception { return BaoqingtianTools.JSON.readTree(tools.baoqingtian_action(action,args)); }
        void login() throws Exception { assertTrue(run("login", "{\"mobile\":\"13800000000\",\"authCode\":\"123456\"}").path("ok").asBoolean()); }
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
    @Test void newDraftRequiresBusinessAndUsesRealDraftFlag() throws Exception {
        Fixture f = new Fixture(); f.login();
        assertFalse(f.run("note_save", "{\"title\":\"标题\",\"content\":\"正文\",\"confirmed\":true}").path("ok").asBoolean());
        assertTrue(f.run("note_save", "{\"title\":\"标题\",\"content\":\"正文\",\"businessId\":\"2\",\"confirmed\":true}").path("ok").asBoolean());
        Call c = f.remote.calls.getLast(); assertEquals("/bqt/lawyer/note/add",c.path); assertEquals("DRAFT",c.body.path("status").asText()); assertEquals("N",c.body.path("isNoteDraft").asText()); assertFalse(c.body.has("lawyerId"));
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
        JsonNode result = f.run("note_save", "{\"title\":\"标题\",\"content\":\"正文\",\"businessId\":\"2\",\"confirmed\":true}");
        assertEquals("outcome_unknown",result.path("errorCode").asText()); assertEquals(count+1,f.remote.calls.size()); assertFalse(result.toString().contains("TOKEN"));
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
            JsonNode result = f.run("note_save", "{\"title\":\"标题\",\"content\":\"正文\",\"businessId\":\"2\",\"confirmed\":true}");
            assertEquals("outcome_unknown", result.path("errorCode").asText());
            assertFalse(result.path("ok").asBoolean()); assertEquals(count + 1, f.remote.calls.size());
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
            JsonNode result = f.run("note_save", "{\"title\":\"标题\",\"content\":\"正文\",\"businessId\":\"2\",\"confirmed\":true}");
            assertEquals("outcome_unknown", result.path("errorCode").asText());
            assertFalse(result.path("ok").asBoolean()); assertEquals(count + 1, f.remote.calls.size());
        }
        f.remote.status = 503;
        assertEquals("outcome_unknown", f.run("note_save", "{\"title\":\"标题\",\"content\":\"正文\",\"businessId\":\"2\",\"confirmed\":true}").path("errorCode").asText());
    }

}
