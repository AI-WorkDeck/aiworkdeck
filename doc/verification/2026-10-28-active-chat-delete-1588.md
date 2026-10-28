# 删除当前聊天后清空页面（dev-board #1588）

根因：工作台宿主的 `currentConversationId` 只随历史加载更新，新建聊天的 ID 由 `ChatInterface` 持有。删除成功后只检查宿主 ID，导致新建聊天未清空。修复改为读取已挂载聊天面板的当前 ID（包括明确的空值），无面板时才沿用宿主；清理在列表刷新之前同步完成，避免刷新期间切换后的会话被迟到操作清空。会话 ID 沿用现有字符串契约。

验证：`node --test frontend/tests/project-home/delete-active-conversation.test.mjs` 7 项通过，执行生产方法，覆盖新建当前聊天、删除其他聊天、删除请求期间切换、刷新期间切换、失败保留、空白新聊天及无面板旧路径。将生产方法还原为修改前实现，原 5 项测试中当前聊天与刷新竞态 2 项转红，再恢复修复。

`node --test frontend/tests/project-home/chat-mode.test.mjs` 9 项通过；`npm --prefix frontend run check:locales` 通过；`git diff --check` 通过。无用户可见文案改动。

边界：本次为生产方法行为测试和既有回归，未完成正式 Electron 客户端点击复测，未发版、部署或升级客户端。未改变任何文档编辑器或文件保存路径。
