// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai.tools;

import com.checkba.service.LangText;
import com.checkba.service.ai.DocumentCheckpointService;
import com.checkba.service.ai.context.ProjectContextHolder;
import dev.langchain4j.agent.tool.Tool;
import dev.langchain4j.agent.tool.P;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * 文档检查点工具：恢复本轮开始前的文档快照。
 * 快照由编排器在本轮第一个修改类工具执行前自动创建。
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class CheckpointTools implements AgentToolComponent {

    private final DocumentCheckpointService documentCheckpointService;

    @Tool("【恢复】把文档恢复到本轮开始前的快照（检查点）。这是最后手段：" +
          "仅在文档已被改乱、无法逐步撤销时使用。" +
          "恢复会丢弃本轮的所有修改（包括修订标记）并让编辑器重新加载文档。" +
          "这不是导出、保存或预览工具，不得为这些目的调用。" +
          "调用者必须明确选择丢弃本轮全部修改：confirmation 精确填写 discard_current_turn_changes，" +
          "reason 填写恢复原因。常规纠错优先精确编辑或可用的 doc_undo。")
    @ToolMeta(displayName = "恢复文档快照", category = "document", fileEffect = "MODIFIED")
    public String doc_restore_checkpoint(
            @P(value = "Explicitly discard ALL current-turn changes: must be exactly discard_current_turn_changes", required = true) String confirmation,
            @P(value = "Nonempty reason for discarding all current-turn changes; this is not export or save", required = true) String reason) {
        if (!"discard_current_turn_changes".equals(confirmation)) {
            return "Error: " + LangText.of(
                    "未执行恢复。恢复会丢弃本轮全部修改，不是导出或保存。必须明确选择此操作，并将 confirmation 精确填写为 discard_current_turn_changes。",
                    "Restore was not performed. It discards ALL current-turn changes; it is not export or save. Explicitly choose this action with confirmation exactly discard_current_turn_changes.");
        }
        // ToolRegistry string binding can stringify Hutool's JSON null sentinel.
        if (reason == null || reason.isBlank() || "null".equalsIgnoreCase(reason.trim())) {
            return "Error: " + LangText.of(
                    "未执行恢复。reason 必须填写丢弃本轮全部修改的原因。",
                    "Restore was not performed. reason must explain why all current-turn changes should be discarded.");
        }
        String conversationId = ProjectContextHolder.getConversationId();
        if (conversationId == null || conversationId.isBlank()) {
            return "Error: " + LangText.of("未执行恢复：无法获取当前会话ID。", "Restore was not performed: current conversation ID is unavailable.");
        }
        log.info("Tool: doc_restore_checkpoint explicitly confirmed");
        return documentCheckpointService.restore(conversationId);
    }
}
