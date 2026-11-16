// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.testsupport;

import java.util.List;
import java.util.Map;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.test.context.ContextConfigurationAttributes;
import org.springframework.test.context.ContextCustomizer;
import org.springframework.test.context.ContextCustomizerFactory;
import org.springframework.test.context.MergedContextConfiguration;

/** Test databases do not isolate network side effects. Disable real feedback delivery before beans start. */
public class FeedbackIsolationContextCustomizerFactory implements ContextCustomizerFactory {
    @Override
    public ContextCustomizer createContextCustomizer(Class<?> testClass,
            List<ContextConfigurationAttributes> configAttributes) {
        return Isolation.INSTANCE;
    }

    private enum Isolation implements ContextCustomizer {
        INSTANCE;

        @Override
        public void customizeContext(ConfigurableApplicationContext context,
                MergedContextConfiguration mergedConfig) {
            context.getEnvironment().getPropertySources().addFirst(new MapPropertySource(
                    "testFeedbackIsolation", Map.of(
                            "feedback.upload.enabled", false,
                            "feedback.upload.url", "",
                            "optimizer.enabled", false)));
        }
    }
}
