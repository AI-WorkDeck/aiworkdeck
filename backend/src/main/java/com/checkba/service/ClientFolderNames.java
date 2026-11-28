// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service;

import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

/**
 * C31（dev-board#1867）：客户上传材料的根文件夹名。原来写死「客户提供的文件」，繁中与英文律师的案卷里
 * 也是一个简体中文文件夹。规矩同 X44 的 {@code CaptureFolderNames}：
 * <ul>
 *   <li>项目里已经有根文件夹（任何一个已知名字）就一直用它：不改名、不另建第二个；</li>
 *   <li>只有全新的根才按当前界面语言起名——调用方要保证这时的语言是律师的（建清单时），
 *       不是客户门户请求带来的客户语言；</li>
 *   <li>没有专门译名的语言按 LangText 的回退链落到英文。</li>
 * </ul>
 */
public final class ClientFolderNames {
    private ClientFolderNames() {}

    private static final Map<String, String> NAMES = Map.of(
            "zh-CN", "客户提供的文件",
            "zh-TW", "客戶提供的檔案",
            "en-US", "Client materials");

    /** 历史名字（存量案卷里的根文件夹都叫它）。 */
    public static String canonical() { return NAMES.get("zh-CN"); }

    /** 根文件夹可能已经叫的所有名字，历史名字在前。 */
    public static Set<String> aliases() {
        Set<String> all = new LinkedHashSet<>();
        all.add(canonical());
        all.add(NAMES.get("zh-TW"));
        all.add(NAMES.get("en-US"));
        return all;
    }

    /** 新建根文件夹时用的名字：当前界面语言。 */
    public static String localized() { return LangText.of(NAMES); }
}
