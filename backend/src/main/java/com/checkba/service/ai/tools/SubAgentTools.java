// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.tools;

import com.checkba.service.ai.subagent.SubAgentResult;
import com.checkba.service.ai.subagent.SubAgentService;
import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * 委派子任务工具（Phase 3C 多智能体协作第一阶段）。
 *
 * 把一个自包含的复杂子问题交给独立的子 Agent 循环执行，
 * 子 Agent 的中间过程不进入主会话历史，只返回最终结构化结果。
 * 身份字段（projectId/conversationId/userId）从 {@link ToolContextHolder}
 * 继承主会话上下文（不变式 3），LLM 无法伪造。
 */
@Component
public class SubAgentTools implements AgentToolComponent {

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(SubAgentTools.class);

    private final SubAgentService subAgentService;

    // @Lazy 打破启动死环：ToolRegistry ← List<AgentToolComponent>(含本类)
    // → SubAgentService → ToolRegistry/XmlToolCallParser(→ToolRegistry)。
    // Spring Boot 默认禁止循环引用，这个环曾让 desktop 打包态后端启动即崩
    // （CI 冒烟测试双平台超时）；subAgentService 只在工具调用运行期使用，
    // 注入代理在此单点断环即可。
    public SubAgentTools(@Lazy SubAgentService subAgentService) {
        this.subAgentService = subAgentService;
    }

    @ToolMeta(displayName = "委派子任务", category = "agent")
    @Tool("把自包含的子任务派给独立子 Agent，由它自己跑工具循环，只返回最终结构化结果。\n"
            + "何时用：需要独立多步探索、或会产生大量中间输出的复杂子问题；一两次工具调用能做完的不要派。\n"
            + "回执是 JSON：success/result/error/toolsUsed/rounds。task_description 要完整独立（子 Agent 看不到本对话）；tool_scope 只给最小必要的工具集。success=false 时自己接手或换策略，不要原样重派。")
    public String dispatch_subtask(
            @P("子任务的完整独立描述（子 Agent 看不到本对话）") String task_description,
            @P(value = "结果必须包含什么；不传则由子 Agent 自行决定", required = false) String expected_output,
            @P(value = "子 Agent 可用的工具名，JSON 数组或逗号分隔；不传即全部", required = false) String tool_scope) {
        log.info("Tool: dispatch_subtask called, scope='{}'", tool_scope);
        if (SubAgentService.inSubAgent()) {
            // 防递归第二道防线（第一道在 SubAgentService 的分发拦截）
            return "Error: dispatch_subtask is not available inside a sub-agent (nested delegation refused).";
        }
        if (task_description == null || task_description.isBlank()) {
            return "Error: task_description is required.";
        }
        ToolContext ctx = ToolContextHolder.get();
        SubAgentResult result = subAgentService.dispatch(
                task_description, expected_output, parseToolScope(tool_scope), ctx);
        return result.toJson();
    }

    /**
     * 容错解析 tool_scope：JSON 数组（["a","b"]）或逗号/顿号分隔字符串（"a, b"）均可。
     */
    public static List<String> parseToolScope(String toolScope) {
        List<String> names = new ArrayList<>();
        if (toolScope == null || toolScope.isBlank()) {
            return names;
        }
        String trimmed = toolScope.trim();
        if (trimmed.startsWith("[")) {
            try {
                for (Object item : cn.hutool.json.JSONUtil.parseArray(trimmed)) {
                    if (item != null && !String.valueOf(item).isBlank()) {
                        names.add(String.valueOf(item).trim());
                    }
                }
                return names;
            } catch (Exception ignored) {
                // 非法 JSON 数组，退回分隔符解析
            }
        }
        for (String part : trimmed.split("[,，、;\\s]+")) {
            String name = part.trim()
                    .replaceAll("^[\\[\"']+", "")
                    .replaceAll("[\\]\"']+$", "");
            if (!name.isBlank()) {
                names.add(name);
            }
        }
        return names;
    }
}
