// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.plugin.api;

import java.util.List;
import java.util.Map;

/** Durable inbox messages. Reading a message never authorizes or completes a business action. */
public interface Notifications {
    Map<String,Object> publish(Map<String,Object> notification);
    Map<String,Object> resolve(String eventKey, String state);
    /** Authoritative case-library hosts only; requires sender write access and real project recipients. */
    List<Map<String,Object>> publishProject(long projectId, List<Long> recipientIds, Map<String,Object> notification);
    void resolveProject(long projectId, List<Long> recipientIds, String eventKey, String state);
}
