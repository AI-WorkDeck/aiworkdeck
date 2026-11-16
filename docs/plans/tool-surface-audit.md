<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# AI 工具面审计：每轮到底下发多少、重叠在哪、怎么收

状态：审计稿（2026-11-07），基于 master `8ee11eadc`。只读审计，未改代码。
关联：`docs/plans/agent-app-control.md`（在途，本文所有 PR 排在其 P1-2 之后）、`docs/capability-catalog.md`、`.claude/agents/ai-chat.md`「工具规格瘦身与渐进披露」节。

一句话结论：**注册表 342 不是问题，问题是三件事**——① 桌面工作台「没开文件」这一态每轮下发 50 个工具 / 1.34 万 token（最胖的常态）；② 关键词预放回没有上限，一句话命中 4 类就从 41 个涨到 64 个（1.76 万 token），命中 16 类涨到 135 个（3.07 万）；③ 单个工具平均 230 token，核心集里最胖的 6 个合计 3,400 token，是 Claude Code 一个工具的 2–4 倍。核心集的「个数」（23–41）与成熟 agent（15–25）同一量级，不必推倒重来；要治的是上面三条。

---

## 1. 测量

方法：在 worktree 里写了一次性 JUnit 探针（已删，不入库）：`RecordingToolRegistry(RealToolBeans.instantiateAll(true,true))` 真实注册 342 个工具 → `getAllSpecifications(conv, kind)`（宿主闸 + 活跃文档闸）→ `ToolDisclosurePolicy(true,true).trimForDocKind + narrow`（类目裁剪 + 核心集）→ 补上编排器每轮固定追加的 `memory_list/read/search`（`AgentOrchestrator` 3444–3452 行）。token 口径与 `ToolSchemaBudgetTest.wireBytes` 同一条编组（`InternalOpenAiHelper.toTools` + openai4j 紧凑 JSON），再过 `OpenAiTokenizer("gpt-4o")`（o200k），**不是各供应商计费实数**。插件工具 / 用户 MCP 为 0（探针没装插件）。

### 1.1 首轮（turn 1）下发量，按宿主 × 提示类型

「中性」=「这份合同有什么风险？」（不命中任何关键词）；A=「把第3条的违约金改成…并加批注」（命中 revision）；B=「按《公司法》核对股东会决议…改成修订」（legal+revision+enterprise-data）；C=「把这张表格的格式统一一下，再建一个下周三的提醒事项」（table+spreadsheet+format+task）；重=一句话命中 16 类；最坏=19 个关键词类目全放回。

| 宿主（会话态） | 候选集 | 中性 | A | B | C | 重 | 最坏 | ASK |
|---|---|---|---|---|---|---|---|---|
| LOWA docx 打开中 | 162 / 35.5k | **41 / 10.7k** | 50 / 11.5k | 56 / 12.3k | 64 / 17.6k | 135 / 30.7k | 147 / 33.2k | 8 / 1.3k |
| LOWA xlsx 打开中 | 134 / 29.1k | 34 / 8.9k | 34 / 8.9k | 40 / 9.7k | 58 / 14.5k | 117 / 25.8k | 129 / 28.3k | 8 / 1.3k |
| LOWA pptx 打开中 | 133 / 30.0k | 34 / 8.7k | 34 / 8.7k | 40 / 9.5k | 37 / 9.6k | 117 / 26.8k | 129 / 29.3k | 8 / 1.3k |
| **LOWA 没开文件**（工作台欢迎页/项目概览，主前端默认态） | 213 / 48.6k | **50 / 13.4k** | 59 / 14.3k | 65 / 15.0k | **94 / 25.0k** | 186 / 43.9k | 198 / 46.4k | 8 / 1.3k |
| Office Word 窗格 | 129 / 28.0k | 32 / 8.1k | 32 / 8.1k | 38 / 8.9k | 35 / 9.1k | 75 / 16.9k | 81 / 17.8k | 5 / 0.9k |
| Office Excel 窗格 | 111 / 24.5k | 30 / 7.9k | 30 / 7.9k | 36 / 8.6k | 33 / 8.8k | 73 / 16.6k | 79 / 17.5k | 5 / 0.9k |
| Office PPT 窗格 | 104 / 22.3k | 29 / 7.6k | 29 / 7.6k | 35 / 8.3k | 32 / 8.5k | 72 / 16.3k | 78 / 17.2k | 5 / 0.9k |
| none（纯 API / 手机端） | 76 / 16.5k | 23 / 6.1k | 23 / 6.1k | 29 / 6.9k | 26 / 7.0k | 66 / 14.8k | 72 / 15.7k | 5 / 0.9k |

单元格 = 工具数 / o200k token。每轮都要重发：一条消息 4 个往返就付 4 遍。叠加固定 system prompt（ai-chat.md 实测 docx zh 7,857 token），docx 中性首轮进模型前就是 **≈1.85 万 token**，没开文件时 ≈2.1 万。

读法：
- **主前端从不传 `clientCapability`**（`frontend/src` 无此字段，`ClientCapabilityService.capabilityOf` 缺省 LOWA），所以欢迎页 / 项目概览里聊天 = 「LOWA 没开文件」行，不是 none 行。`activeDocKind=null` 时三个 LOWA 段（docx 15 + xlsx 5 + pptx 6）全下发，且类目裁剪不生效（「判不准倒向全集」）。这是最常见的会话态之一，却是最胖的。
- 关键词预放回是「只增」且无上限：C 这种律师日常一句话（表格 + 格式 + 事项）在 docx 下 +23 个工具 / +6.9k token；「表格」一词同时放回 table 与 spreadsheet 两类（设计如此）。
- ASK 模式很干净（5–8 个），不动。
- 319 个 `offerToModel=true` 工具全下发是 7.33 万 token——没有任何会话会看到这个数，它只是注册表的「名义大小」。

### 1.2 单工具体量与描述卫生（319 个下发工具）

- 平均 230 token / 工具；描述 >400 字符 51 个；**首行 >120 字符 230 个**（72%，几乎没有「一句话定位」）；参数 ≥12 个的 10 个。
- 最胖 10 个：`doc_set_paragraph_format` 840（15 参数）、`doc_format_selection` 755、`office_set_paragraph_format` 747、`slide_format_text` 717（22 参数）、`doc_format_table` 711、`slide_table_set_style` 682、`save_memory` 674、`office_format_text` 647、`doc_apply_standard_format` 635、`query_memory` 576。前六个全是把样式属性摊平成参数的排版工具。
- 核心集内最胖：`save_memory` 674、`doc_apply_standard_format` 635、`query_memory` 576、`sheet_write_cells` 550、`ask_user` 519（描述 1,348 字符）、`list_tools` 469（描述 1,485 字符，按契约要念全每个类目名）。docx 核心 38 个 = 10.3k，平均 270，比全集均值还高——「判据句长在工具上」（K27）的代价集中在这里。
- 语言：中文为主 137、英文为主 55、**中英混排 127**（同一条描述里两种语言交替，如 `write_docx`「【STRICTLY NEW FILES ONLY】Create a NEW .docx…」）。system prompt 分 zh/en 两版，工具描述不分版。

---

## 2. 重叠组与处置

处置三选一：**合并**（少一个名字）、**宿主分列**（名字各留，模型永远只见一套）、**退场**（`offerToModel=false` 或删除）。`ToolChoiceSurfaceTest` 已钉住的退场（`read_document / move_file / scan_files / deep_search / search_knowledge_base / pdf_list_files / pptx_list_files / pptx_search_files / pptx_* 编辑 3 个 / get_* 3 个`）不再重复。

| # | 组 | 现状 | 处置 | 理由 |
|---|---|---|---|---|
| 1 | `office_*`(102) vs `doc_*`(67)/`sheet_*`(26)/`slide_*`(27) | 同后缀成对：Excel↔sheet 21 对、PPT↔slide 21 对、Word↔doc 31 对，共 73 对；执行器完全不同（Office.js 任务窗格 vs LOWA 编辑桥） | **宿主分列**（维持）；但描述与参数说明改为按后缀共享单一来源（`OfficeToolMessages` 扩成两家共用），**只改文案不改名** | 能力闸已保证模型每轮只见一套，合并名字每轮省 0 token，却要动 office-addin 公开契约与 `toolDisplayNames.js`；真正的病是两份描述各自漂移（`office_get_formatting` 135 vs `doc_get_formatting` 204 token，判据句不一致） |
| 2 | `pptx_*`(12) vs `slide_*` | 编辑面已只剩 slide_*；pptx_ 余 7 个是「图片版 deck」流水线：`generate / generate_outline / refine_outline / export_editable / get_project_pages / inspect_format / check_service` | 合并：`pptx_generate_outline + refine_outline → pptx_generate(stage=outline\|refine\|render)`；`get_project_pages + inspect_format → pptx_inspect(what=pages\|format)`；`pptx_check_service → offerToModel=false`（健康检查不是模型该调的） | 7 → 4；slides 类目在 docx 会话被整类藏着，但「ppt」关键词一放回就是 9 个 pptx+slide 规格 1.66k token |
| 3 | `tmeet_*`(2) vs `meeting_*`(2) vs 插件 `tencent_meeting_action` | 两对「列清单 + 取逐字稿」，描述几乎同句；插件优先已由 agent-app-control E4 拍板 | 合并：`meeting_list(source=recording\|tencent)` + `meeting_get_transcript(id)`；插件装且启用时按 E4 隐藏 tencent 源 | 4 → 2；描述里统一说清「录音是本机转写、腾讯是同步表」 |
| 4 | 六个 `search_*`：`search_project_files`(按名) / `search_project_content`(正文) / `search_across_projects`(跨项目按名) / `search_web` / `sheet_search` / `office_search`（另有 `doc_find_text`、`office_excel_search`） | 三个「找文件」的分工已写进描述（T-03）；跨项目只是多一个范围 | 合并 `search_across_projects → search_project_files(scope=project\|all)`；其余保留——文档内查找是宿主工具，公网是另一个世界 | 6 → 5；agent-app-control B5 要的跨项目搜索由 scope 参数承接 |
| 5 | 文件读/列：`doc_list_project_files`(权威清单) / `list_files`(磁盘视图) / `list_project_folders`(只列文件夹) / `list_attached_files`；`extract_file_text`(按 id) / `read_file`(按路径) | 权威清单已是唯一入口（T-01）；`list_project_folders` 只是它的投影 | 合并 `list_project_folders → doc_list_project_files(foldersOnly=true)`；`list_files/read_file` 留给 `run_python` 的路径世界，继续不进核心集 | 「folderId 从哪来」已写在 `write_docx/create_folder` 描述里 |
| 6 | 写文件：`write_file`(新建 txt/md) / `text_write_file`(整篇覆盖已有文本文件，LOWA) / `text_find_replace` / `write_docx` / `doc_start_stream` / `sheet_create_file` / `slide_create_file` | `write_file` 与 `text_write_file` 是同一件事的两半（新建 vs 覆盖） | 合并 `text_write_file → write_file(mode=create\|overwrite)`；`write_docx`（落文件）与 `doc_start_stream`（流进编辑器）**不合**——一个是产物、一个是体验 | 7 → 6 |
| 7 | 移动：`move_files_batch` / `move_project_file` / `rename_project_file` / `copy_files` | 单条移动 `move_file` 已退场，`move_project_file` 是它的孪生 | 合并 `move_project_file → move_files_batch`（单条就是长度 1 的数组） | 4 → 3 |
| 8 | 记忆 8 个：`query_memory/save_memory`（三级记忆）vs `memory_list/read/search/write/edit/delete`（Markdown 记忆文件） | 心智模型已钉（T-12/T-13）；三只读每轮固定补发 | **不合**；只砍描述：`save_memory` 624 字符、`query_memory` 547 字符各压到 ≤250 | 两个在核心集，合计 1,250 token/轮，是核心集里最贵的一对 |
| 9 | 法规 5 个：`law_search` / `law_search_keyword` / `get_law_article` / `law_recognition` / `case_search` | `law_search_keyword` 只是 `law_search` 的精确模式 | 合并 `law_search(mode=semantic\|keyword)` | 5 → 4 |
| 10 | Word 定位 5 个：`doc_goto` / `doc_collapse_cursor` / `doc_select_anchor` / `doc_select_paragraph` / `doc_set_selection`(已退场) | 都是「把光标/选区放到某处」，参数各一两个 | 合并 `doc_select(target=anchor\|paragraph\|start\|end\|collapse, id?)` | 4 → 1；edit 类目 11 → 8 |
| 11 | 批注 ×4 宿主：`{doc,sheet,office,office_excel}_{add,get,reply,resolve,delete}_comment`（共 17 个） | 同一张 CRUD 表抄四遍 | 合并 write 三件 `add/reply/resolve → *_comment(action=add\|reply\|resolve)`；`get`（read）与 `delete`（destructive）**各自保留**——访问级别是 agent-app-control C5 唯一的策略轴，不能把 destructive 藏进 action 枚举 | 17 → 12；`doc_add_comment` 仍在核心集（审查交付物） |
| 12 | 修订 ×2 宿主：`doc_{accept,reject,accept_all,reject_all,list}_revision(s)` / `office_{accept,reject,get}_revision(s)` | 同上 | 合并 `doc_revisions(action=accept\|reject\|accept_all\|reject_all, id?)`、`office_revisions(action=accept\|reject, id?)`；list/get 保留 | 8 → 4；revision 类目 9 → 5 |
| 13 | PDF 页操作 6 个：`pdf_rotate_pages / extract_pages / split / merge / add_page_numbers`（write）+ `pdf_delete_pages`（destructive） | 律师卷宗整理高频，但每次要先 `list_tools(pdf)` 拿回 13 个规格 3.77k token | 合并 write 五个 → `pdf_pages(op=rotate\|extract\|split\|merge\|number, …)`；`pdf_delete_pages` 独立 | 6 → 2；pdf 类目 13 → 9 |
| 14 | `office_file_{open,create,save,export_pdf}` | 四个只在 Office 窗格可见的小动作 | 合并 `office_file(action=open\|create\|save\|export_pdf)` | 4 → 1 |
| 15 | 排版 6 个：`doc_set_paragraph_format`(15 参数) / `doc_format_selection`(13) / `doc_format_table`(14) / `office_set_paragraph_format`(12) / `slide_format_text`(22) / `sheet_format_cells`(13) | 不重叠，但是全注册表最胖的一族（合计 4.3k token） | 不合名字；把摊平的样式属性收成一个 `style` JSON 对象参数（键表写在描述里一次） | 预计每个 -40% token；需真实模型对照，因为参数变 JSON 会影响弱模型填参 |

合并后注册表约 342 → **≈300**；但请记住 §1 的结论：这些合并的收益只在「该类目被展开的那一轮」兑现，对中性首轮几乎无感。真正动首轮的是 §4 的核心集重切与没开文件态。

---

## 3. 律师相关缺口（agent-app-control 未覆盖）

该计划已覆盖：会议纪要落位、跨项目事项、项目推断、脱敏、律所台账、IM、插件声明式工具、对外 MCP 修订。以下不在其中：

1. **两份文档比对（redline between files）**：没有任何 compare 工具；`version_changes` 只给路径级增删改，不给正文差异；`doc_list_revisions` 只看当前文档里已有的修订。律师收到对方回稿第一件事就是比对。提议 `doc_compare(fileIdA, fileIdB, output=summary|redline_docx)`（access=write，产物落 `GeneratedFileLocation`）。
2. **期限计算（deadline_compute）**：`task_create` 收日期但不会算日期；上诉期、举证期限、仲裁时效按《民诉法》/《仲裁法》规则 + 法定节假日顺延，今天只能让模型心算或 `run_python` 自带日历（没有节假日数据）。提议 read 工具 `deadline_compute(base_date, rule, jurisdiction)`，内置规则表 + 节假日表，结果可直接喂 `task_create`。
3. **跨文件一致性校验的工具化**：`doc-insight` 领域已有「文档内部一致性校验 / 实体抽取」（纯 Web 插件 `insight`），模型调不到。应作为 `HostServiceRegistry` 的第四个适配器（`insight`：entities/consistency，read）挤进 P2-3，与 desensitize/search/lawfirm 同批。
4. **未打开文件的条款级读取**：`doc_get_clauses` 只对 LOWA 当前文档；要看一份没打开的合同的某几条只能 `extract_file_text` 全文。给 `extract_file_text` 加 `section`/`clause` 参数（按标题或条号切片）比新工具便宜。

刻意不列：翻译（模型内生能力）、电子签 / 外发邮件（`legal/PRIVACY.md` 出站红线）、法条时效性标注（数据源限制，非工具面问题）。

---

## 4. 建议

### 4.1 每轮预算（新契约，进 `ToolSurfaceBudgetTest`）

| 指标 | 现状（docx / 没开文件） | 目标 |
|---|---|---|
| 中性首轮工具数 | 41 / 50 | **≤30 / ≤30**（所有宿主） |
| 中性首轮 schema token（o200k） | 10.7k / 13.4k | **≤7k / ≤7k** |
| 关键词预放回后（典型 C 句） | 64 / 94 | **≤45 / ≤45** |
| 单轮预放回类目数 | 无上限（实测 16） | **≤3**（按命中关键词长度排序取前三，其余留给 `list_tools`） |
| 单工具描述首行 | 72% 超 120 字符 | ≤100 字符一句话「做什么 + 何时用」，判据句放第二段 |
| 单工具 token | 均值 230，最大 840 | 核心集单个 ≤350，全集 ≤600 |

`list_tools(query=…)` 已经是「tool-search」（按名字 + 描述关键词 AND 匹配，最多 15 条全签名），不必再造；要做的是让模型更敢用它——真实模型 60 次 0 次调用（ai-chat.md）说明今天核心集「够用」，这正是把核心集再收 25% 的安全边际。

### 4.2 谁离开 CORE（65 个名字 → 约 54 个）

- 通用段：`create_folder / move_files_batch / move_to_trash` → files 类目（「文件夹 / 移动 / 归档」关键词已预放回；三个合计 ~700 token）。保留 `list_tools / ask_user / todo_write / use_skill / dispatch_subtask / 五个找读 / write_docx / ref_list / ref_read / query_memory / save_memory / law_search / get_law_article / search_web / browse_url`。
- docx 段：`doc_apply_standard_format`（635）→ format（「格式 / 排版」预放回）；`doc_export_pdf` → files（「pdf」预放回）；`sheet_create_file / slide_create_file` 退出核心集（落 spreadsheet / slides，「表格 / excel / ppt」预放回）。**保留** `doc_insert_table`（末位提醒点名，B4 回归证据）与 `doc_get_clauses / doc_audit_structure`（合同审查主链）。
- xlsx / pptx / 三个 Office 段：不动（各 4–7 个，已是最小「读 + 找 + 写」）。
- **没开文件态单独一份核心集**：`activeDocKind=null && capability=LOWA` 时不再三段齐发，只给入口 `doc_open_file / write_docx / doc_start_stream / sheet_create_file / slide_create_file`（5 个）；打开或新建后由既有 `widenDocKindIfTypeChanged / widenDocKindAfterDocumentSwitch` 把对应段放回（机制已在，只是 null 分支没走它）。预计 50 / 13.4k → ≈28 / 7k。

### 4.3 描述卫生规则（进 `ToolDeclarationContractTest` 当门禁）

1. 首行 ≤100 字符、一句话、以动词开头；首行不出现「【…】」标签以外的强调符号。
2. 一条描述一种语言：正文中文（产品主语言），工具名 / 参数名 / 枚举值保持英文；英文触发词可在括号里给同义词（`(compare, redline)`），不写整句英文。现有 55 条纯英文描述按此改中文。
3. 判据句（「仅在…时用」「先…再…」）放首行之后，单条 ≤2 句；同一判据在同族工具里只写一次，其余互相点名。
4. 参数 ≥10 个的工具必须收成结构化对象参数（§2 #15）。

---

## 5. 分期 PR（全部排在 agent-app-control **P1-2 合并之后**）

冲突面：P1-2 改 `ToolRegistry`（`DeclaredToolBinding`）、`ToolDisclosurePolicy`（`CATEGORY_KEYWORDS` 动态部分）、`CapabilityCatalog`（读 `access` 字段，新工具 INFERRED 即红）。本文 S1/S3 碰 `ToolDisclosurePolicy` 与编排器，S4 新建合并工具必须显式写 `access`——都得等 P1-2 落地再开。S0 不碰生产代码，可与 P1-2 并行。

验收口径统一两条：**选择准确率** = 用例期望的首个业务工具命中率（回放：`expect.toolCalls[0]`；真实模型：`RealLlmSmokeTest` 首个工具调用 == 期望），**每轮 token** = `EvalHarness` 新增的 `offeredSchemaTokensPerCall`（o200k，首轮值）。每个 PR 报「前 → 后」两列。

| PR | 标记 | 范围 | 验收（ai-eval） |
|---|---|---|---|
| S0 测量基建 | [机] | `EvalHarness.RunResult` 加 `offeredToolCountPerCall / offeredSchemaTokensPerCall`（复用 `ToolSchemaBudgetTest.wireBytes` + `OpenAiTokenizer`）；新 `ToolSurfaceBudgetTest` 把 §1.1 八行 × 中性/C/最坏钉成表并打印；`EvalCase.expect` 加 `maxOfferedToolsFirstCall / maxOfferedSchemaTokensFirstCall` | 基线表与本文 §1.1 一致（±2%）；现有 102 条回放用例全绿、无断言改动 |
| S1 没开文件态 | [设] | `discloseProgressively`：LOWA ∧ kind=null 走「入口核心集」（§4.2 末条）；`prepareToolCategoryPutBack` 预放回类目 ≤3（按命中词长排序） | 新 `cases-tool-surface.json`：①欢迎页「这份合同有什么风险」首轮 ≤30 工具 / ≤7k；②欢迎页「新建一份股权转让协议」→ `doc_start_stream` 后下一轮 `doc_find_replace` 可见；③ C 句首轮 ≤45；④ 16 类重句只放回 3 类且 `list_tools` 在列。`cases-tool-disclosure/visibility` 全绿；三种 -D 模式各跑一遍 |
| S2 描述瘦身 | [机] | 核心集最胖 8 条（`save_memory / query_memory / ask_user / doc_apply_standard_format / sheet_write_cells / office_pass_step / doc_replace_at_anchor / slide_add_page`）按 §4.3 重写；`ToolDeclarationContractTest` 加首行 ≤100 / 单语言两条门禁，存量违规列白名单逐 PR 清零 | docx 中性首轮 token 10.7k → ≤9k，工具数不变；`cases-tool-choice.json` 9 条全绿；真实模型冒烟 3 条不退化 |
| S3 核心集重切 | [设] | §4.2 的 11 个名字退出 `CORE`；末位提醒与 `tools-lowa*.md` 同步去掉对 `doc_apply_standard_format / slide_create_file` 的点名；`ToolDisclosurePolicyTest.corePerSessionIsSmallAndComplete` 阈值 40 → 30 | docx 中性 ≤30 / ≤7k；新增回放：「把合同套用律所标准格式」首轮因「格式」预放回含 `doc_apply_standard_format`；「参考这份合同做个 PPT」首轮含 `slide_create_file`；真实模型矩阵（2 模型 × 10 句 × 3 次）首工具准确率 ≥ 基线 |
| S4 低歧义家族合并 | [机] | §2 的 #2 #4 #5 #6 #7 #9 #10 #11 #12 #13 #14（含 `ToolRegistry` 别名表让老对话里的旧名可回放；新工具显式 `access`，destructive 不并入 action 枚举） | 注册表 342 → ≈300，`CapabilityCatalogDocTest` 重生成；`ToolChoiceSurfaceTest` 加「每个合并族只剩一个下发名」；新增回放：合并卷宗加页码 → `pdf_pages(op=merge)` 再 `pdf_pages(op=number)`；接受全部修订 → `doc_revisions(action=accept_all)`；老用例 `expect.toolCalls` 按别名表改名 |
| S5 会议合流 | [设] | §2 #3，依赖 agent-app-control P0-1/E4：`meeting_list(source)` + `meeting_get_transcript`；插件启用时隐藏 tencent 源 | P1-6 的「腾讯会议纪要」用例改两版（装 / 未装插件）；meeting 类目 4 → 2 |
| S6 排版工具结构化参数 | [设] | §2 #15 六个工具 `style` 对象参数；`doc_set_paragraph_format` 等老签名保留一版做别名 | format 类目 token 4.46k → ≤2.8k；真实模型矩阵「把第 2 段改成宋体小四首行缩进 2 字符」填参正确率 ≥ 基线（这是唯一可能换来准确率下降的 PR，不达标即回退） |
| S7 缺口 | [设] | `doc_compare`、`deadline_compute`、`insight` 适配器（挤进 P2-3）、`extract_file_text(section)` | 四条新回放用例 + `capability-catalog.md` 新行；`deadline_compute` 单测覆盖节假日顺延 |

真实模型对照统一用 `RealLlmSmokeTest` 的矩阵入口（`AI_EVAL_SMOKE_MODEL` 轮两款：一款国内通道、一款 OpenRouter），每次只跑该 PR 新增的句子集，结果写进 ai-chat.md 的实测表。

---

## 6. 需要负责人拍板的两件事

1. **Word 会话里常驻 `slide_create_file / sheet_create_file`**（dev-board#1570/#1572 的决定）是否可以改成「ppt / 表格 关键词预放回」？不改的话 S3 的 docx 目标从 ≤30 放宽到 ≤32。
2. S3 / S6 的验收要跑真实模型矩阵（2 模型 × 10 句 × 3 次 ≈ 60 次 × 2 个 PR），走平台 Key 约有一两百元级花费；是否接受，或改用 BYOK。

## 已拍板（2026-11-07）
1. Word 会话常驻的 `slide_create_file/sheet_create_file`（dev-board#1570）改为关键词预放回，前提是 S1 评测用例覆盖「转成 PPT / 做成表格」类说法且通过。
2. S3/S6 验收用平台 key 跑真实模型矩阵（约 120 次），矩阵取评测里已有的最便宜模型 + 一个主力模型。
