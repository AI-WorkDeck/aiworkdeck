<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# 表格化审阅（tabular-review）

一组文件 × 一组问题 → 一张审阅表。AI 逐份文件抽取答案，每个格子带原文引文，点「跳到原文」打开文件并定位；律师逐格确认或修改，最后导出 Excel（审阅表 + 证据明细两张表）。

- 形态：纯 Web 插件，工作区视图；权限 `file_read`（读项目文件文本）、`ai`（`ai.request`，按用户 Credits 计费）、`file_write`（`files.download` 导出）。
- 最低宿主：0.81.0（`ui.openFile` 的 `locator` 与 `files.download` 在该版本加入，尚未发版）。
- 设计文档：`docs/plans/stella-alignment/tabular-review.md`。

## 开发

```sh
node official-plugins/tabular-review/scripts/sync-panel-l10n.mjs   # 改了 l10n/*.json 后重新生成 web/panel-l10n.js
NODE_PATH=frontend/node_modules node --test official-plugins/tabular-review/tests/*.mjs
./official-plugins/tabular-review/build.sh                          # 测试并打 dist/tabular-review-<版本>.zip（含 SDK）
```

本地试装：把 zip 解压到 `backend/plugins/tabular-review/`（桌面版为 `~/.aiworkdeck/plugins/tabular-review/`），在插件广场点「重新扫描」。上架需走 `docs/PLUGIN_DISTRIBUTION.md` 的审核签名流程。

## 已知限制（第一期）

- 审阅表保存在插件 KV（64 KB 上限），文件或问题较多时可能存不下，界面会提示及时导出。
- PDF 只按引文定位（显示引文卡片），没有页码高亮；扫描件需先做 OCR。
- 每份文件最多审阅前 8 段（约 10 万字），超出部分在行内注明。
- 只导出 Excel；Word 导出见设计文档第二期。
