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
| `--route openrouter\|bailian` | 模型走哪条线（默认 `openrouter`，行为不变）。`bailian` 直连阿里云百炼（国内用户的生产路径），见下节「百炼路由」 |
| `--tier cheap\|release` | 默认模型档（默认 `cheap`）。cn cheap = `deepseek/deepseek-v4-flash` + `qwen/qwen3.7-flash`；intl cheap = `google/gemini-3.6-flash` + `anthropic/claude-haiku-4.5`；`release` 在 cheap 之上再加 cn：`qwen/qwen3.8-max-0902`、`deepseek/deepseek-v4-pro`，intl：`anthropic/claude-sonnet-5`、`openai/gpt-5.6-terra`。`--models` 显式给出时覆盖 |
| `--sentences` 缺省 | cn → `sentences/gate-35.json`，intl → `sentences/gate-35-en.json` |
| `--only id1,id2` | 只跑指定句子 |
| `--api-only` | 跳过需要编辑器的句子（标 `SKIPPED`），也不构建前端、不启动浏览器 |
| `--lowa-dir 目录` | LOWA 运行时缓存目录（默认 `~/.cache/awd-matrix/lowa`） |
| `--run-timeout 秒` | 单句硬上限（默认 300），超时会取消并记 `timeout` |
| `--rescore 目录` | 离线重判已有产物（`results.json` + `backend-*.log`），不调模型、不需要密钥：按当前判分逻辑与当前句集（默认取产物 `meta.profile` 对应的句集，可用 `--sentences` 覆盖）重算，写 `results-rescored.json` / `report-rescored.md` 并打印翻转清单。工具序列与过程指标从后端日志重新解析；`outcomeCheck`（要查库/下载产物）与被旧版截成 1500 字的 `finalText` 检查沿用旧结果，不冒充已验证 |
| `--keep` | 保留临时目录（worktree、库、后端 home）以便排查 |

需要：JDK 21（自动找 `/usr/libexec/java_home -v 21`，或设 `JAVA_HOME`）、Maven、PostgreSQL 17 二进制
（`PG_BIN` 或 Homebrew 默认路径）、Node 20+/npm（编辑器句子需要）。

## 百炼路由（`--route bailian`）

OpenRouter 上的 qwen 经常被上游 429（2026-11-11 当天 cn 矩阵里 qwen3.7-flash 有七成运行记为基础设施故障），
而国内用户的生产路径本来就是百炼。用法：

```bash
set -a; . ~/.local/share/aiworkdeck-ops/credentials/bailian-cn.env; set +a   # 提供 DASHSCOPE_API_KEY、BAILIAN_BASE_URL（compatible-mode/v1）
node scripts/eval/model-matrix.mjs --before origin/master --after feat/x --route bailian --profile cn --tier cheap
```

做法（不改后端代码）：后端实例照常跑 BYOK OpenRouter 档，模型 id 仍是白名单里的 OpenRouter id（能力判定、辅助模型、
failover 与 openrouter 路由同口径），只用 `-Dai.model.open-router.base-url` 把地址指到脚本进程里的本机转发口。
转发口把 `model` 换成百炼 id、按官网平台网关（`lib/platform-ai/proxy.ts` 的 `validateChat`）的口径收敛请求体
（丢掉 `provider`、`reasoning` 等 OpenRouter 专有字段，`enable_thinking` 显式置 false，流式带 `include_usage`），
再带 `DASHSCOPE_API_KEY` 发往 `BAILIAN_BASE_URL`。后端子进程只拿到占位 key，百炼密钥不进子进程环境与后端日志；
产物照样做密钥兜底替换。报告头写明路由与映射，并多一节「百炼上游响应」（转发口按模型×HTTP 状态计数，含后端自己的重试）。

| 矩阵模型 id | 百炼 id | 百炼标价（元 / 1M：输入 / 输出 / 缓存命中） |
|---|---|---|
| `deepseek/deepseek-v4-flash` | `deepseek-v4.1-flash-1017`（生产平台通道用的 DeepSeek Flash） | 2 / 8 / 0.04（高峰档；00:00–08:00、22:00 后低谷 1 / 4 / 0.02） |
| `qwen/qwen3.7-flash` | `qwen3.7-flash`（同名模型；生产辅助模型已迁到 `qwen3.8-flash`） | 0.2 / 0.8 / 0.04（单次输入 ≤32k 档；32k–256k 为 0.6 / 2.4 / 0.12） |
| `qwen/qwen3.8-max-0902`（release） | `qwen3.8-max-0902` | 12 / 36 / 1.5 |
| `deepseek/deepseek-v4-pro`（release） | `deepseek-v4-pro-0813`（生产所用） | 9 / 27 / 0.9（高峰档） |

价格 2026-11-11 取自 DashScope `/api/v1/models`；报告里的成本估算按上表以人民币计（DeepSeek 按高峰档，偏保守）。
没有映射的模型（含 intl 档）直接报错退出——白名单外的 id 会被后端回落成默认模型，结果会张冠李戴。

验证（2026-11-11，before = after = origin/master `ab7353c98`，cn cheap，s01/s12/g02 × `--runs 2`）：24 次运行 0 次基础设施故障
（1 次 qwen 空响应流自动重跑后通过），转发口 147 次上游请求全部 200、0 次 429；同日 OpenRouter 路由的 cn 矩阵里
qwen3.7-flash 240 次运行有 171 次（71%）记为基础设施故障、deepseek-v4-flash 9/240（4%）。qwen 在 s01 上 3/4 次只输出思考文字不调工具，
是模型行为不是故障（OpenRouter 路由同句也常见）。

## 隔离方式

- 脚本在临时目录里 `initdb` 一个**自己的** PostgreSQL 集群（随机端口、`fsync=off`），不碰任何已在运行的库或 9696/5173。
- 每个 ref×模型一个后端实例：独立数据库、随机端口、独立 `user.home`/存储/插件目录，server 模式（`SECURITY_LOCAL_MODE=false`，
  `AI_MOCK_ENABLED=false`），供应商 OpenRouter。每个实例注册一个测试用户。
- 每次运行前清空记忆表、把此前运行留下的项目改名为 `zz-prev-<id>`（防同名项目互相污染），并新建一个全新项目再按 `seed` 灌入数据；同一实例内串行，实例之间并行。
- 唯一出站请求是后端对 OpenRouter 的模型调用；脚本本身不发任何外网请求（`--route bailian` 时例外：模型调用改由脚本的本机转发口发往百炼）。

## 句子集 schema

```jsonc
{ "sentences": [{
  "id": "s08-move-to-archive",
  "text": "把合同.docx移到归档文件夹",
  "hostState": "nofile",            // nofile | docx:<夹具>（xlsx/pptx/attachments 暂不支持，SKIPPED）
  "requiresPlugin": "desensitize",  // 可选：实例 plugins/ 里没有该插件时整句 SKIPPED（报告里写明原因）
  "task": true,                     // 可选：多步任务（只按结果判分），报告里单列「多步任务」表
  "followUps": [{ "whenStatus": "awaiting_input", "text": "执行" }], // 可选，仅 API 句：本轮以 whenStatus 结束时在同一会话里再发一条（按顺序、每条最多一次）；上一轮停在 ask_user 卡（确认卡/反问卡）时按卡片回答「Selected: - 执行」，否则作为普通消息
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
`api(method,url,body)`（以测试用户身份调后端；文件正文用 `GET /api/files/<id>/text`，PDF 也行）、`tools`、`calls`（`[{name,args}]`，后端日志里的调用参数）、`finalText`（多轮时是最后一轮的回复）、`projectId`、
`bytes(id)`、`sha256(buf)`、`fixtureSha256(name)`、`docxXml(buf, part='word/document.xml')`（part 可取 `word/comments.xml`、`word/styles.xml`，缺部件时抛错）。句子文件是受信的本地文件，会被 `eval` 执行。
判分规则（P0 起）：
- `finalTextIncludes` 与 `outcomeCheck` 都用最终回复**全文**（`results.json` 的 `finalText` 现在存全文；旧产物是 1500 字截断）。
- 文本 `<question>` 停问（后端日志 `Detected <question> for <会话>`）等同调用了 `ask_user`：补进 `tools` 末尾，`askedByText=true`。
- 供应商/基础设施故障（限流 429、`AI_QUOTA_EXHAUSTED`、空流、地域 403、`harness_error`）不是模型行为：**不进通过率分母、门禁判定和回退清单**，在报告「基础设施故障」一节单列，逐次运行表里标 `INFRA`。后端自己的 `error` 仍算失败。
- 每次运行新增过程指标（不参与判定，报告「过程指标」一节汇总）：`xmlTurns` / `nativeTurns`（每个 `[Round]` 回合走 XML 文本调用还是原生调用）、`verifyAfterWrite`（最后一次写操作之后是否读过；没写过记 null）、`maxSameTool`（同一工具最多被调用几次）。

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

## 在 GitHub 上跑（intl 模型只能在这里跑）

本机对 OpenRouter 的 Google / Anthropic / OpenAI 模型返回 403，所以 intl 档位走 `.github/workflows/model-matrix.yml`（手动触发，GitHub 美国 runner，ubuntu-latest，超时 150 分钟，同时只允许一个矩阵在跑）：

```bash
gh workflow run model-matrix.yml -f profile=intl -f after=<分支>
# 可选：-f tier=release -f before=master -f runs=3 -f sentences=scripts/eval/sentences/gate-35-en.json -f models=a/b,c/d
```

- workflow 只能从默认分支触发（新文件合并到 master 之后才可用）；脚本取 master 上的版本，`before/after` 是要对比的 ref（分支/tag/SHA，分支名按 `origin/<名>` 解析）。
- 密钥为仓库 secret `EVAL_OPENROUTER_API_KEY`，只注入「Run model matrix」一步的环境变量 `OPENROUTER_API_KEY`；脚本结束时会把产物目录里出现的密钥原文替换为 `***` 再上传。权限仅 `contents: read`。
- 步骤：JDK 21、Node 20、PostgreSQL 17（PGDG apt，脚本在 `/usr/lib/postgresql/17/bin` 找到 `initdb`）、Playwright Chromium（含系统依赖；`~/.cache/awd-matrix`、`~/.cache/ms-playwright` 走 actions/cache）、LOWA 运行时（缓存缺失时按 desktop-build 同一个 `LOWA_BASE_URL` 经 `fetch-lowa-assets.js` 拉取）。
- 产物：`report.md` 写入作业摘要；`scripts/eval/out/**`（report.md、results.json、backend-*.log）作为 artifact `model-matrix-<profile>-<tier>` 保留 30 天。
- 费用：intl cheap 门禁（每句 3 次、before+after）约 **$12**，会产生真实模型费用，所以没有任何自动触发。耗时约 1 小时到 1.5 小时。

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

- `sentences/tasks-10.json`：**多步任务集**（agent-tier1-gap P6）：10 个 ≥3 步的律师任务，**只按结果判分**（不设 `firstToolAnyOf` / `mustUse`，走哪条工具路径都行），每题有 `maxRounds`，句子带 `task: true`，报告里单列「多步任务」表。详见下方「多步任务集 tasks-10」。
- `sentences/gate-35.json`：**回归门禁集 35 句** = core-17（原样）+ 18 个新句 g01–g18，覆盖真实律师工作流：合同审查加批注（g01）、条款插入（g02）、跨文件检索+概括（g03）、法条核对（g04，法宝在矩阵里不可用，接受「无法核实」路径，只要点出第 1082 条张冠李戴）、期限推算（g05，上诉期 2026-11-17）、同名项目歧义必须反问（g06）与点名项目不得反问且事项落在正确项目（g07）、会议录音清单（g08）、脱敏（g09，`requiresPlugin: desensitize`，实例没装就整句 SKIPPED）、删除文件夹走确认卡 `awaiting_input` 且文件夹仍在（g10）、表格改单元格（g11）、拒绝一处其余接受（g12）、记忆召回（g13）、指代不明该反问（g14）与信息已足不该反问（g15）、测试中出现过循环的「删除第三条」（g16，`maxRounds: 10`）、两句英文（g17 概括仲裁条款、g18 英文建提醒）。接受/拒绝全部修订、导出 PDF 已由 core-17 的 s06/s05/s16 覆盖；V4 的单条接受/拒绝、表格删行等在 `v4-merged.json`，不重复收进门禁。
- `sentences/gate-35-en.json`：同一组期望与工具的**英文版**（`--profile intl` 默认）。夹具共用（内容仍是中国法下的虚构中文合同），文件/项目/文件夹名换成英文孪生名（`Contract.docx`、`Archive`、`Evidence`…），编辑器句子的宿主文件用 `hostFile: Contract.docx`；g17 额外检查回答是英文。cn 档位系统提示是中文，英文提问得到中文回答是产品现状，所以 gate-35 的 g17 只查内容。

## 多步任务集 tasks-10（P6）

| 任务 | 宿主 | 步骤 | 结果判据（outcomeCheck） | maxRounds |
|---|---|---|---|---|
| t01-four-step-explicit | docx:contract-tracked | 改第三条措辞 → 第四条加批注 → 接受所有修订 → 导出 PDF | 合同.docx 无 `<w:ins>/<w:del>`；第三条含新措辞且 15 日已接受；第四条挂批注、`comments.xml` 含「客户确认」；PDF 正文（`/api/files/<id>/text`）含新措辞 | 16 |
| t02-penalty-review-comments | docx:contract | 读第四条 → 两个角度各加一条批注 | 第四条段落里 ≥2 个不同批注 id | 12 |
| t03-compare-to-memo | nofile | 读两版协议 → 比对 → 写「差异说明.docx」 | 新 docx 正文含 15 日、20%、保密；两份原件仍在 | 10 |
| t04-penalty-table | nofile | 读「附件」里三份合同 → 抽违约金 → 写表格 docx | 「违约金对比表.docx」的表格里华东 0.5%、华南 20%、华北 万分之五 各占一行 | 12 |
| t05-appeal-deadline-reminder | nofile | 推算上诉期 → 建待办 → 回复 | 本项目事项 due_date=2026-11-17 且标题含「上诉」；回复含该日期 | 8 |
| t06-organise-six-files | nofile | 6 个文件分到 3 个文件夹 | 每个文件在指定文件夹、未删；`move_files` ≤3 次（不逐个搬） | 8 |
| t07-rename-format-export | docx:contract | 改乙方名称 → 律所格式 → 导出 PDF | 正文只剩新名称；有楷体或首行缩进（夹具里都没有）；PDF 含新增的「装备股份有限公司」 | 14 |
| t08-reject-one-accept-rest | docx:contract-tracked | 拒绝第三条修订 → 接受其余 | 无残留修订；第三条「7 日」无 15；第四条含 20% | 12 |
| t09-citations-source-down | nofile | 读意见书 → 逐条核对 → 结论 | 回复点出第 1082 条、并说明未经法源核实（待核实/复核/法宝不可用）；意见书 sha256 不变 | 6 |
| t10-two-turn-delete-confirm | nofile | 删「旧稿」（确认卡）→ 脚本答「执行」→ 建「定稿」→ 移合同 | `followUps` 两轮；最终 finished；旧稿已进回收站、合同在定稿里 | 12 |

- **法源不可用（t09）**：矩阵实例没有法宝凭证，法规工具照常下发，但每次调用都回 `[pkulaw_unavailable]`（`MCP server has no credential` → `LegalTools.vendorUnavailable`），就是线上法宝故障时模型看到的那条路径，不需要另外模拟。
- **两轮（t10）**：`followUps` 只对 API 句生效；确认卡的回答按前端 `formatAskUserAnswer` 的形状发（`<ask_user_answer id=…>` + `Selected:\n- 执行`），后端据此重放挂起的 `move_to_trash`。轮数、工具、tokens 按整个会话累计，`finalText` 是最后一轮的回复。
- 所有 outcomeCheck 有离线单测：`node --test scripts/eval/tasks-10.test.mjs`（手工 ctx 桩，每题至少一个通过、一个不通过用例）。改判据先改单测。
- 夹具：t04 的三份合同 `penalty-east/south/north.docx`（虚构，`make_fixtures.py` 生成），其余复用已有夹具。
- 编辑器句子在本轮结束后、关页面前等自动保存落盘（与 #1470 同一段等待），否则 docx 类判据读到旧稿。

### 基线（2026-11-11，before = after = origin/master `bb5d731e0`，cn cheap，`--runs 2`）

两次实跑：第一次用来校准判据（修了 3 处坏判据，见下），第二次是记录的基线。下表 = 第二次，t04 按修正后的判据离线重判过一次运行（before/deepseek run2，真实产物，从 FAIL 改判 PASS）。
qwen3.7-flash 这两次都被 OpenRouter 上游限流（429 `temporarily rate-limited upstream`）和空流打掉约一半运行，按 P0 规则不进分母，所以 qwen 的样本少、只作参考。

| 任务 | deepseek-v4-flash B / A | qwen3.7-flash B / A |
|---|---|---|
| t01-four-step-explicit | 2/2 / 2/2 | 1/1 / 2/2 |
| t02-penalty-review-comments | 2/2 / 2/2 | 2/2 / 1/1 |
| t03-compare-to-memo | 2/2 / 2/2 | 1/1 / 1/1 |
| t04-penalty-table | 2/2 / 2/2 | 0/0 / 1/1 |
| t05-appeal-deadline-reminder | 2/2 / 2/2 | 1/2 / 2/2 |
| t06-organise-six-files | 2/2 / 2/2 | 0/0 / 1/1 |
| t07-rename-format-export | 2/2 / 2/2 | 1/1 / 1/1 |
| t08-reject-one-accept-rest | 2/2 / 2/2 | 0/0 / 0/1 |
| t09-citations-source-down | 0/2 / 0/2 | 0/0 / 0/1 |
| t10-two-turn-delete-confirm | 2/2 / 2/2 | 1/1 / 1/1 |
| **合计** | **18/20 / 18/20** | **7/8 / 10/12**（另 20 次基础设施故障已排除） |

两次实跑里的真实失败（判据已确认可信，期望保持正确行为、不迁就）：
- **t09 法源不可用**：deepseek 4/4 次、qwen 1/1 次超过 6 轮（8–10 轮），拿到 `[pkulaw_unavailable]` 后转去 `search_web` / `browse_url` 反复检索（P8）。另有 1 次（deepseek）没有注明未核实，还凭记忆编出「第 1082 条是禁止买卖婚姻」「已逐一核实」。
- **t03 长参数被截断**：deepseek 1 次把整份差异说明塞进 `write_docx` 参数，输出两次被截断，最后没写成文件。
- **t03 文本协议泄漏**：qwen 1 次写出畸形的 `<tool_code=search_project_files(...)` 文本，一个工具都没执行，本轮按 finished 结束（R3/R4）。
- **t04 同轮重写被静默复用**：qwen 读完前两份就先 `write_docx`（第三行写「待确认」），读完再写同名文件时被「同一轮同一目标复用第一份」逻辑原样返回成功，文件没更新，模型却说「已覆盖更新」。
- **t05 中途停下**：qwen 1 次 `deadline_compute` 算对 11-17 后多查了一次文件清单就结束，没建待办、没有结论（R4）。
- **t06 参数写错被暂停**：deepseek 1 次 `move_files` 连续 4 次 `unknown or duplicate tool argument` 后被打转检测暂停；另有多次第一次调用自造 `sources/destinations` 参数、第二次才改对（P2）。
- **t08 用文本替换代替拒绝修订**：qwen 2 次——一次 `doc_undo` + `doc_restore_checkpoint` 把文档弄乱后停在恢复确认卡；一次用 `doc_replace_at_anchor` 改合并后的文本，第三条读起来是 7 日，但留下 AI 自己的 `<w:del>15</w:del>` 修订（与 g12 同一问题）。

校准中修掉的坏判据（不是 agent 的错）：
- t06 原先用 `ctx.calls` 判「一批 ≥5 项」：DeepSeek 常用泄露的 `</｜DSML｜…>` 收尾 XML 调用，调用照常执行，但 runner 的日志解析拿不到参数，2 次正确运行被判失败。改为 `move_files` 调用 ≤3 次。`ctx.calls` 的这个盲区对其它句子同样存在，用它的判据要注意。
- t09 原先只认「待核实/未核实」等几个词：模型实际说的是「建议通过 flk.npc.gov.cn 复核」「做最终确认」「法宝暂时不可用」。改为这些也算。
- t04 原先只按行找「华东…0.5%」：deepseek 做过合同作列的转置汇总表，内容全对却被判失败。改为行、列两个方向都认。

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
- 2026-11-11：判分修正（agent-tier1-gap P0），**旧报告与新报告不可直接对比，需重新建基线**。`finalTextIncludes` 改用全文；文本 `<question>` 停问计为 `ask_user`；基础设施故障不进分母/门禁/回退；新增 `xmlTurns` / `nativeTurns` / `verifyAfterWrite` / `maxSameTool` 与 `--rescore`。gate-35 / gate-35-en：g15 去掉 `mustUse create_folder`（`move_files` 会自动建文件夹，结果由 outcomeCheck 判）；g01 的 `firstToolAnyOf` 加 `get_law_article` / `law_search`；g12 的 `firstToolAnyOf` 加只读探查类工具（`doc_find_text`、`doc_table_read`、`doc_get_clauses`、`doc_get_outline`、`todo_write`），同时 `mustNotUse` 加 `doc_replace_at_anchor`（拒绝/接受修订不该走文本替换）。
- 2026-11-11（gap P3）：gate-35 / gate-35-en 的 `g02-insert-clause` 加 `outcomeCheck`，读宿主 docx 的 `word/document.xml`（去掉 `<w:del>` 块后拼 `<w:t>`）：含「保密」的段落都要独立成段、落在第四条与第五条原文段之间、带 `<w:ins>`；此前 g02 只判工具名，新旧结果不可直接对比。新增 `g19-insert-clause-after`（「在第三条后面新增一条……」，同法判第三、四条之间，`maxRounds: 10`），集名沿用 gate-35。另：编辑器句子在本轮结束后、关页面前等状态栏离开「更改待保存/保存中」（最多 20 秒），否则自动保存还没上传，docx 类 outcomeCheck 判到旧稿（首轮实测 g02 一次正确插入被判失败即此原因）。
- 2026-11-11（gap P6）：新增 `sentences/tasks-10.json`（多步任务集，只按结果判分）与离线单测 `tasks-10.test.mjs`；runner 新增 `followUps`（API 句的脚本化第二轮，按确认卡/反问卡回答）、`task: true` 的「多步任务」报告表、`docxXml(buf, part)`；编辑器句子关页面前等自动保存（同 #1470）。既有句集与判分不变。
- 2026-11-11：新增 `--route openrouter|bailian`（默认 openrouter，行为不变）。bailian 经脚本内的本机转发口直连百炼（见「百炼路由」），报告头写明路由与模型映射、成本按人民币标价估算，并列出百炼上游 HTTP 状态计数。句集与判分不变。
