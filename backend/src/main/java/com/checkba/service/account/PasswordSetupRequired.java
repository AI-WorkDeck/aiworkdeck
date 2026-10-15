// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.account;

import java.util.Map;

/** Verified ownership is a restricted challenge, never an authenticated session. */
public final class PasswordSetupRequired extends RuntimeException {
    private final Map<String, Object> challenge;
    public PasswordSetupRequired(Map<String, Object> challenge) {
        super("password_setup_required");
        // Never forward upstream credentials if an incompatible server mixes fields.
        java.util.Map<String, Object> restricted = new java.util.HashMap<>();
        restricted.put("passwordSetupRequired", true);
        for (String key : java.util.List.of("setupToken", "expiresAt", "account")) {
            if (challenge.get(key) != null) restricted.put(key, challenge.get(key));
        }
        this.challenge = Map.copyOf(restricted);
    }
    public Map<String, Object> challenge() { return challenge; }
}
