// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.im;

import java.util.Map;

/** Optional local project actions; implementations must enforce project permissions. */
public interface ImProjectActionHandler {
 boolean supports(String action);
 Object execute(Long userId, Long projectId, String action, Map<String,Object> params);
}
