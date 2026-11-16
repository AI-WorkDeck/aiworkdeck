// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.lawfirm;

import com.checkba.repository.UserRepository;
import com.checkba.service.AdminAccessService;
import com.checkba.service.LangText;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 谁能看全所数据（收费台账、全所看板、ERP 导出）。三种人之一：
 * <ul>
 *   <li>桌面单机（local-mode）：本机只有一个真人，台账就是他自己的；</li>
 *   <li>系统管理员（{@link AdminAccessService#isAdmin}；桌面 allow-all-users 下人人是管理员）；</li>
 *   <li>律所管理员：账户名录里 {@code OrgMembership.firmAdmin}（与 {@code LawFirmWorkflowService.appoint} 指派利冲委员同一个角色）。</li>
 * </ul>
 * 其余登录用户只能看到与自己相关的收案/放行/发票/回款。名录不可用时按「无资格」处理（拒绝优先）。
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class LawFirmAccessPolicy {
    private final UserRepository users;
    private final AdminAccessService admin;
    private final LawFirmAuthority authority;

    @Value("${security.local-mode:false}")
    boolean localMode;

    public boolean canViewFirmWide(Long userId) {
        if (userId == null) return false;
        if (localMode) return true;
        if (users.findById(userId).map(admin::isAdmin).orElse(false)) return true;
        try {
            return authority.current(userId).firmAdmin();
        } catch (RuntimeException e) {
            log.debug("Law firm admin lookup failed for user {}: {}", userId, e.getMessage());
            return false;
        }
    }

    /** Desktop single-user ledger: viewable in full, but it is this device's data, not the firm's. */
    public boolean localLedger() {
        return localMode;
    }

    public void requireFirmWide(Long userId) {
        if (!canViewFirmWide(userId)) {
            throw new IllegalArgumentException(LangText.of("无权查看：全所收费台账与看板仅限律所管理员", "Not permitted: firm-wide fee ledger and dashboards are limited to law firm administrators"));
        }
    }
}
