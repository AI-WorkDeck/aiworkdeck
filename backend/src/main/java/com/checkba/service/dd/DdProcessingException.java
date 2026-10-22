// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.dd;

/** Deliberately authored customer-facing failures; provider response bodies are never persisted. */
public class DdProcessingException extends IllegalArgumentException {
    public DdProcessingException(String message) { super(message); }
}
