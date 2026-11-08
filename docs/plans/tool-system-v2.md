<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# AI 工具系统 v2：设计原则、目标架构、逐工具裁决与迁移计划

状态：设计稿（2026-11-07），基于 master + #1424/#1425/#1426/#1427 合并树。只读分析，未改代码。
附件：`docs/plans/tool-system-v2-inventory.csv`（359 行 = 353 个已注册工具逐条裁决 + 6 个拟新增）。
关联：`docs/plans/tool-surface-audit.md`（S0–S7，族级审计与实测）、`docs/plans/agent-app-control.md`（注册表 + MCP 架构，本文不改其 E 节已拍板事项）、`docs/capability-catalog.md`。

一句话：**注册表 353 → 306，首轮下发 docx 39 个 / 10.2k token → 31 个 / ≈5.8k；200 条描述按统一模板重写；重叠族合并成 24 个单名；22 个长期隐藏的工具删除；补 6 个律师缺口工具。** 代码改动全部是 PR 级、可回滚、有 ai-eval 门禁。

---

## A. 设计原则

这些原则同时约束内置工具、插件声明式工具、JAR 工具，并进 `ToolDeclarationContractTest` / `plugin-dev validate` 当门禁。

**A1 命名**：`<域>_<动词>_<宾语>`，全小写 snake_case，≤28 字符（插件工具因 `<pluginId>_` 前缀规则例外，≤40）。域前缀是公开契约、宿主闸的依据，一律不动：`doc_/sheet_/slide_`（LOWA）、`office_/office_excel_/office_ppt_`（任务窗格）、`ref_`（窗格参考源）、`pdf_/pptx_/law_/memory_/task_/tag_/version_/litigation_`。动词表固定：读 `get/list/read/search/find/inspect/check`，写 `write/insert/replace/set/add/create/apply/move/rename/copy`，破坏 `delete/trash/restore/redact`。`CapabilityCatalog.inferAccess` 就按这张动词表推断，所以命名即访问级别；推断与实际不符的工具必须显式写 `access`。不用 `_batch`（批量是默认，单条是长度 1 的数组）、不用 `_v2`、不用缩写动词。

**A2 一工具一事**：一个工具回答一个「用户会怎么说」的意图。判断合并还是拆分只看两条：① 入参形状是否相同——`accept/reject/accept_all/reject_all` 四个修订动作入参都是「可选 index」，合成 `doc_revisions(action)`；`pdf_merge(fileIds[])` 与 `pdf_rotate(fileId,pages)` 形状不同，不合。② 访问级别是否相同——**destructive 永远不并进 action 枚举**（C5：access 是唯一策略轴，确认闸按工具名拦）。`doc_table_delete` 与 `doc_table_insert` 因此分列。反例也要记住：`create_folder` 不并进 `write_file`，因为律师的「建个文件夹」是独立意图。

**A3 参数化 vs 拆分**：≤8 个参数、全部正交 → 摊平；排版类 ≥10 个属性 → 收成一个 `style` 对象（键表写在描述里一次，枚举值英文），因为弱模型对 15 个可选扁平参数的漏填率明显高于一个 JSON 对象（S6 要用真实模型矩阵验证这一点，不达标即回退）。服务端注入参数（`projectId/conversationId/userId`）永不出现在规格里（既有 `SERVER_CONTEXT_PARAMS`）。标了「【已弃用」的参数由注册表自动摘掉——所以弃用参数先标记、下一版本删，不要直接删。

**A4 读 / 写 / 破坏三分**：`read` 直接执行、可投影 MCP、ASK 模式可用；`write` 直接执行 + 过程卡 + 审计，文档写入一律修订模式；`destructive`（删除、覆盖已有内容、不可逆）走 P2-1 的 `ask_user` 确认闸。两条修正：修订模式下的删除（`doc_delete_selection`）是可撤回的 write 而不是 destructive；只动视图的 `select/goto` 是 read。

**A5 描述模板**（每条 `@Tool` / manifest `description` 都照此写，进门禁）：
```
第一行：动词开头的一句话，≤80 字符，单一语言（产品语言中文；工具名/参数名/枚举值英文），不带【】以外的强调符号。
第二段（可选，≤2 句）：何时用 / 何时不用——点名「不用它而用 X」的那个 X。
第三段（可选）：参数约定与回执字段（paragraphAfterEdit、nextOffset…），一条判据只写在族里一个工具上，其余互相点名。
```
一条描述一种语言。现有 56 条纯英文、160 条中英混排（按首行 + 正文判）全部改中文；英文触发词可括号附同义词（`(compare, redline)`）。英文产品语言下不另写英文描述——描述随系统提示语言切换这件事留给 `LangText` 二版，本轮不做。核心集单工具 ≤300 token，全集 ≤500（o200k）。

**A6 参数命名**：`fileId`（项目文件 id，来自 `doc_list_project_files`）、`folderId`、`anchorId`、`range`（`A1:D20`）、`sheet`（名或 0 起序号）、`slideNumber`（1 起）、`paragraphIndex`（0 起）、`pages`（`1-3,5`）、`query`、`mode/action/op/kind/axis/scope/source`（枚举选择器，按 A2 的用法分工：`action` 选动作、`mode` 选算法、`op` 选页操作、`kind` 选类型、`axis` 行/列、`scope` 范围、`source` 数据源）。起始位置统一说明「0 起」还是「1 起」，不许一族里两种。

**A7 错误回执契约**：工具失败返回 `Error: <一句原因>。<下一步建议>`，不抛栈；`Error` 开头是编排器与 MCP 投影识别失败的唯一判据（既有）。建议部分点名工具：「fileId 不存在，先 `doc_list_project_files`」。未知工具名走 `UNKNOWN_TOOL_HINTS` 指路，**`TOOL_NAME_ALIASES` 保持空表**（历史上别名把 `search_laws` 改道成公网搜索、模型把网页当法条引用）；更名用 E 节的 shim 机制，不用别名。

**A8 宿主变体**：LOWA 与 Office 任务窗格执行器完全不同，名字各留（73 对），但：① 同后缀一对共享同一份描述文案源（`OfficeToolMessages` 扩成两家共用），只在首句的「当前 Word 文档」与「编辑器中的文档」措辞不同；② 目标类目按「事」而不按「宿主」命名（`docx-format` 在 Word 窗格里列出的就是 `office_*` 那一套），`list_tools(category)` 在任何宿主下用同一个类目词；③ 能力闸保证模型永远只见一套。

**A9 插件 / 声明式对等**：插件工具（JAR `@Tool` 或 manifest `tools[]`）与内置工具同一张表、同一套门禁：A5 描述模板由 `plugin-dev validate` 检查；manifest 新增 `agent: false`（对应内置 `offerToModel=false`：注册但不下发，供 UI 直调）；`keywords` 是首轮预放回的唯一入口（已落地）。核心能力与插件重叠时以**插件为准、内置退场**（E4 腾讯会议），但退场方式是「内置工具把该来源路由到插件」而不是两个名字并存。

**A10 MCP 可投影**：`access=read ∧ requiresHost=NONE ∧ offerToModel ∧ mcp≠false`，再减去**会话内生**工具（`list_tools/ask_user/todo_write/use_skill/dispatch_subtask/list_attached_files/create_skill`——它们只对一次对话有意义）。write 工具只在显式 `mcp:true` 时投影（E1），候选清单见 CSV `mcp_eligible=W` 列（11 个）。destructive 永不投影。

**A11 评测契约**：每个工具至少满足一条：核心集工具有 ≥1 条回放用例以它为期望首个业务工具；非核心工具的 `displayName` 作为 `list_tools(query)` 检索词时它必须在前 5 条。首轮下发量钉在 `ToolSurfaceBudgetTest` 基线表（宿主 × 中性/典型/最坏），描述卫生钉在 `ToolDeclarationContractTest`，重叠族「只剩一个下发名」钉在 `ToolChoiceSurfaceTest`。改模型行为的 PR 加跑真实模型矩阵（F 节）。

---

## B. 目标架构

### B1 层次（与 agent-app-control C 节一致，只加不改）

```
ToolRegistry（唯一事实来源：342 内置 + JAR + 声明式 + 用户 MCP）
  ├─ 元数据：@ToolMeta{displayName, category, requiresHost, offerToModel, access, confirm?, mcp?}
  ├─ 可见性：ClientCapabilityService（宿主闸）→ 活跃文档闸 → ToolDisclosurePolicy（核心集 ∪ 展开集，noFile 态）→ SkillRouter（restrict 白名单）
  ├─ 消费者 1：AgentOrchestrator（每轮下发 + 执行 + 确认闸 + 审计）
  └─ 消费者 2：McpToolProjection（A10 过滤 + projectId 显式化 + propose_revision）
```
v2 不加层，只改三件事：核心集重切与**状态条件核心**、类目表按「事」重排、描述与名字按 A 节治理。

### B2 目标核心集（名字；`memory_list/memory_read` 由编排器每轮固定追加，计入数字）

| 段 | 名字 | 数 |
|---|---|---|
| 通用（所有宿主） | `list_tools ask_user todo_write use_skill dispatch_subtask` · `doc_list_project_files search_project_files search_project_content extract_file_text write_docx` · `query_memory save_memory` · `law_search get_law_article search_web browse_url` + 固定 `memory_list memory_read` | 18 |
| 条件（有则加） | `list_attached_files`（本会话有附件时）；`doc_restore_checkpoint`（本轮已有检查点时；pptx 常驻，因为 Impress 的 `doc_undo` 是空操作） | 0–2 |
| LOWA docx | `doc_open_file doc_get_document_text doc_find_text doc_get_cursor_context doc_get_clauses doc_audit_structure doc_find_replace doc_replace_at_anchor doc_insert_at_cursor doc_start_stream doc_insert_table doc_add_comment doc_undo` | 13 |
| LOWA xlsx | `doc_open_file doc_start_stream sheet_get_overview sheet_read_range sheet_write_cells sheet_find_replace doc_undo` | 7 |
| LOWA pptx | `doc_open_file doc_start_stream slide_get_overview slide_get_page slide_set_shape_text slide_replace_text slide_add_page doc_restore_checkpoint` | 8 |
| LOWA 没开文件 | `doc_open_file doc_start_stream sheet_create_file slide_create_file` | 4 |
| Office Word | `ref_list ref_read office_get_text office_search office_insert_text office_replace_text office_replace_batch office_add_comment office_pass_step` | 9 |
| Office Excel | `ref_list ref_read office_excel_get_overview office_excel_get_range office_excel_set_values office_excel_search office_excel_replace` | 7 |
| Office PPT | `ref_list ref_read office_ppt_get_slides office_ppt_replace_text office_ppt_format_text office_ppt_add_slide` | 6 |

离开核心集的 8 个名字：`create_folder move_files_batch move_to_trash`（files 关键词）、`doc_apply_standard_format`（format）、`doc_export_pdf`（files/pdf）、`memory_search`（固定三件退成两件）、`list_attached_files doc_restore_checkpoint`（改条件）。S1 已经把 `sheet_create_file/slide_create_file` 退到没开文件态。

### B3 目标类目（按事命名，宿主无关，22 → 22 但语义重排）

`agent` 编排 · `files` 项目文件（含打开/新建入口、导出、标签、`office_file`）· `docx-edit` 正文增删改与定位 · `docx-format` 字符/段落/页面/目录/脚注/图片/超链接 · `review` 修订与批注（四个宿主）· `table` 文档/幻灯片内表格 · `spreadsheet` · `slides`（含 `pptx_*`、图片生成）· `pdf` · `legal` · `research`（公网 + 企业数据）· `memory` · `tasks` · `evidence` · `template` · `litigation` · `version` · `meeting` · `reference` · `developer`（`plugin_dev_* capability_*`）· `python` · `plugin-tools` · `mcp`。
规则仍是 `ToolDisclosurePolicy.CATEGORIES` 的「声明顺序首中即归属」；`format` 不再是 `doc_` 的兜底通配，兜底落 `misc` 并由契约测试要求 `misc` 为空。

### B4 发现

`list_tools` 已是 tool-search（名字 + 描述关键词 AND 匹配，≤15 条全签名，当轮可经 XML 直调）。v2 只改三处：① 描述从 463 token 压到 ≤250，类目名不再逐个念，改为「无参调用返回目录」；② `query` 匹配源加上 `displayName` 与 A5 的括号同义词，A11 的「displayName 必须命中前 5」就是它的回归测试；③ 关键词预放回维持 ≤3 类（S1 已落地），关键词表补「安排」「比对/对比/比较」「期限计算/顺延」「证据目录」。

### B5 skill ↔ tool

skill 是「流程 + 白名单」，工具是「能力」。三条边界：① `allowed_tools` 只许列目标名；更名期间 `SkillRouter` 通过 shim 表把旧名解析到新名并打 WARN，用户自建 skill 不失效；② restrict skill 的白名单计入 A11——列了却不存在的名字由 `BuiltinSkillsTest` 变红（今天 `tencent-meeting` skill 列的 `tmeet_*` 合并后就靠它提醒）；③ skill 不再承担「把类目放回」以外的披露职责——`categoriesCoveredBy` 不变。

### B6 预算（进 `ToolSurfaceBudgetTest` 与 `cases-tool-surface.json`）

| 指标 | docx | xlsx / pptx / Office 三窗格 / 没开文件 | none | ASK |
|---|---|---|---|---|
| 中性首轮工具数 | ≤32 | ≤28 | ≤20 | ≤8 |
| 中性首轮 schema token（o200k） | ≤6.5k | ≤5.5k | ≤4k | ≤1.3k |
| 典型 C 句（3 类预放回） | ≤45 / ≤10k | ≤45 / ≤9k | ≤40 / ≤8k | — |
| `list_tools(category)` 一次展开 | ≤15 条 / ≤4k | | | |
| 单工具 | 核心 ≤300，全集 ≤500；首行 ≤80 字符 | | | |

### B7 插件与 MCP 如何接入

插件：manifest `tools[]`（C2 schema）+ `agent/keywords/mcp/confirm` 四个开关；`HostServiceRegistry` 适配器（已有 calendar/search/sensitive/lawfirm/im）。**日程插件不声明工具**：`task_*` 已是跨项目日程的唯一读写入口（P0-2），再声明 `calendar_agenda/calendar_create` 就是制造「task_create vs calendar_create」这类实测误选（见 F 节问题 1）。
MCP：`McpToolProjection` 加 A10 的会话内生排除表；`mcp:true` 白名单先放 `task_create/task_update/tag_file/create_folder`（P2-5）；文档内容只走 `propose_revision`（E1）。

---

## C. 逐族裁决（汇总 CSV；计数均以 CSV 为准）

现状 353 = 内置 342（下发 320，隐藏 22）+ JAR 4 + 声明式 7。裁决分布：keep 79 · keep+rewrite-desc 200 · merge 48（→ 24 个目标名）· rename 1 · deprecate 22 · hide-from-model 3 · new 6。**目标 306 个注册 / 303 个可下发。**

| 族（现 → 目标） | 裁决要点 |
|---|---|
| agent 6 → 6 | 全部重写描述（5 条英文）；`list_tools` 463→≤250、`ask_user` 502→≤250、`todo_write` 409→≤150 |
| doc_* 61+6 table → 52 | 修订 4→`doc_revisions`；回复/解决批注→`doc_update_comment`；表格行列 4→`doc_table_insert`+`doc_table_delete`；脚注尾注→`doc_insert_note(kind)`；定位 4→`doc_select(target)`；删 7 个长期隐藏的（`get/set_selection、replace_nth_match、delete_match、delete_text、search_related_docs、debug_revisions`）；6 个排版工具收 `style` 对象；`doc_delete_selection` 改 write、`doc_select` 为 read |
| sheet_* 26 → 26 | 不合名；`format_cells/conditional_format/set_data_validation` 收对象；`select_range` 为 read；19 条描述重写 |
| slide_* 27 → 27 | 不合名；`format_text`(22 参)、`table_set_style`(17 参) 收对象；5 条英文描述改中文 |
| pptx_* 12 → 5 | `generate_outline+refine_outline→pptx_outline(action)`；`check_service` 隐藏；删 5 个已隐藏的替代品（`apply_format/edit_page/open_file/list_files/search_files`）；留 `generate/export_editable/get_project_pages/inspect_format` |
| office_* Word 45+4 file → 42 | 与 doc_ 镜像：`office_revisions`、`office_update_comment`、`office_table_insert/delete`、`office_insert_note`；`office_file_*` 4→`office_file(action)`；3 个排版工具收对象；31 条描述重写 |
| office_excel_* 27 → 25 | `set_formulas` 并入 `set_values`（`=` 前缀即公式，与 `sheet_write_cells` 同口径）；回复/解决批注合并；3 个规则类收对象 |
| office_ppt_* 26 → 26 | 不合名；`format_text` 收对象；5 条 WPS 专属英文描述改中文；「设置形状样式。」这类空首行重写 |
| files 20 → 13 | `write_file` 吸收 `text_write_file(mode=overwrite)`；`move_files_batch→move_files` 并吸收 `move_project_file`；`list_project_folders→doc_list_project_files(foldersOnly)`；`search_across_projects→search_project_files(scope=all)`；删 `scan_files/delete_file/move_file/read_document`；`extract_file_text` 加 `section` 参数 |
| pdf_* 14 → 11 | `rotate/extract/split→pdf_pages(op)`；`merge`、`add_page_numbers`（贝茨号）、`delete_pages`（destructive）各留；删 `pdf_list_files`；`pdf_redact` 与插件 `desensitize_redact` 互相点名 |
| memory 10 → 7 | 删 `get_user_profile/deep_search/search_knowledge_base`（兼容壳自 0.6 起）；`query/save_memory` 压到 ≤250；`memory_search` 退出固定追加 |
| law 5 → 4 | `law_search_keyword→law_search(mode)`；`law_recognition` 定位为「核对文中引用法条」并接受 `fileId`/活跃文档（D5）；全部改中文、去供应商名 |
| meeting 2 + tmeet 2 → 2 | `meeting_list(source=recording\|tencent)` + `meeting_get_transcript(source,id)`；插件启用时 tencent 来源路由到 `tencent_meeting_action` 的 list/detail（E4 的实现方式） |
| task 3 / tag 3 / version 6 / litigation 6 / ref 4 / evidence 4 / template 3 | 全部 keep；`task_create` 去掉旧 `fileId` 参数；`litigation_reference/checkpoint` 改 read；6 条 litigation 英文描述改中文；`dd_export` 显式声明 access（就地覆盖） |
| capability 4 → 3 | `capability_apply` 并入 `capability_install`（两阶段改由确认闸承担，`confirm=always`） |
| 其他内置（web 2、enterprise-data 3、python 1、image 2、plugin_dev 2、text 2 → 1） | keep；英文描述改中文；`search_web` 描述不写供应商 |
| 插件 JAR 4 → 4（隐藏 2） | `baoqingtian_action`、`dpia_workbench_action` manifest 标 `agent:false`（描述自己写着不许 AI 调）；`tencent_meeting_action` 首行「腾讯会议下载插件。」重写 |
| 插件声明式 7 → 7 | 全部 keep（已按 C2 写 access/keywords，描述合格）；名字长（34 字符）是前缀规则的代价，接受 |
| 新增 6 | D 节 |

首轮数字（中性句；现状取 `ai-eval/tool-surface-baseline.csv`，目标按同一编组 JSON 以 tiktoken o200k 估算——该方法重算全集得 73.0k，与审计 73.3k 相差 0.4%；每个核心工具描述按其重写目标封顶，误差 ±10%）：

| 宿主 | 现状 工具 / token | 目标 工具（+条件） / token |
|---|---|---|
| LOWA docx | 39 / 10.2k | 31 (+2) / ≈5.8k |
| LOWA xlsx | 32 / 8.5k | 25 (+2) / ≈4.7k |
| LOWA pptx | 32 / 8.3k | 26 (+1) / ≈4.9k |
| LOWA 没开文件 | 25 / 6.5k | 22 (+1) / ≈4.1k |
| Office Word | 30 / 7.6k | 27 (+1) / ≈5.0k |
| Office Excel | 28 / 7.3k | 25 (+1) / ≈4.7k |
| Office PPT | 27 / 7.0k | 24 (+1) / ≈4.5k |
| none | 21 / 5.6k | 18 (+1) / ≈3.3k |

工具个数只降 15–20%，token 降 40–45%——这正是「问题在描述质量不在数量」的量化：同一批名字今天 8.2k，重写后 5.8k。

---

## D. 律师会撞上的缺口与工具规格

| # | 缺口 | 今天 | 提议工具（access / host / 类目） |
|---|---|---|---|
| D1 | 两份文档比对（收到对方回稿第一件事） | 没有 compare；`version_changes` 只有路径级 | `doc_compare(fileIdA, fileIdB, output=summary\|redline_docx, granularity=paragraph\|sentence)` write / NONE / files。summary 返回增删改清单（段号 + 前后文），redline 产出一份带修订痕迹的 .docx 落 `GeneratedFileLocation`。实现：后端 docx 段落级 diff（已有 `write_docx` 的 docx 写入链）；LibreOffice 原生 compare 作二期（见 F 问题 3） |
| D2 | 期限计算（上诉期、举证期限、仲裁时效、法定节假日顺延） | 模型心算或 `run_python` 无节假日表 | `deadline_compute(baseDate, rule, jurisdiction=CN, count=natural\|working)` read / NONE / tasks。内置规则表（民诉上诉 15/10 日、举证期限、再审 6 个月、劳动仲裁 1 年…）+ 年度节假日表（国务院放假安排，随版本更新）；返回到期日、顺延说明、规则出处，可直接喂 `task_create` |
| D3 | 未打开文件的条款级读取 | `doc_get_clauses` 只对活跃文档；否则全文 `extract_file_text` | 不新增：`extract_file_text` 加 `section`（标题/条号，如「第三条」「3.2」）与 `maxChars`，按条切片 |
| D4 | 实体抽取与跨文件一致性校验（doc-insight 已有，模型调不到） | 纯 Web 插件 `insight` | insight 插件声明 `insight_entities(fileId)`、`insight_consistency(fileIds[])` read，handler=service `insight`（`HostServiceRegistry` 第六个适配器） |
| D5 | 文中法条引用核对 | `law_recognition` 只接受文本 | 不新增：`law_recognition(text? \| fileId? \| activeDocument=true)` 返回每条引用的法规名、条号、是否现行、原文比对差异；描述重定位为「核对引用」 |
| D6 | 证据目录 / 证据清单结构化 | skill 让模型手工列 | `evidence_catalog(folderId, order=name\|date\|type)` read / NONE / evidence：逐文件名、类型、页数、日期（文件名/正文抽取）、hash、是否已被 `doc_link_evidence` 引用；供 `doc_insert_table` 一次成表 |

刻意不做：翻译（模型内生）、电子签/外发邮件（出站红线）、诉讼费计算（规则简单，`run_python` 即可，不值一个名字）。`resolve_project` 已在 agent-app-control P1-6，CSV 列为 new 以便计数。

---

## E. 迁移计划

编号 V0–V9，排在 agent-app-control P1-2（已合）之后，与 tool-surface-audit S 系列的关系：S0/S1 已落地；S2→V1、S3→V2、S4→V4、S5→V5、S6→V6、S7→V7 由本文细化并取代。每个 PR 独立可合、可 revert；合并前照常 `check:locales`、安全门禁、`CapabilityCatalogDocTest` 重生成。

### E1 更名与合并的兼容机制：shim，不是别名

- 旧名**继续注册**一个小版本（0.82 → 0.83 删除），`offerToModel=false`，实现只做参数映射后调用新工具，并在回执末尾追加一句 `（提示：此工具已并入 X，下次请直接调用 X(…)）`。与 `TOOL_NAME_ALIASES` 的区别：shim 做的是同一件事、且告诉模型；别名曾改变意图且静默。`ToolRegistry` 加 `@Deprecated(since, until, replacedBy)` 元数据，`ToolDeclarationContractTest` 在 `until` 版本到期时变红，防止 shim 永久滞留（`deep_search` 一类兼容壳滞留了五个版本就是教训）。
- 旧对话回放：执行日志里的旧名经 shim 仍可执行；`EvalHarness` 的 `toolCalls` 期望在同一 PR 改成新名（shim 命中会让用例通过但也会在 WARN 里暴露）。
- skill：`SkillRouter` 解析 `allowed_tools` 时经同一张 shim 表映射 + WARN；13 个内置 skill 在同一 PR 改名；用户自建 skill 靠映射。
- 插件 allowlist：插件工具名不变，不受影响。
- 提示词：`system_prompt*.md`、`tools-*.md` 五组、`skills/*/prompt.md` 同 PR 替换，`SystemPromptToolVisibilityContractTest` 守住。
- 前端：`toolDisplayNames.js` 新增新名、保留旧名；`@ToolMeta.displayName` 20 语种词条同步。
- `docs/capability-catalog.md` 每个 PR 重生成；本文 CSV 由 V0 的测试重生成基础列。

### E2 分期

| PR | 标记 | 范围 | 验收（ai-eval + 真实模型） | 回滚 |
|---|---|---|---|---|
| **V0 清单与门禁** | [机] | `ToolInventoryContractTest`：从注册表重生成 CSV 基础列（name/host/access/core/首行长度与语言/token 估算）并与入库 CSV 对拍；`ToolDeclarationContractTest` 新增三条门禁——首行 ≤80、单一语言、动词开头，存量违规列白名单（200 条）逐 PR 清零；manifest/`plugin-dev validate` 同规则 | 现有 110 条回放用例全绿；白名单条数 = CSV 中 rewrite 行数 | 删测试 |
| **V1 核心集描述重写** | [机] | B2 全部核心名字（含三宿主变体共 ≈50 条）按 A5 重写；`OfficeToolMessages` 扩为 doc/office 共享源；`list_tools/ask_user/todo_write/save_memory/query_memory` 五个最胖者先行 | 基线 csv 更新：docx 中性 token 10.2k → ≤7.5k，工具数不变；`cases-tool-choice.json` 全绿；真实模型矩阵 A（2 模型 × 12 句 × 3 次）首工具准确率 ≥ 基线 | revert 文案 |
| **V2 核心集重切 + 状态条件核心** | [设] | B2 的 8 个名字退出；`ToolDisclosurePolicy` 加 `conditionalCore(context)`：附件存在 → `list_attached_files`，检查点存在或 pptx → `doc_restore_checkpoint`；固定追加 `memory_list/read` 两件；关键词表补词（B4）；`corePerSessionIsSmallAndComplete` 阈值 40 → 32 | 基线 csv：八行全部达 B6；新增回放：「把合同套用律所标准格式」首轮含 `doc_apply_standard_format`、「本周有什么安排」首轮含 `task_list`、带附件会话首轮含 `list_attached_files`、无附件不含；真实模型矩阵 A 重跑 ≥ 基线 | revert 后基线 csv 一并回退 |
| **V3 删除长期隐藏工具** | [机] | 22 个 deprecate 行的注册与实现删除（全部 `offerToModel=false` ≥2 个版本）；回放用例里它们只出现在 `offeredToolsExclude`（20 处，删除后改为断言「未注册」）和 2 个探针用例的脚本调用（`doc-trim-xml-call-to-hidden-tool-puts-siblings-back` 用 `pdf_list_files`、`memory-user-profile-noarg-xml` 用 `get_user_profile`），改用 `pptx_check_service` 与 `memory_list` 承担同一断言；`ToolChoiceSurfaceTest` 对应断言从「不下发」改「不注册」；`toolDisplayNames.js` 保留键 | 注册数 353 → 331；`ToolDeclarationContractTest` 的 `offerToModel=false` 名单剩 `pptx_check_service` 一项 | revert |
| **V4 低歧义合并** | [机] | C 节的 24 个合并目标（修订/批注/表格行列/脚注尾注/定位/`pdf_pages`/`office_file`/`law_search(mode)`/`write_file(mode)`/`move_files`/`foldersOnly`/`scope=all`/`office_excel_set_values`/`pptx_outline`/`capability_install`），每个新工具显式 `access`，destructive 不并入 action；旧名 shim（E1）；访问级别修正（A4 列出的 9 个） | 注册数 331 → 300（48 行并入 24 个名字，其中 7 个并入既有名字）；每个合并族一条新回放（如「接受全部修订」→ `doc_revisions(action=accept_all)`、「把第 10–20 页抽出来」→ `pdf_pages(op=extract)`）；老用例改名；`ToolChoiceSurfaceTest` 加「每族只剩一个下发名」 | shim 保证旧名可用，revert 无数据风险 |
| **V5 会议合流** | [设] | `meeting_list(source)` + `meeting_get_transcript(source,id)`；插件启用时 tencent 来源路由到 `tencent_meeting_action`（E4）；`tencent-meeting` skill 与内置 skill 改指新名；日程插件 manifest 不声明工具（B7） | P1-6 的腾讯会议用例装/未装两版；「会议录音整理成纪要」首工具 = `meeting_list`；真实模型矩阵 B（会议/日程 8 句 × 2 模型 × 3 次）无误选 | shim |
| **V6 排版工具 style 对象** | [设] | 16 个 ≥10 参数工具收成 `style`/`rule` 对象（CSV `STYLE_OBJ`）；老扁平签名保留为 shim 一版 | `docx-format` 类目 token −40%；真实模型矩阵 C（「第 2 段宋体小四首行缩进 2 字符」等 10 句 × 2 模型 × 3 次）填参正确率 ≥ 基线——**唯一可能换来下降的 PR，不达标即回退** | 保留扁平签名即回滚 |
| **V7 缺口工具** | [设] | D1 `doc_compare`（summary 先、redline 二期）、D2 `deadline_compute`（含节假日表与单测）、D3 `extract_file_text(section)`、D4 insight 适配器 + 插件声明、D5 `law_recognition(fileId)`、D6 `evidence_catalog` | 每个一条回放 + 单测；`deadline_compute` 覆盖节假日顺延与跨年；`capability-catalog.md` 新行；MCP 投影自动含 D2/D4/D6（read） | 独立开关无需，revert 即可 |
| **V8 插件与 MCP 对等** | [机] | manifest `agent:false`（baoqingtian/dpia action）；`McpToolProjection` 会话内生排除表（A10）；`mcp:true` 白名单首批 `task_create/task_update/tag_file/create_folder`（= P2-5）；`plugin-dev validate` 的 A5 规则 | `LocalMcpServerControllerTest`：tools/list 不含 `ask_user/list_tools/todo_write`，含 `task_create`；审计 `source=mcp` | revert |
| **V9 收尾** | [机] | 0.83：删除 V4/V5/V6 的 shim；`tools-*.md`、ai-chat.md「工具规格瘦身」节、`docs/capability-catalog.md`、本文 CSV 最终版 | `ToolDeclarationContractTest` 的 `@Deprecated until` 全部清零；基线 csv = B6 目标 | — |

顺序理由：V0 先立尺子；V1 不动名字只改文案，收益最大风险最小，先把 token 砍一半；V2 改模型可见面，要真实模型背书；V3 删的都是早已不可见的，放在合并之前让 V4 的计数干净；V4–V6 全靠 shim 兜底；V7 新能力最后，避免与合并撞描述；V8 对外面；V9 到期清理。

### E3 验证方法

- **回放层**：`OrchestratorReplayEvalTest`（110 条）+ `ToolSurfaceBudgetTest`（基线 csv，每个改变首轮的 PR 必须同提交更新）+ `ToolChoiceSurfaceTest`/`ToolDeclarationContractTest`/新 `ToolInventoryContractTest`。
- **真实模型层**：`RealLlmSmokeTest` 矩阵，两款模型 DeepSeek V4 Flash（`AI_EVAL_SMOKE_MODEL` 缺省）与 qwen3.8-max，句集三组：A 通用 12 句（读/找/改/批注/法条/记忆/新建）、B 会议日程 8 句、C 排版填参 10 句。判据：首个业务工具 == 期望（A/B），参数 JSON 与期望逐键相等（C）。每次只跑该 PR 涉及的句集，结果写进 ai-chat.md 实测表。预计 V1、V2 各跑 A（72 次），V5 跑 B（48 次），V6 跑 C（60 次）：≈250 次。
- **回归信号**：`list_tools` 调用率（今天 60 次 0 次）与「模型宣称做不了」的 `<final>` 比例——两者任一上升即核心集切过头。

---

## F. 风险与待拍板

**风险**
1. 描述改中文后英文产品语言用户的工具选择退化——缓解：系统提示英文版已 jurisdiction-neutral，V1 矩阵加 2 句英文输入；若退化明显，`LangText` 双语描述提前到 V9。
2. `style` 对象让弱模型漏键（V6）——已设为唯一「不达标即回退」的 PR，扁平签名保留一版。
3. shim 期内新旧名并存，日志与过程卡显示旧名——`toolDisplayNames.js` 同显；只持续一个小版本。
4. 条件核心（V2）让「一轮内工具集不变」契约多一个输入：附件/检查点状态在起跑时一次算定，轮内不变，与 `RunGuard.activeDocKind` 同一口径；用例「附件在第二条消息才出现」要覆盖。
5. 删除 22 个隐藏工具后，老会话执行日志里若出现这些名字，重放会报「未知工具」——它们自 ≥2 个版本前就不下发，模型只能经 XML 兜底调到，实际日志里出现率应为 0；V3 前用 `UserActivityLog(actionType=ai_tool)` 查最近 30 天命中数，非 0 的保留 shim 到 V9。
6. `meeting_list` 的 tencent 来源在插件启用时跨越插件边界调用 JAR 工具——沿用 `PluginHostFactory.bindCall` 与权限校验，不新开通道。

**需要负责人拍板的 3 件事**
1. **日程插件不声明工具**（B7）：agent-app-control P1-3 原计划让 calendar 声明 `calendar_agenda/calendar_create`，实测这正是「task_create vs calendar_create」误选的来源；我建议改为 `task_*` 单一家族、日程插件 manifest `tools: []`。若 P1-3 已在实施，需同步改口径。
2. **真实模型预算**：此前批准约 120 次（S3/S6），本计划需 ≈250 次（V1/V2/V5/V6），仍走平台 key、同两款模型；是否接受。
3. **`doc_compare` 的 redline 产物**：段落级 diff 由后端自实现（V7 一期，无新依赖）；真正的 Word 级修订比对需要服务端 headless LibreOffice（新部署依赖、Docker 镜像 +300MB）或改走桌面端 LOWA 执行（只有桌面可用）。请选：一期只做 summary + 段落级 redline，还是直接引入 headless LibreOffice。

其余（核心集成员、类目名、合并粒度、shim 期限、访问级别修正、插件隐藏）按负责人授权由我拍板，记录在 CSV 的 rationale 列。

## G. 已拍板（2026-11-08，负责人授权由我决定）
1. 日历插件不声明工具：已在 #1418 落地（calendar_agenda / calendar_create 已删），日程只走 `task_*`。
2. 真实模型验收预算：同意约 250 次（DeepSeek V4 Flash + qwen3.8-max），走 OpenRouter 测试 key。
3. `doc_compare`：优先用编辑器内 LOWA 的 `.uno:CompareDocuments` 产出原生修订（不新增服务端部署依赖）；无编辑器场景（MCP / 后台）退到服务端段落级 diff，结果以修订建议（propose_revision 同形）呈现，不直接改文件。
