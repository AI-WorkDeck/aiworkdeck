// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service;

/** Consume with AFTER_COMMIT so a failed upload never starts paid AI work. */
public record DdSubmissionCreated(Long submissionId) {}
