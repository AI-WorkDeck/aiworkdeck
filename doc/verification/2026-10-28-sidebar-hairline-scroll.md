<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# 侧栏纵向细滑轨（dev-board#1575）

左侧工具图标栏和项目列表根节点复用 App.vue 既有 `awd-hairline-scroll`；删除图标栏自有的常驻 thumb 规则。悬停颜色改由宿主 CSS 变量驱动伪元素，修复直接滚动容器仅修改 :hover 伪元素不刷新的现象；4px 尺寸与编辑器高度补偿均不改。项目功能重排只作产品讨论，本次没有实施。

## 验证

- `node frontend/tests/project-home/rail-overflow-ui.mjs`：30 个工具，480/640/900px 窗口，4px/静止透明、滚轮到末项并点击、底部固定按钮和成员浮层正常。
- `node frontend/tests/project-home/hairline-scroll-ui.mjs`：直接/内层滚动 × 横向/纵向，共 8 次 hover/leave、4px 和真实滚动通过；主任务独立复跑。用旧 App.vue 负对照，4 处直接滚动容器 hover 失败，内层正常。显式去掉 Puppeteer 默认隐藏滑轨参数后截图可见滑块。
- 同一用例 `RAIL_BASELINE=1` 用修改前 HEAD 运行，在静止透明断言失败：原 thumb 为 `rgb(195, 188, 169)`；修改后通过。
- 真实 H5 合成 API（40 个项目，隔离浏览器，无真实账号）验证两处滑轨均为4px/静止透明、鼠标移入显形且宽度不变；项目列表可滚动并定位末项，页面错误为零。临时脚本 `/tmp/sidebar-scroll-check.mjs`，结果 `/tmp/sidebar-scroll-result.json`。
- `check:nav:full`、`check:locales` 通过。导航护栏仍验证项目面板根节点锚点类，允许追加共享样式类。

## 验证边界

不能把无头截图或 computedStyle 的异常直接归为测试局限：本次最小对照发现，旧规则在直接滚动的容器上实际不显形，而包裹子滚动容器时可显形。宿主颜色变量方案修复后，主任务真实 H5 实测 hover 为 `rgb(195, 188, 169)`、idle 透明，鼠标滚动和列表末项可达。

没有升级正式客户端或宣称正式客户端视觉复测通过。Word、PPT、Excel 共用 EditorToolbar 横向滑轨，PDF 与其他文件共用工作台标签横向滑轨；本次保持宽高与宿主高度补偿不变，测试覆盖共享的横/纵向及直接/内层滚动结构。没有修改各格式文档引擎、输入、批注或保存链路，未另做正文编辑/保存重开验收。
