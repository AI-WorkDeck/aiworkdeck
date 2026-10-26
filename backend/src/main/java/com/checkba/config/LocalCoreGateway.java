// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.config;

import com.checkba.localcore.LocalCoreOwnership;
import com.checkba.localcore.LocalCoreHttpReads;
import jakarta.servlet.DispatcherType;
import jakarta.servlet.Filter;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.WebServer;

import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Collections;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/** Stable loopback port: core requests hold a lease through their response, then route one way to Spring. */
public final class LocalCoreGateway implements AutoCloseable {
    @FunctionalInterface
    public interface CoreHandler {
        /** False means unsupported. Do not consume the request body or modify the response in that case. */
        boolean handle(HttpServletRequest request, HttpServletResponse response) throws Exception;
    }

    private static final Set<String> HOP_HEADERS = Set.of("connection", "keep-alive", "proxy-authenticate",
            "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length", "expect");
    private final LocalCoreOwnership ownership;
    private final CoreHandler core;
    private final Duration waitForBackend;
    private final CompletableFuture<Integer> backend = new CompletableFuture<>();
    private final CompletableFuture<Integer> documentBackend = new CompletableFuture<>();
    private final CompletableFuture<Void> documentAvailable = new CompletableFuture<>();
    private volatile CoreHandler jpaDocuments;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2))
            .followRedirects(HttpClient.Redirect.NEVER).version(HttpClient.Version.HTTP_1_1).build();
    private final WebServer server;
    private volatile boolean closed;
    private volatile boolean failed;

    public LocalCoreGateway(int port, LocalCoreOwnership ownership, CoreHandler core,
                            String allowedOrigins, boolean allowAll, Duration waitForBackend) throws IOException {
        if (port < 0 || port > 65535 || waitForBackend.isNegative() || waitForBackend.isZero()) {
            throw new IllegalArgumentException("Invalid gateway configuration");
        }
        this.ownership = java.util.Objects.requireNonNull(ownership);
        this.core = java.util.Objects.requireNonNull(core);
        this.waitForBackend = waitForBackend;
        var factory = new TomcatServletWebServerFactory(port);
        factory.setAddress(InetAddress.getByName("127.0.0.1"));
        server = factory.getWebServer(context -> {
            register(context, "localAccess", new LocalModeAccessFilter(true, allowedOrigins, allowAll));
            register(context, "cors", new CorsConfig.CorsPreflightFilter(CorsConfig.parseOrigins(allowedOrigins), allowAll));
            register(context, "sourceNotice", new SourceCodeNoticeFilter());
            var servlet = context.addServlet("localCore", new HttpServlet() {
                @Override protected void service(HttpServletRequest request, HttpServletResponse response)
                        throws ServletException, IOException { dispatch(request, response); }
            });
            servlet.setLoadOnStartup(1);
            servlet.addMapping("/");
        });
        try { server.start(); }
        catch (RuntimeException | Error failure) {
            try { server.stop(); } finally { server.destroy(); }
            throw failure;
        }
    }

    private static void register(jakarta.servlet.ServletContext context, String name, Filter filter) {
        context.addFilter(name, filter).addMappingForUrlPatterns(EnumSet.of(DispatcherType.REQUEST), true, "/*");
    }

    public int port() { return server.getPort(); }

    /** Called only after Spring readiness, which must follow successful ownership handoff. */
    public synchronized void backendReady(int port) {
        validateDestination(port);
        if (!backend.complete(port)) throw new IllegalStateException("Backend destination already published");
        documentBackend.complete(port);
        documentAvailable.complete(null);
    }

    /** Only document routes, after runners and synchronous file reconciliation; not full readiness. */
    public synchronized void documentBackendReady(int port) {
        validateDestination(port);
        if (!documentBackend.complete(port)) throw new IllegalStateException("Document destination already published");
        documentAvailable.complete(null);
    }

    /** A distinct, bounded capability after the CORE lease drain and successful JPA handoff. */
    public synchronized void jpaDocumentsReady(CoreHandler handler) {
        if (closed || failed || ownership.state() != LocalCoreOwnership.State.JPA || jpaDocuments != null || backend.isDone())
            throw new IllegalStateException("JPA document capability is not available");
        jpaDocuments = java.util.Objects.requireNonNull(handler);
        documentAvailable.complete(null);
    }

    private void validateDestination(int port) {
        if (closed || failed || ownership.state() != LocalCoreOwnership.State.JPA || port <= 0 || port > 65535 || port == port()
                || (documentBackend.isDone() && !documentBackend.isCompletedExceptionally() && documentBackend.getNow(port) != port)) {
            throw new IllegalStateException("Backend is not ready for handoff");
        }
    }

    public synchronized void backendFailed() {
        failed = true;
        var failure = new IllegalStateException("Backend startup failed");
        backend.completeExceptionally(failure); documentBackend.completeExceptionally(failure);
        documentAvailable.completeExceptionally(failure);
    }

    private static boolean documentRoute(String method, String path) {
        // Proxy health to its existing readiness checks; an accepting socket must never mean UP.
        if ((method.equals("GET") || method.equals("HEAD"))
                && Set.of("/api/desktop/health", "/api/desktop/startup-health").contains(path)) return true;
        if ((method.equals("GET") || method.equals("HEAD")) && LocalCoreHttpReads.READ_PATHS.stream()
                .anyMatch(route -> path.matches(route.replace(":id", "[1-9][0-9]*")))) return true;
        String content = "/api/local-core/projects/[1-9][0-9]*/files/[1-9][0-9]*/content";
        if (path.matches(content)) return Set.of("GET", "HEAD", "PUT").contains(method);
        return Set.of("GET", "DELETE").contains(method) && path.matches(content
                + "/receipts/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
    }

    private void dispatch(HttpServletRequest request, HttpServletResponse response) throws IOException, ServletException {
        try {
            if (closed || failed) { unavailable(response); return; }
            if (ownership.state() == LocalCoreOwnership.State.CORE) {
                LocalCoreOwnership.CoreLease lease = null;
                try { lease = ownership.acquireCoreLease(); }
                catch (IllegalStateException racedHandoff) { /* Recheck through the readiness future below. */ }
                if (lease != null) {
                    try (var admitted = lease) {
                        if (core.handle(request, response)) return;
                    }
                }
            }
            if (ownership.state() == LocalCoreOwnership.State.FAILED) { unavailable(response); return; }
            // Never retain a core lease while waiting for the backend that needs to drain those leases.
            boolean document = documentRoute(request.getMethod(), request.getRequestURI());
            if (document) {
                documentAvailable.get(waitForBackend.toMillis(), TimeUnit.MILLISECONDS);
                if (closed || failed) { unavailable(response); return; }
                var local = jpaDocuments;
                if (!backend.isDone() && ownership.state() == LocalCoreOwnership.State.JPA && local != null
                        && local.handle(request, response)) return;
            }
            var destination = document ? documentBackend : backend;
            int target = destination.get(waitForBackend.toMillis(), TimeUnit.MILLISECONDS);
            if (closed || failed) { unavailable(response); return; }
            proxy(request, response, target);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            if (!response.isCommitted()) unavailable(response);
        } catch (TimeoutException | java.util.concurrent.ExecutionException e) {
            if (!response.isCommitted()) unavailable(response);
        } catch (IOException e) { throw e; }
        catch (Exception e) { throw new ServletException("Local request failed", e); }
    }

    private void proxy(HttpServletRequest request, HttpServletResponse response, int target)
            throws IOException, InterruptedException {
        String query = request.getQueryString();
        URI uri = URI.create("http://127.0.0.1:" + target + request.getRequestURI() + (query == null ? "" : "?" + query));
        Set<String> excluded = excludedHeaders(Collections.list(request.getHeaders("Connection")));
        var builder = HttpRequest.newBuilder(uri);
        for (String name : Collections.list(request.getHeaderNames())) {
            if (!excluded.contains(name.toLowerCase(Locale.ROOT))) {
                for (String value : Collections.list(request.getHeaders(name))) builder.header(name, value);
            }
        }
        // Stream large uploads; content length and transfer framing belong to the new connection.
        boolean hasBody = request.getContentLengthLong() > 0 || request.getHeader("Transfer-Encoding") != null;
        HttpRequest.BodyPublisher body = hasBody ? HttpRequest.BodyPublishers.ofInputStream(() -> {
            try { return request.getInputStream(); }
            catch (IOException e) { throw new java.io.UncheckedIOException(e); }
        }) : HttpRequest.BodyPublishers.noBody();
        if (request.getContentLengthLong() > 0) {
            body = HttpRequest.BodyPublishers.fromPublisher(body, request.getContentLengthLong());
        }
        HttpResponse<InputStream> upstream = client.send(builder.method(request.getMethod(), body).build(),
                HttpResponse.BodyHandlers.ofInputStream());
        try (InputStream input = upstream.body()) {
            response.setStatus(upstream.statusCode());
            Set<String> responseExcluded = excludedHeaders(upstream.headers().allValues("Connection"));
            upstream.headers().map().forEach((name, values) -> {
                if (!responseExcluded.contains(name.toLowerCase(Locale.ROOT))) {
                    response.setHeader(name, values.get(0));
                    for (int i = 1; i < values.size(); i++) response.addHeader(name, values.get(i));
                }
            });
            upstream.headers().firstValue("Content-Length").ifPresent(length -> response.setHeader("Content-Length", length));
            if ("HEAD".equals(request.getMethod())) return;
            byte[] buffer = new byte[16 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                response.getOutputStream().write(buffer, 0, read);
                // Preserve SSE delivery; do not buffer the entire response until its stream closes.
                response.flushBuffer();
            }
        }
    }

    private static Set<String> excludedHeaders(java.util.List<String> connections) {
        Set<String> excluded = new HashSet<>(HOP_HEADERS);
        for (String connection : connections) for (String name : connection.split(",")) {
            excluded.add(name.trim().toLowerCase(Locale.ROOT));
        }
        return excluded;
    }

    private static void unavailable(HttpServletResponse response) throws IOException {
        response.setStatus(503);
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write("{\"code\":-1,\"reason\":\"BACKEND_STARTING\",\"message\":\"后台服务仍在准备，请稍后重试\"}");
    }

    @Override public synchronized void close() {
        if (closed) return;
        closed = true;
        backendFailed();
        // This server lives outside Spring's WebServerStartStopLifecycle. stop() only stops its
        // connectors; destroy() also releases the non-daemon Tomcat await/utility threads.
        try { server.stop(); } finally { server.destroy(); }
    }
}
