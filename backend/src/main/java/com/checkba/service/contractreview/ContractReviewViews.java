// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.contractreview;

import java.time.LocalDateTime;
import java.util.List;

public final class ContractReviewViews {
    private ContractReviewViews() {}
    public record Rule(String id, String title, String instruction) {}
    public record SaveStandard(Long id, Long expectedVersion, String name, String position,
                               String jurisdiction, List<Rule> rules) {}
    public record Confirm(long version) {}
    public record StartRun(Long docFileId, Long standardId, long version) {}
    public record StandardView(Long id, String name, String position, String jurisdiction,
                               List<Rule> rules, long version, Long confirmedVersion,
                               LocalDateTime confirmedAt, LocalDateTime updatedAt) {}
    public record Result(String ruleId, String status, String quote, String reason, String suggestion) {}
    public record RunView(Long id, Long docFileId, StandardView standard, String status,
                          List<Result> results, String documentHash, boolean stale,
                          LocalDateTime startedAt, LocalDateTime finishedAt, String error) {}
}
