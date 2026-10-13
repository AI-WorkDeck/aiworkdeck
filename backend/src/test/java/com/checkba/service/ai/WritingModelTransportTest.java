// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import com.checkba.config.AiModelProperties;
import com.checkba.service.SystemSettingService;
import com.checkba.service.telemetry.TelemetryService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import dev.langchain4j.agent.tool.ToolSpecification;
import dev.langchain4j.data.message.*;
import dev.langchain4j.model.StreamingResponseHandler;
import dev.langchain4j.model.output.Response;
import org.junit.jupiter.api.*;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class WritingModelTransportTest {
    HttpServer server;
    ExecutorService executor;
    AtomicReference<String> body = new AtomicReference<>();
    AtomicReference<String> auth = new AtomicReference<>();
    AtomicInteger requests = new AtomicInteger();
    static final String SSE = "data: {\"id\":\"test\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"建议\"},\"finish_reason\":null}]}\n\ndata: [DONE]\n\n";
    @BeforeEach void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        executor = Executors.newCachedThreadPool(); server.setExecutor(executor); server.start();
    }
    @AfterEach void stop() { server.stop(0); executor.shutdownNow(); }
    String url() { return "http://127.0.0.1:" + server.getAddress().getPort(); }
    OpenRouterStreamingChatModel model(String name, Duration timeout) { return new OpenRouterStreamingChatModel("synthetic-key", url(), name, timeout); }
    void serve() {
        server.createContext("/chat/completions", ex -> {
            requests.incrementAndGet(); body.set(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            auth.set(ex.getRequestHeaders().getFirst("Authorization"));
            byte[] bytes = SSE.getBytes(StandardCharsets.UTF_8);
            ex.sendResponseHeaders(200, bytes.length);
            try (var out = ex.getResponseBody()) { out.write(bytes); }
        });
    }
    static class Collector implements StreamingResponseHandler<AiMessage> {
        CountDownLatch done = new CountDownLatch(1), first = new CountDownLatch(1);
        AtomicReference<Throwable> error = new AtomicReference<>();
        AtomicInteger terminal = new AtomicInteger();
        public void onNext(String token) { first.countDown(); }
        public void onComplete(Response<AiMessage> r) { terminal.incrementAndGet(); done.countDown(); }
        public void onError(Throwable t) { error.set(t); terminal.incrementAndGet(); done.countDown(); }
        void await() throws InterruptedException { assertTrue(done.await(5, TimeUnit.SECONDS)); }
    }
    @Test void writingAddsOutputCapAndRetainsUsageAndCaching() throws Exception {
        serve(); Collector c = new Collector();
        var call = model("qwen/qwen3.7-flash", Duration.ofSeconds(3)).generateCancellable(
                List.of(SystemMessage.from("synthetic system"), UserMessage.from("synthetic source")), 512, c);
        assertNotNull(call); c.await(); assertNull(c.error.get());
        var json = new ObjectMapper().readTree(body.get());
        assertEquals(512, json.path("max_tokens").asInt());
        assertTrue(json.path("stream_options").path("include_usage").asBoolean());
        assertEquals("ephemeral", json.path("messages").get(0).path("content").get(0).path("cache_control").path("type").asText());
        assertEquals("Bearer synthetic-key", auth.get()); assertFalse(json.has("tools"));
    }
    @Test void defaultBodyIsByteForByteIdenticalAfterWritingCall() throws Exception {
        serve(); var m = model("openai/gpt-4o", Duration.ofSeconds(3));
        List<ChatMessage> messages = List.of(UserMessage.from("synthetic"));
        var tools = List.of(ToolSpecification.builder().name("example").description("synthetic").build());
        Collector first = new Collector(); m.generate(messages, tools, first); first.await();
        String baseline = body.get(); assertFalse(new ObjectMapper().readTree(baseline).has("max_tokens"));
        Collector writing = new Collector(); m.generateCancellable(messages, 256, writing); writing.await();
        assertEquals(256, new ObjectMapper().readTree(body.get()).path("max_tokens").asInt());
        Collector last = new Collector(); m.generate(messages, tools, last); last.await();
        assertEquals(baseline, body.get());
        assertTrue(new ObjectMapper().readTree(body.get()).path("tools").isArray());
    }
    @Test void structuredReviewBudgetReachesTheRealHttpTransport() throws Exception {
        serve(); Collector c=new Collector();
        model("deepseek/deepseek-v4-flash",Duration.ofSeconds(3)).generateCancellable(
                List.of(UserMessage.from("synthetic structured review")),8192,c);
        c.await(); assertNull(c.error.get()); assertEquals(1,requests.get());
        assertEquals(8192,new ObjectMapper().readTree(body.get()).path("max_tokens").asInt());
    }
    @Test void invalidCapIsRejectedBeforeAnyHttp() {
        serve(); var m = model("openai/gpt-4o", Duration.ofSeconds(3));
        for (int cap : new int[]{-1, 0, 255, 8193}) assertThrows(IllegalArgumentException.class,
                () -> m.generateCancellable(List.of(UserMessage.from("synthetic")), cap, new Collector()));
        assertEquals(0, requests.get());
    }
    @Test void cancellationClosesHttpStreamAndSettlesOnce() throws Exception {
        CountDownLatch disconnected = new CountDownLatch(1);
        server.createContext("/chat/completions", ex -> {
            ex.getRequestBody().readAllBytes(); ex.sendResponseHeaders(200, 0);
            try (var out = ex.getResponseBody()) {
                out.write(SSE.substring(0, SSE.indexOf("data: [DONE]")).getBytes(StandardCharsets.UTF_8)); out.flush();
                for (int i = 0; i < 200; i++) {
                    Thread.sleep(10); out.write((":" + "x".repeat(8192) + "\n\n").getBytes(StandardCharsets.UTF_8)); out.flush();
                }
            } catch (java.io.IOException e) { disconnected.countDown(); }
            catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        });
        Collector c = new Collector(); var call = model("openai/gpt-4o", Duration.ofSeconds(5))
                .generateCancellable(List.of(UserMessage.from("synthetic")), 1024, c);
        assertTrue(c.first.await(3, TimeUnit.SECONDS)); call.cancel(); c.await();
        assertTrue(call.isCanceled()); assertNotNull(c.error.get());
        assertTrue(disconnected.await(3, TimeUnit.SECONDS), "Server must observe socket close, not merely discarded output");
        assertEquals(1, c.terminal.get());
    }
    @Test void wallClockDeadlineStopsHttp() throws Exception {
        server.createContext("/chat/completions", ex -> {
            ex.getRequestBody().readAllBytes();
            try { Thread.sleep(3000); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            ex.close();
        });
        Collector c = new Collector(); long start = System.nanoTime();
        model("openai/gpt-4o", Duration.ofMillis(150)).generateCancellable(List.of(UserMessage.from("synthetic")), 512, c);
        c.await(); assertNotNull(c.error.get()); assertTrue(Duration.ofNanos(System.nanoTime() - start).toMillis() < 2000);
    }

    ChatModelFactory factory(String provider, AiModelProperties props, PlatformAiChannel platform) {
        return factory(provider, props, platform, props.getOpenRouter().getBaseUrl());
    }
    ChatModelFactory factory(String provider, AiModelProperties props, PlatformAiChannel platform, String byokUrl) {
        SystemSettingService settings = mock(SystemSettingService.class);
        when(settings.get(anyString(), any())).thenAnswer(i -> i.getArgument(1));
        when(settings.get(eq("ai.activeProvider"), any())).thenReturn(provider);
        when(settings.get(eq(ChatModelFactory.SETTING_OPENROUTER_BASE_URL), any())).thenReturn(byokUrl);
        return new ChatModelFactory(props, settings, platform, mock(PlatformCreditsGate.class), mock(PlatformUsageAccountant.class),
                new AuxModelResolver(settings, AllowedModels.QWEN_3_7_FLASH.getModelId()), mock(TelemetryService.class));
    }
    @Test void factoryUsesRequestScopedByokAndValidatedAuxiliaryModel() throws Exception {
        serve(); AiModelProperties props = new AiModelProperties(); props.getOpenRouter().setApiKey("synthetic-byok"); props.getOpenRouter().setBaseUrl(url());
        var f = factory("OPENROUTER", props, mock(PlatformAiChannel.class));
        var m = f.getWritingModel(Duration.ofSeconds(2));
        assertNotSame(m, f.getWritingModel(Duration.ofSeconds(2))); assertEquals(AllowedModels.QWEN_3_7_FLASH.getModelId(), m.modelName());
        Collector c = new Collector(); m.generateCancellable(List.of(UserMessage.from("synthetic")), 512, c); c.await();
        assertEquals("Bearer synthetic-byok", auth.get());
    }
    @Test void factoryUsesPlatformCredential() throws Exception {
        serve(); AiModelProperties props = new AiModelProperties(); props.getOpenRouter().setBaseUrl(url()); props.getOpenRouter().setApiKey("wrong-byok");
        var platform = mock(PlatformAiChannel.class); when(platform.apiKey()).thenReturn("synthetic-platform");
        var m = factory("AWD_CLOUD", props, platform).getWritingModel(Duration.ofSeconds(2));
        Collector c = new Collector(); m.generateCancellable(List.of(UserMessage.from("synthetic")), 512, c); c.await();
        assertEquals("Bearer synthetic-platform", auth.get());
    }
    @Test void platformNeverSendsKeyToByokCustomAddress() throws Exception {
        serve(); AiModelProperties props = new AiModelProperties(); props.getOpenRouter().setBaseUrl(url());
        var platform = mock(PlatformAiChannel.class); when(platform.apiKey()).thenReturn("synthetic-platform");
        var m = factory("AWD_CLOUD", props, platform, "http://127.0.0.1:1/untrusted").getWritingModel(Duration.ofSeconds(2));
        Collector c = new Collector(); m.generateCancellable(List.of(UserMessage.from("synthetic")), 4096, c); c.await();
        assertNull(c.error.get()); assertEquals("Bearer synthetic-platform", auth.get());
        assertEquals(4096, new ObjectMapper().readTree(body.get()).path("max_tokens").asInt());
    }
    @Test void ollamaIsExplicitlyUnsupportedNeverFallsBack() {
        var platform = mock(PlatformAiChannel.class);
        var f = factory("OLLAMA", new AiModelProperties(), platform);
        assertThrows(com.checkba.exception.FeatureNotConfiguredException.class, () -> f.getWritingModel(Duration.ofSeconds(2)));
        assertThrows(com.checkba.exception.FeatureNotConfiguredException.class, () -> f.getAutomaticWritingModel(Duration.ofSeconds(2)));
        for (int reviewer : new int[]{0, 1}) assertThrows(com.checkba.exception.FeatureNotConfiguredException.class,
                () -> f.getAutomaticWritingReviewModel(Duration.ofSeconds(2),reviewer));
        verify(platform, never()).apiKey();
    }
    @Test void expiredBudgetRejected() {
        var f = factory("OPENROUTER", new AiModelProperties(), mock(PlatformAiChannel.class));
        for (Duration d : new Duration[]{Duration.ZERO, Duration.ofMillis(-1)}) assertThrows(IllegalArgumentException.class, () -> f.getWritingModel(d));
        assertThrows(IllegalArgumentException.class, () -> f.getWritingModel(null));
        for (Duration d : new Duration[]{null, Duration.ZERO, Duration.ofMillis(-1)}) {
            assertThrows(IllegalArgumentException.class, () -> f.getAutomaticWritingModel(d));
            for (int reviewer : new int[]{0, 1}) assertThrows(IllegalArgumentException.class,
                    () -> f.getAutomaticWritingReviewModel(d,reviewer));
        }
    }
    @Test void emptyOrReasoningOnlyStreamsAlwaysReachOneErrorTerminal() throws Exception {
        AtomicReference<String> response=new AtomicReference<>();
        server.createContext("/chat/completions",ex -> {
            ex.getRequestBody().readAllBytes(); byte[] bytes=response.get().getBytes(StandardCharsets.UTF_8);
            ex.sendResponseHeaders(200,bytes.length==0?-1:bytes.length);
            try(var out=ex.getResponseBody()) { if(bytes.length>0) out.write(bytes); }
        });
        for(String sse:List.of("", "data: [DONE]\n\n",
                "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":256,\"total_tokens\":266}}\n\ndata: [DONE]\n\n",
                "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":null,\"reasoning\":\"synthetic thought\"},\"finish_reason\":\"length\"}]}\n\ndata: [DONE]\n\n")) {
            response.set(sse); Collector c=new Collector();
            model("qwen/qwen3.7-flash",Duration.ofSeconds(2)).generateCancellable(List.of(UserMessage.from("synthetic")),256,c);
            c.await(); assertNotNull(c.error.get()); assertEquals(1,c.terminal.get());
            var empty=assertInstanceOf(OpenRouterStreamingChatModel.EmptyResponseException.class,c.error.get());
            if(sse.contains("prompt_tokens")) { assertEquals(10,empty.tokenUsage().inputTokenCount()); assertEquals(256,empty.tokenUsage().outputTokenCount()); }
            else assertNull(empty.tokenUsage());
        }
    }
    @Test void boundedWritingDisablesOnlyVerifiedFlashReasoningAndPreservesOtherModels() throws Exception {
        serve();
        for(String name:List.of("qwen/qwen3.7-flash","qwen/qwen3.8-max-0902","qwen/qwen3.7-max","alibaba/test","openai/gpt-4o")) {
            var m=model(name,Duration.ofSeconds(2)); Collector bounded=new Collector();
            m.generateCancellable(List.of(UserMessage.from("synthetic")),512,bounded); bounded.await();
            var request=new ObjectMapper().readTree(body.get());
            if(name.equals("qwen/qwen3.7-flash")) { assertTrue(request.has("reasoning")); assertFalse(request.path("reasoning").path("enabled").asBoolean(true)); }
            else assertFalse(request.has("reasoning"), "Unverified or mandatory-reasoning models retain defaults: " + name);
            Collector normal=new Collector(); m.generate(List.of(UserMessage.from("synthetic")),normal); normal.await();
            assertFalse(new ObjectMapper().readTree(body.get()).has("reasoning"));
        }
    }
    @Test void boundedFlashReviewCanDisableReasoningWithoutAnUnsupportedEffort() throws Exception {
        serve();
        var review = new OpenRouterStreamingChatModel("synthetic-key", url(), "deepseek/deepseek-v4-flash",
                Duration.ofSeconds(2), 5, "none");
        Collector c = new Collector();
        review.generateCancellable(List.of(UserMessage.from("synthetic review")),8192,c); c.await();
        assertNull(c.error.get());
        var request = new ObjectMapper().readTree(body.get());
        assertEquals(8192,request.path("max_tokens").asInt());
        assertFalse(request.path("reasoning").path("enabled").asBoolean(true));
        assertFalse(request.path("reasoning").has("effort"));
    }
    @Test void deepSeekFlashReasoningDisableDoesNotExpandToHighDefaultOrUnboundedCalls() throws Exception {
        serve(); ObjectMapper json = new ObjectMapper();
        List<ChatMessage> messages = List.of(UserMessage.from("synthetic reasoning boundary"));
        var high = new OpenRouterStreamingChatModel("synthetic-key", url(), "deepseek/deepseek-v4-flash",
                Duration.ofSeconds(2), 5, "high");
        Collector review = new Collector(); high.generateCancellable(messages,8192,review); review.await();
        assertNull(review.error.get());
        var request = json.readTree(body.get());
        assertEquals(8192,request.path("max_tokens").asInt());
        assertEquals(json.readTree("{\"effort\":\"high\"}"),request.path("reasoning"));

        var defaults = new OpenRouterStreamingChatModel("synthetic-key", url(), "deepseek/deepseek-v4-flash",
                Duration.ofSeconds(2), 5, null);
        Collector generation = new Collector(); defaults.generateCancellable(messages,4096,generation); generation.await();
        assertNull(generation.error.get());
        request = json.readTree(body.get());
        assertEquals(4096,request.path("max_tokens").asInt());
        assertFalse(request.has("reasoning"),"Bounded generation must retain provider defaults when effort is absent");

        var none = new OpenRouterStreamingChatModel("synthetic-key", url(), "deepseek/deepseek-v4-flash",
                Duration.ofSeconds(2), 5, "none");
        Collector ordinary = new Collector(); none.generate(messages,ordinary); ordinary.await();
        assertNull(ordinary.error.get());
        request = json.readTree(body.get());
        assertFalse(request.has("max_tokens"));
        assertEquals(json.readTree("{\"effort\":\"none\"}"),request.path("reasoning"),
                "Unbounded chat retains its existing effort serialization");
        assertEquals(3,requests.get());
    }
    @Test void boundedReviewPreservesExplicitLowReasoningForFlash() throws Exception {
        serve();
        var review = new OpenRouterStreamingChatModel("synthetic-key", url(), "qwen/qwen3.7-flash",
                Duration.ofSeconds(2), 5, "low");
        Collector c = new Collector();
        review.generateCancellable(List.of(UserMessage.from("synthetic review")), 4096, c); c.await();
        assertNull(c.error.get());
        var request = new ObjectMapper().readTree(body.get());
        assertEquals(4096, request.path("max_tokens").asInt());
        assertEquals("low", request.path("reasoning").path("effort").asText());
        assertFalse(request.path("reasoning").has("enabled"));
    }
    @Test void automaticFactoryUsesMainGenerationAndTwoLowReviewersOnByokAndPlatform() throws Exception {
        serve();
        AiModelProperties props = new AiModelProperties();
        props.getOpenRouter().setBaseUrl(url()); props.getOpenRouter().setApiKey("synthetic-byok");
        props.getOpenRouter().setDefaultModel("deepseek/deepseek-v4-flash");
        var platform = mock(PlatformAiChannel.class); when(platform.apiKey()).thenReturn("synthetic-platform");
        for (String provider : List.of("OPENROUTER", "AWD_CLOUD")) {
            var factory = factory(provider, props, platform, provider.equals("OPENROUTER") ? url() : "http://127.0.0.1:1/untrusted");
            var reasoning = new com.checkba.config.AiReasoningProperties();
            reasoning.setModels(List.of("deepseek/deepseek-v4-flash", "moonshotai/kimi-k3", "qwen/qwen3.8-max"));
            reasoning.setEffortDefault("high"); factory.setReasoningPropertiesForTest(reasoning);
            for (int stage : new int[]{-1, 0, 1}) {
                var model = stage < 0 ? factory.getAutomaticWritingModel(Duration.ofSeconds(2))
                        : factory.getAutomaticWritingReviewModel(Duration.ofSeconds(2), stage);
                Collector c = new Collector();
                model.generateCancellable(List.of(UserMessage.from("synthetic writing")),4096,c); c.await();
                assertNull(c.error.get());
                assertEquals(provider.equals("OPENROUTER") ? "Bearer synthetic-byok" : "Bearer synthetic-platform",auth.get());
                var request = new ObjectMapper().readTree(body.get());
                assertEquals(stage < 0 ? "deepseek/deepseek-v4-flash" : stage == 0 ? AllowedModels.KIMI_K3.getModelId()
                        : AllowedModels.QWEN_3_8_MAX.getModelId(),request.path("model").asText());
                assertEquals(4096,request.path("max_tokens").asInt());
                assertEquals(stage < 0 ? "high" : "low",request.path("reasoning").path("effort").asText());
                assertFalse(request.path("reasoning").has("enabled"));
            }
        }
        assertEquals(6,requests.get());
    }
    @Test void boundedWritingNeverLogsMalformedProviderContent() throws Exception {
        String secret = "SYNTHETIC_PRIVATE_MATERIAL_042";
        server.createContext("/chat/completions", ex -> {
            ex.getRequestBody().readAllBytes();
            String response = "data: {" + secret + "\n\ndata: {\"choices\":\"" + secret + "\"}\n\n" + SSE;
            byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
            ex.sendResponseHeaders(200, bytes.length);
            try (var out = ex.getResponseBody()) { out.write(bytes); }
        });
        var logger = (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(OpenRouterStreamingChatModel.class);
        var logs = new ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent>();
        logs.start(); logger.addAppender(logs);
        try {
            var m = model("openai/gpt-4o", Duration.ofSeconds(2));
            Collector bounded = new Collector();
            m.generateCancellable(List.of(UserMessage.from("synthetic")), 512, bounded); bounded.await();
            assertNull(bounded.error.get());
            assertEquals(2, logs.list.size());
            assertTrue(logs.list.stream().noneMatch(event -> event.getFormattedMessage().contains(secret)));
            logs.list.clear();
            Collector normal = new Collector(); m.generate(List.of(UserMessage.from("synthetic")), normal); normal.await();
            assertNull(normal.error.get());
            assertTrue(logs.list.stream().anyMatch(event -> event.getFormattedMessage().contains(secret)), "Existing normal chat diagnostics remain unchanged");
        } finally { logger.detachAppender(logs); logs.stop(); }
    }

    @Test void automaticWritingSendsConfiguredRoutingForGenerationAndReview() throws Exception {
        serve();
        AiModelProperties props = new AiModelProperties();
        props.getOpenRouter().setBaseUrl(url()); props.getOpenRouter().setApiKey("synthetic-byok");
        props.getOpenRouter().setDefaultModel("moonshotai/kimi-k3");
        var platform = mock(PlatformAiChannel.class); when(platform.apiKey()).thenReturn("synthetic-platform");
        for (String channel : List.of("OPENROUTER", "AWD_CLOUD")) {
            var factory = factory(channel, props, platform);
            var reasoning = new com.checkba.config.AiReasoningProperties();
            reasoning.setModels(List.of("moonshotai/kimi-k3"));
            factory.setReasoningPropertiesForTest(reasoning);
            var routing = new com.checkba.config.AiProviderRoutingProperties();
            routing.setEnabled(true); routing.setSort("throughput");
            routing.setQuantizations(List.of("fp8")); routing.setAllowFallbacks(false);
            factory.setProviderRoutingForTest(routing, 1);
            for (boolean review : new boolean[]{false, true}) {
                Collector c = new Collector();
                var model = review ? factory.getAutomaticWritingReviewModel(Duration.ofSeconds(2), 0)
                        : factory.getAutomaticWritingModel(Duration.ofSeconds(2));
                model.generateCancellable(List.of(UserMessage.from("synthetic")), 4096, c); c.await();
                assertNull(c.error.get());
                var request = new ObjectMapper().readTree(body.get());
                assertEquals("throughput", request.path("provider").path("sort").asText());
                assertEquals(List.of("fp8"), new ObjectMapper().convertValue(request.path("provider").path("quantizations"), List.class));
                assertFalse(request.path("provider").path("allow_fallbacks").asBoolean(true));
                assertEquals("moonshotai/kimi-k3", request.path("model").asText());
                assertEquals(review ? "low" : "medium", request.path("reasoning").path("effort").asText());
                assertEquals(4096, request.path("max_tokens").asInt());
                assertTrue(request.path("stream_options").path("include_usage").asBoolean());
                assertEquals(channel.equals("OPENROUTER") ? "Bearer synthetic-byok" : "Bearer synthetic-platform", auth.get());
            }
        }
        assertEquals(4, requests.get());
    }

    @Test void boundedRoutingDoesNotEnableLocalProviderRequeueOrRetryOnFailure() throws Exception {
        AtomicBoolean closeBeforeHeaders = new AtomicBoolean();
        server.createContext("/chat/completions", ex -> {
            requests.incrementAndGet(); body.set(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            if (!closeBeforeHeaders.get()) ex.sendResponseHeaders(503, -1);
            ex.close();
        });
        class RoutedCollector extends Collector implements ReasoningStreamingHandler {
            @Override public void bindProviderRequeue(int afterSeconds, java.util.function.BooleanSupplier requeue) {
                fail("Bounded writing must not bind local provider requeue");
            }
        }
        var route = new OpenRouterStreamingChatModel.ProviderRouting("latency", List.of(), true, 1);
        var model = new OpenRouterStreamingChatModel("synthetic-key", url(), "moonshotai/kimi-k3",
                Duration.ofSeconds(2), 5, "medium", route);
        for (boolean disconnect : new boolean[]{false, true}) {
            closeBeforeHeaders.set(disconnect); requests.set(0);
            var c = new RoutedCollector();
            model.generateCancellable(List.of(UserMessage.from("synthetic")), 512, c); c.await();
            assertNotNull(c.error.get()); assertEquals(1, c.terminal.get()); assertEquals(1, requests.get());
            var request = new ObjectMapper().readTree(body.get());
            assertEquals("latency", request.path("provider").path("sort").asText());
            assertFalse(request.path("provider").has("ignore"));
        }
    }

}
