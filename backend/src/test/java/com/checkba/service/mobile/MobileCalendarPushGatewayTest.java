// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;
import org.junit.jupiter.api.Test;
import java.security.*;
import java.security.spec.ECGenParameterSpec;
import java.time.Instant;
import java.util.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;
class MobileCalendarPushGatewayTest {
    @Test void missingConfigurationDoesNotAdvertiseRemoteDelivery() {
        assertFalse(new MobileCalendarPushGateway(false,"8WKHZVR2W8","TESTKEY123","/missing/key.p8","com.aiworkdeck.mobile.cn").available());
        assertFalse(new MobileCalendarPushGateway(true,"8WKHZVR2W8","TESTKEY123","/missing/key.p8","com.aiworkdeck.mobile.cn").available());
    }
    @Test void signsAppleEs256WithFixedWidthJoseSignatureAndCorrectClaims() throws Exception {
        var generator=KeyPairGenerator.getInstance("EC");generator.initialize(new ECGenParameterSpec("secp256r1"));var key=generator.generateKeyPair();
        Instant time=Instant.parse("2026-10-27T00:00:00Z");
        String[] jwt=MobileCalendarPushGateway.sign("8WKHZVR2W8","TESTKEY123",key.getPrivate(),time).split("\\.");
        var decoder=Base64.getUrlDecoder();var json=new ObjectMapper();
        assertEquals("ES256",json.readTree(decoder.decode(jwt[0])).path("alg").asText());
        assertEquals("8WKHZVR2W8",json.readTree(decoder.decode(jwt[1])).path("iss").asText());
        assertEquals(time.getEpochSecond(),json.readTree(decoder.decode(jwt[1])).path("iat").asLong());
        byte[] signed=decoder.decode(jwt[2]);assertEquals(64,signed.length);
        var verifier=Signature.getInstance("SHA256withECDSAinP1363Format");verifier.initVerify(key.getPublic());
        verifier.update((jwt[0]+"."+jwt[1]).getBytes(java.nio.charset.StandardCharsets.US_ASCII));assertTrue(verifier.verify(signed));
    }
    @Test void onlyActualDeliveryIsSuccessAndOnlyTokenErrorsUnregister() {
        assertEquals(MobileCalendarPushGateway.Result.SENT,MobileCalendarPushGateway.result(200,""));
        assertEquals(MobileCalendarPushGateway.Result.INVALID_DEVICE,MobileCalendarPushGateway.result(410,"{}"));
        assertEquals(MobileCalendarPushGateway.Result.INVALID_DEVICE,MobileCalendarPushGateway.result(400,"{\"reason\":\"BadDeviceToken\"}"));
        assertEquals(MobileCalendarPushGateway.Result.RETRY,MobileCalendarPushGateway.result(403,"{\"reason\":\"InvalidProviderToken\"}"));
        assertEquals(MobileCalendarPushGateway.Result.RETRY,MobileCalendarPushGateway.result(429,"{}"));
        assertEquals(MobileCalendarPushGateway.Result.RETRY,MobileCalendarPushGateway.result(500,"{}"));
    }
    @Test void notificationDelegatesLanguageToThePhoneWithoutIncludingCaseContent() {
        var payload=new ObjectMapper().valueToTree(MobileCalendarPushGateway.payload("fixture-event"));
        assertEquals("personal.reminders",payload.path("aps").path("alert").path("loc-key").asText());
        assertFalse(payload.path("aps").path("alert").has("body"));
        assertEquals("fixture-event",payload.path("eventId").asText());
        assertEquals(Set.of("aps","eventId","kind"),new ObjectMapper().convertValue(payload,Map.class).keySet());
    }
}
