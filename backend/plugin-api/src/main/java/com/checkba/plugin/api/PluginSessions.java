// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.plugin.api;

import java.util.List;

/** Native Agent sessions scoped to the calling plugin, current user and current project. */
public interface PluginSessions {
    /** Revalidate current plugin and staff write access before a plugin-local operation. */
    void authorize();
    PluginSession ensure(String key, String title);
    PluginSession status(String key);
    /** Durable inbox acceptance; retries must reuse requestId and the original prompt. */
    boolean submit(String key, String requestId, String prompt, List<String> skillIds);
    /** Acknowledges the cancellation request, not completion of already executing tools. */
    boolean cancel(String key);
}
