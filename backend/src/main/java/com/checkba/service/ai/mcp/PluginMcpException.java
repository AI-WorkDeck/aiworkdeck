// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.mcp;

/** Safe, bounded errors: never include remote bodies, tokens or arbitrary URLs. */
public class PluginMcpException extends RuntimeException {
    private final String code;
    private final int status;
    public PluginMcpException(String code, int status, String message) {
        super(message); this.code = code; this.status = status;
    }
    public String code() { return code; }
    public int status() { return status; }
}
