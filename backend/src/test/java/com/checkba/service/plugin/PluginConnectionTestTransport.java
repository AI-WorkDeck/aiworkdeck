// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.plugin;

import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import java.io.IOException;
import java.net.URI;
import java.net.Proxy;
import java.time.Duration;
import java.util.Set;
import org.springframework.test.util.ReflectionTestUtils;

/** Test-only exact-origin routing. Production endpoint validation and response handling stay active. */
public final class PluginConnectionTestTransport {
    private PluginConnectionTestTransport() {}
    public static void install(PluginConnectionService service, URI localProvider) {
        if (!"http".equals(localProvider.getScheme()) || !"127.0.0.1".equals(localProvider.getHost())
                || localProvider.getPort() < 1 || localProvider.getRawUserInfo() != null) {
            throw new IllegalArgumentException("An isolated HTTP loopback provider is required");
        }
        var client = new OkHttpClient.Builder().proxy(Proxy.NO_PROXY)
                .followRedirects(false).followSslRedirects(false).callTimeout(Duration.ofSeconds(5))
                .addInterceptor(chain -> {
                    HttpUrl url = chain.request().url();
                    if (!url.scheme().equals("https") || url.port() != 443
                            || !Set.of("service.example.invalid").contains(url.host())) {
                        throw new IOException("Test transport refuses undeclared origin");
                    }
                    HttpUrl routed = url.newBuilder().scheme("http").host("127.0.0.1").port(localProvider.getPort()).build();
                    return chain.proceed(chain.request().newBuilder().url(routed).build());
                }).build();
        ReflectionTestUtils.setField(service, "http", client);
    }
}
