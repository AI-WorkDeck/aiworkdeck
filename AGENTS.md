<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# AI WorkDeck：Agent 入口

开始项目工作前读根目录 `CLAUDE.md`，按其中的领域路由读取相关 `.claude/agents/*.md`。
这些 Markdown 保存项目事实、文件地图、契约、已知问题与验证命令，供各宿主共用；不要复制另一套领域文档。
其中 Claude 专属的模型名、agent 类型与工具参数不适用于 Codex，调度使用当前宿主提供的能力。

可独立拆分的任务可交给原生子代理，任务书写清绝对工作目录、文件范围、验证方式和交付要求。
Codex 子代理共享文件系统；并行写入须明确隔离 worktree 或互不重叠的文件，不能假定自动隔离。
主任务核对 diff 和实际验证结果后整合交付。

旧任务的 `.remember/remember.md`、本地会话与记忆仅作线索，继续之前核对当前分支、未提交改动、PR 和测试产物。
保护旧工作树；提交与未提交补丁分别恢复到独立工作树。不要把原始会话、凭据或机器私有记忆提交进仓库。

合并与发版分开：完成审阅和必要检查后可按用户授权合并；发版、部署或升级客户端需要本次明确指示。

多语种令牌化必检（dev-board#1477）：所有新增或改动的用户可见文案（前端、桌面端、Office/WPS 加载项、官方插件、后端接口与 AI 工具/Skill）一律采用多语种令牌，严禁硬编码写死。每次提交或合并 PR 前必须运行 `cd frontend && npm run check:locales` 并检查 diff，若发现未令牌化文案或漏译词条，先补齐令牌与多语言词条后再提交/合并。

漏洞与安全扫描合并前必检（dev-board#1661）：每次提交或合并 PR 前，必须自主执行安全与漏洞检查：① 涉及依赖或锁文件改动时，对受影响工作区跑 `npm audit`（确保 0 漏洞），核对 Maven `pom.xml`（含 `backend/` 与 `official-plugins/*/backend/pom.xml`）及 Python `requirements*.txt` / `uv.lock` 无已知高危/中危 CVE；② 合并 PR 前必须等待 `CodeQL` 检查完成，并通过 `gh api "repos/AI-WorkDeck/aiworkdeck/dependabot/alerts?state=open"` 与 `gh api "repos/AI-WorkDeck/aiworkdeck/code-scanning/alerts?state=open"` 核对是否存在未处理告警——凡能修复的漏洞与静态扫描问题必须先修完、验证通过后再合并 PR。
