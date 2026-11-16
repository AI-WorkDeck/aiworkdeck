<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Agent 操作整个应用（含插件）+ 对外 MCP 读写：现状、缺口与分期方案

状态：设计稿（2026-11-07），分支 `feat/agent-app-control`。`docs/` 在 .gitignore 里，入库要 `git add -f`。
关联：`docs/plans/stella-alignment/mcp-server.md`（#1385 已落地第一期）、`docs/capability-catalog.md`、`docs/PLUGIN_SPEC.md`、`docs/PLUGIN_API_ROADMAP.md`。

目标一句话：**一个工具注册表（`ToolRegistry`），两个消费者（应用内 Agent、对外 MCP 服务器）；核心功能与每个插件都用同一种方式申报工具，新装插件无需改核心即可被两边调用。**

---

## A. 现状（按代码核实）

### A1 应用内 Agent 的工具从哪来

- **注册表**：`backend/src/main/java/com/checkba/service/ai/ToolRegistry.java`。`init()` 扫所有 `AgentToolComponent` bean（`service/ai/tools/*`）的 langchain4j `@Tool` 方法登记为内置工具（342 个）；`getAllSpecifications()` 还并入三类运行期工具：
  1. 插件 JAR 工具：`PluginService.getPluginTools()`（`backendJars` 里带 `@Tool` 的类，`registerToolObject`），分发前 `missingPermissionsForTool`（manifest `tools[].permissions ⊆ permissions`）+ `PluginHostFactory.bindCall(ctx)` 绑定宿主 SPI；
  2. 插件声明的远程 MCP：`service/ai/mcp/PluginMcpService.bindings()`（manifest `contributes.mcpServers`，工具名 `mcp_<hash24>_<tool>`）；
  3. 用户自配 MCP：`UserMcpConnectionService.bindings()`（`user_mcp_*`，`/api/mcp/*`）。
- **元数据**：`service/ai/tools/ToolMeta.java`：`displayName / category / fileEffect / fileArg / refreshFiles / requiresHost(NONE|LOWA|OFFICE) / offerToModel / access(INFERRED|READ|WRITE|DESTRUCTIVE)`。`access` 缺省由 `service/ai/capability/CapabilityCatalog.inferAccess` 按动词推断，结果生成 `docs/capability-catalog.md`（`CapabilityCatalogDocTest` 做漂移比对）。**没有**「需用户确认」「可投影到 MCP」字段。
- **可见性三道闸**：`ToolDisclosurePolicy`（核心集 + 类目渐进披露，`list_tools(category)`，关键词预放回；插件工具统一落 `plugin-tools` 类目，**没有关键词预放回**）→ `ClientCapabilityService.isToolVisible`（宿主闸）→ `skill/SkillRouter.visibleTools`（restrict skill 白名单）。ASK 模式只放 `AgentOrchestrator.ASK_READ_TOOLS`。
- **执行**：`ToolRegistry.execute(name, argsJson, ToolContext)`；`ToolContext(projectId, conversationId, userId, modelId, sessionTools, offeredTools, defaultOutputFolderId…)`，`projectId/conversationId/userId` 是服务端注入参数（`SERVER_CONTEXT_PARAMS`），不向模型暴露。
- **已有的「非文档」工具**（纠正「只会文档/文件夹/MCP」的印象，见 `docs/capability-catalog.md`）：`task_create/task_list/task_update`（`tools/TaskTools.java`，落 `ProjectTask` 表，就是日程插件的数据）、`tmeet_list_meetings/tmeet_get_transcript`（`tools/TencentMeetingTools.java`，读内置同步表 `TencentMeetingRecord`）、`meeting_*`（会议录音）、`memory_*`、`law_search/case_search/qichacha_*/tushare_query/search_web`、`tag_*`、`version_*`、`pdf_*/pptx_*`、`image_generate_asset`、`capability_*`、`plugin_dev_*`、`dispatch_subtask`、`ask_user`。
- **确认/审计**：没有逐工具确认；唯一的停机点是模型主动 `ask_user`（SSE `ask_user` 事件 + `AgentRunRecord` 状态 `AWAITING_INPUT`）和「实施计划」审批（`AWAITING_APPROVAL`）。没有工具调用审计表；过程卡以 `<process>` 文本写进 `ProjectAiMessage`。`UserActivityLog`（`UserActivityLogService`）记用户动作，可复用。
- **新文件落点**：`tools/GeneratedFileLocation.java`：`write_file/write_docx/doc_start_stream/sheet_create_file/pptx_generate` 未指定目录时，继承本轮活跃文件所在目录，否则根目录；结果经 `file_change` 回查真名，聊天「新增」列表可拖拽移动。**没有**「对话无项目时推断事项」的机制：会话按 `POST /api/agent/conversations {projectId}` 绑定项目。
- **修订**：Word 经 `EditorBridgeService.sendOpenFileAction` 带 `trackRevisions=true` 打开，`doc_*` 写入即为原生修订；**没有**服务端「待审修订」记录，也没有对未打开文件做修订写入的服务（`write_docx` 是整文件覆盖）。

### A2 插件怎样向 Agent 暴露（或暴露不了）能力

四类形态见 `.claude/agents/plugin-system.md`。关键事实：

| 插件 | 形态 | 能力所在 | Agent 今天能否调用 |
|---|---|---|---|
| tencent-meeting | JAR + Web + skill | `official-plugins/tencent-meeting/backend/.../TencentMeetingTools.java` 单工具 `tencent_meeting_action(action,json)`（status/login/sync/list/detail/export/autosync），归档写 `腾讯会议/<标题>-逐字稿.md`，自动同步时经 `host.llm()` 产「-会议纪要.md」「-待办.md」 | **能但基本调不到**：① `plugin-tools` 类目无关键词预放回，模型得先 `list_tools`；② 插件自带 skill `skill/skill.yml` 是 `restrict`，`allowed_tools` **漏了 `tencent_meeting_action`**，触发词命中反而把它裁掉；③ 内置 skill `backend/skills/tencent-meeting` 走的是另一套 `tmeet_*`（内置同步表），两套并存 |
| calendar | 纯 Web | iframe → `services.request('calendar', op)` → `frontend/src/utils/pluginCollectionServices.js` → `/api/tasks`（`TaskController`，`ProjectTask`） | 间接能：核心 `task_*` 读同一张表，但 `task_list` **必须带 projectId**（`TaskTools.java:187`），回答「本周截止」要逐项目查 |
| lawfirm-management | 纯 Web | `lawfirm.request(action)` → `controller/ai/PluginLawFirmController` → `service/lawfirm/LawFirmManagementService.execute`（overview/list/dashboard/conflict*/submitIntake/…/recordCollection/exportCsv）+ `LawFirmWorkflowService.ACTIONS` | **不能**：无任何 `@Tool` |
| project-im | 纯 Web | `im.request` → `PluginImController` → `service/im/ImService.execute`（list/messages/send/upload/…） | **不能** |
| desensitize | 纯 Web | `services.request('sensitive', preview/redact/restore)` → `SensitiveController` `/api/sensitive/*` → `SensitiveService`（按文件）/ `service/sensitive/SensitiveTextEngine`（纯文本 `apply/edits`） | **不能**（只有 `pdf_redact`） |
| search / favorites / clipboard / voice / insight / litigation-visual / tabular-review | 纯 Web | `services.request(<service>)` 走宿主 REST | search 有核心 `search_project_content`；其余无 |
| dpia-workbench | JAR | `dpia_workbench_task` | 能 |

结构性原因：
- **manifest `tools[]` 今天只是 JAR 工具的「名单」**（name/description/permissions，`sdk/plugin-sdk/manifest.schema.json` 第 83 行；`PluginService.PluginToolInfo`），用于广场展示、§8.7 直调白名单和权限校验；纯 Web 插件按 `backend/skills/plugin-dev/prompt.md` 的规则 **必须 `tools: []`**。
- **桥只有插件→宿主一个方向**：`frontend/src/components/PluginPane.vue` `handleCall` 方法表（files.*/doc.*/ai.request/tools.invoke/chat.send/services.request/lawfirm.request/im.request/notifications.*/settings.*/connections.*/mcp.*…），宿主→插件只有 `init/theme/result/event` 推送，没有「宿主发请求、等插件回复」。所以 iframe 里的逻辑后端调不到。
- 但 **纯 Web 插件的真实业务逻辑几乎都在宿主后端**（`services.request` 的固定服务表 `frontend/src/utils/pluginBusinessServices.js` / `pluginCollectionServices.js` 只是把 REST 包了一层）。这意味着「插件声明工具 → 后端服务」这条路不需要进 iframe。
- JAR 宿主 SPI `backend/plugin-api/.../PluginHost`：files/text/tags/evidence/jobs/docs/settings/llm/sessions/notifications，**没有 tasks/lawfirm/im**。

### A3 MCP 客户端（供对比，不改）

`controller/ai/UserMcpController`（用户自配）、`PluginMcpController`（插件声明），统一进 `ToolRegistry`；`mcp` 类目渐进披露，ASK 不开放。

### A4 对外 MCP 服务器（#1385 第一期）

- `controller/ai/LocalMcpServerController`：`POST /mcp`（Streamable HTTP，仅 JSON，initialize/ping/tools/list/tools/call），**只在 local-mode**，默认关闭=404；`POST /api/mcp-server/enable` 签发 `awdm_` 令牌（库存 SHA-256，响应附 `claude mcp add` 命令）、`disable`、`GET status`。每请求 `Authorization: Bearer`，带 `Origin` 一律 403，回环校验由 `LocalModeAccessFilter` 兜。
- 工具硬编码在 `service/mcpserver/LocalMcpServerTools.DEFINITIONS`：`list_projects / list_project_files / read_file / search_project`，全部 read，**不经 ToolRegistry**，身份 `LocalIdentityService.localUserId()`，逐次核项目读权限；`CapabilityCatalogDocTest` 钉死「MCP 定义只能是 read」。
- 没有设置页开关（只能 curl）；最近的 UI 落点是个人中心 `frontend/src/components/admin/McpConnectionsPanel.vue`（MCP 客户端连接面板）。

---

## B. 缺口表

| # | 场景 | 今天能走到哪 | 缺什么 |
|---|---|---|---|
| 1 | 「刚开完腾讯会议，整理成纪要」 | 插件工具 `tencent_meeting_action` 已注册；归档/纪要逻辑都在插件后端 | ① 模型看不见它（plugin-tools 无关键词、插件 skill 白名单漏列）；② 「合适位置」只到当前项目 `腾讯会议/`，**对话无项目时不会推断事项**；③ 纪要产出走 `host.llm()` 而非对话主模型，用户不可见过程 |
| 2 | 「本周有没有截止事项」 | `task_list(from,to,projectId)` | 跨项目查询（`controller/CalendarController` `GET /api/calendar` 已有「用户全部项目 ∪ 日期范围」的组合逻辑，但没暴露成工具）；日程插件自身无工具声明 |
| 3 | 「下周三上午十点加个开庭提醒，挂到 X 案」 | `task_create` 在当前项目可建 | 跨项目定位目标项目；`remindBefore/assigneeId/fileIds` 未全部暴露；无写入确认策略 |
| 4 | 「把这份意见书归到 X 案并建一条工作记录」 | `move_files_batch` + `task_create` | 同 3 的项目推断；lawfirm 工作负荷/工作记录无工具 |
| 5 | 「所有项目里提到『张三』的文件」 | `search_across_projects` | 已可；对外 MCP 只有单项目 `search_project` |
| 6 | 「把当前文件脱敏后另存」 | 无 | `SensitiveService` 无工具；脱敏面板是纯 Web |
| 7 | 「X 案的收费与回款情况」 | 无 | `LawFirmManagementService` 无工具；无读写分级 |
| 8 | 外部 Claude Code「把第 3 条改成…」 | MCP 只读 4 工具 | `propose_revision`、待审记录、桌面端接受/拒绝 UI、设置页开关 |
| 9 | 新装第三方插件后 Agent/MCP 自动能用 | 只有 JAR `@Tool` 或 `contributes.mcpServers` 两条路 | 纯 Web 插件无声明式工具；SDK/lint/样例缺 |

---

## C. 目标架构：一个注册表、两个消费者

### C1 原则

1. **不建第二套注册表**。`ToolRegistry` 已经是应用内 Agent 的唯一事实来源，且已接纳 JAR 工具与插件 MCP 绑定；只需再加一种来源（manifest 声明式工具）和一个消费者（对外 MCP 投影）。
2. **插件业务逻辑留在后端**。纯 Web 插件声明的工具绑定到宿主后端服务或插件自有 HTTPS 服务；iframe 常驻处理器放到第四期。
3. **读写分级是唯一的策略轴**：`access` 决定是否确认、能否投影到 MCP、文档写入是否只产修订。

### C2 工具声明 schema（manifest `tools[]`，规范 v2.13，只加不改）

```jsonc
{
  "name": "calendar_week_agenda",            // 必填；非 JAR 工具必须以 <pluginId 连字符转下划线>_ 开头
  "description": "%tools.weekAgenda.desc%",  // 必填；支持 l10n %key%（§14.4），第一行进模型目录
  "access": "read",                          // 必填：read | write | destructive
  "inputSchema": { "type": "object", "properties": {...}, "required": [...] },  // 复用 §17.5 的 mcpObjectSchema 子集
  "handler": {                               // 缺省 {"type":"jar"}（老形态：name = @Tool 方法名）
    "type": "service", "service": "calendar", "operation": "list"            // 宿主后端固定服务（与 services.request 同一张表）
    // | "type": "connection", "connectionId": "crm", "operation": "listMatters"  // 插件自有 HTTPS（contributes.connections）
    // | "type": "view", "viewId": "main"                                        // 第四期：iframe 常驻处理器
  },
  "permissions": ["tasks"],                  // 该工具运行所需，⊆ manifest.permissions（既有规则）
  "mcp": true,                               // 是否投影到对外 MCP；缺省 read→true，write/destructive→false
  "confirm": "auto",                         // auto | always | never；缺省 auto = 按 access（destructive 必确认）
  "keywords": ["日程", "截止", "deadline"]    // 可选；命中即在起跑时放回本插件工具（喂 ToolDisclosurePolicy）
}
```

落点：`sdk/plugin-sdk/manifest.schema.json`（`tools.items` 改成 `oneOf` 老形态/新形态）、`manifest.d.ts`、`PluginService.PluginToolInfo` 加字段。老 manifest（只有 name/description）继续按 JAR 解释，**零改动兼容**。

### C3 发现与注册

- `PluginService` 加载时解析新字段 → `getDeclaredTools()`；非法声明（名字不带前缀、access 缺失、inputSchema 不过 `validateMcpInputSchema`、service/operation 不在宿主表里、handler=connection 但连接未声明）→ 该插件整个工具段跳过 + WARN，面板照常（与 `frontendEntry` 失败同口径）。
- 广场/开发安装前置校验：`scripts/plugin-dev.mjs validate` 与 `PluginMarketService` 安装路径共用同一规则（`PluginManifestContractValidator.validateTools`），拒装而不是装了不生效。
- `ToolRegistry.getAllSpecifications/resolve/execute` 增加 `DeclaredToolBinding` 来源（模式照抄 `PluginMcpService.bindings()`：`ToolSpecification` 由 `inputSchema` 转换，`RegisteredTool(fromPlugin=true)`），启停过滤沿用 `pluginToolEnabled`。
- `ToolDisclosurePolicy`：插件工具仍归 `plugin-tools`，但 `keywords` 并入 `CATEGORY_KEYWORDS` 的动态部分；`CapabilityCatalog` 读 `access` 字段而非推断。
- 内置核心能力不改申报方式：继续 `@Tool + @ToolMeta`，只是 **新增核心工具必须显式写 `access`**（`CapabilityCatalogDocTest` 加断言：新工具 INFERRED 即红）。

### C4 调用路径

| handler | 执行者 | 备注 |
|---|---|---|
| jar | 现有反射路径 | 不变 |
| service | 新 `service/plugin/HostServiceRegistry`：`(service, operation) → 处理 bean + 所需权限 + access` | 首批适配器：`calendar`（`ProjectTaskService`：list/listForUser/create/update/delete）、`search`（`ContentSearchService`）、`sensitive`（`SensitiveService.previewFile/processFile`）、`lawfirm`（`LawFirmManagementService.execute`，白名单动作）、`im`（`ImService.execute` 只读动作）。**同一张表同时服务 `PluginPane` 的 `services.request`**（前端 `pluginBusinessServices.js` 的服务名/操作名即表键），不新造名字 |
| connection | `PluginConnectionService` 既有操作调用 | 凭据、SSRF 拦截沿用 §17.4 |
| view（第四期） | 后端经 SSE `plugin_tool_call` → `PluginPane` 向 iframe 发 `{type:'tool'}` → SDK `awd.tools.handle(name, fn)` 回复 | 要求视图已加载；`requiresHost=DESKTOP`；永不投影到 MCP |

`ToolContext` 对声明式工具同样注入 `projectId/userId`；插件参数里出现的 `projectId` 只作「目标项目」且再核成员权限（与 `tencent_meeting_action` 的 `requireProject` 同口径）。

### C5 权限与确认策略

| access | 应用内 Agent | 对外 MCP |
|---|---|---|
| read | 直接执行 | 投影（缺省） |
| write | 直接执行 + 过程卡 + 审计；**文档写入一律修订模式**（LOWA 已是 `trackRevisions=true`；`write_docx` 覆盖现有文件时改为新建副本或拒绝，不静默覆盖） | 不投影，除非声明 `mcp:true`；文档类写入只有 `propose_revision`（见 C7） |
| destructive | **暂停确认**：编排器在分发前拦截，复用 `ask_user` 卡（问题「是否执行 <displayName>：<参数摘要>」，选项 执行/取消），答复「执行」后以原参数重放；运行态 `AWAITING_INPUT` 不新增 | 永不投影 |

`confirm: always` 可把 write 也拉进确认；`never` 对 destructive 无效。ASK 模式继续只放 `ASK_READ_TOOLS`，声明式 read 工具并入该集合。

### C6 「合适位置」推断

1. 文件落点：沿用 `GeneratedFileLocation`（活跃文件目录 → 根），插件按自家约定（`host.files().createFolderPath(projectId, ["腾讯会议"])`）。不新增「AI 输出」文件夹。
2. 目标项目：会话已绑项目 → 用它。无项目（欢迎页/全局面板）或用户明确提到别的案子 → 新 read 工具 `resolve_project(hint)`：按 `Project.name / targetCompanyName / listedCompanyName` 模糊匹配 + `UserActivityLog` 最近 7 天活跃度 + 会议标题/参会人与项目成员重合度打分，返回 ≤3 个候选和置信度。规则写进 system prompt：**单一高置信候选直接用并在回复里写明路径（可拖拽改位）；否则 `ask_user`**。不做跨项目自动写入的任何「猜」。

### C7 对外 MCP：投影 + 待审修订

- `LocalMcpServerController.toolList()` = 保留的 4 个精修工具（有分页）+ **投影**：`ToolRegistry` 中 `access=read ∧ requiresHost=NONE ∧ offerToModel ∧ mcp≠false` 的工具（内置与插件同等），`inputSchema` 由 `ToolSpecification.parameters()` 转换，`projectId` 作为显式参数补回。`annotations.readOnlyHint` 按 access。
- `tools/call` → `ToolRegistry.execute(name, args, ToolContext(userId=localUserId, projectId=args.projectId, conversationId="mcp:"+令牌摘要前 8 位))`，走同一套权限/配额/审计。
- 唯一文档写工具 `propose_revision(fileId, baseVersion, edits[{find, replace, reason}])`（access=write, scope `awd:project.propose`）：落 `PendingRevision` 实体（fileId/projectId/baseVersion/editsJson/source/status/createdAt），REST `/api/revisions/pending`（list/accept/reject），文件树与编辑器顶栏显示「N 条外部修订待审」；接受 = 打开文件（修订模式）后经 `EditorBridgeService` 逐条 `doc_find_replace`，仍留给用户在文档里接受；`baseVersion` 不符标过期。拒绝即删。
- 鉴权维持：本机回环 + `awdm_` 令牌 + 拒 Origin；团队服务器模式 404。设置页开关进 `AdminPane` 的 MCP 区：状态 / 开启并复制接入命令 / 关闭（轮换=再开）。
- 脱敏端点 `/mcp-anonymized`（第三期）：按 `mcp-server.md §3.2`，投影层每个工具带 `anonymize(fields)|passthrough|excluded`，出口用 `SensitiveTextEngine.apply` 先脱敏后分页，令牌绑定端点。

### C8 审计

单一扼点 `ToolRegistry.execute` 结束时写 `UserActivityLog`：`actionType=ai_tool`，`targetName=工具名`，`metaInfo={source: agent|mcp|plugin-ui, access, pluginId?, argsDigest(sha256), ok, durationMs}`，不记正文。MCP 调用的 `source` 带 initialize 的 `clientInfo.name`。个人中心活动日志可按 `source=mcp` 过滤。不建新表。

### C9 SDK 要补的东西（新插件零核心改动的前提）

- `sdk/plugin-sdk/manifest.schema.json` + `manifest.d.ts`：C2 的 schema；`sdk/plugin-sdk/services.json`（新）：宿主服务表的发布副本（service → operations → 所需权限/access），`validate` 据此离线校验，`PluginDevSdkParityTest` 钉住与后端 `HostServiceRegistry` 逐字一致。
- `awd-plugin-sdk.js/.d.ts`：`awd.tools.list()`（读本插件已注册的工具，供面板自检）；`awd.tools.handle(name, fn)` 第四期才启用，先占类型。
- `scripts/plugin-dev.mjs validate`：新 lint 规则（名字前缀、access 必填、inputSchema、service/operation 存在、connection 引用存在、description 非空且可 l10n）；`init` 模板带一个 read 工具样例。
- `backend/skills/plugin-dev/prompt.md`：删「tools 必须为空」，改为「纯 Web 插件可声明 service/connection 工具；JAR 工具仍走广场审核」。
- `docs/PLUGIN_SPEC.md` 新 §20「声明式 Agent 工具」；`sdk/plugin-sdk/README.md` 与官网模板字节同步（既有纪律 §12.5）。
- 样例 `examples/hello-agent-tools/`：一个 read（service=calendar/list）+ 一个 write（service=calendar/create）工具，附测试：装入后 `ToolRegistry.getAllSpecifications()` 含两者、`/mcp tools/list` 只含 read 那个。
- 兼容：无新字段的老插件行为不变；官方插件迁移顺序 tencent-meeting（补 access/keywords + skill 修）→ calendar（首个纯声明式）→ desensitize/search → lawfirm/im。

---

## D. 分期 PR 清单

标记：**[机]** 机械，按本文可由低档模型实现；**[设]** 需要主模型仔细设计。每个 PR 独立可合并，合并前照常跑 `npm run check:locales`、安全门禁。

### 第 0 期：零设计止血（本周可合）

| PR | 范围 | 文件 | 验收 |
|---|---|---|---|
| P0-1 [机] | 插件 skill 白名单补 `tencent_meeting_action`；`ToolDisclosurePolicy` 给 `plugin-tools` 类目加关键词（会议/纪要/腾讯会议/插件名） | `official-plugins/tencent-meeting/skill/skill.yml`、`ToolDisclosurePolicy.java` | `BuiltinSkillsTest` 新断言；回放用例「腾讯会议纪要」首轮可见工具含 `tencent_meeting_action` |
| P0-2 [机] | `task_list` 的 `projectId` 可空 = 用户全部项目（把 `CalendarController.list` 的「`ProjectService.getUserProjects` × `ProjectTaskService`」组合抽成服务方法共用），结果带 projectName | `tools/TaskTools.java`、`controller/CalendarController.java`、`service/task/ProjectTaskService.java`、`TaskToolsTest` | 「本周截止事项」回放用例：一次调用覆盖多项目 |

### 第 1 期：两个场景端到端 + MCP 写入即待审修订

| PR | 范围 | 文件 | 验收 |
|---|---|---|---|
| P1-1 [机] SDK 声明 | C2 schema、`services.json`、lint 规则、`init` 模板、README/PLUGIN_SPEC §20/plugin-dev prompt | `sdk/plugin-sdk/*`、`scripts/plugin-dev.mjs`、`docs/PLUGIN_SPEC.md`、`backend/skills/plugin-dev/prompt.md` | `scripts/tests/plugin-dev.test.mjs`：合法/非法声明各 5 例；`PluginDevSdkParityTest` 与后端表一致（表先以 calendar/search/sensitive 三项落地） |
| P1-2 [设] 注册表接声明式工具 | `PluginToolInfo` 新字段；`PluginManifestContractValidator.validateTools`；`HostServiceRegistry` + calendar/search/sensitive 三个适配器；`ToolRegistry` 的 `DeclaredToolBinding`；`CapabilityCatalog` 读 access | `service/ai/PluginService.java`、`PluginManifestContractValidator.java`、新 `service/plugin/HostServiceRegistry.java`、`ToolRegistry.java`、`capability/CapabilityCatalog.java` | `PluginServiceTest`：非法声明跳过且面板可用；`ToolRegistryTest`：声明式工具可 `resolve/execute`、禁用插件后消失、权限不足拒绝；`PluginPane` 的 `services.request('calendar')` 改走同一表后 `frontend/tests/plugin-sdk/*` 全绿 |
| P1-3 [机] 官方插件迁移 + 样例 | tencent-meeting manifest 补 `access:"write"/keywords`；calendar 声明 `calendar_agenda`(read, 跨项目+日期范围) 与 `calendar_create`(write)；`examples/hello-agent-tools` + 测试 | `official-plugins/tencent-meeting/manifest.json`、`official-plugins/calendar/manifest.json`、`examples/hello-agent-tools/*` | 样例测试：装入后两者出现在 `ToolRegistry.getAllSpecifications()`；`node scripts/plugin-dev.mjs validate` 通过 |
| P1-4 [设] MCP 投影 | `toolList()` = 4 精修 + 投影；`tools/call` 经 `ToolRegistry.execute`；`ToolSpecification→inputSchema` 转换；`projectId` 显式化 | `controller/ai/LocalMcpServerController.java`、`service/mcpserver/LocalMcpServerTools.java`、新 `McpToolProjection.java` | `LocalMcpServerControllerTest`：tools/list 含 `task_list`、`calendar_agenda`，不含任何 write/destructive/LOWA 工具；`CapabilityCatalogDocTest` 的 read 断言改为对投影结果断言 |
| P1-5 [设] propose_revision | `PendingRevision` 实体 + MCP 工具 + `/api/revisions/pending` + 文件树/编辑器角标 + 接受经修订模式套用 | 新 `model/entity/PendingRevision.java`、`service/revision/PendingRevisionService.java`、`controller/RevisionController.java`、`LocalMcpServerTools.java`、`frontend/src/components/FileTree.vue`、`LibreOfficeEditor.vue`、locales 20 语种 | 后端：提案→列表→接受（基线匹配）→编辑器收到 N 条 `doc_find_replace`；基线不符标过期；拒绝即删。前端：角标与接受/拒绝按钮；`frontend/tests/revision/pending.test.mjs` |
| P1-6 [设] 项目推断 + 场景串联 | `resolve_project` 工具；system prompt 加「合适位置」规则；两个场景的回放评测用例（含无项目态） | `tools/ProjectResolveTools.java`、`prompts/system_prompt.md`、`backend/src/test/resources/ai-eval/cases/cases-app-control.json`、`frontend/src/utils/toolDisplayNames.js` | 评测：①「刚开完腾讯会议…」→ 调 `tencent_meeting_action(list/export)` → 纪要落到对应项目 `腾讯会议/`，回复写明路径；②「本周截止」→ 单次 `task_list` 跨项目；③ 无项目 + 唯一候选直接落、多候选 `ask_user` |
| P1-7 [机] 设置页开关 | `AdminPane` MCP 区加「对外 MCP 服务」状态/开启(复制命令)/关闭；20 语种词条 | `frontend/src/components/admin/McpConnectionsPanel.vue`（或同级新组件）、`frontend/src/locales/*/mcp.js`（20 语种）、`services/api.js` | `npm run check:locales` 绿；`frontend/tests/admin/mcp-server-toggle.test.mjs`：开→显示命令，关→404 |
| P1-8 [机] 审计 | `ToolRegistry.execute` 写 `UserActivityLog`；MCP `source` 带 clientInfo | `ToolRegistry.java`、`UserActivityLogService.java`、`LocalMcpServerController.java` | `ToolRegistryAuditTest`：agent/mcp/plugin-ui 三来源各一条，metaInfo 无正文 |

第 1 期完成的判据：两个示例场景的回放用例绿；Claude Code 经 `/mcp` 能列项目、查本周事项、对一份 docx 提交 `propose_revision`，桌面端角标出现、接受后文档里是修订。

### 第 2 期：写入治理与更多插件

| PR | 范围 | 标记 |
|---|---|---|
| P2-1 destructive 确认：编排器拦截 + `ask_user` 卡复用 + 重放；`confirm:always` | [已做] |
| P2-2 `write_docx` 覆盖保护（已有文件 → 副本或拒绝） | [机] |
| P2-3 `HostServiceRegistry` 加 lawfirm（只读 + 台账查询）、im（只读）、sensitive 写路径；desensitize/search/lawfirm 三插件声明工具 | [机] |
| P2-4 connection 型 handler（插件自有 HTTPS 服务工具） | [设] |
| P2-5 MCP 投影放开 `mcp:true` 的 write 工具（如 `task_create`），审计 `source=mcp` 在个人中心可见 | [机]，需 E1 决定 |
| P2-6 `docs/capability-catalog.md` 增「声明式插件工具」节（运行时由 `/api/plugins/list` 给出，不进生成测试） | [机] |

### 第 3 期：脱敏端点 `/mcp-anonymized`（按 mcp-server.md §3.2）[设]

### 第 4 期：iframe 常驻处理器（`handler.type=view`、SSE `plugin_tool_call`、SDK `awd.tools.handle`）[设]，仅在真有插件需要前端态能力（如语音设备、剪贴板）时再做。

---

## E. 已拍板（2026-11-07，负责人授权由我决定）

1. **对外 MCP 写入边界**：非文档写入（建日程/任务、归档）在声明 `mcp:true` 时直接生效 + 审计（`source=mcp`，个人中心可查）；文档内容一律只走 `propose_revision`；destructive 永不投影。
2. **无项目态落位**：唯一高置信候选 → 直接存并在回复写明路径（可拖拽改位）；否则 `ask_user`。
3. **破坏性确认**：每次都问，第 2 期不做「本轮不再询问」。
4. **腾讯会议双轨**：以插件 `tencent_meeting_action` 为准。插件已安装且启用时，`ToolDisclosurePolicy` 不向模型提供内置 `tmeet_*`，内置 skill 改指插件工具；插件未装时保留 `tmeet_*`，不让未装插件的用户失能。
5. **团队服务器模式** 对外 MCP 本轮维持 404（OAuth 另立项）。
