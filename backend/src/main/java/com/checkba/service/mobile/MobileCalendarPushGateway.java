// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;

import com.checkba.model.entity.MobileCalendarPushDevice;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.*;
import java.util.*;

/** Apple's token-based HTTP/2 API. Configuration is opt-in; no key is bundled or copied. */
@Service
public class MobileCalendarPushGateway {
    public enum Result { SENT, RETRY, INVALID_DEVICE }
    private final String team, keyId, keyPath, topic;
    private final boolean enabled;
    private final HttpClient http;
    private final ObjectMapper mapper=new ObjectMapper();
    private String cachedJwt;
    private Instant jwtAt=Instant.EPOCH;
    public MobileCalendarPushGateway(@Value("${mobile.calendar.apns.enabled:false}") boolean enabled,
            @Value("${mobile.calendar.apns.team-id:}") String team,
            @Value("${mobile.calendar.apns.key-id:}") String keyId,
            @Value("${mobile.calendar.apns.key-path:}") String keyPath,
            @Value("${mobile.calendar.apns.topic:com.aiworkdeck.mobile.cn}") String topic) {
        this.enabled=enabled;this.team=team;this.keyId=keyId;this.keyPath=keyPath;this.topic=topic;
        this.http=HttpClient.newBuilder().version(HttpClient.Version.HTTP_2).connectTimeout(Duration.ofSeconds(10)).build();
    }
    public boolean available() {
        if(!enabled || !team.matches("[A-Z0-9]{10}") || !keyId.matches("[A-Z0-9]{10}") || topic.isBlank() || keyPath.isBlank()) return false;
        try {
            if(!Files.isRegularFile(Path.of(keyPath)) || !Files.isReadable(Path.of(keyPath))) return false;
            jwt(); return true;
        } catch(Exception e) { return false; }
    }
    public Result send(MobileCalendarPushDevice device,String eventId,String deliveryId) {
        if(!available()) return Result.RETRY;
        try {
            String host="sandbox".equals(device.getEnvironment()) ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
            HttpRequest request=HttpRequest.newBuilder(URI.create(host+"/3/device/"+device.getToken()))
                    .version(HttpClient.Version.HTTP_2).timeout(Duration.ofSeconds(20))
                    .header("authorization","bearer "+jwt())
                    .header("apns-topic",topic).header("apns-push-type","alert").header("apns-priority","10")
                    .header("apns-id",deliveryId).header("apns-collapse-id",eventId)
                    .header("apns-expiration",Long.toString(Instant.now().plusSeconds(3600).getEpochSecond()))
                    .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(payload(eventId)))).build();
            HttpResponse<String> response=http.send(request,HttpResponse.BodyHandlers.ofString());
            return result(response.statusCode(),response.body());
        } catch(InterruptedException e) { Thread.currentThread().interrupt();return Result.RETRY; }
        catch(Exception e) { return Result.RETRY; } // Tokens, responses and signing material never enter logs.
    }
    static Map<String,Object> payload(String eventId) {
        // The app ships this key in every supported language; no case content reaches the lock screen.
        return Map.of("aps",Map.of("alert",Map.of("title","AI WorkDeck","loc-key","personal.reminders"),"sound","default"),
                "eventId",eventId,"kind","calendar");
    }
    static Result result(int status,String body) {
        if(status==200) return Result.SENT;
        if(status==410) return Result.INVALID_DEVICE;
        if(status==400) try {
            String reason=new ObjectMapper().readTree(body).path("reason").asText();
            if(Set.of("BadDeviceToken","DeviceTokenNotForTopic").contains(reason)) return Result.INVALID_DEVICE;
        } catch(Exception ignored) {}
        return Result.RETRY;
    }
    private synchronized String jwt() throws Exception {
        Instant now=Instant.now();
        if(cachedJwt!=null && now.isBefore(jwtAt.plusSeconds(3000))) return cachedJwt;
        String pem=Files.readString(Path.of(keyPath)).replace("-----BEGIN PRIVATE KEY-----","")
                .replace("-----END PRIVATE KEY-----","").replaceAll("\\s","");
        PrivateKey key=KeyFactory.getInstance("EC").generatePrivate(new PKCS8EncodedKeySpec(Base64.getDecoder().decode(pem)));
        cachedJwt=sign(team,keyId,key,now);jwtAt=now;return cachedJwt;
    }
    static String sign(String team,String keyId,PrivateKey key,Instant now) throws Exception {
        ObjectMapper mapper=new ObjectMapper();Base64.Encoder encoder=Base64.getUrlEncoder().withoutPadding();
        String data=encoder.encodeToString(mapper.writeValueAsBytes(Map.of("alg","ES256","kid",keyId)))+"."
                +encoder.encodeToString(mapper.writeValueAsBytes(Map.of("iss",team,"iat",now.getEpochSecond())));
        Signature signature=Signature.getInstance("SHA256withECDSAinP1363Format");
        signature.initSign(key);signature.update(data.getBytes(StandardCharsets.US_ASCII));
        return data+"."+encoder.encodeToString(signature.sign());
    }
}
