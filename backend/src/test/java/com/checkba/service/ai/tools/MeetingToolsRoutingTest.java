// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.tools;

import com.checkba.service.ai.ToolRegistry;
import com.checkba.service.meeting.MeetingRecordingService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.ObjectProvider;

import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * V5 会议合流的路由：source=tencent 在插件已装且启用时走 tencent_meeting_action，否则读内置同步表。
 * 全程用桩和夹具，不碰真实腾讯会议账号。
 */
class MeetingToolsRoutingTest {

    private static final String KEY = "123e4567-e89b-12d3-a456-426614174000";

    private MeetingRecordingService recordings;
    private TencentMeetingTools builtin;
    private ToolRegistry registry;
    private MeetingTools tools;

    @SuppressWarnings("unchecked")
    @BeforeEach
    void setUp() {
        recordings = mock(MeetingRecordingService.class);
        builtin = mock(TencentMeetingTools.class);
        registry = mock(ToolRegistry.class);
        ObjectProvider<ToolRegistry> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(registry);
        tools = new MeetingTools(recordings, builtin, provider);
        tools.pollIntervalMs = 1;
        tools.pollBudgetMs = 5;
        ToolContextHolder.set(new ToolContext(7L, "c1", 3L, null, null, null, null, null, null, null, null, null));
    }

    @AfterEach
    void tearDown() {
        ToolContextHolder.clear();
    }

    private void pluginReplies(String... outputs) {
        when(registry.tencentMeetingPluginActive()).thenReturn(true);
        var results = new ToolRegistry.ToolResult[outputs.length];
        for (int i = 0; i < outputs.length; i++) results[i] = new ToolRegistry.ToolResult(outputs[i], null, true);
        var stub = when(registry.execute(eq("tencent_meeting_action"), anyString(), any(ToolContext.class)));
        stub.thenReturn(results[0], java.util.Arrays.copyOfRange(results, 1, results.length));
    }

    @Test
    @DisplayName("插件启用：source=tencent 的列表走 tencent_meeting_action(list)，按日期与关键词过滤，不读内置表")
    void tencentListGoesToThePluginWhenActive() {
        pluginReplies("{\"success\":true,\"data\":{\"meetings\":["
                + "{\"key\":\"" + KEY + "\",\"subject\":\"股权激励签约会\",\"meetingCode\":\"888\",\"startTime\":\"2026-11-08T10:00:00+08:00\"},"
                + "{\"key\":\"k2\",\"subject\":\"旧会议\",\"meetingCode\":\"1\",\"startTime\":\"2026-10-01T10:00:00+08:00\"}]}}");

        String out = tools.meeting_list(7L, "tencent", "2026-11-02", "2026-11-09", null);

        assertTrue(out.contains("source=tencent | meetingId=" + KEY + " | 股权激励签约会"), out);
        assertFalse(out.contains("旧会议"), out);
        verify(builtin, never()).listSynced(any(), any(), any(), any());
        ArgumentCaptor<String> args = ArgumentCaptor.forClass(String.class);
        verify(registry).execute(eq("tencent_meeting_action"), args.capture(), any(ToolContext.class));
        assertTrue(args.getValue().contains("\"action\":\"list\""), args.getValue());
    }

    @Test
    @DisplayName("插件未装或未启用：source=tencent 读内置同步表，不调用插件")
    void tencentListFallsBackToBuiltinTable() {
        when(registry.tencentMeetingPluginActive()).thenReturn(false);
        when(builtin.listSynced(7L, null, LocalDate.of(2026, 11, 2), null)).thenReturn("内置表结果");

        assertTrue(tools.meeting_list(7L, "tencent", "2026-11-02", null, null).contains("内置表结果"));
        verify(registry, never()).execute(anyString(), anyString(), any(ToolContext.class));
    }

    @Test
    @DisplayName("source=all 同时列出录音与腾讯会议；非法 source / 日期给出 Error")
    void allListsBothAndValidatesInput() {
        when(registry.tencentMeetingPluginActive()).thenReturn(false);
        when(builtin.listSynced(any(), any(), any(), any())).thenReturn("腾讯会议列表：\n- source=tencent | meetingId=1");
        String out = tools.meeting_list(7L, null, null, null, null);
        assertTrue(out.contains("source=tencent"), out);
        assertTrue(out.contains("会议录音") || out.contains("recordings"), out);

        assertTrue(tools.meeting_list(7L, "zoom", null, null, null).startsWith("Error"));
        assertTrue(tools.meeting_list(7L, "all", "昨天", null, null).startsWith("Error"));
    }

    @Test
    @DisplayName("逐字稿：UUID key 走插件 detail，pending 后轮询到完成并渲染逐字稿")
    void tencentTranscriptPollsThePluginJob() {
        pluginReplies(
                "{\"success\":true,\"data\":{\"pending\":true,\"jobId\":\"job-1\"}}",
                "{\"success\":true,\"data\":{\"subject\":\"股权激励签约会\",\"startTime\":\"2026-11-08\","
                        + "\"smartMinutes\":\"决议A\",\"paragraphs\":[{\"speaker\":\"张三\",\"text\":\"同意\",\"startTime\":\"00:01\"}],"
                        + "\"todos\":[],\"errors\":[]}}");

        String out = tools.meeting_get_transcript(7L, KEY, "tencent");

        assertTrue(out.contains("股权激励签约会") && out.contains("[00:01] 张三") && out.contains("决议A"), out);
        ArgumentCaptor<String> args = ArgumentCaptor.forClass(String.class);
        verify(registry, org.mockito.Mockito.times(2)).execute(eq("tencent_meeting_action"), args.capture(), any(ToolContext.class));
        assertTrue(args.getAllValues().get(0).contains(KEY));
        assertTrue(args.getAllValues().get(1).contains("job-1"));
    }

    @Test
    @DisplayName("逐字稿任务超时：把 jobId 交回模型，让它用插件工具继续查，不静默失败")
    void tencentTranscriptStillPendingReturnsJobId() {
        pluginReplies("{\"success\":true,\"data\":{\"pending\":true,\"jobId\":\"job-9\"}}");
        String out = tools.meeting_get_transcript(7L, KEY, "tencent");
        assertTrue(out.contains("job-9") && out.contains("tencent_meeting_action"), out);
    }

    @Test
    @DisplayName("内置表的数字 id 即使插件启用也读内置表；UUID 不带 source 时按腾讯会议处理")
    void numericIdsStayOnTheBuiltinTable() {
        when(registry.tencentMeetingPluginActive()).thenReturn(true);
        when(builtin.transcript(7L, 101L)).thenReturn("内置逐字稿");
        assertTrue(tools.meeting_get_transcript(7L, "101", "tencent").contains("内置逐字稿"));
        verify(registry, never()).execute(anyString(), anyString(), any(ToolContext.class));

        pluginReplies("{\"success\":false,\"error\":\"请先登录\"}");
        assertTrue(tools.meeting_get_transcript(7L, KEY, null).contains("请先登录"));
    }

    @Test
    @DisplayName("插件返回失败时原样带回原因（未登录/无项目），不吞掉")
    void pluginFailureIsSurfaced() {
        pluginReplies("{\"success\":false,\"error\":\"请先打开一个项目\"}");
        String out = tools.meeting_list(null, "tencent", null, null, null);
        assertTrue(out.startsWith("Error") && out.contains("请先打开一个项目"), out);
    }
}
