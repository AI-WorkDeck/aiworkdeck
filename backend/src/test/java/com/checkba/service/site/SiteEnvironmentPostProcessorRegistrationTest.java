// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.site;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.env.EnvironmentPostProcessor;
import org.springframework.core.io.support.SpringFactoriesLoader;

import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 0.91.0 发布前：处理器登记在 Spring Boot 不认的 {@code .imports} 文件里，真实应用里从没跑过，
 * 选了国际站的用户每次重启都回到国内站（Key 发到国内站被拒）。这两个用例在修复前都失败。
 */
class SiteEnvironmentPostProcessorRegistrationTest {

    @TempDir
    Path home;

    @Test
    void springDiscoversTheSitePostProcessor() {
        @SuppressWarnings("deprecation")
        List<String> names = SpringFactoriesLoader.loadFactoryNames(EnvironmentPostProcessor.class, getClass().getClassLoader());
        assertTrue(names.contains(SiteEnvironmentPostProcessor.class.getName()), names.toString());
    }

    @Test
    void restartWithIntlSiteFileStartsOnIntl() throws Exception {
        SiteStateFile.write(home, new SiteStateFile.State("intl", "2026-11-26T00:00:00Z", "user"));
        SpringApplication app = new SpringApplication(Object.class);
        app.setWebApplicationType(WebApplicationType.NONE);
        app.setAdditionalProfiles("desktop");
        var holder = new org.springframework.core.env.ConfigurableEnvironment[1];
        app.addListeners((org.springframework.context.ApplicationListener<org.springframework.boot.context.event.ApplicationEnvironmentPreparedEvent>)
                e -> holder[0] = e.getEnvironment());
        // 只走到环境准备完毕：在 ApplicationEnvironmentPreparedEvent 里取环境后中止启动
        app.addListeners((org.springframework.context.ApplicationListener<org.springframework.boot.context.event.ApplicationContextInitializedEvent>)
                e -> { throw new StopHere(); });
        try {
            app.run("--security.license.dir=" + home, "--spring.main.banner-mode=off", "--logging.level.root=OFF");
        } catch (StopHere expected) {
            // 环境已准备好
        }
        assertNotNull(holder[0]);
        assertEquals("intl", holder[0].getProperty("ai.account.resolved-site"));
        assertEquals("https://www.workdeck.ai", holder[0].getProperty("ai.account.base-url"));
        assertEquals("https://www.workdeck.ai/api/registry/plugins", holder[0].getProperty("ai.plugins.registry-url"));
    }

    private static final class StopHere extends RuntimeException {
        StopHere() { super(null, null, false, false); }
    }
}
