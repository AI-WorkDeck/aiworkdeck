// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.lawfirm;

import java.util.Map;

/**
 * 桌面端宿主服务调律所云端（{@code POST /api/lawfirm/cloud}）的入口，由 {@link LawFirmWorkflowGateway} 实现：
 * 用已连接的官方账户转发，账户变化或云端不可用时报错，不回落本机台账。服务端（local-mode=false）直接分发到本机登记的功能。
 * 插件经插件桥调用时走 {@link LawFirmWorkflowGateway#executeCloudForPlugin}（按功能声明的插件做最小权限校验）。
 */
@FunctionalInterface
public interface LawFirmCloudCaller {
    Map<String, Object> call(Long userId, String action, Map<String, Object> params);
}
