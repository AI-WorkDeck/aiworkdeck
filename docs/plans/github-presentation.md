# GitHub 仓库门面整理方案

日期：2026-11-05　状态：草案，待维护者确认

## 0. 背景与范围

GitHub 访客主要是开发者。他们打开仓库后先看根目录、README 首屏、Issues 和 Releases，再决定要不要试用或贡献。本仓库目前的问题集中在四处：

- 根目录混有内部文件；
- `doc/` 与 `docs/` 并存，`docs/` 下内部审计、交接和计划文档与对外文档混放，也没有索引页；
- Issue 首页被每日 QA 自动 issue 占满；
- Releases 里插件运行包与桌面版混在一起。

本方案把改动分成两类：

- **A 类：PR 能完成的改动**。本轮已开 PR，或建议后续开 PR。
- **B 类：仓库设置与线上状态**。包括简介、Topics、Wiki/Projects 开关、标签、关闭 issue、Releases 编辑。本轮一律未动，第 4 节列出具体命令，等维护者确认后执行。

README 正文和产品截图不在本轮范围内（截图自动化另有任务在做），只在第 3.6 节提出结构性建议。

## 1. 参考项目做法

| 项目 | 可借鉴的做法 |
|---|---|
| stella/stella（开源法律工作台） | 简介只有一句（27 字符）。README 首屏依次是横幅、一句话标语、链接行和 5 个徽章，release 徽章用 `filter=v*` 排除子包。Issue 用 YAML 表单，并设 `blank_issues_enabled: false`。config.yml 里注明：有 SECURITY.md 时 GitHub 会自动注入漏洞报告入口，无需重复。夜间依赖扫描失败只更新一条滚动 issue（固定标题加标签，查到就改，查不到才建，只在默认分支运行，支持 dry-run）。flaky 测试进隔离清单并带到期日，不开 issue。部署细节放私有运维仓。 |
| langgenius/dify | 关闭空白 issue。contact_links 分别指向安全公告、插件仓、文档仓和 Discussions，把反馈分流到对的地方。用户文档、官方插件各自独立成仓。README 顶部用一排语言徽章切换语言。 |
| toeverything/AFFiNE（Electron，与本项目最接近） | 根目录只放 README、SECURITY、CHANGELOG、LICENSE。CONTRIBUTING 和 CODE_OF_CONDUCT 放进 `docs/`，CLA 放进 `.github/`。标签按 `app:` / `mod:` 分前缀。canary 版用日期 tag 并标为预发布，与稳定版视觉上分开。 |
| n8n-io/n8n | 标签体系最完整：`type:` / `status:` / `triage:` / `closed:`（关闭原因）/ `team:` / `release:`。架构决策记录放 `docs/adr/`。提问和功能建议分流到社区论坛。 |
| zed-industries/zed（桌面应用） | 关闭空白 issue，功能建议走 Discussions 分类。标签严格加前缀（`area:`、`platform:`、`state:`、`severity:`）。用定时任务改写同一条置顶滚动 issue（#6952）。nightly 构建不发 Release，只移动 `nightly` tag。预览版用 `-pre` 后缀并标为预发布。 |
| supabase/supabase | SECURITY、CODE_OF_CONDUCT 和 issue 模板放在组织级 `.github` 仓库统一继承。master 失败只发 Slack，不开 issue。 |

共同点：

- 根目录只放 README、LICENSE 和社区健康文件，其余进子目录；
- 用 YAML issue 表单，关闭空白 issue，提问分流到 Discussions；
- 标签按前缀分组；
- 自动化报告只用一条滚动 issue，或改发聊天通知；
- 预发布、nightly 和子包与主版本分开，用 tag 前缀加 prerelease 标记区分；
- 关掉不用的 Wiki 和 Projects。

## 2. 现状盘点（2026-11-05 核对）

- **根目录**：除点文件外有 41 项。其中内部或易误解的有：
  - `GROWTH_PLAYBOOK.md`：Star 增长运营手册；
  - `qa-evidence/`：#1086 的 4 张验收截图；
  - `doc/`：56 个内部审计和验收记录；
  - `experiments/`：zetaoffice spike；
  - `restart-all.sh`：本地一键启动；
  - `data/`：见 2.1。
- **docs/**：`.gitignore` 仍忽略 `docs/`（#1077）。根层有约 50 个文件，大写的计划、审计、交接文档与小写的对外指南混放，另有 `superpowers/` 下 93 个 agent 设计稿，没有 `README.md` 索引（#1078）。
- **Issues**：33 条 open issue 中有 6 条是「每日 QA 失败」（#1352、#1343、#1277、#1265、#1255、#1219）。它们由维护者本机 crontab 跑 `scripts/qa-nightly.sh` 每天新开，不是 GitHub Actions。
- **Issue 模板**：旧式 `.md`；`blank_issues_enabled: true`；没有引导到 Discussions。
- **Releases**：桌面版 `vX.Y.Z` 与插件运行包 `pack-<id>-vX.Y.Z`（名称为 `native pack: …`）交错出现。pack 已标为 prerelease，不会抢占 Latest，README 的 release 徽章也不受影响。但列表观感混乱。
- **About**：简介 160 字符，偏叙事，没说清是什么；16 个 Topics，含泛词 `open-source`、`workspace`。
- **Wiki**：已开启，但没有 wiki 仓库（内容为空）。**Projects**：已开启，Projects v2 数量为 0。**Discussions**：已开启，6 个默认分类，共 8 条。私密漏洞报告：已开启。
- **标签**：
  - GitHub 默认标签 9 个，其中 `documentation`、`duplicate`、`invalid`、`question`、`wontfix` 使用次数均为 0；
  - 前缀标签有 `area:` ×7、`priority:` ×3、`type: rfc`、`status: deferred`；
  - 另有 `user-feedback`，由反馈优化者自动打上，代码里写死了这个名字。
- **社区文件**：`SECURITY.md`、`CONTRIBUTING.md`、`PULL_REQUEST_TEMPLATE.md` 在 `.github/`；`CODE_OF_CONDUCT.md`、`GOVERNANCE.md`、`MAINTAINERS.md`、`BOUNTIES.md` 在根目录。GitHub 能识别根目录和 `.github/` 两处，位置本身没问题。

### 2.1 需要维护者单独决定的事项

根目录 `data/` 是 2025-12 误入库的本地运行数据，共 644 个文件，`.gitignore` 已忽略它但这些文件仍被跟踪。另有一个本地 e2e 脚本 `frontend/tests/lowa-e2e/open-not-dirty.mjs` 引用了其中一个 xlsx。

处理方式（只移出跟踪，还是同时改写历史）超出门面整理范围，本方案不代为决定，另行沟通。

## 3. 逐项方案

### 3.1 Issue 模板与提问分流（A 类，已开 PR #1379）

- **现状**：旧式 `.md` 模板，允许空白 issue，没有提问入口。
- **目标**：用 YAML 表单收集必要信息，把提问分流到 Discussions，安全问题走私密通道。
- **做法**：
  - `bug_report.yml`：版本、使用形态、复现步骤为必填，并勾选「不含客户保密信息」。法律场景特有，参考项目里没有。
  - `feature_request.yml`：引导先到 Discussions Ideas 讨论，大改动走 `rfcs/`。
  - `config.yml`：关闭空白 issue，链接 Discussions Q&A、商业授权和官网。安全入口由 GitHub 根据 SECURITY.md 自动注入。
- **风险**：网页端不能再开空白 issue。CLI 和 API 不受影响，自动化（反馈优化者、QA 脚本）照常。
- **后续**：可加 `.github/DISCUSSION_TEMPLATE/q-a.yml`（参考 dify、zed），以及插件问题模板，必填插件名和版本。

### 3.2 每日 QA 自动 issue（A 类已开 PR #1380；清理旧 issue 属 B 类）

- **现状**：每次失败都新开一条 issue，已积累 6 条 open。
- **目标**：只保留一条滚动 issue，Issue 首页留给人写的问题。
- **做法**：
  - `scripts/qa-nightly.sh` 改为按固定标题「每日 QA 滚动报告 / nightly QA (rolling)」查找。失败时追加评论，已关闭则重开；恢复全绿时留言并自动关闭。
  - 专用克隆每天 `reset --hard origin/master`，合并后次日自动生效。
- **风险**：
  - 依赖 issue 搜索索引，新建后几分钟内可能搜不到。每天只跑一次，可以接受。
  - 有人手动改了标题，会导致脚本另建一条新的。
- **B 类配套**：关闭 6 条旧的每日 issue（命令见 4.4）。
- **更进一步（可选）**：参考 supabase，失败通知改发飞书或邮件，不再写 issue。

### 3.3 根目录精简（A 类，已开 PR #1381、#1382；其余待定）

- **现状**：41 项，混有内部文件，`doc/` 与 `docs/` 并存。
- **目标**：根目录只留源码目录、构建配置、README/LICENSE 和社区健康文件。
- **本轮已做**：
  - #1381：`doc/` 整体移入 `docs/dev-notes/`，同步修正 `.claude/agents` 等 21 处引用。「官网仓 `doc/desktop-contract.md`」指另一个仓库，保持原样。
  - #1382：`GROWTH_PLAYBOOK.md` 移到 `docs/marketing/`，`qa-evidence/` 移到 `docs/qa/evidence/`。
  - 根目录因此减少 3 项。
- **建议后续（需维护者拍板，每项单独一个 PR）**：

  | 项 | 建议 | 风险或成本 |
  |---|---|---|
  | `data/` | 见 2.1 | 需先决定是否改写历史 |
  | `restart-all.sh` | 移到 `scripts/dev/`，根目录不留包装脚本 | 脚本用 `dirname $0` 定位项目根，要改为上一级；`docs/getting-started.md`、`docker-sidecars.md`、`firm-eval-topology-a.md`、`.claude/agents/eng-infra.md`、`backend/restart-backend.sh` 都要同步；开发者习惯也要改 |
  | `experiments/zetaoffice-spike/` | 移到 `docs/dev-notes/spikes/`，或直接删除（结论已写进 LIBREOFFICE_MIGRATION_PLAN） | 代码注释里有 5 处引用，`scripts/spdx-scope.mjs` 有排除项，需一并改 |
  | `GOVERNANCE.md` / `MAINTAINERS.md` / `BOUNTIES.md` | 移到 `.github/` 或 `docs/community/` | README、CONTRIBUTING 里有 5 处链接要改；收益一般，可不做 |
  | `WHY.md` / `WHY.zh-CN.md` | 保留在根目录。它们是 README 首屏链接的「理念」文档 | — |
  | `UPSTREAM.md`、`REUSE.toml`、`LICENSES/`、`legal/` | 保留。溯源与许可合规要求放在根目录，CLAUDE.md 也有约定 | — |
  | `asr/kokoro/mineru/pptx-service` 四个侧车目录 | 暂不合并到 `services/`。涉及 docker-compose、CI、打包脚本和 SPDX 规则，成本远大于收益 | — |
  | `frontend/.github/dependabot.yml` | Dependabot 只读根目录的 `.github/`，这份配置不生效，根目录也没有 dependabot 配置。应移到 `.github/dependabot.yml`，并按需加上 desktop、office-addin 等目录 | 生效后会开始自动提依赖 PR，需要有人跟进处理 |

### 3.4 docs 组织（与 good first issue 衔接）

- **现状**：`.gitignore` 忽略 `docs/`；内部文档与对外文档混放；没有索引页。
- **目标**：
  - 对外部分只保留开发者入口：`architecture`、`getting-started`、`plugin-guide` / `PLUGIN_SPEC`、`SKILL_SPEC`、`EVIDENCE_CONTRACT`、`docker-sidecars`、`firm-eval-topology-a`、`i18n/` 等，由 `docs/README.md` 统一索引；
  - 内部计划、审计和交接文档统一放在 `docs/dev-notes/`。
- **与 GFI 的关系**：以下三条留给新人，本轮不做，按顺序认领最顺：
  - **#1077**：把 `docs/` 从 `.gitignore` 移除；
  - **#1078**：新建 `docs/README.md` 索引；
  - **#1079**：示范迁一篇内部文档到 `docs/dev-notes/` 并留跳转页。

  #1381 先建好了 `docs/dev-notes/`，只移入了原 `doc/` 的内容。#1079 的三个候选文件都留在原处，三条 GFI 的任务都没有变。
- **第二批（GFI 合并后由维护者做）**：
  - 把 `docs/` 根层剩余的内部文档批量移入 `docs/dev-notes/`：大写的 `*_PLAN`、`AUDIT_*`、`HANDOFF_*`、`*_REVIEW_*`、`SECURITY_AUDIT_*`、`UPSTREAM_LICENSE_MEMO_*`、`worklog-*`、`s0-prd`、`upgradeplan`、`handoffs/`、`research/`、`plans/`，以及中文文件名笔记；
  - 每批迁移前用 `git grep` 修正引用。
- **`docs/superpowers/`**：93 个 agent 设计稿，CLAUDE.md 和多份领域文档按路径引用它，**建议保持原路径**，只在索引里标注为「设计档案」。
- **决策记录**：新增决策可参考 n8n 的 `docs/adr/`；现有 `rfcs/` 已承担这个角色，不必另起。
- **风险**：每次移动都会让外部旧链接（博客、已合并 PR 正文）失效。必要时在原路径留 5 行跳转页（#1079 的做法）。

### 3.5 Releases（B 类为主）

- **现状**：`pack-*` 预发布与桌面版交错出现，已正确标为 prerelease，不影响 Latest。
- **约束**：客户端分发链路是「镜像优先，GitHub 按 tag 直链兜底」（`pack-release.yml` 的注释）。**不能删除或迁移已发布的 pack release**，否则已安装的客户端无法兜底下载。
- **建议**：
  1. **短期（A 类，小改动）**：`pack-release.yml` 里 release 名称从 `native pack: <id> vX` 改为 `[插件运行包] <id> vX`，正文首行说明「这是插件运行时包，桌面版请看 Latest」。由于正在发 0.80.1，改动 workflow 建议等发版结束再提。
  2. **README**：release 徽章加 `?filter=v*`（参考 stella），确保徽章永远显示桌面版。
  3. **长期**：新建 `AI-WorkDeck/native-packs` 仓库专门发布 pack。客户端兜底地址先同时支持新旧两个仓库，过渡一个大版本后再停用旧地址。这需要改代码并发版，单独立项。
  4. **已有的 `native pack: …` release**：可以批量改名（命令见 4.5），只改 name，不改 tag，不影响下载。

### 3.6 README（只提结构性建议，本轮不改）

对照参考项目，现有 README 首屏已经具备 logo、一句话标语、3 个徽章、语言切换和链接行，基本合格。建议：

- **徽章**：release 徽章加 `filter=v*`。
- **链接行**：加 `Docs`（指向 #1078 产出的 `docs/README.md`）和 `Discussions`。
- **首屏长度**：截图前的三段叙事较长。可以把发起人介绍挪到「Licensing and stewardship」之前，让产品截图更早出现。

截图及其顺序归截图自动化任务负责，这里不动。

### 3.7 About 与仓库开关（B 类）

- **简介**：先说清「是什么」和差异点，控制在 100–200 字符。建议：
  > Open-source AI workspace for legal document work: reviewable AI edits as tracked changes, linked sources, project history. Desktop app + plugin SDK. 开源法律 AI 文档工作台
- **Topics**：
  - 删除泛词 `open-source`、`workspace`；
  - 新增 `legal`、`law`、`desktop-app`、`llm`、`plugin-system`；
  - 保留 `legaltech`、`legal-ai`、`document-ai`、`electron`、`libreoffice`、`mcp`、`ocr`、`rag`、`self-hosted`、`ai-agents`、`spring-boot`、`vue`。
  - 删改后共 19 个，在 GitHub 上限 20 个以内。
- **Wiki**：内容为空，关闭。
- **Projects**：Projects v2 数量为 0，关闭标签页。以后要用时可以随时重新打开。
- **Discussions**：保留。建议删除 `Polls` 分类，新增「插件开发 / Plugin development」分类。
- **置顶 issue**：可置顶 #15（docs 整理总纲）和一条 GFI 汇总。滚动 QA issue 不要置顶。

### 3.8 标签体系（B 类）

- **目标**：按前缀分组，与 n8n、zed 对齐；保留 GitHub 有特殊用途的标签。`good first issue` 和 `help wanted` 会被 GitHub 的 contribute 页识别。
- **保留不改**：
  - `bug`、`enhancement`：表单、QA 脚本和历史 issue 都在用，改名要同步改表单和脚本，收益不大；
  - `good first issue`、`help wanted`；
  - `user-feedback`：名字写死在 `OptimizerProperties`，改名必须同时改代码；
  - 现有的 `area:*`、`priority:*`、`type: rfc`、`status: deferred`。
- **删除**（使用次数均为 0）：`question`（提问走 Discussions）、`documentation`（与 `area: docs` 重复）。
- **改名为关闭原因**（参考 n8n）：`duplicate` → `closed: duplicate`，`invalid` → `closed: invalid`，`wontfix` → `closed: wontfix`。
- **新增**：
  - `status: needs-info`、`status: blocked`；
  - `platform: macos`、`platform: windows`、`platform: linux`；
  - `area: editor`（LOWA 编辑器问题目前散落在 desktop/frontend 两个标签下）、`area: office-addin`。
- **风险**：标签改名会同步到所有已打标签的 issue，但外部按旧名过滤的书签会失效。删除标签不可撤销，所以只删使用次数为 0 的。

## 4. 待确认的仓库设置命令（本轮未执行）

以下命令均需维护者确认后执行，执行账号要有仓库 admin 权限。

### 4.1 简介、Topics、Wiki、Projects

```bash
R=AI-WorkDeck/aiworkdeck
gh repo edit $R --description "Open-source AI workspace for legal document work: reviewable AI edits as tracked changes, linked sources, project history. Desktop app + plugin SDK. 开源法律 AI 文档工作台"
gh repo edit $R --remove-topic open-source,workspace \
  --add-topic legal,law,desktop-app,llm,plugin-system
gh repo edit $R --enable-wiki=false --enable-projects=false
```

### 4.2 删除与改名标签

```bash
gh label delete question -R $R --yes
gh label delete documentation -R $R --yes
gh label edit duplicate -R $R --name "closed: duplicate" --color cfd3d7
gh label edit invalid   -R $R --name "closed: invalid"   --color cfd3d7
gh label edit wontfix   -R $R --name "closed: wontfix"   --color cfd3d7
```

### 4.3 新增标签

```bash
gh label create "status: needs-info" -R $R --color cfd3d7 --description "等待补充信息 / Waiting for details"
gh label create "status: blocked"    -R $R --color cfd3d7 --description "被外部依赖阻塞 / Blocked"
for p in macos windows linux; do gh label create "platform: $p" -R $R --color bfd4f2; done
gh label create "area: editor"       -R $R --color 1d76db --description "LOWA 文档编辑器 / Document editor"
gh label create "area: office-addin" -R $R --color 1d76db --description "Office/WPS 加载项 / Office & WPS add-ins"
```

### 4.4 关闭旧的每日 QA issue

PR #1380 合并后执行：

```bash
for n in 1219 1255 1265 1277 1343 1352; do
  gh issue close $n -R $R --reason "not planned" \
    --comment "每日 QA 已改为单条滚动 issue（#1380），旧的逐日 issue 统一关闭；仍复现的失败会出现在滚动 issue 里。"
done
```

### 4.5 统一 pack release 名称

只改 name，不动 tag 和资产，不影响下载。

```bash
gh release list -R $R --limit 200 --json tagName -q '.[].tagName' | grep '^pack-' | while read t; do
  id_ver=${t#pack-}; gh release edit "$t" -R $R --title "[插件运行包] ${id_ver%-v*} v${id_ver##*-v}"
done
```

## 5. PR 清单（本轮）

| PR | 目的 | 性质 |
|---|---|---|
| #1379 | Issue 改为 YAML 表单，config.yml 分流提问 | 仅 `.github/` |
| #1380 | 每日 QA 只维护一条滚动 issue | 改了本机 cron 脚本的行为，PR 内有说明 |
| #1381 | `doc/` 并入 `docs/dev-notes/` 并修正引用 | 纯文档移动 |
| #1382 | 根目录移出 `GROWTH_PLAYBOOK.md`、`qa-evidence/` | 纯文件移动 |
| 本文档 | 整理方案 | 文档 |

四个 PR 互不依赖，可以按任意顺序合并。
