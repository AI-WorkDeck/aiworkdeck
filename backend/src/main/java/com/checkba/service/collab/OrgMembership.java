// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.collab;

/** 真实账户的团队/律所归属；firmAdmin 仅由权威目录按总部 OWNER/ADMIN 判定。 */
public record OrgMembership(String teamId, String firmId, boolean firmAdmin) {
    public OrgMembership(String teamId, String firmId) { this(teamId, firmId, false); }
    public static final OrgMembership NONE = new OrgMembership(null, null);
}
