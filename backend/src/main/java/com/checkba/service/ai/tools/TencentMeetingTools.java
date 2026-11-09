// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.tools;

import com.checkba.model.entity.TencentMeetingRecord;
import com.checkba.repository.TencentMeetingRecordRepository;
import com.checkba.service.LangText;
import com.checkba.service.tmeet.TencentMeetingService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Optional;

/**
 * 腾讯会议 AI 编排工具集：
 * 提供查询已同步的腾讯会议列表与读取逐字稿/智能纪要素材的能力，
 * 供「腾讯会议」Skill 及通用编排在生成会议纪要和提炼 ToDo 时调用。
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class TencentMeetingTools implements AgentToolComponent {

    private static final DateTimeFormatter TIME_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

    private final TencentMeetingRecordRepository recordRepository;
    private final TencentMeetingService tencentMeetingService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    /** 旧名 tmeet_list_meetings：并入 meeting_list（V5），保留一版兼容壳，始终读内置同步表。 */
    @ToolShim(replacedBy = "meeting_list")
    @ToolMeta(displayName = "列出腾讯会议", category = "meeting", offerToModel = false, access = ToolMeta.Access.READ)
    @Tool("列出已同步的腾讯会议记录。")
    public String tmeet_list_meetings(
            @P("Project id (injected by runtime)") Long projectId,
            @P(value = "按会议主题过滤的关键词", required = false) String keyword) {
        return ToolShims.hint(listSynced(projectId, keyword, null, null), "meeting_list",
                "meeting_list(source=tencent, keyword)");
    }

    /** 内置同步表的会议列表（meeting_list 在插件未装/未启用时走这里）；from/to 含端点，按开会日期过滤。 */
    public String listSynced(Long projectId, String keyword, java.time.LocalDate from, java.time.LocalDate to) {
        log.info("Tool: meeting_list(tencent builtin) projectId={} keyword={}", projectId, keyword);

        List<TencentMeetingRecord> list;
        if (projectId != null) {
            if (keyword != null && !keyword.isBlank()) {
                list = recordRepository.findByProjectIdAndSubjectContainingIgnoreCaseOrderByStartTimeDesc(projectId, keyword.trim());
            } else {
                list = recordRepository.findByProjectIdOrderByStartTimeDesc(projectId);
            }
        } else {
            list = recordRepository.findAll();
        }

        if ((list == null || list.isEmpty()) && projectId != null) {
            list = recordRepository.findAll();
            if (keyword != null && !keyword.isBlank()) {
                String kw = keyword.trim().toLowerCase();
                list = list.stream().filter(m -> m.getSubject() != null && m.getSubject().toLowerCase().contains(kw)).toList();
            }
            if (list.size() > 20) {
                list = list.subList(0, 20);
            }
        }

        if (list != null && (from != null || to != null)) {
            list = list.stream().filter(m -> m.getStartTime() == null
                    || ((from == null || !m.getStartTime().toLocalDate().isBefore(from))
                    && (to == null || !m.getStartTime().toLocalDate().isAfter(to)))).toList();
        }

        if (list == null || list.isEmpty()) {
            return LangText.of(
                    "暂无已同步的腾讯会议记录。用户可在左栏「腾讯会议」插件面板中扫码并点击同步。",
                    "No synchronized Tencent meeting records found. The user can sync meetings in the Tencent Meeting sidebar panel.");
        }

        StringBuilder sb = new StringBuilder(LangText.of(
                "腾讯会议列表：\n", "Tencent meeting list:\n"));
        for (TencentMeetingRecord m : list) {
            sb.append("- source=tencent | meetingId=").append(m.getId())
                    .append(" | 会议：").append(m.getSubject());
            if (m.getMeetingCode() != null && !m.getMeetingCode().isBlank()) {
                sb.append("（会议号：").append(m.getMeetingCode()).append("）");
            }
            if (m.getStartTime() != null) {
                sb.append(" | 时间：").append(m.getStartTime().format(TIME_FMT));
            }
            if (m.getDuration() != null) {
                sb.append(" | 时长：").append(m.getDuration());
            }
            sb.append(" | 状态：").append(statusLabel(m.getStatus()))
                    .append('\n');
        }
        return sb.toString();
    }

    /** 旧名 tmeet_get_transcript：并入 meeting_get_transcript（V5），保留一版兼容壳，始终读内置同步表。 */
    @ToolShim(replacedBy = "meeting_get_transcript")
    @ToolMeta(displayName = "读取腾讯会议转写稿", category = "meeting", offerToModel = false, access = ToolMeta.Access.READ)
    @Tool("读取一条已同步腾讯会议的逐字稿与智能纪要。")
    public String tmeet_get_transcript(
            @P("Project id (injected by runtime)") Long projectId,
            @P("Tencent meeting record id") Long recordId) {
        return ToolShims.hint(transcript(projectId, recordId), "meeting_get_transcript",
                "meeting_get_transcript(meetingId, source=tencent)");
    }

    /** 内置同步表的逐字稿（meeting_get_transcript 在插件未装/未启用，或 meetingId 是内置数字 id 时走这里）。 */
    public String transcript(Long projectId, Long recordId) {
        log.info("Tool: meeting_get_transcript(tencent builtin) projectId={} recordId={}", projectId, recordId);

        Optional<TencentMeetingRecord> opt = recordRepository.findById(recordId);
        if (opt.isEmpty()) {
            return LangText.of("未找到该腾讯会议记录 (recordId=" + recordId + ")。",
                    "Tencent meeting record not found (recordId=" + recordId + ").");
        }

        TencentMeetingRecord record = opt.get();
        if (projectId != null && record.getProjectId() == null) {
            record.setProjectId(projectId);
            recordRepository.save(record);
        }

        StringBuilder sb = new StringBuilder();
        sb.append(LangText.of("会议主题：", "Meeting Subject: ")).append(record.getSubject()).append("\n");
        if (record.getMeetingCode() != null) {
            sb.append(LangText.of("会议号：", "Meeting Code: ")).append(record.getMeetingCode()).append("\n");
        }
        if (record.getStartTime() != null) {
            sb.append(LangText.of("开会时间：", "Start Time: ")).append(record.getStartTime().format(TIME_FMT)).append("\n");
        }
        if (record.getDuration() != null) {
            sb.append(LangText.of("会议时长：", "Duration: ")).append(record.getDuration()).append("\n");
        }
        if (record.getSpeakersJson() != null) {
            try {
                List<String> sp = objectMapper.readValue(record.getSpeakersJson(), new TypeReference<>() {});
                if (!sp.isEmpty()) {
                    sb.append(LangText.of("与会发言人：", "Speakers: ")).append(String.join("、", sp)).append("\n");
                }
            } catch (Exception ignored) {}
        }

        if (record.getSmartMinutesText() != null && !record.getSmartMinutesText().isBlank()) {
            sb.append(LangText.of("\n=== 腾讯会议官方智能纪要素材（供参考）===\n",
                    "\n=== Tencent Meeting Smart Minutes (For Reference) ===\n"));
            sb.append(record.getSmartMinutesText()).append("\n");
        }

        String transcript = tencentMeetingService.renderTranscriptText(record);
        sb.append(LangText.of("\n=== 完整逐字稿（[时间] 说话人：内容）===\n",
                "\n=== Diarized Transcript ([Time] Speaker: Content) ===\n"));
        if (!transcript.isBlank()) {
            sb.append(transcript).append("\n");
        } else {
            sb.append(LangText.of("（该会议暂无转写文本，可能是尚未转写完成或无音频录制）",
                    "(No transcript available for this meeting)"));
        }

        return sb.toString();
    }

    private String statusLabel(String status) {
        if (status == null) return "未知";
        return switch (status) {
            case TencentMeetingRecord.STATUS_SYNCED -> LangText.of("已同步", "synced");
            case TencentMeetingRecord.STATUS_FAILED -> LangText.of("同步失败", "failed");
            default -> status;
        };
    }
}
