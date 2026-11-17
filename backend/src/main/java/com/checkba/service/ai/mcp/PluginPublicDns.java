// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.mcp;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.*;

import java.io.IOException;
import java.net.IDN;
import java.net.InetAddress;
import java.net.Proxy;
import java.net.UnknownHostException;
import java.time.Duration;
import java.util.*;

/** Real-address fallback for fake-IP DNS. The caller must still screen every returned address. */
final class PluginPublicDns implements Dns {
    private static final int MAX_BYTES = 64 * 1024;
    private static final ObjectMapper JSON = new ObjectMapper().enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
    private static final HttpUrl ENDPOINT = HttpUrl.get("https://dns.alidns.com/resolve");
    private final OkHttpClient http;

    PluginPublicDns() { this(client()); }
    // Package-private injection keeps synthetic tests offline; production has no configurable endpoint.
    PluginPublicDns(OkHttpClient http) { this.http = http; }

    static OkHttpClient client() {
        return new OkHttpClient.Builder().dns(host -> {
            if (!"dns.alidns.com".equals(host)) throw failure();
            return List.of(InetAddress.getByAddress(new byte[]{(byte) 223, 5, 5, 5}),
                    InetAddress.getByAddress(new byte[]{(byte) 223, 6, 6, 6}));
        }).proxy(Proxy.NO_PROXY).cookieJar(CookieJar.NO_COOKIES)
                .authenticator(Authenticator.NONE).proxyAuthenticator(Authenticator.NONE)
                .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
                .connectTimeout(Duration.ofSeconds(3)).readTimeout(Duration.ofSeconds(4))
                .callTimeout(Duration.ofSeconds(4)).build();
    }

    @Override public List<InetAddress> lookup(String hostname) throws UnknownHostException {
        try {
            String name = dnsName(hostname);
            Set<InetAddress> addresses = new LinkedHashSet<>();
            addresses.addAll(query(name, 1));
            addresses.addAll(query(name, 28));
            if (addresses.isEmpty()) throw failure();
            return List.copyOf(addresses);
        } catch (IOException | IllegalArgumentException e) {
            // Never expose resolver response bodies, target names, or request URLs to plugin errors.
            throw failure();
        }
    }

    private List<InetAddress> query(String name, int type) throws IOException {
        Request request = new Request.Builder().url(ENDPOINT.newBuilder()
                .addQueryParameter("name", name).addQueryParameter("type", Integer.toString(type)).build())
                .header("Accept", "application/dns-json").get().build();
        try (Response response = http.newCall(request).execute()) {
            if (!response.isSuccessful() || response.body() == null) throw failure();
            byte[] bytes = response.body().byteStream().readNBytes(MAX_BYTES + 1);
            if (bytes.length > MAX_BYTES) throw failure();
            JsonNode root = JSON.readTree(bytes);
            if (root == null || !root.isObject() || !root.path("Status").isIntegralNumber()
                    || root.path("Status").intValue() != 0 || root.path("TC").asBoolean(false)) throw failure();
            JsonNode question = root.path("Question");
            // AliDNS returns one object; accept the conventional single-question array as well.
            if (question.isArray()) {
                if (question.size() != 1) throw failure();
                question = question.get(0);
            }
            if (!question.isObject() || question.path("type").asInt(-1) != type
                    || !name.equals(dnsName(question.path("name").asText()))) throw failure();
            JsonNode answers = root.path("Answer");
            if (answers.isMissingNode()) return List.of(); // NOERROR/NODATA, e.g. an IPv4-only service.
            if (!answers.isArray() || answers.size() > 128) throw failure();
            return addresses(answers, name, type);
        }
    }

    private static List<InetAddress> addresses(JsonNode answers, String name, int type) throws IOException {
        Set<String> visited = new HashSet<>();
        for (int depth = 0; depth < 16; depth++) {
            if (!visited.add(name)) throw failure();
            List<InetAddress> result = new ArrayList<>();
            String alias = null;
            for (JsonNode answer : answers) {
                if (!name.equals(dnsName(answer.path("name").asText()))) continue;
                int answerType = answer.path("type").asInt(-1);
                String data = answer.path("data").asText();
                if (answerType == 5) {
                    String target = dnsName(data);
                    if (alias != null && !alias.equals(target)) throw failure();
                    alias = target;
                } else if (answerType == type) {
                    result.add(numericAddress(data, type));
                }
            }
            if (alias == null) return result;
            if (!result.isEmpty()) throw failure(); // A CNAME owner cannot simultaneously hold address records.
            name = alias;
        }
        throw failure();
    }

    private static InetAddress numericAddress(String value, int type) throws UnknownHostException {
        if (type == 1) {
            String[] octets = value.split("\\.", -1);
            if (octets.length != 4) throw failure();
            byte[] address = new byte[4];
            for (int i = 0; i < 4; i++) {
                if (!octets[i].matches("[0-9]{1,3}")) throw failure();
                int octet = Integer.parseInt(octets[i]);
                if (octet > 255) throw failure();
                address[i] = (byte) octet;
            }
            return InetAddress.getByAddress(address);
        }
        // A colon plus this alphabet forces JDK numeric IPv6 parsing; no hostname or zone lookup.
        if (!value.contains(":") || !value.matches("[0-9a-fA-F:.]+")) throw failure();
        return InetAddress.getByName(value);
    }

    private static String dnsName(String name) throws UnknownHostException {
        if (name.endsWith(".")) name = name.substring(0, name.length() - 1);
        name = IDN.toASCII(name, IDN.USE_STD3_ASCII_RULES).toLowerCase(Locale.ROOT);
        if (name.isEmpty() || name.length() > 253) throw failure();
        return name;
    }

    private static UnknownHostException failure() {
        return new UnknownHostException("Public DNS resolution failed.");
    }
}
