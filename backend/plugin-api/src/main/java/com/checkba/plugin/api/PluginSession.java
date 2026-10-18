// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.plugin.api;

/** An opaque plugin key bound to a host-owned conversation in the current user/project. */
public record PluginSession(String key, String conversationId, boolean running) {}
