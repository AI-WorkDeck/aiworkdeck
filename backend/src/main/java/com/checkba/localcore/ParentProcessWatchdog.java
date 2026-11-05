// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.localcore;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.util.Optional;

/**
 * 桌面壳崩溃后后端 JVM 会残留（下次启动还会复用它，退出时又没人停它）。
 * 壳启动后端时通过 AWD_PARENT_PID 报上自己的 pid，这里盯住该进程，它一退出就让后端自行退出。
 * 没设该变量（开发态 restart-backend.sh、服务器部署）时完全不起作用。
 */
@Component
public class ParentProcessWatchdog {
    static final String ENV = "AWD_PARENT_PID";
    private static final Logger log = LoggerFactory.getLogger(ParentProcessWatchdog.class);

    private final ConfigurableApplicationContext context;

    public ParentProcessWatchdog(ConfigurableApplicationContext context) {
        this.context = context;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onStartup() {
        watch(System.getenv(ENV), () -> {
            log.warn("desktop shell process exited, shutting down backend");
            int code = SpringApplication.exit(context, () -> 0);
            System.exit(code);
        });
    }

    /** @return 是否已开始监视；pid 非法或该进程已不存在时什么都不做。 */
    static boolean watch(String rawPid, Runnable onExit) {
        if (rawPid == null || rawPid.isBlank()) return false;
        long pid;
        try {
            pid = Long.parseLong(rawPid.trim());
        } catch (NumberFormatException e) {
            return false;
        }
        Optional<ProcessHandle> parent = ProcessHandle.of(pid);
        if (parent.isEmpty() || !parent.get().isAlive()) return false;
        parent.get().onExit().thenRun(onExit);
        return true;
    }
}
