// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.config;

import com.checkba.service.ai.AgentOrchestrator;
import com.checkba.service.ai.SseEmitterService;
import com.checkba.service.mobile.DesktopStreamService;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.binder.MeterBinder;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;

import java.util.function.ToIntFunction;

/**
 * Business gauges for the loopback Prometheus endpoint (application-ops.yml).
 * Beans are resolved at scrape time so binding never forces early initialisation of the
 * orchestrator; on desktop metrics are disabled and these gauges are no-ops.
 */
@Component
public class OpsMetrics implements MeterBinder {
    private final ObjectProvider<SseEmitterService> chatStreams;
    private final ObjectProvider<DesktopStreamService> desktopStreams;
    private final ObjectProvider<AgentOrchestrator> orchestrator;

    public OpsMetrics(ObjectProvider<SseEmitterService> chatStreams,
                      ObjectProvider<DesktopStreamService> desktopStreams,
                      ObjectProvider<AgentOrchestrator> orchestrator) {
        this.chatStreams = chatStreams;
        this.desktopStreams = desktopStreams;
        this.orchestrator = orchestrator;
    }

    @Override
    public void bindTo(MeterRegistry registry) {
        Gauge.builder("awd.sse.connections", this, m -> count(m.chatStreams, SseEmitterService::activeConnectionCount))
                .tag("stream", "chat").description("Open AI chat SSE connections").register(registry);
        Gauge.builder("awd.sse.connections", this, m -> count(m.desktopStreams, DesktopStreamService::activeConnectionCount))
                .tag("stream", "desktop").description("Open desktop doorbell SSE connections").register(registry);
        Gauge.builder("awd.agent.runs.active", this, m -> count(m.orchestrator, AgentOrchestrator::activeRunCount))
                .description("Conversations with a registered agent run").register(registry);
    }

    private static <T> double count(ObjectProvider<T> provider, ToIntFunction<T> fn) {
        T bean = provider.getIfAvailable();
        return bean == null ? Double.NaN : fn.applyAsInt(bean);
    }
}
