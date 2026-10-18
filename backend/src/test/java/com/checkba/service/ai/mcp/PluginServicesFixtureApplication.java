// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.mcp;

import com.checkba.CheckbaApplication;
import com.checkba.service.plugin.PluginConnectionService;
import okhttp3.OkHttpClient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.core.env.MapPropertySource;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.IOException;
import java.net.Proxy;
import java.time.Duration;
import java.util.*;

/** Explicit test-classpath launcher for browser acceptance. Run with an isolated HOME, database,
 * storage directories and a synthetic provider. This class is absent from the production jar.
 * Authentication, plugin trust, credentials and controllers remain the production implementations. */
public final class PluginServicesFixtureApplication {
    private PluginServicesFixtureApplication() {}

    public static void main(String[] args) {
        int port = Arrays.stream(args).filter(a -> a.startsWith("--fixture-port="))
                .map(a -> Integer.parseInt(a.substring("--fixture-port=".length()))).findFirst()
                .orElseThrow(() -> new IllegalArgumentException("--fixture-port is required"));
        new PluginMcpFixtureHttpClient(port); // Validate before constructing the application.
        String base = "http://127.0.0.1:" + port;
        Map<String, Object> defaults = new LinkedHashMap<>();
        defaults.put("fixture.port", port);
        defaults.put("ai.packs.enabled", false);
        defaults.put("ai.packs.auto-upgrade", false);
        defaults.put("ai.plugins.registry-url", base + "/api/registry/plugins");
        defaults.put("ai.skills.registry-url", base + "/api/registry/skills");
        defaults.put("ai.account.base-url", base);
        defaults.put("telemetry.ingest-url", base + "/api/telemetry");
        defaults.put("feedback.upload.enabled", false);
        defaults.put("optimizer.enabled", false);
        defaults.put("ai.model.open-router.base-url", base + "/v1");
        // Existing environment credentials must not become a synthetic provider's credentials.
        defaults.put("ai.model.open-router.api-key", "synthetic-fixture-key");
        defaults.put("ai.model.ollama.base-url", base);
        defaults.put("mcp.servers", "");
        var application = new SpringApplication(CheckbaApplication.class, FixtureConfiguration.class);
        application.addInitializers(context -> {
            var sources = context.getEnvironment().getPropertySources();
            var source = new MapPropertySource("pluginFixtureDefaults", defaults);
            // Explicit Spring CLI arguments can point account/registry to the separate local website.
            // Otherwise these defaults override application.yml and inherited machine environment.
            if (sources.contains("commandLineArgs")) sources.addAfter("commandLineArgs", source);
            else sources.addFirst(source);
        });
        application.run(Arrays.stream(args).filter(a -> !a.startsWith("--fixture-port=")).toArray(String[]::new));
    }

    @TestConfiguration(proxyBeanMethods = false)
    public static class FixtureConfiguration {
        @Bean @Primary
        PluginMcpHttpClient fixtureMcp(@Value("${fixture.port}") int port) {
            return new PluginMcpFixtureHttpClient(port);
        }

        @Bean static BeanPostProcessor fixtureConnections(@Value("${fixture.port}") int port) {
            return new BeanPostProcessor() {
                @Override public Object postProcessBeforeInitialization(Object bean, String name) {
                    if (bean instanceof PluginConnectionService) ReflectionTestUtils.setField(bean, "http", connectionTransport(port));
                    return bean;
                }
            };
        }
    }

    /** Production URL/declaration checks run in PluginConnectionService before this transport.
     * Only the agreed synthetic public origin is mapped; redirects and all other origins fail. */
    static OkHttpClient connectionTransport(int port) {
        return new OkHttpClient.Builder().proxy(Proxy.NO_PROXY).followRedirects(false).followSslRedirects(false)
                .retryOnConnectionFailure(false).connectTimeout(Duration.ofSeconds(2))
                .readTimeout(Duration.ofSeconds(30)).callTimeout(Duration.ofSeconds(45))
                .addInterceptor(chain -> {
                    var request = chain.request(); var url = request.url();
                    if (!"https".equals(url.scheme()) || !"service.example.invalid".equals(url.host()) || url.port() != 443
                            || !url.username().isEmpty() || !url.password().isEmpty())
                        throw new IOException("Endpoint is outside the fixture allowlist");
                    return chain.proceed(request.newBuilder().url(url.newBuilder().scheme("http").host("127.0.0.1").port(port).build()).build());
                }).build();
    }
}
