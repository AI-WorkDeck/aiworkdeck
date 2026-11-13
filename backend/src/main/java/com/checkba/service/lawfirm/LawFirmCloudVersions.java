// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.lawfirm;

import com.checkba.service.LangText;

import java.util.Map;

/** 律所云端记录的乐观版本校验：界面带上所见版本（expectedVersion），与当前版本不一致即拒绝，提示刷新。 */
public final class LawFirmCloudVersions {
    private LawFirmCloudVersions() {}

    public static String staleMessage() {
        return LangText.of("该记录已被同事修改，请刷新后再改", "A colleague has changed this record; refresh and try again");
    }

    /** params 里没有 expectedVersion 时视为调用方不做并发控制（如幂等的批量上传），不拦截。 */
    public static void check(Map<String, Object> params, long current) {
        Object raw = params == null ? null : params.get("expectedVersion");
        if (raw == null) return;
        long expected;
        if (raw instanceof Number n) expected = n.longValue();
        else {
            try {
                expected = Long.parseLong(String.valueOf(raw).trim());
            } catch (NumberFormatException e) {
                throw new IllegalArgumentException(LangText.of("版本号无效", "Invalid version"));
            }
        }
        if (expected != current) throw new IllegalStateException(staleMessage());
    }
}
