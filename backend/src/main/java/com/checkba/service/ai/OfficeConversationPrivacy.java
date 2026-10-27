// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import java.util.regex.Pattern;

/** Remove transient tool payloads before persisting Office conversation history. */
public final class OfficeConversationPrivacy {
    private static final Pattern PAYLOAD = Pattern.compile(
            "(<(tool_code|tool_output|code)(?:\\s+[^>]*)?>)[\\s\\S]*?(</\\2>|\\z)");
    private static final String OMITTED = "[工具原始参数与输出不保留 / Raw tool payload not retained]";

    private OfficeConversationPrivacy() {}

    public static String forStorage(String content) {
        if (content == null) return null;
        // Also cover interrupted streams whose closing payload tag has not arrived yet.
        return PAYLOAD.matcher(content).replaceAll("$1" + OMITTED + "</$2>");
    }
}
