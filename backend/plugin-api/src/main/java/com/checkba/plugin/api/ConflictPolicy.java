// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.plugin.api;

/** {@link Files#write} 遇到同名文件时的处置。 */
public enum ConflictPolicy { FAIL, RENAME }
