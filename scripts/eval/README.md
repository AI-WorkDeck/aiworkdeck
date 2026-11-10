<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# 真实模型 A/B 矩阵（model-matrix）

对比两个 git ref 在若干真实模型、一组句子上的 Agent 行为（首工具、必用/禁用工具、最终状态、tokens、轮数、耗时）。
原先「17 句 × 2 模型 × 2 分支」靠无头浏览器串行 + 90 秒静默等待，6–10 小时；本工具直连后端 HTTP/SSE，
实例并行、以 `bubble_end` 事件判定本轮结束，没有固定静默等待。

## 用法

```bash
export OPENROUTER_API_KEY=...        # 只从环境读取，只传给后端子进程，不打印、不落盘
node scripts/eval/model-matrix.mjs \
  --before origin/master --after feat/my-branch \
  --models deepseek/deepseek-v4-flash,qwen/qwen3.8-max-0902 \
  --sentences scripts/eval/sentences/core-17.json \
  --runs 3 --concurrency 4
```

| 参数 | 说明 |
|---|---|
| `--before/--after` | git ref。各自在临时 worktree 里 `mvn package`（同一 ref 只建一次） |
| `--models` | 逗号分隔的 OpenRouter 模型 id，随请求的 `model` 字段下发 |
| `--sentences` | 句子集 JSON（见下） |
| `--runs N` | 每句重复次数（默认 1） |
| `--concurrency K` | 同时启动的后端实例数（默认 4）；启动完成后各实例并行跑题 |
| `--profile cn\|intl` | 站点/语言档位（默认 `cn`）。`cn`：界面语言 zh-CN（`system_prompt.md` + 中文 LangText），账户站点保持默认 aiworkdeck.com；`intl`：界面语言 en-US（`system_prompt.en.md` + 英文 LangText），实例设 `AI_ACCOUNT_BASE_URL=https://www.workdeck.ai`（`OfficialCloudEndpoint.isInternationalSite` 按主机判定的就是它）。语言经请求体 `appLanguage` + `X-App-Language` 头下发，编辑器句子经浏览器 `checkba_app_language` |
| `--tier cheap\|release` | 默认模型档（默认 `cheap`）。cn cheap = `deepseek/deepseek-v4-flash` + `qwen/qwen3.7-flash`；intl cheap = `google/gemini-3.6-flash` + `anthropic/claude-haiku-4.5`；`release` 在 cheap 之上再加 cn：`qwen/qwen3.8-max-0902`、`deepseek/deepseek-v4-pro`，intl：`anthropic/claude-sonnet-5`、`openai/gpt-5.6-terra`。`--models` 显式给出时覆盖 |
| `--sentences` 缺省 | cn → `sentences/gate-35.json`，intl → `sentences/gate-35-en.json` |
| `--only id1,id2` | 只跑指定句子 |
| `--api-only` | 跳过需要编辑器的句子（标 `SKIPPED`），也不构建前端、不启动浏览器 |
| `--lowa-dir 目录` | LOWA 运行时缓存目录（默认 `~/.cache/awd-matrix/lowa`） |
| `--run-timeout 秒` | 单句硬上限（默认 300），超时会取消并记 `timeout` |
| `--keep` | 保留临时目录（worktree、库、后端 home）以便排查 |

需要：JDK 21（自动找 `/usr/libexec/java_home -v 21`，或设 `JAVA_HOME`）、Maven、PostgreSQL 17 二进制
（`PG_BIN` 或 Homebrew 默认路径）、Node 20+/npm（编辑器句子需要）。

## 隔离方式

- 脚本在临时目录里 `initdb` 一个**自己的** PostgreSQL 集群（随机端口、`fsync=off`），不碰任何已在运行的库或 9696/5173。
- 每个 ref×模型一个后端实例：独立数据库、随机端口、独立 `user.home`/存储/插件目录，server 模式（`SECURITY_LOCAL_MODE=false`，
  `AI_MOCK_ENABLED=false`），供应商 OpenRouter。每个实例注册一个测试用户。
- 每次运行前清空记忆表、把此前运行留下的项目改名为 `zz-prev-<id>`（防同名项目互相污染），并新建一个全新项目再按 `seed` 灌入数据；同一实例内串行，实例之间并行。
- 唯一出站请求是后端对 OpenRouter 的模型调用；脚本本身不发任何外网请求。

## 句子集 schema

```jsonc
{ "sentences": [{
  "id": "s08-move-to-archive",
  "text": "把合同.docx移到归档文件夹",
  "hostState": "nofile",            // nofile | docx:<夹具>（xlsx/pptx/attachments 暂不支持，SKIPPED）
  "requiresPlugin": "desensitize",  // 可选：实例 plugins/ 里没有该插件时整句 SKIPPED（报告里写明原因）
  "seed": {
    "projectName": "星河科技买卖合同纠纷",        // 可选：当前项目名（默认 matrix-<id>-<时间>）
    "otherProjects": [{ "name": "星河科技劳动争议", "tasks": [{ "title": "x", "dueInDays": 3 }] }], // 可选：同一用户名下的其它项目
    "folders": ["归档"],
    "files": [{ "name": "合同.docx", "fixture": "contract.docx", "folder": "归档" /* 可选 */ }],
    "tasks": [{ "title": "提交答辩状", "dueInDays": 1 }],
    "memory": [{ "key": "客户偏好", "content": "客户偏好周五开会", "type": "preference", "scope": "user" }]
  },
  "expect": {
    "firstToolAnyOf": ["move_files"],            // 第一个工具须命中其一；"<none>" 表示允许不调工具；"/正则/" 也可
    "mustUse": [["move_files", "move_project_file"]],  // 每个子数组是「任一」，各组都要满足
    "mustNotUse": ["move_to_trash"],
    "status": "awaiting_input",                   // 可选：本轮须以此状态结束（确认卡/反问 = awaiting_input，正常结束 = finished）
    "maxRounds": 10,                              // 可选：轮数上限，防编辑器句子空转循环
    "finalTextIncludes": ["沟通记录"],           // 可选：最终回复须包含
    "outcomeCheck": "const f = await ctx.files(); return f.some(x => x.name==='合同.docx');"  // 可选：JS 函数体
  }
}]}
```

`outcomeCheck` 是 async 函数体，参数 `ctx`：`files()`、`tasks()`、`memory()`（查库返回行数组）、`rows(sql)`、`sql(sql)`、
`api(method,url,body)`（以测试用户身份调后端）、`tools`、`finalText`、`projectId`。句子文件是受信的本地文件，会被 `eval` 执行。
一次运行「通过」= 本轮正常结束（`bubble_end` 且 status=finished）且所有已声明的检查都为真。

夹具在 `fixtures/`（虚构内容），由 `python3 fixtures/make_fixtures.py` 生成：`contract.docx`（第三条/甲方/违约金/仲裁）、
`contract-tracked.docx`（含修订）、`contract-draft.docx`、`mention-zhangsan.docx`、`plain-notes.docx`；gate-35 另有 `opinion.docx`（引用了两处法条，第二处张冠李戴）。

## 编辑器句子（docx 宿主）

`doc_*` 编辑原语经 `client_action` 走**页面自己的 SSE 会话**桥到前端 LOWA 执行，纯 API 客户端接不住，所以 `hostState` 为 `docx:<夹具>`
的句子由 Playwright 自带 Chromium（headless，不用系统 Chrome）驱动：

1. 每个 ref 额外构建一次 H5（`uni build`，API 地址为占位符）和 zetaoffice 胶水（`build:zetaoffice`），LOWA 运行时与 CJK 字体从
   `~/.cache/awd-matrix/lowa`（`--lowa-dir` 可改）拷入，缓存缺失时用 `desktop/scripts/fetch-lowa-assets.js` 拉一次并回填。
2. 每个后端实例一个进程内静态服务：带 COOP/COEP，回放 `.encodings.json` 的 Content-Encoding，并把占位符替换成该实例后端地址。
   页面只允许访问本机请求，对 9696 一律拦截；`/api/desktop/startup-health` 回 404（纯浏览器没有桌面壳，让本地内容协议回退到普通下载）。
3. 每次运行：新建项目并上传夹具 → 打开项目页并点开 `合同.docx` → 等编辑器就绪（状态栏出现已保存状态且引擎启动文案消失）→ 在聊天框发送；
   会话 id 取自页面发出的 `/api/agent/chat` 请求，**结束判据是后端日志 `Agent Loop Finished for <conv>`**，不是静默等待。
4. Playwright 首次使用时装到 `~/.cache/awd-matrix/pw`（首次约 2–3 分钟，含浏览器下载）。

`--api-only` 跳过这类句子（标 `SKIPPED`）；xlsx/pptx/attachments 宿主暂不支持，也标 `SKIPPED`。

## 产物

`scripts/eval/out/<时间戳>/`（已 gitignore）：`results.json`（每次运行的工具序列、轮数、每轮提供的工具数、tokens、耗时、
检查结果、最终回复、SSE 事件计数）、`report.md`（汇总 + 逐句对比 + 未通过明细 + 结论行
`AFTER ≥ BEFORE on correctness for all models: yes/no`）、各实例后端日志 `backend-*.log`。

tokens 来自后端 `token_usage` 表（按会话汇总，含 `cached_tokens` / `cache_write_tokens`，旧 ref 没有这两列时缓存数记 0）；报告里 **计费等价 = 提示词 tokens − 0.9·缓存命中 tokens**（假设缓存读按输入价 0.1x，忽略缓存写溢价与输出价差，代理指标非账单）；**工具集变化轮数** = 与上一轮下发工具名集合不同的轮数，来自 `[Round]` 日志的 `toolsHash`（旧 ref 无此项记 `-`）；轮数与每轮提供的工具数来自后端 `[Round]` 日志，工具序列来自编排器日志。

## 句子集清单

- `sentences/core-17.json`：核心 17 句（读/找/改/批注/法条/记忆/新建）。V4 起期望里合并后的新名与旧名并列，可对拍合并前后两个 ref。
- `sentences/v4-merged.json`：tool-system-v2 V4 合并工具专用 6 句（接受/拒绝修订、回复批注、表格插行、PDF 删页/抽页），夹具 `contract-commented.docx` / `contract-table.docx` / `dossier-24p.pdf`（`python3 fixtures/make_fixtures.py` 生成）。
- `sentences/v5-meetings.json`：tool-system-v2 V5 会议合流专用 5 句（只看腾讯会议清单、整理纪要不指明来源、上周会议录音、昨天的逐字稿）。种子支持 `meetings`（写 `meeting_recording`）与 `tencentMeetings`（写内置同步表 `tencent_meeting_record`），都是虚构数据、`dayOffset` 相对今天；实例没有腾讯会议插件，tencent 来源走内置表，**绝不碰真实 tmeet 账号**。
- `sentences/v7-compare.json`：tool-system-v2 V7 D1 两份 docx 比对专用 5 句（c01–c03 摘要，API 模式即可；c04–c05 编辑器宿主的修订对比稿，校验新 .docx 含 w:ins/w:del 且原件 sha256 不变），夹具 `compare-v1.docx` / `compare-v2.docx`（第三条付款期限、第五条违约金、新增第七条保密，第二条仅空白差异）；outcomeCheck 要求调用过 compare_docx_summary、回复点出三处改动、原件仍在且没有产生新文件（回复文本含工具输出，所以不做「不得提及未改动条款」的反向断言）。

- `sentences/gate-35.json`：**回归门禁集 35 句** = core-17（原样）+ 18 个新句 g01–g18，覆盖真实律师工作流：合同审查加批注（g01）、条款插入（g02）、跨文件检索+概括（g03）、法条核对（g04，法宝在矩阵里不可用，接受「无法核实」路径，只要点出第 1082 条张冠李戴）、期限推算（g05，上诉期 2026-11-17）、同名项目歧义必须反问（g06）与点名项目不得反问且事项落在正确项目（g07）、会议录音清单（g08）、脱敏（g09，`requiresPlugin: desensitize`，实例没装就整句 SKIPPED）、删除文件夹走确认卡 `awaiting_input` 且文件夹仍在（g10）、表格改单元格（g11）、拒绝一处其余接受（g12）、记忆召回（g13）、指代不明该反问（g14）与信息已足不该反问（g15）、测试中出现过循环的「删除第三条」（g16，`maxRounds: 10`）、两句英文（g17 概括仲裁条款、g18 英文建提醒）。接受/拒绝全部修订、导出 PDF 已由 core-17 的 s06/s05/s16 覆盖；V4 的单条接受/拒绝、表格删行等在 `v4-merged.json`，不重复收进门禁。
- `sentences/gate-35-en.json`：同一组期望与工具的**英文版**（`--profile intl` 默认）。夹具共用（内容仍是中国法下的虚构中文合同），文件/项目/文件夹名换成英文孪生名（`Contract.docx`、`Archive`、`Evidence`…），编辑器句子的宿主文件用 `hostFile: Contract.docx`；g17 额外检查回答是英文。cn 档位系统提示是中文，英文提问得到中文回答是产品现状，所以 gate-35 的 g17 只查内容。

## 门禁用法与策略

- **日常 PR 门禁**：cn + intl 两个 profile 的 **cheap 档、每句 3 次**：
  ```bash
  node scripts/eval/model-matrix.mjs --before origin/master --after <分支> --profile cn   --tier cheap --runs 3 --concurrency 4
  node scripts/eval/model-matrix.mjs --before origin/master --after <分支> --profile intl --tier cheap --runs 3 --concurrency 4
  ```
  便宜模型过了，贵模型理应也过；所以贵模型只在发版前抽检。
- **发版门禁**：在 cheap 之上加 `--tier release`（贵模型），**每句 2 次**。
- 报告末尾有「门禁汇总」：逐句中位数（轮数、计费等价 token、缓存命中率）、通过率、**四处看看率**（第一个工具是清单/目录类工具且不在 `firstToolAnyOf` 里）、`todo_write` 次数、`ask_user` 率；判定规则 **AFTER 的通过句数当量 ≥ BEFORE − 1** 才算该模型通过；**回退清单** = 同句同模型 AFTER 比 BEFORE 少通过 ≥2 次（`--runs 1` 时不适用）。最后有成本与耗时估算。
- 供应商瞬时故障（空响应流、第 1 轮即卡死、编辑器超时）自动重跑最多 2 次（`infraRetries`）；OpenRouter 对某模型连续 3 次 403（地域/条款）则该实例剩余句子整体 SKIPPED 并写明原因。模型流报错（`Stream error`）会立即结束本轮，不再空等 300 秒。
- 同一 ref 当 before 和 after 跑 1 次，句数当量也会差 1–2 句（纯噪声），所以 1 次的结果只用来校准，门禁必须 ≥3 次。

## 校准记录（2026-11-10，before = after = origin/master `3c60d3ad7`，`--runs 1`）

句子、期望与工具对照真实行为校准过；下面是 master 上**真实存在**的失败，期望一律保持正确行为，不迁就。

**cn（deepseek-v4-flash + qwen3.7-flash）**
- `s14-delete-to-recycle-bin`（core-17）原先 4/4 失败：期望文件已进回收站，但 master 的确认卡闸门（#1442）让 `move_to_trash` 停在 `awaiting_input`。**已修正（见下方变更记录）**，不再是已知失败。
- `g16-delete-third-clause`：编辑器里「删除第三条」仍会空转（deepseek 一次 29 轮、qwen 13 轮；另一次 7 轮通过），属真实循环。`g02-insert-clause`（qwen 22 轮）、`s17-four-step`（qwen 15 轮后漏接受修订）同类。
- qwen3.7-flash 偏弱：`g18`（只 `list_tools`→`task_list`，没建事项）、`g14`（指代不明没反问）、`g15`/`s08`（没完成移动）。
- DeepSeek 经 OpenRouter 约 10% 的运行返回空响应流，已由自动重跑吸收；不重跑时这些会算成失败。
- g17（英文句）在 cn 档位里模型用中文回答，只查内容；回答语言检查在 en 句集。

**intl（因 Google/Anthropic/OpenAI 在本机对该 Key 返回 403，改用 deepseek-v4-flash + qwen3.7-flash 走英文提示词校准；见下）**
- 英文提示词下**工具可见性明显更差**：`s06`、`s10`、`g06`、`g07`、`g12` 的第一个工具是 `list_tools` / `query_memory`（先找工具再干活，多 1–3 轮）；qwen 在 `g06` 里明说「工具清单里没有 task_create」、`s10` 没调到 `task_list`、`g18` 一次零工具。中文同句均直接命中。这是 intl 站的真实缺陷，不是期望问题。
- `g05-deadline-appeal`（英文）23 轮在 `law_search` 上打转到超时（法宝不可用时的外部检索循环，评审 §4 的 source-down 问题）；中文版 6 轮内答出。
- `s14`、`g16` 同 cn。
- 校准中改过的期望（属句子写得不对，不是迁就缺陷）：英文 s09 原写 “Zhang San” 在中文文档里搜不到，改为「张三 (Zhang San)」；英文 g05 原句没说明法域，模型合理反问，改为 “A PRC first-instance civil judgment …”。

## 本机已知限制与耗时/成本估算

- **本机对 OpenRouter 的 Google / Anthropic / OpenAI 模型返回 403（`The request is prohibited due to a violation of provider Terms Of Service`）**（DeepSeek、Qwen 正常），所以 intl cheap 档（gemini-3.6-flash、claude-haiku-4.5）在本机无法实跑；`--profile intl` 的流程、英文提示词与英文句集已用 DeepSeek/Qwen 实跑验证。在能访问这些模型的机器上跑 intl cheap 档前，先确认 403 已消失（脚本连续 3 次 403 会自动 SKIPPED 并写明原因）。
- 耗时（4 个实例并行、同实例串行；35 句 × 2 侧 × 2 模型）：cn 每句 1 次墙钟 ≈ 20 min（其中跑题 17.8 min），外推每句 3 次 ≈ **53 min + 构建启动 2 min**；intl（deepseek/qwen 实测）每句 1 次跑题 15.2 min，外推 3 次 ≈ **46 min**。编辑器句子（15 句）与循环句占大头；每个卡死的运行最多吃 `--run-timeout`（默认 300 s）。
- 成本（每句 3 次、before+after 两侧，OpenRouter 标价，按实测 token：每次运行均值约 7.1 万提示词 tokens（其中约 4.8 万缓存命中）+ 约 700 补全 tokens）：

  | 模型 | 缓存按实测 | 完全无缓存（上限） |
  |---|---|---|
  | deepseek-v4-flash | $0.67 | $1.38 |
  | qwen3.7-flash | $0.27 | $0.47 |
  | **cn cheap 合计（实测）** | **≈ $0.94** | ≈ $1.85 |
  | gemini-3.6-flash（按 deepseek/qwen 的 token 外推） | ≈ $5.0 | ≈ $11.5 |
  | claude-haiku-4.5（同上；Anthropic 缓存需显式断点，实际可能更接近无缓存） | ≈ $6.7 | ≈ $15.4 |
  | **intl cheap 合计（外推）** | **≈ $11.7** | ≈ $27 |
  | release 加量（cn）：qwen3.8-max / deepseek-v4-pro | ≈ $13.2 / $5.8（3 次），发版 2 次再 ×2/3 | $31 / $14.7 |
  | release 加量（intl）：claude-sonnet-5 / gpt-5.6-terra | ≈ $13.3 / $13.6（3 次），发版 2 次再 ×2/3 | $31.6 / $31.9 |

  外推值不含各家 tokenizer 差异、不含辅助模型（起标题/记忆抽取）与重试，仅作量级参考；`report.md` 末尾「成本与耗时估算」按实测自动给出本次所跑模型的数字。

## 变更记录

- 2026-11-10：core-17 / gate-35 / gate-35-en 的 `s14-delete-to-recycle-bin` 改为期望 `status: awaiting_input` 且文件仍在（#1442 起删除先走确认卡，与 g10 同模式）；这是 core-17 唯一一次期望变更，之前的矩阵结果里 s14 不可与之后对比。
