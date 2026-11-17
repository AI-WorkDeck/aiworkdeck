// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.mcp;

import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.*;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetAddress;
import java.net.Proxy;
import java.net.UnknownHostException;
import java.util.*;
import java.util.function.Function;

import static org.junit.jupiter.api.Assertions.*;

class PluginPublicDnsTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private final List<Request> requests = new ArrayList<>();

    private PluginPublicDns resolver(Function<Request, String> reply) {
        return new PluginPublicDns(PluginPublicDns.client().newBuilder().addInterceptor(chain -> {
            Request request = chain.request();
            requests.add(request);
            return new Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("OK")
                    .body(ResponseBody.create(reply.apply(request), MediaType.get("application/dns-json"))).build();
        }).build());
    }

    private static String reply(Request request, List<Map<String, Object>> answers) {
        return json(Map.of("Status", 0, "TC", false, "Question", Map.of("name", request.url().queryParameter("name") + ".",
                "type", Integer.parseInt(request.url().queryParameter("type"))), "Answer", answers));
    }
    private static Map<String, Object> answer(String name, int type, String data) {
        return Map.of("name", name, "type", type, "data", data);
    }
    private static String json(Object value) {
        try { return JSON.writeValueAsString(value); }
        catch (IOException e) { throw new AssertionError(e); }
    }

    @Test void combinesAAndAaaaWithoutSendingAnythingExceptTheQuestion() throws Exception {
        PluginPublicDns dns = resolver(request -> reply(request, List.of(answer("service.example.",
                Integer.parseInt(request.url().queryParameter("type")),
                "1".equals(request.url().queryParameter("type")) ? "93.184.216.34" : "2606:2800:220:1:248:1893:25c8:1946"))));
        var addresses = dns.lookup("Service.Example.");
        assertEquals(2, addresses.size());
        assertEquals("93.184.216.34", addresses.get(0).getHostAddress());
        assertEquals(16, addresses.get(1).getAddress().length);
        assertEquals(2, requests.size());
        for (Request request : requests) {
            assertEquals("https", request.url().scheme());
            assertEquals("dns.alidns.com", request.url().host());
            assertEquals("/resolve", request.url().encodedPath());
            assertEquals(Set.of("name", "type"), request.url().queryParameterNames());
            assertEquals("service.example", request.url().queryParameter("name"));
            assertEquals("GET", request.method());
            assertNull(request.body());
            assertEquals(Set.of("Accept"), request.headers().names());
        }
    }

    @Test void followsCnameAnswersRegardlessOfOrderAndIgnoresUnrelatedRecords() throws Exception {
        PluginPublicDns dns = resolver(request -> reply(request, "1".equals(request.url().queryParameter("type"))
                ? List.of(answer("unrelated.example", 1, "127.0.0.1"), answer("cdn.example", 1, "93.184.216.34"),
                    answer("service.example", 5, "CDN.EXAMPLE.")) : List.of()));
        assertEquals(List.of(InetAddress.getByAddress(new byte[]{93, (byte) 184, (byte) 216, 34})), dns.lookup("service.example"));
    }

    @Test void noDataForOneFamilyIsAllowedButBothEmptyFail() throws Exception {
        PluginPublicDns v6Only = resolver(request -> reply(request, "28".equals(request.url().queryParameter("type"))
                ? List.of(answer("service.example", 28, "2001:4860:4860::8888")) : List.of()));
        assertEquals(16, v6Only.lookup("service.example").get(0).getAddress().length);
        assertThrows(UnknownHostException.class, () -> resolver(request -> reply(request, List.of())).lookup("service.example"));
        PluginPublicDns arrayQuestion = resolver(request -> json(Map.of("Status", 0,
                "Question", List.of(Map.of("name", "service.example.", "type", Integer.parseInt(request.url().queryParameter("type")))),
                "Answer", "1".equals(request.url().queryParameter("type"))
                        ? List.of(answer("service.example", 1, "93.184.216.34")) : List.of())));
        assertEquals("93.184.216.34", arrayQuestion.lookup("service.example").get(0).getHostAddress());
    }

    @Test void leavesPublicAddressClassificationToThePolicyWithoutResolvingAnswerHostnames() throws Exception {
        PluginPublicDns dns = resolver(request -> reply(request, "1".equals(request.url().queryParameter("type"))
                ? List.of(answer("service.example", 1, "198.18.1.2")) : List.of()));
        assertEquals("198.18.1.2", dns.lookup("service.example").get(0).getHostAddress());
        for (String invalid : List.of("127.1", "999.1.2.3", "localhost", "1.2.3.4.example", "1.2.3.4/32")) {
            assertThrows(UnknownHostException.class, () -> resolver(request -> reply(request,
                    List.of(answer("service.example", 1, invalid)))).lookup("service.example"), invalid);
        }
        for (String invalid : List.of("localhost", "fe80::1%en0", "[::1]", "1.2.3.4", "::not-an-ip")) {
            assertThrows(UnknownHostException.class, () -> resolver(request -> reply(request,
                    "28".equals(request.url().queryParameter("type"))
                            ? List.of(answer("service.example", 28, invalid)) : List.of())).lookup("service.example"), invalid);
        }
    }

    @Test void malformedOrMismatchedRepliesFailClosedWithoutReturningPartialResults() {
        List<String> invalid = List.of("{}", "not json", "{} {}",
                json(Map.of("Status", 0, "Question", Map.of("name", "wrong.example", "type", 28))),
                json(Map.of("Status", 0, "Question", Map.of("name", "service.example", "type", 1))),
                json(Map.of("Status", 0, "Question", List.of())),
                json(Map.of("Status", 0, "Question", List.of(Map.of("name", "service.example", "type", 28), Map.of("name", "other.example", "type", 28)))),
                json(Map.of("Status", 3, "Question", List.of(Map.of("name", "service.example", "type", 28)))),
                json(Map.of("Status", 0, "TC", true, "Question", List.of(Map.of("name", "service.example", "type", 28)))),
                json(Map.of("Status", 0, "Question", List.of(Map.of("name", "wrong.example", "type", 28)))),
                json(Map.of("Status", 0, "Question", List.of(Map.of("name", "service.example", "type", 1)))),
                json(Map.of("Status", 0, "Question", List.of(Map.of("name", "service.example", "type", 28)), "Answer", "invalid")),
                "x".repeat(64 * 1024 + 1));
        for (String value : invalid) {
            PluginPublicDns dns = resolver(request -> "1".equals(request.url().queryParameter("type"))
                    ? reply(request, List.of(answer("service.example", 1, "93.184.216.34"))) : value);
            UnknownHostException failure = assertThrows(UnknownHostException.class, () -> dns.lookup("service.example"));
            assertEquals("Public DNS resolution failed.", failure.getMessage());
            assertNull(failure.getCause());
        }
    }

    @Test void aliasCyclesConflictsAndAddressOnAliasOwnerAreRejected() {
        for (var answers : List.of(
                List.of(answer("service.example", 5, "other.example"), answer("other.example", 5, "service.example")),
                List.of(answer("service.example", 5, "one.example"), answer("service.example", 5, "two.example")),
                List.of(answer("service.example", 5, "other.example"), answer("service.example", 1, "93.184.216.34")))) {
            assertThrows(UnknownHostException.class, () -> resolver(request -> reply(request, answers)).lookup("service.example"));
        }
    }

    @Test void transportErrorsAndRedirectsAreNotFollowedOrExposed() {
        for (int code : List.of(302, 500)) {
            var client = PluginPublicDns.client().newBuilder().addInterceptor(chain -> {
                requests.add(chain.request());
                return new Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(code).message("Failure")
                        .header("Location", "https://private.example/secret").body(ResponseBody.create("private response", null)).build();
            }).build();
            int before = requests.size();
            assertThrows(UnknownHostException.class, () -> new PluginPublicDns(client).lookup("service.example"));
            assertEquals(before + 1, requests.size());
        }
        var failed = PluginPublicDns.client().newBuilder().addInterceptor(chain -> { throw new IOException("private upstream detail"); }).build();
        assertEquals("Public DNS resolution failed.", assertThrows(UnknownHostException.class,
                () -> new PluginPublicDns(failed).lookup("service.example")).getMessage());
    }

    @Test void productionClientPinsOnlyTheResolverAndRetainsTlsAndTransportGuards() throws Exception {
        var client = PluginPublicDns.client();
        assertEquals(List.of("223.5.5.5", "223.6.6.6"), client.dns().lookup("dns.alidns.com").stream().map(InetAddress::getHostAddress).toList());
        assertThrows(UnknownHostException.class, () -> client.dns().lookup("unexpected.example"));
        assertEquals(Proxy.NO_PROXY, client.proxy());
        assertSame(CookieJar.NO_COOKIES, client.cookieJar());
        assertSame(Authenticator.NONE, client.authenticator());
        assertSame(Authenticator.NONE, client.proxyAuthenticator());
        assertFalse(client.followRedirects());
        assertFalse(client.followSslRedirects());
        assertFalse(client.retryOnConnectionFailure());
        assertEquals(3000, client.connectTimeoutMillis());
        assertEquals(4000, client.readTimeoutMillis());
        assertEquals(4000, client.callTimeoutMillis());
        assertSame(new OkHttpClient().hostnameVerifier(), client.hostnameVerifier());
    }
}
