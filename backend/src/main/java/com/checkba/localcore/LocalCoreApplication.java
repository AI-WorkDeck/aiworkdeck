// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.localcore;

import com.checkba.config.LocalCoreGateway;
import com.checkba.service.AppLanguageScope;
import com.checkba.service.LicenseService;
import com.checkba.service.LocalIdentityService;
import com.checkba.service.account.AccountService;
import com.checkba.service.account.HttpAccountTransport;
import com.checkba.service.site.SiteProfileService;
import com.checkba.service.site.SiteProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.support.RootBeanDefinition;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.context.event.ApplicationContextInitializedEvent;
import org.springframework.boot.context.properties.bind.Bindable;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.web.servlet.context.ServletWebServerApplicationContext;
import org.springframework.context.ApplicationListener;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.web.servlet.resource.ResourceHttpRequestHandler;

import javax.sql.DataSource;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Assembly of the opt-in desktop candidate. Unsupported operations still wait for the full backend. */
public final class LocalCoreApplication implements LocalCoreBootstrap.Callbacks,
        ApplicationListener<ApplicationContextInitializedEvent> {
    private final Map<String, Object> shared = new LinkedHashMap<>();
    private ObjectMapper json;
    private LocalCoreGateway gateway;

    public static void configure(SpringApplication application) {
        var wiring = new LocalCoreApplication();
        application.addListeners(new LocalCoreBootstrap(wiring), wiring);
    }

    @Override public AutoCloseable onCorePrepared(ConfigurableEnvironment environment, DataSource database,
                                                LocalCoreStore store, LocalCoreOwnership ownership) throws Exception {
        json = new ObjectMapper().registerModule(new JavaTimeModule()).disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        var properties = Binder.get(environment).bind("ai.account", Bindable.of(SiteProperties.class))
                .orElseGet(SiteProperties::new);
        String stateDir = environment.getProperty("security.license.dir",
                environment.getRequiredProperty("user.home") + "/.aiworkdeck");
        var site = new SiteProfileService(true, environment.getProperty("ai.account.base-url", "https://www.aiworkdeck.com"),
                environment.getProperty("ai.account.resolved-site", ""), stateDir, properties);
        var license = new LicenseService(true, site, stateDir,
                environment.getProperty("security.license.trial-code.enabled", Boolean.class, true),
                environment.getProperty("security.license.trial-code.legacy-grace-until", ""));
        var transport = new HttpAccountTransport();
        var account = new AccountService(site, stateDir, transport, license);
        shared.put("siteProperties", properties); shared.put("siteProfileService", site);
        shared.put("licenseService", license); shared.put("httpAccountTransport", transport); shared.put("accountService", account);
        // SmsAuthService.active and MailAuthService.active both explicitly return false in local mode.
        var reads = new LocalCoreHttpReads(store, database, license, account, site,
                new LocalCoreHttpReads.AuthFlags(environment.getProperty("security.admin.allow-all-users", Boolean.class, false), false, false),
                LocalIdentityService::displayNameOf);
        String build = environment.getRequiredProperty("AWD_BACKEND_BUILD");
        int publicPort = environment.getProperty("server.port", Integer.class, 8080);
        gateway = new LocalCoreGateway(publicPort, ownership, (request, response) -> {
            if (("GET".equals(request.getMethod()) || "HEAD".equals(request.getMethod()))
                    && request.getRequestURI().equals("/api/desktop/health")) {
                response.setStatus(503);
                writeJson(request, response, Map.of("status", "DOWN", "build", build, "phase", "core"));
                return true;
            }
            if (("GET".equals(request.getMethod()) || "HEAD".equals(request.getMethod()))
                    && request.getRequestURI().equals("/api/desktop/startup-health")) {
                try (var c = database.getConnection(); var s = c.createStatement()) {
                    s.setQueryTimeout(1);
                    try (var r = s.executeQuery("SELECT 1")) {
                        if (!r.next() || r.getInt(1) != 1) throw new IllegalStateException("Core database unavailable");
                    }
                }
                var readPaths = new java.util.ArrayList<>(LocalCoreHttpReads.READ_PATHS);
                readPaths.add("/api/desktop/startup-health");
                readPaths.add("/api/desktop/health");
                writeJson(request, response, Map.of("status", "UP", "build", build, "phase", "core", "coreReadPaths", readPaths));
                return true;
            }
            Map<String, List<String>> headers = new LinkedHashMap<>();
            for (String name : Collections.list(request.getHeaderNames())) headers.put(name, Collections.list(request.getHeaders(name)));
            String language = AppLanguageScope.normalize(request.getHeader("X-App-Language"));
            if (language == null) {
                try (var c = database.getConnection(); var s = c.prepareStatement("SELECT \"value\" FROM system_setting WHERE config_key='app.language'")) {
                    try (var r = s.executeQuery()) { language = r.next() ? AppLanguageScope.normalize(r.getString(1)) : null; }
                }
            }
            String effectiveLanguage = language == null ? "zh-CN" : language;
            try {
                return AppLanguageScope.call(effectiveLanguage, () -> {
                    try {
                        var result = reads.handle(new LocalCoreHttpReads.Request(request.getMethod(), request.getRequestURI(),
                                request.getQueryString(), headers));
                        if (result.isEmpty()) return false;
                        var body = result.get(); response.setStatus(body.status());
                        body.headers().forEach(response::setHeader);
                        if (body.bodyFile() != null) writeFile(request, response, body.bodyFile());
                        else writeJson(request, response, body.jsonBody());
                        return true;
                    } catch (Exception e) { throw new RequestFailure(e); }
                });
            } catch (RequestFailure e) { throw e.original; }
        }, environment.getProperty("security.cors.allowed-origins", ""),
                environment.getProperty("security.cors.allow-all", Boolean.class, false), Duration.ofSeconds(10));
        // Keep server.port for callback URLs and internal clients; only the connector binds privately.
        org.springframework.boot.web.server.WebServerFactoryCustomizer<org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory>
                privateServer = factory -> {
                    factory.setPort(0);
                    factory.addConnectorCustomizers(connector -> connector.setProxyPort(publicPort));
                };
        shared.put("localCorePrivateServer", privateServer);
        return gateway;
    }

    @Override public void onApplicationEvent(ApplicationContextInitializedEvent event) {
        var factory = (org.springframework.beans.factory.support.BeanDefinitionRegistry) event.getApplicationContext().getBeanFactory();
        shared.forEach((name, instance) -> {
            RootBeanDefinition definition = new RootBeanDefinition(instance.getClass());
            definition.setInstanceSupplier(() -> instance);
            factory.registerBeanDefinition(name, definition);
        });
    }

    @Override public void onJpaHandoff(ConfigurableApplicationContext context) {
        // This first integration only serves reads before handoff. Content writes are not enabled yet.
    }

    @Override public void onReady(ConfigurableApplicationContext context) {
        if (gateway != null) gateway.backendReady(((ServletWebServerApplicationContext) context).getWebServer().getPort());
    }

    private void writeJson(HttpServletRequest request, HttpServletResponse response, Object body) throws Exception {
        response.setContentType("application/json;charset=UTF-8");
        byte[] bytes = json.writeValueAsBytes(body); response.setContentLength(bytes.length);
        if (!"HEAD".equals(request.getMethod())) response.getOutputStream().write(bytes);
    }

    private static void writeFile(HttpServletRequest request, HttpServletResponse response, Path path) throws Exception {
        // Use Spring's existing resource transfer semantics, including HEAD, byte ranges and 416.
        var handler = new ResourceHttpRequestHandler() {
            @Override protected Resource getResource(HttpServletRequest ignored) { return new FileSystemResource(path); }
        };
        handler.afterPropertiesSet(); handler.handleRequest(request, response);
    }

    private static final class RequestFailure extends RuntimeException {
        final Exception original;
        RequestFailure(Exception original) { super(original); this.original = original; }
    }
}
