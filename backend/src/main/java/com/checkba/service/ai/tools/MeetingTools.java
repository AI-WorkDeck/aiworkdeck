// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.tools;

import com.checkba.model.entity.MeetingRecording;
import com.checkba.service.LangText;
import com.checkba.service.ai.ToolRegistry;
import com.checkba.service.meeting.MeetingRecordingService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.StreamSupport;

/**
 * 会议录音工具：给 AI 编排读会议转写稿与摘要素材（生成纪要的 skill 用）。
 * projectId 由 ToolRegistry 从 ToolContext 强制注入，LLM 报的值不生效。
 *
 * <p>返回文本双语（LangText）：这些串是喂给模型的脚手架，英文会话里塞中文小标题
 * （「转写稿」「机器摘要素材」）等于要求模型跨语言理解自己的输入格式，也会漏进过程卡。
 * 转写内容本身是用户数据，一律原样不动。
 */
@Component
@RequiredArgsConstructor
public class MeetingTools implements AgentToolComponent {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Pattern TMEET_KEY = Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");

    private final MeetingRecordingService meetingService;
    private final TencentMeetingTools tmeetBuiltin;
    /** 懒取：ToolRegistry 持有全部工具组件，直接注入会成环。 */
    private final ObjectProvider<ToolRegistry> toolRegistry;
    private final ObjectMapper objectMapper = JSON;

    /** 插件 detail 是异步任务：在工具内最多等这么久，仍未完成就把 jobId 交回模型。 */
    long pollIntervalMs = 1500;
    long pollBudgetMs = 30_000;

    @ToolMeta(displayName = "列出会议", category = "meeting", access = ToolMeta.Access.READ)
    @Tool("列出会议（录音与腾讯会议），返回来源、会议 id、标题和时间。\n"
            + "何时用：用户提到某场会议、要整理纪要或取逐字稿但没给 meetingId。"
            + "source=recording 是本项目的会议录音，tencent 是腾讯会议，all（缺省）两者都列。"
            + "只列清单不导出、不归档；取全文用 meeting_get_transcript。")
    public String meeting_list(
            @P("Project id (injected by runtime)") Long projectId,
            @P(value = "来源：recording | tencent | all（缺省 all）", required = false) String source,
            @P(value = "起始日期 yyyy-MM-dd（含）", required = false) String from,
            @P(value = "截止日期 yyyy-MM-dd（含）", required = false) String to,
            @P(value = "按标题过滤的关键词", required = false) String keyword) {
        String src = source == null || source.isBlank() ? "all" : source.trim().toLowerCase(java.util.Locale.ROOT);
        if (!Set.of("recording", "tencent", "all").contains(src)) {
            return "Error: source must be recording, tencent or all.";
        }
        LocalDate fromDate;
        LocalDate toDate;
        try {
            fromDate = parseDate(from);
            toDate = parseDate(to);
        } catch (DateTimeParseException e) {
            return "Error: from/to must be yyyy-MM-dd.";
        }
        List<String> parts = new ArrayList<>();
        if (!"tencent".equals(src)) parts.add(listRecordings(projectId, fromDate, toDate, keyword));
        if (!"recording".equals(src)) parts.add(listTencent(projectId, fromDate, toDate, keyword));
        return String.join("\n", parts);
    }

    @ToolMeta(displayName = "读取会议转写稿", category = "meeting", access = ToolMeta.Access.READ)
    @Tool("读取一场会议的完整逐字稿（带说话人和时间），有智能纪要/摘要素材时一并附上。\n"
            + "何时用：整理纪要、提炼待办、核对谁说了什么。meetingId 与 source 取自 meeting_list 的结果或 kick-off 提示。")
    public String meeting_get_transcript(
            @P("Project id (injected by runtime)") Long projectId,
            @P("会议 id（meeting_list 返回的 meetingId）") String meetingId,
            @P(value = "来源：recording | tencent（缺省 recording）", required = false) String source) {
        String id = meetingId == null ? "" : meetingId.trim();
        if (id.isEmpty()) return "Error: meetingId is required. Call meeting_list first.";
        String src = source == null || source.isBlank() ? "" : source.trim().toLowerCase(java.util.Locale.ROOT);
        if (src.isEmpty()) src = TMEET_KEY.matcher(id).matches() ? "tencent" : "recording";
        if ("tencent".equals(src)) {
            if (TMEET_KEY.matcher(id).matches()) return pluginTranscript(id);
            if (id.matches("\\d+")) return tmeetBuiltin.transcript(projectId, Long.valueOf(id));
            return "Error: invalid Tencent meetingId. Call meeting_list(source=tencent) first.";
        }
        if (!"recording".equals(src)) return "Error: source must be recording or tencent.";
        if (!id.matches("\\d+")) return "Error: invalid recording meetingId. Call meeting_list(source=recording) first.";
        return recordingTranscript(projectId, Long.valueOf(id));
    }

    /** 旧名 meeting_list_recordings：并入 meeting_list（V5），保留一版兼容壳。 */
    @ToolShim(replacedBy = "meeting_list")
    @ToolMeta(displayName = "列出会议录音", category = "meeting", offerToModel = false, access = ToolMeta.Access.READ)
    @Tool("列出本项目的会议录音。")
    public String meeting_list_recordings(@P("Project id (injected by runtime)") Long projectId) {
        return ToolShims.hint(listRecordings(projectId, null, null, null), "meeting_list", "meeting_list(source=recording)");
    }

    // ---- 录音（本项目 MeetingRecording） ----

    private String listRecordings(Long projectId, LocalDate from, LocalDate to, String keyword) {
        List<MeetingRecording> meetings = projectId == null ? List.of() : meetingService.list(projectId).stream()
                .filter(m -> inRange(m.getCreatedAt() == null ? null : m.getCreatedAt().toLocalDate(), from, to))
                .filter(m -> keyword == null || keyword.isBlank()
                        || (m.getTitle() != null && m.getTitle().toLowerCase().contains(keyword.trim().toLowerCase())))
                .toList();
        if (meetings.isEmpty()) {
            return LangText.of(
                    "本项目还没有会议录音。请用户先在左栏「会议录音」面板录制。",
                    "This project has no meeting recordings yet. Ask the user to record one in the "
                            + "Meeting Recording panel in the sidebar.");
        }
        StringBuilder sb = new StringBuilder(LangText.of(
                "本项目的会议录音：\n", "Meeting recordings in this project:\n"));
        for (MeetingRecording m : meetings) {
            sb.append("- source=recording | meetingId=").append(m.getId())
                    .append(" | ").append(m.getTitle())
                    .append(LangText.of(" | 时长 ", " | duration ")).append(m.getDurationMs() != null
                            ? MeetingRecordingService.formatMs(m.getDurationMs())
                            : LangText.of("未知", "unknown"))
                    .append(LangText.of(" | 状态 ", " | status ")).append(statusLabel(m.getStatus()))
                    .append('\n');
        }
        return sb.toString();
    }

    private String recordingTranscript(Long projectId, Long meetingId) {
        MeetingRecording meeting = meetingService.get(meetingId);
        if (!projectId.equals(meeting.getProjectId())) {
            // 刻意不带 Error / 错误 前缀（dev-board#1065 T-11 裁决）：维护者把它定为软失败，
            // 这句只陈述「这个 meetingId 不在本项目」，由模型换一个 meetingId 或向用户说明。
            // ToolFailureClassificationTest 的源码扫描把这一处列在白名单里，改文案时同步那里。
            return LangText.of("该会议不属于当前项目。",
                    "That meeting does not belong to the current project.");
        }
        if (!MeetingRecording.STATUS_TRANSCRIBED.equals(meeting.getStatus())) {
            return LangText.of(
                    "该会议尚未完成转写（当前状态：" + statusLabel(meeting.getStatus())
                            + "）。请用户在「会议录音」面板完成转写后再生成纪要。",
                    "That meeting has not finished transcription (current status: "
                            + statusLabel(meeting.getStatus()) + "). Ask the user to finish "
                            + "transcription in the Meeting Recording panel before generating minutes.");
        }
        StringBuilder sb = new StringBuilder();
        sb.append(LangText.of("会议：", "Meeting: ")).append(meeting.getTitle());
        if (meeting.getDurationMs() != null) {
            sb.append(LangText.of("（时长 ", " (duration "))
                    .append(MeetingRecordingService.formatMs(meeting.getDurationMs()))
                    .append(LangText.of("）", ")"));
        }
        sb.append(LangText.of("\n\n=== 转写稿（[时间] 说话人：内容）===\n",
                "\n\n=== Transcript ([time] speaker: text) ===\n"));
        sb.append(meetingService.renderTranscriptText(meeting));
        appendSummary(sb, meeting);
        return sb.toString();
    }

    // ---- 腾讯会议：插件已装且启用走插件（E4），否则读内置同步表 ----

    private boolean pluginActive() {
        ToolRegistry registry = toolRegistry == null ? null : toolRegistry.getIfAvailable();
        return registry != null && registry.tencentMeetingPluginActive();
    }

    private String listTencent(Long projectId, LocalDate from, LocalDate to, String keyword) {
        if (!pluginActive()) return tmeetBuiltin.listSynced(projectId, keyword, from, to);
        JsonNode reply = callPlugin("{\"action\":\"list\",\"json\":\"{}\"}");
        if (!reply.path("success").asBoolean(false)) return "Error: " + reply.path("error").asText("tencent_meeting_action failed");
        List<JsonNode> rows = new ArrayList<>();
        for (JsonNode m : reply.path("data").path("meetings")) {
            LocalDate day = parseTencentDay(m.path("startTime").asText(""));
            String subject = m.path("subject").asText("");
            if (inRange(day, from, to) && (keyword == null || keyword.isBlank()
                    || subject.toLowerCase().contains(keyword.trim().toLowerCase()))) rows.add(m);
        }
        if (rows.isEmpty()) {
            return LangText.of(
                    "腾讯会议插件里没有符合条件的已同步会议。可先用 tencent_meeting_action(action=status) 看是否已登录，"
                            + "再用 action=sync 同步（只列清单不需要导出）。",
                    "The Tencent Meeting plugin has no synced meetings matching this. Check login with "
                            + "tencent_meeting_action(action=status), then action=sync to refresh (listing needs no export).");
        }
        rows.sort(java.util.Comparator.comparing((JsonNode m) -> m.path("startTime").asText("")).reversed());
        StringBuilder sb = new StringBuilder(LangText.of("腾讯会议列表：\n", "Tencent meeting list:\n"));
        for (JsonNode m : rows) {
            sb.append("- source=tencent | meetingId=").append(m.path("key").asText())
                    .append(" | ").append(m.path("subject").asText());
            if (!m.path("meetingCode").asText("").isBlank()) {
                sb.append(LangText.of("（会议号：", " (code: ")).append(m.path("meetingCode").asText())
                        .append(LangText.of("）", ")"));
            }
            if (!m.path("startTime").asText("").isBlank()) {
                sb.append(LangText.of(" | 时间：", " | time: ")).append(m.path("startTime").asText());
            }
            sb.append('\n');
        }
        return sb.toString();
    }

    private String pluginTranscript(String key) {
        if (!pluginActive()) {
            return LangText.of("Error: 腾讯会议插件未启用，该 meetingId 无法读取。请先 meeting_list(source=tencent) 取内置同步表的会议。",
                    "Error: the Tencent Meeting plugin is not enabled, so this meetingId cannot be read. "
                            + "Call meeting_list(source=tencent) for the built-in synced meetings.");
        }
        String args = "{\"action\":\"detail\",\"json\":" + JSON.valueToTree("{\"key\":" + JSON.valueToTree(key) + "}") + "}";
        JsonNode reply = callPlugin(args);
        String jobId = null;
        for (long waited = 0; ; waited += pollIntervalMs) {
            if (!reply.path("success").asBoolean(false)) return "Error: " + reply.path("error").asText("tencent_meeting_action failed");
            JsonNode data = reply.path("data");
            if (!data.path("pending").asBoolean(false)) return renderPluginTranscript(data);
            jobId = data.path("jobId").asText(jobId);
            if (waited >= pollBudgetMs) break;
            try {
                Thread.sleep(pollIntervalMs);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
            reply = callPlugin("{\"action\":\"detail\",\"json\":" + JSON.valueToTree("{\"jobId\":" + JSON.valueToTree(jobId) + "}") + "}");
        }
        return LangText.of(
                "逐字稿仍在读取中（任务 " + jobId + "）。请稍后用 tencent_meeting_action(action=detail, json={\"jobId\":\"" + jobId + "\"}) 继续查询。",
                "The transcript is still being fetched (job " + jobId + "). Poll later with "
                        + "tencent_meeting_action(action=detail, json={\"jobId\":\"" + jobId + "\"}).");
    }

    private String renderPluginTranscript(JsonNode d) {
        StringBuilder sb = new StringBuilder();
        sb.append(LangText.of("会议主题：", "Meeting Subject: ")).append(d.path("subject").asText()).append('\n');
        if (!d.path("meetingCode").asText("").isBlank()) {
            sb.append(LangText.of("会议号：", "Meeting Code: ")).append(d.path("meetingCode").asText()).append('\n');
        }
        if (!d.path("startTime").asText("").isBlank()) {
            sb.append(LangText.of("开会时间：", "Start Time: ")).append(d.path("startTime").asText()).append('\n');
        }
        if (!d.path("smartMinutes").asText("").isBlank()) {
            sb.append(LangText.of("\n=== 腾讯会议官方智能纪要素材（供参考）===\n",
                    "\n=== Tencent Meeting Smart Minutes (For Reference) ===\n")).append(d.path("smartMinutes").asText()).append('\n');
        }
        sb.append(LangText.of("\n=== 完整逐字稿（[时间] 说话人：内容）===\n",
                "\n=== Diarized Transcript ([Time] Speaker: Content) ===\n"));
        JsonNode paragraphs = d.path("paragraphs");
        if (paragraphs.isEmpty()) {
            sb.append(LangText.of("（该会议暂无转写文本）", "(No transcript available for this meeting)")).append('\n');
        }
        for (JsonNode p : paragraphs) {
            sb.append('[').append(p.path("startTime").asText()).append("] ")
                    .append(p.path("speaker").asText()).append(LangText.of("：", ": ")).append(p.path("text").asText()).append('\n');
        }
        if (d.path("todos").isArray() && !d.path("todos").isEmpty()) {
            sb.append(LangText.of("\n=== 官方待办线索 ===\n", "\n=== Official to-do leads ===\n"));
            for (JsonNode t : d.path("todos")) sb.append("- ").append(t.path("content").asText()).append('\n');
        }
        if (d.path("errors").isArray() && !d.path("errors").isEmpty()) {
            sb.append(LangText.of("\n（部分内容未读取完整：", "\n(Partially incomplete: "));
            sb.append(String.join("；", StreamSupport.stream(d.path("errors").spliterator(), false).map(JsonNode::asText).toList()))
                    .append(LangText.of("）\n", ")\n"));
        }
        return sb.toString();
    }

    /** 经注册表调用插件工具：沿用权限校验与 PluginHostFactory.bindCall，不另开通道（tool-system-v2 风险 6）。 */
    private JsonNode callPlugin(String argsJson) {
        ToolRegistry registry = toolRegistry == null ? null : toolRegistry.getIfAvailable();
        ToolContext ctx = ToolContextHolder.get();
        if (registry == null || ctx == null) return JSON.createObjectNode().put("success", false).put("error", "no tool context");
        try {
            String out = registry.execute("tencent_meeting_action", argsJson, ctx).output();
            JsonNode node = JSON.readTree(out);
            return node != null && node.isObject() ? node
                    : JSON.createObjectNode().put("success", false).put("error", String.valueOf(out));
        } catch (Exception e) {
            return JSON.createObjectNode().put("success", false).put("error", "tencent_meeting_action failed");
        }
    }

    // ---- 小工具 ----

    private static LocalDate parseDate(String s) {
        return s == null || s.isBlank() ? null : LocalDate.parse(s.trim().substring(0, Math.min(10, s.trim().length())));
    }

    private static boolean inRange(LocalDate day, LocalDate from, LocalDate to) {
        return day == null || ((from == null || !day.isBefore(from)) && (to == null || !day.isAfter(to)));
    }

    /** 插件 startTime 格式随 CLI（ISO 带时区 / 本地时间 / 秒或毫秒时间戳），认不出就当未知（不过滤）。 */
    static LocalDate parseTencentDay(String s) {
        if (s == null || s.isBlank()) return null;
        String t = s.trim();
        try {
            if (t.matches("\\d{9,13}")) {
                long v = Long.parseLong(t);
                return java.time.Instant.ofEpochMilli(t.length() > 10 ? v : v * 1000)
                        .atZone(java.time.ZoneId.of("Asia/Shanghai")).toLocalDate();
            }
            return OffsetDateTime.parse(t).atZoneSameInstant(java.time.ZoneId.of("Asia/Shanghai")).toLocalDate();
        } catch (RuntimeException ignored) {
            // fall through
        }
        try {
            return LocalDate.parse(t.substring(0, Math.min(10, t.length())));
        } catch (RuntimeException e) {
            return null;
        }
    }

    /** 听悟的章节/摘要/待办素材，有就带上——给纪要当参考，不作为最终结论。 */
    private void appendSummary(StringBuilder sb, MeetingRecording meeting) {
        if (meeting.getSummaryJson() == null || meeting.getSummaryJson().isBlank()) return;
        try {
            Map<?, ?> summary = objectMapper.readValue(meeting.getSummaryJson(), Map.class);
            sb.append(LangText.of("\n=== 机器摘要素材（仅供参考，以转写稿原文为准）===\n",
                    "\n=== Machine summary material (reference only; the transcript is authoritative) ===\n"));
            String colon = LangText.of("：", ": ");
            Object chapters = summary.get("chapters");
            if (chapters instanceof List<?> list && !list.isEmpty()) {
                sb.append(LangText.of("章节速览：\n", "Chapters:\n"));
                for (Object c : list) {
                    if (c instanceof Map<?, ?> m) {
                        sb.append("- ").append(m.get("title")).append(colon).append(m.get("summary")).append('\n');
                    }
                }
            }
            if (summary.get("summary") instanceof String s && !s.isBlank()) {
                sb.append(LangText.of("全文摘要：", "Overall summary: ")).append(s).append('\n');
            }
            if (summary.get("todos") instanceof List<?> todos && !todos.isEmpty()) {
                sb.append(LangText.of("待办线索：\n", "To-do leads:\n"));
                todos.forEach(t -> sb.append("- ").append(t).append('\n'));
            }
            if (summary.get("keywords") instanceof List<?> kw && !kw.isEmpty()) {
                sb.append(LangText.of("关键词：", "Keywords: "))
                        .append(String.join(LangText.of("、", ", "),
                                kw.stream().map(String::valueOf).toList()))
                        .append('\n');
            }
        } catch (Exception ignored) {
            // 摘要素材损坏不影响转写稿主体
        }
    }

    /** 与面板的 meeting.status* 同口径（那边是给人看的徽标，这里是给模型读的字面）。 */
    private String statusLabel(String status) {
        return switch (status) {
            case MeetingRecording.STATUS_RECORDING -> LangText.of("录音中", "recording");
            case MeetingRecording.STATUS_RECORDED -> LangText.of("已录音（未转写）", "recorded (not transcribed)");
            case MeetingRecording.STATUS_TRANSCRIBING -> LangText.of("转写中", "transcribing");
            case MeetingRecording.STATUS_TRANSCRIBED -> LangText.of("已转写", "transcribed");
            case MeetingRecording.STATUS_EMPTY -> LangText.of("未识别到人声", "no speech detected");
            case MeetingRecording.STATUS_FAILED -> LangText.of("转写失败", "transcription failed");
            default -> status;
        };
    }
}
