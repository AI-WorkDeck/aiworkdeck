// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.aiworkdeck.plugins.baoqingtian;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.spec.*;
import java.util.Base64;
import static org.junit.jupiter.api.Assertions.*;

class SecureEnvelopeTest {
    static final ObjectMapper JSON = new ObjectMapper();
    static final SecureRandom RANDOM = new SecureRandom();
    record Client(ObjectNode envelope, SecretKey key, String nonce) {}
    static Client request(SecureEnvelope server, String action, ObjectNode args) throws Exception {
        return request(server,action,args,System.currentTimeMillis()+5*60*1000);
    }
    static Client request(SecureEnvelope server, String action, ObjectNode args, long expiresAt) throws Exception {
        KeyGenerator generator=KeyGenerator.getInstance("AES"); generator.init(256); SecretKey key=generator.generateKey();
        byte[] iv=new byte[12], nonceBytes=new byte[32]; RANDOM.nextBytes(iv); RANDOM.nextBytes(nonceBytes);
        String nonce=b64(nonceBytes);
        PublicKey rsaKey=KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(Base64.getDecoder().decode(server.publicKey().path("publicKey").asText())));
        Cipher rsa=Cipher.getInstance("RSA/ECB/OAEPPadding"); rsa.init(Cipher.ENCRYPT_MODE,rsaKey,new OAEPParameterSpec("SHA-256","MGF1",MGF1ParameterSpec.SHA256,PSource.PSpecified.DEFAULT));
        Cipher aes=Cipher.getInstance("AES/GCM/NoPadding"); aes.init(Cipher.ENCRYPT_MODE,key,new GCMParameterSpec(128,iv)); aes.updateAAD(aad("request",nonce));
        ObjectNode payload=JSON.createObjectNode().put("action",action).put("expiresAt",expiresAt);payload.set("args",args);
        return new Client(JSON.createObjectNode().put("v",1).put("nonce",nonce).put("key",b64(rsa.doFinal(key.getEncoded()))).put("iv",b64(iv)).put("data",b64(aes.doFinal(JSON.writeValueAsBytes(payload)))),key,nonce);
    }
    static String response(Client client,ObjectNode envelope) throws Exception {
        Cipher aes=Cipher.getInstance("AES/GCM/NoPadding"); aes.init(Cipher.DECRYPT_MODE,client.key(),new GCMParameterSpec(128,Base64.getDecoder().decode(envelope.path("iv").asText())));aes.updateAAD(aad("response",client.nonce()));
        return new String(aes.doFinal(Base64.getDecoder().decode(envelope.path("data").asText())),StandardCharsets.UTF_8);
    }
    static String b64(byte[] b){return Base64.getEncoder().encodeToString(b);}
    static byte[] aad(String direction,String nonce){return ("bqt:v1:"+direction+":"+nonce).getBytes(StandardCharsets.UTF_8);}
    @Test void roundTripBindsResponseAndHidesSensitiveValues() throws Exception {
        SecureEnvelope server=new SecureEnvelope();Client client=request(server,"login",JSON.createObjectNode().put("authCode","SYNTHETIC_SECRET"));
        assertFalse(client.envelope().toString().contains("SYNTHETIC_SECRET"));
        var request=server.open(client.envelope());assertEquals("login",request.action());assertEquals("SYNTHETIC_SECRET",request.args().path("authCode").asText());
        ObjectNode result=JSON.createObjectNode().put("ok",true).put("data","SYNTHETIC_PRIVATE_RESULT");ObjectNode sealed=server.seal(request,result);
        assertNotEquals(client.envelope().path("iv"),sealed.path("iv"));assertFalse(sealed.toString().contains("SYNTHETIC_PRIVATE_RESULT"));assertEquals(result.toString(),response(client,sealed));
        assertThrows(IllegalArgumentException.class,()->server.open(client.envelope()));
    }
    @Test void rejectsTamperingWrongKeysNestedTransportAndOversizeWithoutEcho() throws Exception {
        SecureEnvelope server=new SecureEnvelope();Client client=request(server,"status",JSON.createObjectNode());
        ObjectNode bad=client.envelope().deepCopy();bad.put("nonce",b64(new byte[32]));
        assertEquals("Secure transport rejected",assertThrows(IllegalArgumentException.class,()->server.open(bad)).getMessage());
        assertThrows(IllegalArgumentException.class,()->new SecureEnvelope().open(client.envelope()));
        Client nested=request(server,"secure",JSON.createObjectNode());assertThrows(IllegalArgumentException.class,()->server.open(nested.envelope()));
        ObjectNode huge=client.envelope().deepCopy().put("data","A".repeat(SecureEnvelope.MAX_ENVELOPE));assertThrows(IllegalArgumentException.class,()->server.open(huge));
    }
    @Test void rejectsExpiredAndOverlongLifetimes() throws Exception {
        SecureEnvelope server=new SecureEnvelope();
        Client expired=request(server,"status",JSON.createObjectNode(),System.currentTimeMillis()-1000);
        Client future=request(server,"status",JSON.createObjectNode(),System.currentTimeMillis()+60*60*1000);
        assertThrows(IllegalArgumentException.class,()->server.open(expired.envelope()));
        assertThrows(IllegalArgumentException.class,()->server.open(future.envelope()));
    }
    @Test void acceptsFourMebibyteMediaChunk() throws Exception {
        SecureEnvelope server=new SecureEnvelope();ObjectNode args=JSON.createObjectNode().put("base64",b64(new byte[4*1024*1024]));Client client=request(server,"media_upload",args);
        assertTrue(client.envelope().toString().length()<SecureEnvelope.MAX_ENVELOPE);assertEquals(args,server.open(client.envelope()).args());
    }
}
