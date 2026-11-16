// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.testsupport;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.io.support.SpringFactoriesLoader;
import org.springframework.test.context.ContextCustomizerFactory;

import static org.junit.jupiter.api.Assertions.*;

class FeedbackIsolationContextCustomizerFactoryTest {
    @Test
    void registeredGuardOverridesInheritedDeliveryBeforeContextRefresh() {
        var factory = SpringFactoriesLoader.loadFactories(ContextCustomizerFactory.class,
                        getClass().getClassLoader()).stream()
                .filter(FeedbackIsolationContextCustomizerFactory.class::isInstance)
                .findFirst().orElseThrow();
        try (var context = new GenericApplicationContext()) {
            context.getEnvironment().getPropertySources().addFirst(new MapPropertySource(
                    "inheritedDelivery", Map.of("feedback.upload.enabled", true,
                            "feedback.upload.url", "http://127.0.0.1:9/never-send",
                            "optimizer.enabled", true)));
            var customizer = factory.createContextCustomizer(getClass(), List.of());
            customizer.customizeContext(context, null);
            assertFalse(context.getEnvironment().getProperty("feedback.upload.enabled", Boolean.class));
            assertEquals("", context.getEnvironment().getProperty("feedback.upload.url"));
            assertFalse(context.getEnvironment().getProperty("optimizer.enabled", Boolean.class));
            assertEquals(customizer, factory.createContextCustomizer(String.class, List.of()));
        }
    }
}
