// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.telemetry;

import com.checkba.service.SystemSettingService;
import org.springframework.stereotype.Service;

import java.time.Instant;

/**
 * 埋点上报开关（设计 §5.7）。语义：只控制「出本机」，本地账本永远记录。
 * - telemetry.rollup.enabled 缺省 true：分享匿名日聚合计数
 * - telemetry.events.enabled 缺省 false：分享脱敏事件流（Tier 2）
 */
@Service
public class TelemetrySettings {

    public static final String KEY_ROLLUP = "telemetry.rollup.enabled";
    public static final String KEY_EVENTS = "telemetry.events.enabled";
    /** Tier 2 事件上报游标：已成功上报到的最后一条事件时间（ISO-8601）。 */
    public static final String KEY_EVENTS_CURSOR = "telemetry.events.cursor";

    private final SystemSettingService settings;

    public TelemetrySettings(SystemSettingService settings) {
        this.settings = settings;
    }

    public boolean rollupEnabled() {
        return Boolean.parseBoolean(settings.get(KEY_ROLLUP, "true"));
    }

    public boolean eventsEnabled() {
        return Boolean.parseBoolean(settings.get(KEY_EVENTS, "false"));
    }

    /** 缺省或无法解析时回到 EPOCH（调用方再与「最近一天」取较大者）。 */
    public Instant eventsCursor() {
        try {
            return Instant.parse(settings.get(KEY_EVENTS_CURSOR, ""));
        } catch (Exception e) {
            return Instant.EPOCH;
        }
    }

    public void setEventsCursor(Instant ts) {
        settings.set(KEY_EVENTS_CURSOR, ts.toString());
    }

    public void setRollupEnabled(boolean v) {
        settings.set(KEY_ROLLUP, Boolean.toString(v));
    }

    public void setEventsEnabled(boolean v) {
        settings.set(KEY_EVENTS, Boolean.toString(v));
    }
}
