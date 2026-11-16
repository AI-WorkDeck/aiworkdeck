// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.lawfirm;

import java.util.Map;
import java.util.Set;

/**
 * 律所云端的一项功能（如客户与主体 clients、计时工时 time）。服务端由 {@link LawFirmCloudService} 统一入口：
 * 先按账户名录解析调用人所在律所与角色，再核对该律所是否开启本功能，最后交给本功能处理。
 * 功能只拿到已解析的成员身份，所有数据行必须按 {@code me.firmId()} 限定。
 */
public interface LawFirmCloudFeature {

    /** 功能键，同时是动作前缀（key + "."）和开关名，如 "clients"、"time"、"pitch"；小写字母开头，2–24 位。 */
    String key();

    Map<String, Object> execute(LawFirmAuthority.Member me, String action, Map<String, Object> params);

    /**
     * 允许经插件桥调用本功能动作的插件 ID（最小权限：插件只能调自己功能的动作）。默认空集 = 任何插件都不能直接调用，
     * 只有宿主自身（如本机台账服务）能调用。
     */
    default Set<String> pluginIds() { return Set.of(); }

    /** 「律所云端」开关列表上显示的名称与说明，按语言（如 "zh-CN"、"en-US"）给出；由功能自己提供，不改律所管理插件的词条。 */
    default Map<String, String> names() { return Map.of(); }

    default Map<String, String> descriptions() { return Map.of(); }

    /** 律所管理员关闭开关并选择删除时，清除本律所在该功能下的全部云端数据。 */
    default long purge(String firmId) { return 0; }

    /** 单次请求与回复的大小上限（经桌面端网关转发时生效）。 */
    default int maxRequestBytes() { return 768 * 1024; }

    default int maxResponseBytes() { return 4 * 1024 * 1024; }
}
