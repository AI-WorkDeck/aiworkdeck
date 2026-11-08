// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.tools;

import com.checkba.service.ai.AskUserQuestion;
import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import org.springframework.stereotype.Component;

/**
 * 向用户提问（dev-board#868，对标 Claude Code 的 AskUserQuestion）。
 *
 * <p>本方法<b>只做参数校验</b>：校验不过回 {@code Error:}，模型改了重发；校验通过后真正的动作
 * （发 SSE {@code ask_user} 事件、落库问题卡、以 AWAITING_INPUT 停机）由编排器做——
 * 这是一个会结束本轮的工具，工具方法本身拿不到「结束本轮」的权力，也不该拿。
 * 编排器按<b>参数</b>重建问题（{@link AskUserQuestion#fromArgsJson}），不读本方法的返回值。
 *
 * <p>刻意不做「工具里阻塞等人类回答」：理由与 {@code <question>} 反问停机相同——工具分发跑在
 * 流式回调线程上，撞 600s callTimeout 与 180s 看门狗，而律师完全可能明天才回来答。
 * 答案是下一轮普通用户消息（以 {@code <ask_user_answer>} 开头）。
 *
 * <p>子 Agent 里不可用（SubAgentService 排除）：子任务没有用户可问，也停不了父轮次。
 */
@Component
public class AskUserTools implements AgentToolComponent {

    @Tool("向用户提一个澄清问题并结束本轮，答复在下一条用户消息里（以 <ask_user_answer id=...> 开头）。\n"
            + "何时用：请求含糊、多种读法会产生不同改动（「清理」「整理」「优化一下」没有标准或范围）；要删除或重写大段内容而用户没授权范围；「你能帮我…么」这类动作不明的提问。\n"
            + "何时不用：指令已写明对象和动作（「把第12到21段删掉」）就直接做；能从文档、项目文件、历史、记忆查到的不要问；同一点只问一次。\n"
            + "给 2-4 个互不重叠的具体理解，推荐项放第一个，不要自己加「其他」。调用后本轮不再调用其他工具。")
    @ToolMeta(displayName = "向用户提问", category = "planning")
    public String ask_user(
            @P("要问的一个问题，用用户的语言，一句话说清哪里含糊")
            String question,
            @P(value = "可选。2-4 个选项的 JSON 数组 [{\"label\":\"≤15字\",\"description\":\"选它会怎么做\"}]；省略则为自由文本问题",
                    required = false)
            String options,
            @P(value = "可选。可多选时为 true，默认 false",
                    required = false)
            Boolean multi_select,
            @P(value = "可选。问题上方的话题短标签（≤8 字）",
                    required = false)
            String header) {
        try {
            AskUserQuestion q = AskUserQuestion.of(question, options, multi_select, header, null);
            return "OK: the question has been shown to the user with " + q.options().size()
                    + " option(s). This turn ends here; wait for the user's answer in the next message.";
        } catch (IllegalArgumentException e) {
            return "Error: " + e.getMessage();
        }
    }
}
