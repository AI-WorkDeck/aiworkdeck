// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.tools;

import com.checkba.service.LangText;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 期限计算（tool-system-v2 D2）。纯本地计算：节假日表是随包资源
 * {@code legal/cn-holidays-YYYY.json}（国务院办公厅年度放假通知，含调休上班日），不发任何出站请求。
 *
 * <p>计数规则（民事诉讼法第85条、民法典第201–203条）：起算的当日不计入，自次日起算；
 * 按月、年计算的，以到期月的对应日为最后一日，没有对应日的以月末日为最后一日；
 * 最后一日是法定休假日（含周末，但调休上班的周末除外）的，顺延到休假日结束后的第一个工作日。
 * 期间中途遇到节假日不延长，只有最后一日顺延。
 */
@Component
@Slf4j
public class DeadlineTools implements AgentToolComponent {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String[] WEEKDAY_ZH = {"", "周一", "周二", "周三", "周四", "周五", "周六", "周日"};
    private static final String[] WEEKDAY_EN = {"", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"};

    /** 预设：键 → {中文名, 数量, 单位, 英文名}。只是常见默认值，一律提示律师核实。 */
    private static final Map<String, Preset> PRESETS = new LinkedHashMap<>();

    private record Preset(String zh, String en, int amount, Unit unit) {
    }

    enum Unit {
        DAY("日", "day(s)"), MONTH("个月", "month(s)"), YEAR("年", "year(s)");
        final String zh;
        final String en;

        Unit(String zh, String en) {
            this.zh = zh;
            this.en = en;
        }
    }

    static {
        PRESETS.put("appeal_judgment", new Preset("上诉期（不服判决）", "appeal period (judgment)", 15, Unit.DAY));
        PRESETS.put("appeal_ruling", new Preset("上诉期（不服裁定）", "appeal period (ruling)", 10, Unit.DAY));
        PRESETS.put("defense", new Preset("答辩期", "defense period", 15, Unit.DAY));
        PRESETS.put("evidence", new Preset("举证期限（法院指定的以通知为准，一审不少于15日）", "evidence period (court-set one prevails; at least 15 days at first instance)", 15, Unit.DAY));
        PRESETS.put("retrial", new Preset("申请再审期限", "retrial application period", 6, Unit.MONTH));
        PRESETS.put("limitation", new Preset("诉讼时效（普通）", "limitation period (general)", 3, Unit.YEAR));
    }

    private static final Map<String, String> PRESET_ALIASES = Map.ofEntries(
            Map.entry("上诉期", "appeal_judgment"), Map.entry("上诉期判决", "appeal_judgment"),
            Map.entry("上诉期裁定", "appeal_ruling"), Map.entry("答辩期", "defense"),
            Map.entry("举证期限", "evidence"), Map.entry("申请再审", "retrial"),
            Map.entry("再审", "retrial"), Map.entry("诉讼时效", "limitation"));

    /** 一年的日历：休假日 / 调休上班日。 */
    record Calendar(int year, String source, Set<LocalDate> holidays, Map<LocalDate, String> holidayNames,
                    Set<LocalDate> workdays) {
    }

    private static final Map<Integer, java.util.Optional<Calendar>> CALENDARS = new ConcurrentHashMap<>();

    static Calendar calendarOf(int year) {
        return CALENDARS.computeIfAbsent(year, DeadlineTools::loadCalendar).orElse(null);
    }

    private static java.util.Optional<Calendar> loadCalendar(int year) {
        try (InputStream in = DeadlineTools.class.getResourceAsStream("/legal/cn-holidays-" + year + ".json")) {
            if (in == null) {
                return java.util.Optional.empty();
            }
            JsonNode root = JSON.readTree(in);
            Set<LocalDate> holidays = new HashSet<>();
            Map<LocalDate, String> names = new HashMap<>();
            for (JsonNode h : root.path("holidays")) {
                LocalDate from = LocalDate.parse(h.path("from").asText());
                LocalDate to = LocalDate.parse(h.path("to").asText());
                for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) {
                    holidays.add(d);
                    names.put(d, h.path("name").asText());
                }
            }
            Set<LocalDate> workdays = new HashSet<>();
            for (JsonNode w : root.path("workdays")) {
                workdays.add(LocalDate.parse(w.path("date").asText()));
            }
            return java.util.Optional.of(new Calendar(year, root.path("source").asText(), holidays, names, workdays));
        } catch (IOException | RuntimeException e) {
            log.warn("deadline_compute: 节假日表 {} 读取失败，按周末兜底", year, e);
            return java.util.Optional.empty();
        }
    }

    @Tool("计算中国法定期限的到期日（上诉期、答辩期、举证期限、申请再审、诉讼时效等），含起算规则与节假日顺延。\n"
            + "何时用：用户问某期限几号到期、哪天截止，或要据此建截止日提醒（先算再 task_create）。"
            + "不用于：计算两个日期相差多少天、违约金利息金额（用 run_python）。\n"
            + "起算当日不计入；按月、年的取对应日，无对应日取月末；最后一日遇周末或法定节假日顺延到下一个工作日（调休上班日算工作日）。"
            + "kind 的期间只是常见默认值，回执会标待核实，以判决书、通知书或法律规定为准；"
            + "已知确切期间时直接传 amount+unit（覆盖 kind）。startDate 是送达日、知道或应当知道之日等起算事件当日。")
    @ToolMeta(displayName = "计算法定期限", category = "task", access = ToolMeta.Access.READ)
    public String deadline_compute(
            @P("起算事件发生的日期 yyyy-MM-dd（如判决书送达日）；该日本身不计入期间") String startDate,
            @P(value = "常见期限预设：appeal_judgment 上诉期判决15日 / appeal_ruling 上诉期裁定10日 / defense 答辩期15日 / "
                    + "evidence 举证期限15日 / retrial 申请再审6个月 / limitation 诉讼时效3年；也可写中文名如「上诉期」「诉讼时效」。"
                    + "「上诉期」默认按判决15日，用户说裁定时用 appeal_ruling", required = false) String kind,
            @P(value = "期间长度的数量（正整数）；与 unit 同时给出时覆盖 kind", required = false) Integer amount,
            @P(value = "期间单位：DAY 日 / MONTH 月 / YEAR 年", required = false) String unit) {
        log.info("Tool: deadline_compute startDate={} kind={} amount={} unit={}", startDate, kind, amount, unit);
        LocalDate start;
        try {
            start = LocalDate.parse(startDate == null ? "" : startDate.trim());
        } catch (DateTimeParseException e) {
            return "Error: " + LangText.of("startDate 须为 yyyy-MM-dd 格式的日期。请换算后重试。",
                    "startDate must be a yyyy-MM-dd date. Convert it and retry.");
        }
        Preset preset = null;
        if (kind != null && !kind.isBlank()) {
            String k = kind.trim();
            preset = PRESETS.get(k.toLowerCase(java.util.Locale.ROOT).replace('-', '_'));
            if (preset == null) {
                String alias = PRESET_ALIASES.get(k.replaceAll("[（）()\\s]", ""));
                preset = alias == null ? null : PRESETS.get(alias);
            }
            if (preset == null) {
                return "Error: " + LangText.of("未知的 kind「" + k + "」。可选：" + String.join(" / ", PRESETS.keySet())
                                + "；或直接传 amount+unit。",
                        "Unknown kind \"" + k + "\". Options: " + String.join(" / ", PRESETS.keySet())
                                + "; or pass amount+unit directly.");
            }
        }
        int n;
        Unit u;
        boolean explicit = amount != null && unit != null && !unit.isBlank();
        if (explicit) {
            try {
                u = Unit.valueOf(unit.trim().toUpperCase(java.util.Locale.ROOT));
            } catch (IllegalArgumentException e) {
                return "Error: " + LangText.of("unit 须为 DAY / MONTH / YEAR。", "unit must be DAY / MONTH / YEAR.");
            }
            n = amount;
            if (n <= 0 || n > 200) {
                return "Error: " + LangText.of("amount 须为 1–200 的正整数。", "amount must be a positive integer up to 200.");
            }
        } else if (preset != null) {
            n = preset.amount();
            u = preset.unit();
        } else {
            return "Error: " + LangText.of("请给出 kind，或同时给出 amount 与 unit。例如 kind=appeal_judgment，或 amount=15 unit=DAY。",
                    "Give kind, or both amount and unit. E.g. kind=appeal_judgment, or amount=15 unit=DAY.");
        }
        return compute(start, n, u, explicit ? null : preset);
    }

    static String compute(LocalDate start, int n, Unit u, Preset preset) {
        LocalDate raw = switch (u) {
            case DAY -> start.plusDays(n);
            case MONTH -> start.plusMonths(n);
            case YEAR -> start.plusYears(n);
        };
        boolean clamped = u != Unit.DAY && raw.getDayOfMonth() != start.getDayOfMonth();

        Set<Integer> missingYears = new TreeSet<>();
        List<String> skipped = new ArrayList<>();
        LocalDate end = raw;
        String firstReason = null;
        while (true) {
            String reason = restReason(end, missingYears);
            if (reason == null) {
                break;
            }
            if (firstReason == null) {
                firstReason = reason;
            }
            skipped.add(fmtZh(end) + "（" + reason + "）");
            end = end.plusDays(1);
        }

        StringBuilder sb = new StringBuilder();
        sb.append(LangText.of("到期日：", "Deadline: ")).append(fmt(end)).append('\n');
        sb.append(LangText.of("计算过程：\n", "Steps:\n"));
        sb.append("1. ").append(LangText.of(
                "起算日 " + fmtZh(start) + " 当日不计入期间，自次日 " + fmtZh(start.plusDays(1)) + " 起算。",
                "Start date " + fmtEn(start) + " is excluded; counting begins the next day, " + fmtEn(start.plusDays(1)) + "."))
                .append('\n');
        String label = preset == null ? "" : LangText.of("（" + preset.zh() + "，默认值）", " (" + preset.en() + ", default)");
        sb.append("2. ").append(LangText.of(
                "期间 " + n + " " + u.zh + label + "：" + fmtZh(start) + " + " + n + u.zh + " = " + fmtZh(raw) + "。",
                "Period " + n + " " + u.en + label + ": " + fmtEn(start) + " + " + n + " " + u.en + " = " + fmtEn(raw) + "."))
                .append('\n');
        if (clamped) {
            sb.append("   ").append(LangText.of(
                    "到期月没有对应日，以月末日为期间最后一日。",
                    "The target month has no corresponding day; the last day of that month is used.")).append('\n');
        }
        if (skipped.isEmpty()) {
            sb.append("3. ").append(LangText.of("最后一日是工作日，无需顺延。", "The last day is a working day; no roll-forward.")).append('\n');
        } else {
            sb.append("3. ").append(LangText.of(
                    "顺延：期间最后一日 " + String.join("、", skipped) + " 不是工作日，顺延至 " + fmtZh(end) + "。",
                    "Rolled forward: the last day (" + String.join(", ", skipped) + ") is not a working day; moved to " + fmtEn(end) + "."))
                    .append('\n');
            sb.append("   ").append(LangText.of("期间途中的节假日不延长期间，只有最后一日顺延。",
                    "Holidays inside the period do not extend it; only the last day rolls.")).append('\n');
        }

        List<String> notes = new ArrayList<>();
        if (preset != null) {
            notes.add(LangText.of("期间长度 " + n + u.zh + " 是该类期限的常见默认值，具体以判决书/裁定书/通知书载明或现行法律规定为准，请核实。",
                    "The " + n + " " + u.en + " period is a common default; verify against the judgment, notice or current law."));
        }
        if (preset != null && "limitation".equals(keyOf(preset))) {
            notes.add(LangText.of("诉讼时效可能中止、中断，起算点（知道或应当知道权利受损及义务人之日）也需认定，另有最长保护期限，请核实。",
                    "Limitation may be suspended or interrupted and the starting point needs confirming; verify."));
        }
        if (!missingYears.isEmpty()) {
            notes.add(LangText.of("本地没有 " + missingYears + " 年的官方节假日表，仅按周末顺延，未计法定节假日与调休，请对照国务院放假通知核实。",
                    "No bundled holiday calendar for " + missingYears + "; only weekends were considered. Check the State Council notice."));
        } else {
            Calendar c = calendarOf(end.getYear());
            if (c != null) {
                notes.add(LangText.of("节假日依据：" + c.source() + "。若法院另有通知（如遇特殊情形），以其为准。",
                        "Holiday source: " + c.source() + "."));
            }
        }
        if (!notes.isEmpty()) {
            sb.append(LangText.of("待核实：\n", "To verify:\n"));
            for (String note : notes) {
                sb.append("- ").append(note).append('\n');
            }
        }
        sb.append(LangText.of("如需建提醒，用此到期日调用 task_create（type=DEADLINE）。",
                "To set a reminder, call task_create (type=DEADLINE) with this date."));
        return sb.toString();
    }

    private static String keyOf(Preset p) {
        for (Map.Entry<String, Preset> e : PRESETS.entrySet()) {
            if (e.getValue() == p) {
                return e.getKey();
            }
        }
        return "";
    }

    /** 不是工作日的原因；是工作日返回 null。无该年官方表时只看周末并记入 missingYears。 */
    private static String restReason(LocalDate d, Set<Integer> missingYears) {
        Calendar c = calendarOf(d.getYear());
        if (c == null) {
            missingYears.add(d.getYear());
        } else {
            if (c.workdays().contains(d)) {
                return null;
            }
            if (c.holidays().contains(d)) {
                return LangText.of("法定节假日·" + c.holidayNames().get(d), "public holiday: " + c.holidayNames().get(d));
            }
        }
        DayOfWeek w = d.getDayOfWeek();
        if (w == DayOfWeek.SATURDAY || w == DayOfWeek.SUNDAY) {
            return LangText.of("周末", "weekend");
        }
        return null;
    }

    private static String fmt(LocalDate d) {
        return LangText.isEnglish() ? fmtEn(d) : fmtZh(d);
    }

    private static String fmtZh(LocalDate d) {
        return d + WEEKDAY_ZH[d.getDayOfWeek().getValue()];
    }

    private static String fmtEn(LocalDate d) {
        return d + " " + WEEKDAY_EN[d.getDayOfWeek().getValue()];
    }
}
