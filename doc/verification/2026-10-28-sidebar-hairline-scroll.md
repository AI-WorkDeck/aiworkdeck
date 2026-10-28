<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# 侧栏纵向细滑轨（dev-board#1575）

左侧工具图标栏和项目列表根节点复用 App.vue 既有 `awd-hairline-scroll`；删除图标栏自有的常驻 thumb 规则。全局编辑器滑轨实现、宽度与编辑器高度补偿均不改。项目功能重排只作产品讨论，本次没有实施。

## 验证

- `node frontend/tests/project-home/rail-overflow-ui.mjs`：30 个工具，480/640/900px 窗口，4px/静止透明、滚轮到末项并点击、底部固定按钮和成员浮层正常。
- 同一用例 `RAIL_BASELINE=1` 用修改前 HEAD 运行，在静止透明断言失败：原 thumb 为 `rgb(195, 188, 169)`；修改后通过。
- 真实 H5 合成 API（40 个项目，隔离浏览器，无真实账号）验证两处滑轨均为4px/静止透明、鼠标移入宽度不变；项目列表可滚动并定位末项，页面错误为零。临时脚本 `/tmp/sidebar-scroll-check.mjs`，结果 `/tmp/sidebar-scroll-result.json`。
- `check:nav:full`、`check:locales` 通过。导航护栏仍验证项目面板根节点锚点类，允许追加共享样式类。

## 验证边界

悬停显形复用已存在的全局规则；无头 Chrome 的 scrollbar 伪元素动态 computedStyle 与截图不能单独当作滑轨像素证据（相关既有说明见 sidebar-shell.md 的 dev-board#543）。没有升级正式客户端或宣称正式客户端视觉复测通过。编辑器顶部仅作现有样式参考，Word/PPT/Excel/PDF 编辑路径没有改动。
