<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# fixtures/marketing-demo — 产品截图用的在线广场夹具

`frontend/tests/marketing-screenshots/run.mjs` 在本机静态服务里把这两份 JSON 当作在线广场注册表返回，
后端用 `AI_SKILLS_REGISTRYURL` / `AI_PLUGINS_REGISTRYURL` 指过来，截图不依赖官网实时数据（下载数、上架条目会变）。

| 文件 | 内容 |
|---|---|
| `registry-skills.json` | 官网 Skill 注册表 2026-11-05 快照中的 10 条，作者统一为团队名，`updatedAt` 固定 |
| `registry-plugins.json` | 空列表（第一批截图不展示在线插件） |

**禁止**放入真实客户、当事人姓名或个人作者信息。改动这里会改变 `plugin-market` 截图，需要同时更新基线。
