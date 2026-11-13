// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.activity;

import com.checkba.model.entity.UserActivityLog;
import com.checkba.repository.UserActivityLogRepository;
import java.time.format.DateTimeFormatter;
import java.util.*;
import org.springframework.stereotype.Service;

/**
 * 工作记录汇总（插件服务 worklog.summary，权限 worklog_read）：只汇总调用人本人在指定项目上的记录，
 * 按月、按类别合计小时数，再列出用时最多的文件名。不返回逐条记录、来源地址或设备信息。
 */
@Service
public class WorklogSummaryService {
    static final int TOP_FILES = 15;
    private static final DateTimeFormatter MONTH = DateTimeFormatter.ofPattern("yyyy-MM");
    private final UserActivityLogRepository repository;

    public WorklogSummaryService(UserActivityLogRepository repository) {
        this.repository = repository;
    }

    public Map<String, Object> summarize(Long userId, Long projectId) {
        if (userId == null || projectId == null) throw new IllegalArgumentException("projectId required");
        List<UserActivityLog> rows = repository.findTop20000ByUserIdAndProjectIdOrderByTimestampAsc(userId, projectId);
        long totalMs = 0;
        Map<String, Long> byMonth = new TreeMap<>();
        Map<String, Long> byCategory = new TreeMap<>();
        Map<String, Long> byFile = new HashMap<>();
        String first = null;
        String last = null;
        for (UserActivityLog r : rows) {
            long ms = r.getDuration() == null ? 0 : Math.max(0, r.getDuration());
            if (ms <= 0 || r.getTimestamp() == null) continue;
            totalMs += ms;
            String month = r.getTimestamp().format(MONTH);
            byMonth.merge(month, ms, Long::sum);
            byCategory.merge(r.getActionType() == null ? "OTHER" : r.getActionType(), ms, Long::sum);
            String name = r.getTargetName();
            if (name != null && !name.isBlank()) byFile.merge(name.length() > 200 ? name.substring(0, 200) : name, ms, Long::sum);
            String day = r.getTimestamp().toLocalDate().toString();
            if (first == null) first = day;
            last = day;
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("projectId", projectId);
        out.put("totalHours", hours(totalMs));
        out.put("from", first);
        out.put("to", last);
        out.put("byMonth", entries(byMonth, "month"));
        out.put("byCategory", entries(byCategory, "category"));
        List<Map.Entry<String, Long>> files = new ArrayList<>(byFile.entrySet());
        files.sort((a, b) -> Long.compare(b.getValue(), a.getValue()));
        List<Map<String, Object>> top = new ArrayList<>();
        for (Map.Entry<String, Long> e : files.subList(0, Math.min(TOP_FILES, files.size()))) top.add(Map.of("name", e.getKey(), "hours", hours(e.getValue())));
        out.put("topFiles", top);
        return out;
    }

    private static List<Map<String, Object>> entries(Map<String, Long> m, String key) {
        List<Map<String, Object>> out = new ArrayList<>();
        m.forEach((k, v) -> out.add(Map.of(key, k, "hours", hours(v))));
        return out;
    }

    static double hours(long ms) {
        return Math.round(ms / 36_000.0) / 100.0;
    }
}
