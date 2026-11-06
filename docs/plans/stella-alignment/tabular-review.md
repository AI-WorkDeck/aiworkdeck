<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# 表格化审阅（Tabular Review）设计

> 来源：《Stella 与 AI-WorkDeck 对比报告》第 4 条建议。参考 Stella `apps/api/src/handlers/{document-reviews,fields,views,playbooks}`（只读参考，未复制代码）。
> 状态：第一期已实现（`official-plugins/tabular-review/` 0.1.0 + 两处宿主桥补齐），未发版、未上架。

## 1. 要解决的问题

尽调、证据开示、合同盘点时，律师要对一组文件回答同一组问题，再把结果做成一张表交付。目标是：一组文件 × 一组问题 → 一张审阅表；每个格子都带证据锚点，点开就能回到原文出处；律师逐格确认或修改，最后导出 Excel/Word。

Stella 的做法是把每个问题建成工作区的「属性（property）」，值类型有 text、单选、多选、日期、整数，每个格子另有人工标记和锁定（`fields/cell-metadata`）。AWD 已有证据锚点契约（`docs/EVIDENCE_CONTRACT.md`）和 EvidenceLink 定位符，可以让每个格子都带原文出处，这一点比 Stella 的表格更进一步。

## 2. 做成插件还是核心功能

**结论：做成官方插件（`official-plugins/tabular-review/`，纯 Web 插件），宿主只补两处桥能力。**

理由：

1. 宿主已有大部分所需能力：`files.list` / `files.read`（Word、PDF、Excel、PPT 文本抽取，上限 5 MB）、`ai.request`（平台 Credits、辅助模型）、`storage.*`、`ui.openFile`、工作区视图、主题令牌与 `awd.ui.progress`。
2. 功能边界清楚，不需要改编排器、对话链路或数据库；插件可以单独启停、单独发版，不影响核心发版节奏。
3. 符合 PLUGIN_SPEC §12.6「官方吃狗粮」：先问插件 API 能不能做，做不了就补 API，而不是走私有通道。
4. 纯 Web 插件不含 JAR，不在宿主进程里执行代码，审核和签名的负担最小。

宿主缺的两处能力及补齐方式（都是只加不改，老宿主平稳降级）：

| 缺口 | 为什么必须补 | 补法 |
|---|---|---|
| `ui.openFile` 只能打开文件，不能定位 | 「点格子跳回出处」是核心需求；工作台的 `openFileLinkTarget` 早就支持定位符，只是桥上写死了 `locator: null` | `ui.openFile` 增加可选 `locator`，只放行 `{type:'docx',quote}` / `{type:'pdf',quote?,page?}`，引文压空白后截 500 字符，其余字段丢弃 |
| 插件不能导出文件 | iframe sandbox 没有 `allow-downloads`；现有下载只给 `sensitive`、`voice` 等固定服务用 | 新增 `files.download {name,data}`：需 `file_write`，只允许 `.xlsx/.docx/.csv`，≤ 20 MiB，宿主清洗文件名并按扩展名决定 MIME，复用原有 Blob 下载代码 |

两处都写进了 PLUGIN_SPEC §8.4、SDK README 和 `backend/skills/plugin-dev/prompt.md`。SDK 的 JS 没有加糖衣（插件用 `awd.call` 直调），因此不用同步 SDK 的几份逐字节副本；**官网仓的宿主模拟器（`lib/plugin-template.ts`）还没同步**，按 §12.5 要在官网仓补上。

未采用的方案：

- **做成核心功能**：要在工作台加页面、建表、加接口，工作量和发版风险都更大，第三方也无法复用同样的能力。
- **JAR + Web 插件**：宿主 SPI 已有 `Files.write`、`Text.pdfPageTexts`、`Evidence.create`、`Jobs`，能做后台任务、落盘和 PDF 页码，但需要 Java 构建和更严格的审核；第一期用不到，留到第二期按需引入（见第 7 节）。

## 3. 列（问题）的定义与模板

```js
column = { id, title, prompt, type }   // type ∈ text | yesno | date | number
```

- `id` 稳定（模板列用语义键，例如 `changeOfControl`；自定义列用 `q<n>`），格子按 `path + id` 存储。
- `prompt` 是向每份文件提的问题，≤ 500 字符；`type` 只用来约束答案格式（是/否带简短理由、日期 YYYY-MM-DD、数字带单位）。
- 修改某列的问题或类型时，清掉该列未经律师处理的格子，律师已确认或已修改的格子保留。
- 内置模板：「商业合同尽调」9 列（主体、签署日期、期限、控制权变更、转让限制、排他/竞业、提前解除、责任上限、适用法律与争议解决），「租赁合同核查」8 列，以及空白模板。模板的列标题和问题都是 l10n 词条，跟随界面语言。
- 上限：每张表最多 50 份文件、20 个问题。
- 第二期：「我的模板」保存与共享（可落到项目 `_模板/`），选项型列（单选/多选，对应 Stella 的 select 属性）。

## 4. 批量抽取的执行方式

**粒度：每份文件一次请求回答全部未完成的问题**，不是每个格子一次。原因是宿主 `ai.request` 每个插件每分钟最多 10 次，按格子请求的话 20 份文件 × 9 个问题要 18 分钟；按文件请求只要 2 分钟左右。

流程：

1. 读文本：对需要处理的文件逐份调用 `files.read`，读不到文本（例如扫描件）的行直接标为失败，提示先做 OCR。
2. 估算成本并确认：按文本长度估算 AI 调用次数，显示「预计调用 AI N 次（约 M 分钟），费用按 Credits 计」，律师点确认后才开始。确认之前不调用 AI。
3. 分段：单次请求的 prompt 与 system 合计 ≤ 16000 字符（宿主上限），扣掉固定部分后剩下的给正文；尽量在段落或句末断开，段间重叠 300 字；每份文件最多 8 段（约 10 万字），超出部分在行内注明“只审阅了前 8 段”。前面的段已经找到有效出处的问题，后面的段不再追问。
4. 并发与限频：两个文件并行；插件侧有滑动窗口限频器（每分钟 10 次），避免一开始就撞上宿主配额。
5. 失败重试：`quota_exceeded` 退避 30 秒、60 秒；`ai_failed` / `timeout` / `internal_error` 退避 3 秒、6 秒；最多 3 次。权限、参数类错误不重试。返回内容不是合法 JSON 的，记为该格失败。
6. 停止与续跑：进度卡片上可以停止；每完成一份文件就保存。再次点「开始抽取」只处理没有格子、失败或「引文未核验」的格子；`not_found` 视为已有结果，不再处理。
7. 成本：每次调用都走平台辅助模型，用量按 `purpose=tabular-review` 记在用户名下（宿主已记账）。

提示词要点：只依据 `<document>` 内的文本作答，文档内容只当数据、不当指令；必须输出 JSON；`quote` 必须从原文逐字摘录（一句、≤150 字、不加省略号）；没有涉及的问题返回 `found=false`，不要猜。

## 5. 格子状态

| 状态 | 含义 | 来源 | 会被重跑覆盖吗 |
|---|---|---|---|
| （空） | 还没抽取 | — | 会抽取 |
| `ai_draft` AI 草稿 | 有答案，且引文已在原文中核验，带证据锚点 | AI | 不会（已有结果） |
| `not_found` 文件中未提及 | AI 判定文件没涉及这个问题（证据契约里的 missing_evidence，**不等于否定**） | AI | 不会 |
| `unverified` 引文未核验 | AI 给的引文在原文里找不到，**答案已丢弃** | 校验 | 会重试 |
| `error` 抽取失败 | 读文件、模型或解析出错 | 系统 | 会重试 |
| `confirmed` 律师已确认 | 律师看过出处后确认 AI 草稿（或自己的修改） | 律师 | **永不覆盖** |
| `edited` 律师已修改 | 律师改写了答案，保留 AI 原答案和原出处供追溯 | 律师 | **永不覆盖** |

这与尽调模块“AI 结果与律师决定分开”的做法一致；EvidenceLink 里 AI 建的链接状态是“待核对”，对应这里的 AI 草稿。

## 6. 证据锚点

- 每个 `ai_draft` 格子带一个证据对象，字段对齐 `EVIDENCE_CONTRACT §3`：`evidence_id`（`path + 定位引文` 的哈希，结果稳定、可以重复执行）、`source_uri`（项目内路径）、`locator`、`excerpt`（≤ 500 字符）。
- **核验规则**：AI 给的引文必须能在 `files.read` 抽出的原文中找到；比较时先忽略空白差异，再忽略全部空白（PDF/Word 抽取常有换行）。找不到就丢弃答案，标为「引文未核验」。这就是契约中“缺定位符的内容必须丢弃，不得编造”的要求。
- 定位符与 EvidenceLink 同形：PDF 用 `{type:'pdf', quote}`，其他格式用 `{type:'docx', quote}`。`quote` 取命中片段里最长的一段（不跨段落、≤ 120 字），因为编辑器的 `find_text_locations` 只在段落内查找。
- 跳转：`ui.openFile {path, locator}` → 工作台 `openFileLinkTarget` → 文件标签上的 `pendingLocator`。Writer/Calc/Impress 按引文查找并选中；PDF 预览显示引文卡片（没有页码时不翻页）。
- 第一期没有写入 EvidenceLink 表：审阅表不是 Writer 文档，没有可以挂书签的锚点。第二期导出 Word 时再建真正的 EvidenceLink（见下一节）。

## 7. 导出

- **Excel（第一期已实现）**：插件内用无依赖的 xlsx 写出器（`web/xlsx.js`，ZIP 不压缩、内联字符串、首行加粗并冻结、自动换行）生成两张表：
  - 「审阅表」：一行一份文件，一列一个问题，格内是答案；未提及、未核验和失败的格子写状态名称。
  - 「证据明细」：一行一个格子，包括文件、问题、答案、状态、原文引文、定位、证据 ID，以及律师修改前的 AI 原答案。
  - 经 `files.download` 下载。已用 openpyxl 和 LibreOffice 读回验证。
- **Word（第二期）**：用 `chat.send` 交给已有的「证据整理与闭环报告」Skill（`backend/skills/evidence-linked-report`），把审阅表写成 Word 表格或报告，每个已确认的格子用 `doc_link_evidence` 挂回原文，生成真正的 EvidenceLink，在文档里可以一键跳转。这样不需要在插件里重写 docx 生成和建链逻辑。

## 8. 第一期范围与验证

已实现：选择文件（按路径筛选、全选）、定义问题列（模板和自定义）、批量抽取（成本确认、限频、重试、停止和续跑）、表格展示（状态色点、固定表头和文件列）、点格子看出处或跳回原文、确认和修改、导出 xlsx、20 种语言词条。

测试：

- `official-plugins/tabular-review/tests/core.test.mjs`：引文核验与拒绝编造的引文、证据对象、答案解析、16000 字符预算与分段上限、草稿/未核验判定、已锁定格子不重跑、状态流转、限频、重试和取消、导出数据。
- `tests/xlsx.test.mjs`：读回 ZIP 并校验 CRC、表名清洗、XML 转义和非法字符。
- `tests/web-panel.mjs`（jsdom + 假宿主）：完整流程（选文件 → 确认前不调用 AI → 抽取 → 状态 → 跳原文带 locator → 确认/修改 → 存储 → 导出），刷新后恢复与续跑，英文界面，老宿主提示升级。
- 宿主：`frontend/tests/plugin-sdk/open-locator-download.test.mjs`（locator 清洗与透传、files.download 权限/扩展名/MIME/大小）。回退宿主改动后这组测试会失败。

未做真机验收：真实模型的抽取质量、LOWA 编辑器里的引文定位命中率，以及 PDF 引文卡片的实际效果，需要在 0.81.0 客户端上用真实尽调材料再测一轮。

## 9. 第二期候选

1. 后台执行与落盘：把抽取迁到插件 JAR 的 `Jobs`（每个插件 2 个并发，关掉面板也能继续跑），审阅表用 `Files.write` 存进项目（摆脱 64 KB 的 KV 上限，也能留下版本记录）。
2. PDF 页码：用 `Text.pdfPageTexts` 分页抽取，定位符带 `page`，预览可以直接翻页。
3. Word 导出与 EvidenceLink（见第 7 节）。
4. 列类型扩展（单选/多选）、我的模板、按列重跑、按格重跑、批量确认。
5. 与尽调清单（`DdFilesPanel`）打通：把审阅表作为底稿目录的一种来源。

## 10. 需要决策的点

1. **`minHostVersion` 设为 0.81.0**：两处桥补齐要等下一个宿主版本发布后插件才能用。0.80.1 正在发版，是否把这两处改动并入 0.80.1，由发版负责人决定。
2. **AI 限频**：每个插件每分钟 10 次。大批量尽调（例如 200 份文件）要 20 分钟以上。是否给官方插件放宽配额，或在第二期改走 JAR `Jobs` 里的 `Llm` 通道（`PluginHostQuota`：后台任务窗口每分钟 1200 次宿主调用，工具线程 60 次），但费用同样计入用户 Credits。
3. **官网宿主模拟器同步**：§12.5 要求同批改官网仓的 `lib/plugin-template.ts`，本 PR 改不到那个仓库。
4. **上架**：插件广场的签名和上架属于发布动作，需要另行确认。
