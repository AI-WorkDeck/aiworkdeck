// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import java.util.List;

/** Remove transient tool payloads before persisting Office conversation history. */
public final class OfficeConversationPrivacy {
    private static final List<String> TAGS = List.of("tool_code", "tool_output", "code");
    private static final String OMITTED = "[工具原始参数与输出不保留 / Raw tool payload not retained]";

    private OfficeConversationPrivacy() {}

    public static String forStorage(String content) {
        if (content == null) return null;
        // Also cover interrupted streams whose closing payload tag has not arrived yet.
        StringBuilder out = null;
        int copied = 0; // content[0, copied) is already in out (or needs no change)
        int pos = 0;    // search cursor; may run ahead of copied over non-payload '<'
        int len = content.length();
        while (pos < len) {
            int lt = content.indexOf('<', pos);
            if (lt < 0) break;
            String matchedTag = matchTagAt(content, lt);
            int gt = matchedTag == null ? -1 : content.indexOf('>', lt + 1 + matchedTag.length());
            if (gt < 0) {
                pos = lt + 1;
                continue;
            }
            if (out == null) out = new StringBuilder(len);
            out.append(content, copied, gt + 1).append(OMITTED).append("</").append(matchedTag).append('>');
            String closeTag = "</" + matchedTag + ">";
            int closeIdx = content.indexOf(closeTag, gt + 1);
            pos = copied = closeIdx >= 0 ? closeIdx + closeTag.length() : len;
        }
        if (out == null) return content;
        if (copied < len) out.append(content, copied, len);
        return out.toString();
    }

    private static String matchTagAt(String content, int lt) {
        for (String tag : TAGS) {
            int after = lt + 1 + tag.length();
            if (after <= content.length() && content.regionMatches(lt + 1, tag, 0, tag.length())) {
                if (after < content.length()) {
                    char next = content.charAt(after);
                    if (next == '>' || Character.isWhitespace(next)) return tag;
                }
            }
        }
        return null;
    }
}
