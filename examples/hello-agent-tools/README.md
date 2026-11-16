<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# hello-agent-tools

声明式 Agent 工具（规范 v2.13，`docs/PLUGIN_SPEC.md` §20）的最小示例：没有 Java、没有构建步骤，
`manifest.json` 的 `tools[]` 里两个条目就让应用内 Agent 多了两个工具。

| 工具 | access | 绑定的宿主服务 |
|---|---|---|
| `hello_agent_tools_list_tasks` | read | `calendar.listForUser`（用户全部项目的日程） |
| `hello_agent_tools_add_task` | write | `calendar.create`（在目标项目建事项，需项目写权限） |

- 工具名必须以 `hello_agent_tools_`（插件 id 把 `-` 换成 `_`）开头。
- `permissions` 必须是 manifest `permissions` 的子集；宿主服务表（`sdk/plugin-sdk/services.json`）还会要求自己的权限（这里是 `tasks`），缺了会被拒绝。
- 校验：`node scripts/plugin-dev.mjs validate examples/hello-agent-tools`。
- 后端回归：`PluginDeclaredToolsTest` 把本目录装进临时插件目录，核对两个工具出现在 `ToolRegistry.getAllSpecifications()`、读工具可执行、写工具缺权限被拒、禁用插件后消失。
