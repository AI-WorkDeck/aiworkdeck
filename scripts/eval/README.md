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
- 每次运行前清空记忆表，并新建一个全新项目再按 `seed` 灌入数据；同一实例内串行，实例之间并行。
- 唯一出站请求是后端对 OpenRouter 的模型调用；脚本本身不发任何外网请求。

## 句子集 schema

```jsonc
{ "sentences": [{
  "id": "s08-move-to-archive",
  "text": "把合同.docx移到归档文件夹",
  "hostState": "nofile",            // nofile | docx:<夹具>（xlsx/pptx/attachments 暂不支持，SKIPPED）
  "seed": {
    "folders": ["归档"],
    "files": [{ "name": "合同.docx", "fixture": "contract.docx", "folder": "归档" /* 可选 */ }],
    "tasks": [{ "title": "提交答辩状", "dueInDays": 1 }],
    "memory": [{ "key": "客户偏好", "content": "客户偏好周五开会", "type": "preference", "scope": "user" }]
  },
  "expect": {
    "firstToolAnyOf": ["move_files"],            // 第一个工具须命中其一；"<none>" 表示允许不调工具；"/正则/" 也可
    "mustUse": [["move_files", "move_project_file"]],  // 每个子数组是「任一」，各组都要满足
    "mustNotUse": ["move_to_trash"],
    "finalTextIncludes": ["沟通记录"],           // 可选：最终回复须包含
    "outcomeCheck": "const f = await ctx.files(); return f.some(x => x.name==='合同.docx');"  // 可选：JS 函数体
  }
}]}
```

`outcomeCheck` 是 async 函数体，参数 `ctx`：`files()`、`tasks()`、`memory()`（查库返回行数组）、`rows(sql)`、`sql(sql)`、
`api(method,url,body)`（以测试用户身份调后端）、`tools`、`finalText`、`projectId`。句子文件是受信的本地文件，会被 `eval` 执行。
一次运行「通过」= 本轮正常结束（`bubble_end` 且 status=finished）且所有已声明的检查都为真。

夹具在 `fixtures/`（虚构内容），由 `python3 fixtures/make_fixtures.py` 生成：`contract.docx`（第三条/甲方/违约金/仲裁）、
`contract-tracked.docx`（含修订）、`contract-draft.docx`、`mention-zhangsan.docx`、`plain-notes.docx`。

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
- `sentences/v7-compare.json`：tool-system-v2 V7 D1 两份 docx 比对专用 3 句（中文两句 + 英文一句），夹具 `compare-v1.docx` / `compare-v2.docx`（第三条付款期限、第五条违约金、新增第七条保密，第二条仅空白差异）；outcomeCheck 要求最终回复点出三处改动、不报未改动条款、原件仍在且没有产生新文件。
