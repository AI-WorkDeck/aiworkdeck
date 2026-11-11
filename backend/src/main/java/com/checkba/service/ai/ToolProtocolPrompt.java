// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 系统提示的工具协议变体（gap P2：一个模型只讲一种工具协议）。
 *
 * <p>XML 变体就是改造前的原文，逐字节不变（旧会话、没有可靠原生工具调用的模型继续用它）。
 * 原生变体去掉 {@code <thinking>} 必填与 {@code <process><tool_code>} 语法，只保留前端据以路由的
 * {@code <final>} / {@code <question>} / {@code <artifact>} 等回答标签。选哪一档由
 * {@link ChatModelFactory#nativeToolProtocol} 按通道与模型决定，一个会话内不变，所以两档各自的
 * 提示缓存前缀都稳定。XML 解析器在两档下都保留为兜底。
 */
final class ToolProtocolPrompt {

    private ToolProtocolPrompt() {}

    /** prompts/system_prompt*.md 里的变体块：xml 段与 native 段二选一，标记行本身不发给模型。 */
    private static final Pattern VARIANT_BLOCK = Pattern.compile(
            "(?s)<!-- awd:protocol:xml -->\\n(.*?)<!-- awd:protocol:native -->\\n(.*?)<!-- awd:protocol:end -->\\n");

    static String select(String basePrompt, boolean nativeProtocol) {
        return VARIANT_BLOCK.matcher(basePrompt)
                .replaceAll(m -> Matcher.quoteReplacement(m.group(nativeProtocol ? 2 : 1)));
    }

    /**
     * {@code ContextAssemblerService} 里硬编码段（enforcement / 模式约束 / 工具目录）的原生改写表：
     * 左边是 XML 变体原文里的片段，右边是原生变体的写法。左边必须在原文里找得到——
     * {@code ToolProtocolPromptTest} 逐条钉住，改了原文而没改这里会直接转红。
     */
    static final String[][] NATIVE_REWRITES = {
            // enforcement（中英两版这几段文字相同）
            {"## CRITICAL: Raw XML Output (MUST READ FIRST)\n"
                    + "- **DO NOT** wrap your output in markdown code blocks. No ```xml or ``` around tags.\n"
                    + "- Output XML tags directly: `<thinking>...</thinking>` NOT ```xml\n<thinking>```\n"
                    + "- VIOLATION OF THIS RULE WILL BREAK THE SYSTEM.\n",
             "## CRITICAL: Tool Calls And Answer Tags (MUST READ FIRST)\n"
                    + "- Call tools ONLY through the function-calling interface. NEVER write a tool call as text "
                    + "(tags or JSON in the answer): text is not executed, so the action silently does not happen.\n"
                    + "- Every turn must end with a tool call, a question or the answer. Never stop after analysis alone.\n"
                    + "- **DO NOT** wrap answer tags in markdown code blocks. Output them directly: "
                    + "`<final>...</final>` NOT ```xml\n<final>```\n"},
            {"- OMIT `<title>` and `<process>` tags entirely.\n", "- OMIT the `<title>` tag entirely.\n"},
            {"1. `<thinking>` - Brief intent analysis (always required)\n"
                    + "2. `<title>` - Session title (complex tasks only)\n"
                    + "3. `<process>` - Tool invocations (if any)\n"
                    + "4. `<artifact>`",
             "1. `<title>` - Session title (complex tasks only)\n"
                    + "2. Tool calls through function calling (if any)\n"
                    + "3. `<artifact>`"},
            {"5. `<final>` - **MAIN ANSWER**", "4. `<final>` - **MAIN ANSWER**"},
            {"6. `<walkthrough>` - Brief", "5. `<walkthrough>` - Brief"},
            {"- When you output `<tool_code>`, STOP and wait for `<tool_output>`.\n"
                    + "- When you receive `TOOL_RESULT`, you MUST continue execution. Do NOT ask \"should I continue?\".\n"
                    + "- Do NOT output `<final>` in the same turn as `<tool_code>`.\n",
             "- Tool calls that do not depend on each other's results belong in ONE response.\n"
                    + "- When you receive a tool result, you MUST continue execution. Do NOT ask \"should I continue?\".\n"
                    + "- Do NOT output `<final>` in the same response as a tool call.\n"},
            // 模式约束：ASK
            {"   - DO NOT output `<process>` tags - 不执行任何操作流程\n", ""},
            {"   - DO NOT output `<process>` tags - no operation flows\n", ""},
            {"（使用 `<thinking>` + 纯文本或 `<final>` 标签）", "（使用纯文本或 `<final>` 标签）"},
            {"(using `<thinking>` + plain text or the `<final>` tag)", "(using plain text or the `<final>` tag)"},
            {"   <thinking>分析用户意图...</thinking>\n\n", ""},
            {"   <thinking>Analyzing the user's intent...</thinking>\n\n", ""},
            // 模式约束：PLAN
            {"禁止使用 `<tool_code>` 调用任何工具", "禁止调用任何工具"},
            {"calling any tool via `<tool_code>` is FORBIDDEN", "calling any tool is FORBIDDEN"},
            {"   <thinking>分析任务复杂度和所需步骤...</thinking>\n\n", ""},
            {"   <thinking>Analyzing the task's complexity and the steps required...</thinking>\n\n", ""},
            // 工具目录
            {" (call one right away with `<tool_code>name(arg=\"value\")</tool_code>`)", ""},
            {"（想当轮就用，写成 `<tool_code>name(arg=\"value\")</tool_code>`）", ""},
    };

    static String nativeText(String xmlText) {
        String out = xmlText;
        for (String[] pair : NATIVE_REWRITES) {
            out = out.replace(pair[0], pair[1]);
        }
        return out;
    }
}
