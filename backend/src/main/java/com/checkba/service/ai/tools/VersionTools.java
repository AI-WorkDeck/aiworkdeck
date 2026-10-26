// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.tools;

import com.checkba.service.ai.VersionToolActionService;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import java.util.Map;
import java.util.function.Supplier;

@Component
@RequiredArgsConstructor
public class VersionTools implements AgentToolComponent {
    private final VersionToolActionService actions;
    private final ObjectMapper mapper;

    @Tool("查看当前项目的版本/Git状态、未提交改动和待处理冲突。保存文件不等于提交版本；不要把本地提交说成已同步云端。")
    @ToolMeta(displayName = "查看版本状态", category = "version", requiresHost = ToolMeta.Host.LOWA)
    public String version_status() { return result(() -> actions.read("status", null, null, false)); }

    @Tool("列出当前项目的版本历史，返回完整版本编号。历史恢复前先用它核实用户指定的版本；查找自动保存或恢复前保留的工作时设includeAuto=true。这不是本轮文档检查点。")
    @ToolMeta(displayName = "查看版本历史", category = "version", requiresHost = ToolMeta.Host.LOWA)
    public String version_history(@P(value = "条数，默认50，最多100", required = false) Integer limit,
            @P(value = "上页返回的nextCursor", required = false) String cursor,
            @P(value = "包含自动保存和恢复前保留的工作，默认false", required = false) Boolean includeAuto) {
        return result(() -> actions.read("history", limit, cursor, Boolean.TRUE.equals(includeAuto)));
    }

    @Tool("只读查看当前项目变更清单：仅文件路径和新增/修改/删除/重命名类型，不是正文差异。无参数查看磁盘相对HEAD的改动，不含编辑器尚未保存的内容；仅to查看该提交的改动；from/to都给则比较两版。版本编号必须是从version_history取得的完整40位SHA。最多返回500条，total/truncated表示是否截断。提交前可先用本工具核对范围。")
    @ToolMeta(displayName = "查看版本变更", category = "version", requiresHost = ToolMeta.Host.LOWA)
    public String version_changes(@P(value = "比较起点的完整SHA；与to一起提供", required = false) String from,
            @P(value = "目标版本完整SHA；单独提供时查看该提交", required = false) String to) {
        return result(() -> actions.changes(from, to));
    }

    @Tool("保存项目所有已打开文档并提交当前工作为一个版本。title为简短提交说明。稿上提交只保存在当前稿；主线提交可能触发现有云端自动上传，但不保证云端同步。自动合并仅使用现有无冲突合并流程；有重叠冲突须报告，不可擅自选一方。结果未知时禁止重发，先查看状态。")
    @ToolMeta(displayName = "提交项目改动", category = "version", requiresHost = ToolMeta.Host.LOWA)
    public String version_commit(@P(value = "简短提交说明", required = false) String title) {
        return result(() -> actions.request("commit", title == null ? Map.of() : Map.of("title", title)));
    }

    @Tool("保存项目已打开文档并取回云端最新版本，复用现有自动合并。只能在主线上且没有进行中的工作/合并时执行；受阻时不要丢弃工作或切稿绕过。可能自动回推合并结果；离线或冲突不能称为已取回。结果未知时禁止重发。")
    @ToolMeta(displayName = "取回云端最新版本", category = "version", requiresHost = ToolMeta.Host.LOWA)
    public String version_pull() { return result(() -> actions.request("pull", Map.of())); }

    @Tool("将整个项目恢复到用户选定的历史版本。必须先查version_history并明确目标；不是只恢复当前文件，也不是本轮检查点。服务先保留当前已保存内容，再追加恢复版本，不删除历史。ref须完整40位版本编号。结果未知时禁止重发。")
    @ToolMeta(displayName = "恢复历史版本", category = "version", requiresHost = ToolMeta.Host.LOWA)
    public String version_restore(@P("从版本历史中核实的完整40位版本编号") String ref) {
        return result(() -> actions.request("restore", Map.of("ref", ref == null ? "" : ref)));
    }

    private String result(Supplier<Map<String, Object>> action) {
        try { return mapper.writeValueAsString(action.get()); }
        catch (Exception e) { return "{\"error\":\"无法完成版本操作，请检查项目权限和版本面板\",\"retryable\":false}"; }
    }
}
