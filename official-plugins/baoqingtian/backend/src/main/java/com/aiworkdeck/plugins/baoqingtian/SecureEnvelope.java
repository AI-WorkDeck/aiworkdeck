// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.aiworkdeck.plugins.baoqingtian;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.OAEPParameterSpec;
import javax.crypto.spec.PSource;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.spec.MGF1ParameterSpec;
import java.util.*;

/** Keeps bridge diagnostics from recording account data or media. Keys exist only in memory. */
final class SecureEnvelope {
    static final int MAX_PLAIN = 6 * 1024 * 1024;
    static final int MAX_ENVELOPE = 9 * 1024 * 1024;
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final SecureRandom RANDOM = new SecureRandom();
    private final KeyPair pair;
    private final Map<String, Long> seen = new HashMap<>();
    record Request(String action, JsonNode args, SecretKey key, String nonce) {}

    SecureEnvelope() {
        try { KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA"); generator.initialize(2048); pair = generator.generateKeyPair(); }
        catch (GeneralSecurityException e) { throw new IllegalStateException("Secure transport unavailable"); }
    }
    ObjectNode publicKey() { return JSON.createObjectNode().put("v",1).put("publicKey",Base64.getEncoder().encodeToString(pair.getPublic().getEncoded())); }

    Request open(JsonNode envelope) {
        try {
            if (envelope == null || !envelope.isObject() || envelope.toString().length() >= MAX_ENVELOPE || envelope.path("v").asInt() != 1) throw invalid();
            String nonce = envelope.path("nonce").asText();
            if (!nonce.matches("[A-Za-z0-9+/]{43}=")) throw invalid();
            byte[] wrapped = bytes(envelope,"key",344), iv = bytes(envelope,"iv",16), data = bytes(envelope,"data",(MAX_PLAIN+16)*4/3+4);
            if (wrapped.length != 256 || iv.length != 12 || data.length < 16 || data.length >= MAX_PLAIN+16) throw invalid();
            Cipher rsa = Cipher.getInstance("RSA/ECB/OAEPPadding");
            rsa.init(Cipher.DECRYPT_MODE,pair.getPrivate(),new OAEPParameterSpec("SHA-256","MGF1",MGF1ParameterSpec.SHA256,PSource.PSpecified.DEFAULT));
            byte[] rawKey = rsa.doFinal(wrapped);
            if (rawKey.length != 32) throw invalid();
            SecretKey key = new SecretKeySpec(rawKey,"AES"); Arrays.fill(rawKey,(byte)0);
            Cipher aes = Cipher.getInstance("AES/GCM/NoPadding");
            aes.init(Cipher.DECRYPT_MODE,key,new GCMParameterSpec(128,iv)); aes.updateAAD(aad("request",nonce));
            byte[] plain = aes.doFinal(data);
            JsonNode payload;
            try { payload = JSON.readTree(plain); } finally { Arrays.fill(plain,(byte)0); }
            long now = System.currentTimeMillis(), expiresAt = payload.path("expiresAt").asLong();
            if (expiresAt <= now || expiresAt > now + 6*60*1000) throw invalid();
            String action = payload.path("action").asText();
            if (!action.matches("[a-z_]{1,40}") || Set.of("secure","transport_key").contains(action) || !payload.path("args").isObject()) throw invalid();
            synchronized (seen) {
                seen.values().removeIf(expiry -> expiry < now);
                if (seen.size() >= 10000 || seen.putIfAbsent(nonce,expiresAt) != null) throw invalid();
            }
            return new Request(action,payload.get("args"),key,nonce);
        } catch (Exception e) { throw invalid(); }
    }
    ObjectNode seal(Request request, ObjectNode result) {
        try {
            byte[] plain = JSON.writeValueAsBytes(result);
            if (plain.length >= MAX_PLAIN) throw invalid();
            byte[] iv = new byte[12]; RANDOM.nextBytes(iv);
            Cipher aes = Cipher.getInstance("AES/GCM/NoPadding"); aes.init(Cipher.ENCRYPT_MODE,request.key(),new GCMParameterSpec(128,iv)); aes.updateAAD(aad("response",request.nonce()));
            byte[] data;
            try { data=aes.doFinal(plain); } finally { Arrays.fill(plain,(byte)0); }
            return JSON.createObjectNode().put("v",1).put("nonce",request.nonce()).put("iv",Base64.getEncoder().encodeToString(iv)).put("data",Base64.getEncoder().encodeToString(data));
        } catch (Exception e) { throw invalid(); }
    }
    private static byte[] bytes(JsonNode n,String key,int limit) {
        if (!n.path(key).isTextual() || n.path(key).textValue().length()>limit) throw invalid();
        return Base64.getDecoder().decode(n.path(key).textValue());
    }
    private static byte[] aad(String direction,String nonce) { return ("bqt:v1:"+direction+":"+nonce).getBytes(StandardCharsets.UTF_8); }
    private static IllegalArgumentException invalid() { return new IllegalArgumentException("Secure transport rejected"); }
}
