<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# 记忆与技能管理入口验证

对应 dev-board#1573、#1574。聊天「记忆」改为宿主设置标签的 memory 深链；技能管理改为工作台插件市场侧栏。设置保持跨窗格单例，对话模式打开设置同步展开画布；市场入口确保展开，重复点击不收起。内嵌记忆按面板宽度响应：窄面板中文件列表和编辑器上下排列，操作按钮不拆字。

## 本次检查

- `node --test frontend/tests/project-home/memory-settings-navigation.test.mjs frontend/tests/project-home/chat-mode.test.mjs frontend/tests/project-home/personal-settings-reentrancy.test.mjs frontend/tests/ai-alignment/memoryBrowserState.test.mjs frontend/tests/ai-alignment/memoryBrowserAsync.test.mjs`：37 项通过。执行实际宿主方法，包含右侧分屏已有设置标签的重入。
- `node --test frontend/tests/project-home/*.test.mjs`：1,941 项通过。
- `npm --prefix frontend run check:nav:full`、`check:emits`、`check:locales` 通过。
- `MEMORY_NAV_OUT=/tmp/memory-settings-navigation-parent-final node frontend/tests/project-home/memory-settings-navigation-ui.mjs`：主任务独立复跑通过，空聊天和有历史消息两态，页面错误为零。
- UI 使用本地 H5 与拦截的合成项目 42、用户 7；记忆/技能入口真实点击。验证记忆无弹窗、请求带项目 ID、设置单例、重定位、重复进入同一记忆页保留草稿、聊天正文和输入保留、技能入口重复打开不折叠。
- 窄画布实测：记忆容器约 426px，编辑控件约 406px；四个空间入口、禁用律所、列表位于编辑器上方、保存文本单行且无横向溢出均通过。
- 对话模式原有样式隐藏聊天头部，因此画布关闭后重开设置这一步直接调用宿主入口，不是声称该模式可点击记忆按钮。
- 另一位 Codex 原生子代理只读检查事件绑定、设置单例和市场切换逻辑，未发现阻断问题；主任务核对实际 diff 与测试输出。

## 同类交互排查

已修复聊天技能管理直接跳独立插件市场的问题，并删除其导航护栏豁免。头像/设置/账户/更新入口已走设置标签；内置工作流编辑器已走工作区标签；插件团队管理深链指向团队设置；插件详情使用详情标签。上传、回退确认、演示参数、登录与安装提示是当前任务操作，保留弹窗。OAuth 外部授权保留系统浏览器。

本次没有验证真实账号后端和正式 Electron 安装包。记忆页面已有的跨栏目/跨标签未保存草稿生命周期不在此次管理入口修复中；测试只证明重复点击当前记忆入口不清空草稿，不代表全面未保存保护。未发版或升级客户端。
