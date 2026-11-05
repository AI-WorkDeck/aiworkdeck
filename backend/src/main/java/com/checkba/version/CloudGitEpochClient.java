// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.eclipse.jgit.api.TransportConfigCallback;
import org.eclipse.jgit.transport.TransportHttp;
import java.io.IOException;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.*;

/** Persisted write fence; explicit connections alone may adopt a newer cloud generation. */
public final class CloudGitEpochClient {
    record Reply(int status,String body) {}
    @FunctionalInterface interface Reader { Reply read(URI endpoint,String username,String token) throws IOException; }
    private record Scope(String repository,String token) {}
    static final ThreadLocal<Map<String,String>> explicitEpoch = new ThreadLocal<>();
    private final Reader reader;
    private final Map<Scope,Map<String,String>> epochs=new HashMap<>();
    private static final HttpClient HTTP=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NEVER).build();
    private static final CloudGitEpochClient INSTANCE=new CloudGitEpochClient((endpoint,username,token)->{
        try {
            var request=HttpRequest.newBuilder(endpoint).timeout(Duration.ofSeconds(15)).header("Authorization","Basic "+Base64.getEncoder().encodeToString(((username==null?"":username)+":"+token).getBytes(java.nio.charset.StandardCharsets.UTF_8))).GET().build();
            var response=HTTP.send(request,HttpResponse.BodyHandlers.ofInputStream());
            try(var input=response.body()) {
                byte[] bytes=input.readNBytes(65537);
                if(bytes.length>65536)throw new IOException("Cloud state response exceeds limit");
                return new Reply(response.statusCode(),new String(bytes,java.nio.charset.StandardCharsets.UTF_8));
            }
        } catch(InterruptedException e) {Thread.currentThread().interrupt();throw new IOException(e);}
    });
    CloudGitEpochClient(Reader reader) {this.reader=reader;}
    public static Map<String,String> headers(String remote,String username,String token) throws IOException {return INSTANCE.resolve(remote,username,token);}
    public static TransportConfigCallback transport(String remote,String username,String token) throws IOException {
        Map<String,String> headers=headers(remote,username,token);
        return transport->{if(transport instanceof TransportHttp http && !headers.isEmpty())http.setAdditionalHeaders(headers);};
    }
    /** Explicit user connection only. No background retry may call this method. */
    public static void bind(org.eclipse.jgit.lib.StoredConfig config,String remote,String username,String token) throws IOException {
        INSTANCE.bindConfig(config,remote,username,token);
    }
    public static Map<String,String> frozenHeaders(org.eclipse.jgit.lib.StoredConfig config,String remote,String username,String token) throws IOException {
        return INSTANCE.verifyConfig(config,remote,username,token);
    }
    public static TransportConfigCallback transport(org.eclipse.jgit.lib.StoredConfig config,String remote,String username,String token) throws IOException {
        Map<String,String> frozen=frozenHeaders(config,remote,username,token);
        return transport->{if(transport instanceof TransportHttp http && !frozen.isEmpty())http.setAdditionalHeaders(frozen);};
    }
    void bindConfig(org.eclipse.jgit.lib.StoredConfig config,String remote,String username,String token) throws IOException {
        String repository=repository(remote);
        if(repository==null) {
            config.unset("remote","origin","awdCloudEpoch");config.unset("remote","origin","awdCloudScope");config.save();return;
        }
        Map<String,String> current=readEpoch(repository,username,token);
        if(explicitEpoch.get()!=null && !explicitEpoch.get().equals(current))throw reconnect();
        config.setString("remote","origin","awdCloudScope",scopeFingerprint(repository,username,token));
        config.setString("remote","origin","awdCloudEpoch",current.getOrDefault("X-Cloud-Epoch","legacy"));
        config.save();
    }
    Map<String,String> verifyConfig(org.eclipse.jgit.lib.StoredConfig config,String remote,String username,String token) throws IOException {
        String repository=repository(remote);
        if(repository==null)return Map.of();
        String scope=config.getString("remote","origin","awdCloudScope"),epoch=config.getString("remote","origin","awdCloudEpoch");
        if(!scopeFingerprint(repository,username,token).equals(scope)||epoch==null||!(epoch.equals("legacy")||epoch.matches("[0-9]+")))throw reconnect();
        Map<String,String> frozen=epoch.equals("legacy")?Map.of():Map.of("X-Cloud-Epoch",epoch);
        // Observe permission changes, but never adopt them during background work, even after restart.
        if(!frozen.equals(readEpoch(repository,username,token)))throw reconnect();
        return frozen;
    }
    private static VersionException reconnect() {
        return VersionException.cloudReconnectRequired(com.checkba.service.mobile.CloudBillingText.get("cloudReconnectRequired"));
    }
    private static String scopeFingerprint(String repository,String username,String token) throws IOException {
        if(token==null||token.isBlank())throw reconnect();
        try {
            byte[] hash=java.security.MessageDigest.getInstance("SHA-256").digest((repository+"\n"+(username==null?"":username)+"\n"+token).getBytes(java.nio.charset.StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        }catch(java.security.NoSuchAlgorithmException impossible){throw new IOException(impossible);}
    }
    private static String repository(String remote) throws IOException {
        URI uri;
        try {uri=URI.create(remote);}catch(RuntimeException invalid){return null;}
        String host=uri.getHost();
        if(!"https".equalsIgnoreCase(uri.getScheme()) || uri.getUserInfo()!=null || (uri.getPort()!=-1 && uri.getPort()!=443)
                || host==null || !Set.of("case.aiworkdeck.com","case.workdeck.ai").contains(host.toLowerCase(Locale.ROOT)))return null;
        String path=uri.getRawPath();
        int objects=path.indexOf("/awd-objects");
        if(objects>=0)path=path.substring(0,objects);
        if(!path.matches("/git/[^/]+\\.git"))throw new IOException("Unsupported official Git repository");
        return "https://"+host.toLowerCase(Locale.ROOT)+path;
    }
    private Map<String,String> readEpoch(String repository,String username,String token) throws IOException {
        if(token==null||token.isBlank())throw reconnect();
        Reply reply=reader.read(URI.create(repository+"/awd-cloud-state"),username,token);
        if(reply.status()==404)return Map.of();
        if(reply.status()!=200)throw new IOException("Cloud state is unavailable");
        var document=new ObjectMapper().readTree(reply.body());
        if(document==null || !document.isObject())throw new IOException("Cloud state is invalid");
        var epoch=document.path("cloudAccess").path("epoch");
        if(!epoch.isIntegralNumber() || !epoch.canConvertToLong() || epoch.longValue()<0)throw new IOException("Cloud epoch is missing");
        return Map.of("X-Cloud-Epoch",epoch.asText());
    }
    synchronized Map<String,String> resolve(String remote,String username,String token) throws IOException {
        String repository=repository(remote);
        if(repository==null)return Map.of();
        Scope scope=new Scope(repository,token);
        if(epochs.containsKey(scope))return epochs.get(scope);
        Map<String,String> result=readEpoch(repository,username,token);
        epochs.put(scope,result);return result;
    }
}
