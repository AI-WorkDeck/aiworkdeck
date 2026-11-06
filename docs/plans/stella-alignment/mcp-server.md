<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Stella 对齐：AWD 作为 MCP 服务器 + 能力目录

参考：Stella `apps/api/src/mcp/README.md`（按受众分端点、OAuth / API key、scope）、
`docs/capability-coverage.md` 与 `apps/api/scripts/export-capability-catalog.ts`；
对比报告第 2、3 条建议。

## 1. 现状

- AWD 目前只做 MCP **客户端**：`UserMcpController`（`/api/mcp/*`，用户自配连接）、`PluginMcpController`（插件声明的 MCP）。
- `docs/AI_ARCHITECTURE.md` 里没勾的「进程外插件形态（MCP server）」说的是**插件以独立 MCP server 进程运行、由 AWD 调用**，
  实际也是客户端方向，和本主题（AWD 自己对外提供 MCP）不是一回事。本 PR 不勾选那一项。
- Agent 工具：`ToolRegistry` 从 `AgentToolComponent` 的 `@Tool` 方法登记，当前 **342 个**；`@ToolMeta` 已有
  displayName / category / fileEffect / requiresHost / offerToModel，但没有读写分级。
  已有的只读判断散落在 `ClientCapabilityService.isDocumentWritingTool`（只管 doc_/sheet_/slide_）和
  `AgentOrchestrator.ASK_READ_TOOLS`（ASK 模式白名单，8 个）。
- 后端 REST：约 90 个 Controller，本期不进目录（见第 5 节）。

## 2. 能力元数据（本期已实现）

每个 agent 工具 = 一条能力，id 就是工具名。元数据：

| 字段 | 来源 |
| --- | --- |
| 访问级别 read / write / destructive | `@ToolMeta(access=...)` 显式声明优先；否则按工具名动词推断（`CapabilityCatalog.inferAccess`）：含删除类动词（delete/remove/trash/restore/redact）→ destructive；含写入动词 → write；只含读取动词 → read；**都认不出 → write**。声明了 fileEffect 的不会被推成 read。 |
| 权限范围 `awd:<领域>.<read\|write>` | 领域按前缀 / 宿主 / 类目推出：project（项目文件与数据，默认）、editor（需桌面编辑器）、office-addin（需任务窗格）、memory、external（向外部服务发请求，如企查查、法宝、联网搜索）、system（执行代码、子 agent、插件 / skill 安装）。 |
| 宿主、是否下发给模型 | 直接取 `@ToolMeta.requiresHost / offerToModel`。 |
| MCP 覆盖 | 由 MCP 工具定义里的 `coversAgentTools` 反推。 |

本期只在两处加了显式声明（`qichacha_ipr` → read，`tag_remove_from_file` → write）。其余推断结果见
`docs/capability-catalog.md`：read 100 / write 220 / destructive 22。

**生成与漂移**：`docs/capability-catalog.md` 由 `CapabilityCatalogDocTest` 生成，CI 的 `mvn verify` 会逐字节比对，
工具增删改后不重新生成就红。重新生成：`cd backend && AWD_WRITE_CAPABILITY_CATALOG=1 mvn test -Dtest=CapabilityCatalogDocTest`。

取舍：没有给 342 个工具逐个手标，而是「推断 + 少量显式覆盖 + 生成文档供审阅」。漏判方向固定在「多算写入」，
代价是少开放，不会把写操作当只读放出去。

## 3. MCP 服务器

### 3.1 第一期（本 PR 已实现）：本机只读 `/mcp`

- **传输**：MCP Streamable HTTP，`POST /mcp`，只回 `application/json`；不开 SSE 推送、不维护会话（GET/DELETE 返回 405）。
  协议版本协商 2025-06-18 / 2025-03-26 / 2024-11-05。只实现 initialize、ping、tools/list、tools/call 和通知。
- **只在单机模式（local-mode）存在**；团队服务器模式下端点与管理接口都是 404。
- **默认关闭**：未开启时 `/mcp` 回 404，与不存在一样。
- **开启与令牌**：`POST /api/mcp-server/enable` 签发 `awdm_` 前缀的 256 位随机令牌，明文只在这次响应里出现
  （附带 `claude mcp add --transport http ...` 命令），库里（system_setting）只存 SHA-256；再次调用即轮换，旧令牌立即失效；
  `POST /api/mcp-server/disable` 关闭并清掉摘要；`GET /api/mcp-server/status` 查状态（不回令牌）。
- **每个请求**：`Authorization: Bearer awdm_...` 常量时间比对；带 `Origin` 头一律 403（防网页借 DNS 重绑定打本机端口；
  本机 MCP 客户端不发 Origin）。原有 `LocalModeAccessFilter` 的回环 / 反代头校验照常在前面生效。
- **工具（全部 read，scope `awd:project.read`）**：`list_projects`、`list_project_files`、`read_file`、`search_project`。
  - 身份为本机用户（`LocalIdentityService.localUserId()`），每次调用按项目读权限复核；无权与不存在回同一句话。
  - `read_file` 走 `ProjectFileTextExtractor.extract`：**不走 OCR**，因此不产生云端请求和扣费，不新增出站请求（PRIVACY 红线）；
    分页 `offset / maxChars / nextOffset`。
  - 只调查询服务，不经 `ToolRegistry`、不发 SSE、不写库。
  - 工具层错误按 MCP 约定放进 `result.isError`；日志只记工具名和 id，不记正文。
- **客户端接入**：Claude Code 用返回的命令；Claude Desktop 目前只认 stdio，需经 `mcp-remote` 之类的桥接，第二期再给现成配置。

**安全边界要说清楚**：单机模式下 `/api/*` 本来就不鉴权（只靠回环 + Origin 校验），本机任何进程都能读项目、也能调
`/api/mcp-server/enable` 拿令牌。所以本期令牌的作用是「用户显式开启 + 给客户端一个可撤销的凭据」，**不是**防本机恶意程序的边界。
真正收紧要等本机 API 整体加鉴权，超出本主题。

### 3.2 第二期设计：脱敏只读端点 `/mcp-anonymized`

照 Stella「一个注册表、派生脱敏投影」的做法：

- 每个 MCP 工具定义加必填的脱敏策略：`anonymize(要脱敏的输出字段)` / `passthrough` / `excluded(write)`，
  缺策略编译不过，两套端点不会悄悄分叉。
- 处理器不知道自己在哪个端点；统一在出口按字段脱敏，**先脱敏后分页**，避免实体名被分页切断。
- 引擎复用 `SensitiveService` / `service/sensitive/SensitiveTextEngine`（与左栏脱敏面板、`desensitize` skill 同一套本地规则，不调大模型）。
  需要补一个纯文本入口（现在是按文件处理），并在一次连接内保持占位符稳定（同一实体 → 同一编号），映射只存内存、不回给客户端。
- 项目名、文件名、检索片段一并脱敏；scope 用 `awd:project.read_anonymized`，令牌可绑定端点：只开脱敏端点的令牌拿不到 `/mcp`。
- 待决：文件名脱敏后客户端难以对应，是否允许用户勾选「文件名不脱敏」。

### 3.3 第二期设计：写操作只产生待审修订

- MCP 永远不直接改文件。唯一写工具 `propose_revision(fileId, baseVersion, edits[{find, replace, reason}])`，
  scope `awd:project.propose`，access 标 write（不是 destructive）。
- 服务端只落一条「待审修订」记录（文件 id、基线版本、修订列表、来源客户端），并通知桌面端。
- 用户在 AWD 里打开文件时看到待审提案；接受后由现有 doc_* 编辑原语以**修订模式（redline）**写进编辑器，仍要用户在文档里逐条接受；
  基线版本已变则标记过期、不套用。拒绝即删除记录。
- destructive 能力（删除、回滚、涂黑）不经 MCP 开放。

### 3.4 以后

- 桌面端设置页加开关、显示 / 复制令牌与接入命令（需 20 语种词条，本期没做）。
- 证据查询、版本历史等只读能力按目录逐步加；OAuth 只在团队服务器模式考虑。

## 4. 本期改动清单

- `ToolMeta.access()` 与 `ToolMeta.Access`；`service/ai/capability/CapabilityCatalog`；`docs/capability-catalog.md`（生成）。
- `service/mcpserver/LocalMcpServerSettings`（开关 + 令牌）、`LocalMcpServerTools`（4 个只读工具）、
  `controller/ai/LocalMcpServerController`（`/mcp` 与 `/api/mcp-server/*`）。
- 测试：`CapabilityCatalogDocTest`（推断规则、真实工具抽查、MCP 只开放 read、文档漂移）、
  `LocalMcpServerSettingsTest`、`LocalMcpServerToolsTest`、`LocalMcpServerControllerTest`。

## 5. 未纳入 / 待决

1. 后端 REST（约 90 个 Controller）是否也进目录：Stella 是 handler 级。AWD 的 REST 主要服务自家前端，建议等第二期真要通过 MCP 开放某个 REST 能力时再逐个登记。
2. destructive 的口径：现在编辑器里的删除（`doc_delete_text` 等，可撤销）也算 destructive，偏保守；如果要据此弹确认，需要再细分。
3. 前端开关 UI 与 i18n 未做：本期只能通过 `POST /api/mcp-server/enable` 开启。
