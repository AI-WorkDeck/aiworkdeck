// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.lawfirm;

/**
 * 「客户管理」云端功能是否已由律所管理员开启。由律所云端通道的开关表实现；
 * 没有实现时一律视为未开启（云端利冲不使用主体数据）。
 */
@FunctionalInterface
public interface LawFirmCloudClientsSwitch {
    boolean enabled(String firmId);
}
