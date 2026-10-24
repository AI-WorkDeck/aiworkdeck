// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.config;

import com.checkba.service.ai.PluginService;
import com.checkba.service.ai.skill.SkillRegistry;
import com.checkba.service.platform.ExternalProviderBackfill;
import com.checkba.service.plugin.PluginJobService;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.stereotype.Component;

/**
 * 必要的数据恢复与注册分开于 Bean 构造，让异步 JPA 初始化与普通对象构造重叠。
 * 此阶段仍在 WebServer 接收请求前同步完成；不把迁移或插件禁用状态检查留给首次业务请求。
 */
@Component
public class StartupDataInitializer implements SmartInitializingSingleton {

    private final ExternalProviderBackfill providers;
    private final PluginJobService jobs;
    private final PluginService plugins;
    private final SkillRegistry skills;

    public StartupDataInitializer(ExternalProviderBackfill providers, PluginJobService jobs,
                                  PluginService plugins, SkillRegistry skills) {
        this.providers = providers;
        this.jobs = jobs;
        this.plugins = plugins;
        this.skills = skills;
    }

    @Override
    public void afterSingletonsInstantiated() {
        providers.onStartup();
        // 插件加载可以提交任务，恢复必须先于插件执行；新任务不能被误认作上轮的孤儿。
        jobs.recoverOrphans();
        // 内置插件安装和禁用状态读取先于加载；技能扫描需要已完整加载的插件目录。
        plugins.init();
        skills.init();
    }
}
