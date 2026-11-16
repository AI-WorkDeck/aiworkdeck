// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.plugin.api;

/** 证据链接视图（精简版）。 */
public record LinkView(long id, String linkKey, long docFileId, String anchorText, String sectionPath,
                       String sectionTitle, String status, java.util.List<TargetView> targets) {}
