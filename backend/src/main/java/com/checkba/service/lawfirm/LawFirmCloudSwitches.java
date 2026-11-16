// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.lawfirm;

/**
 * 某律所是否开启了某项律所云端功能（服务端读开关表；由 {@link LawFirmCloudService} 实现）。
 * 供功能在统一入口之外复核（如云端利冲是否使用律所共享的主体数据：{@code enabled(firmId, "clients")}）。
 */
@FunctionalInterface
public interface LawFirmCloudSwitches {
    boolean enabled(String firmId, String feature);
}
