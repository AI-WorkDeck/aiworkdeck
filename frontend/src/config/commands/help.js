// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 「帮助」菜单。此前整条菜单不存在——新用户找不到任何入口，使用手册只在官网上。

export const HELP_COMMANDS = [
  // 欢迎（dev-board#1047）：中栏「欢迎」标签（单例），有无项目两态都能开。
  // 关掉「启动时显示欢迎页」之后，这里是除空态链接之外的另一个入口。
  {
    id: 'help.welcome',
    label: { zh: '欢迎', 'zh-TW': '歡迎', en: 'Welcome' },
    menu: 'help', group: 0,
    when: ['workbench'],
    run: 'wb:openWelcome',
  },
  {
    id: 'help.manual',
    label: { zh: '使用手册', 'zh-TW': '使用手冊', en: 'User Guide' },
    menu: 'help', group: 1,
    run: 'app:openUrl:https://aiworkdeck.com/start',
  },
  {
    id: 'help.shortcuts',
    label: { zh: '快捷键速查', 'zh-TW': '快速鍵一覽', en: 'Keyboard Shortcuts' },
    menu: 'help', group: 1,
    run: 'app:showShortcuts',
  },
  {
    id: 'help.website',
    label: { zh: '官网', 'zh-TW': '官網', en: 'Website' },
    menu: 'help', group: 1,
    run: 'app:openUrl:https://aiworkdeck.com',
  },

  {
    id: 'help.viewLogs',
    label: { zh: '查看日志', 'zh-TW': '檢視記錄檔', en: 'View Logs' },
    menu: 'help', group: 2,
    run: 'app:viewLogs',
  },
  {
    id: 'help.reportIssue',
    label: { zh: '报告问题…', 'zh-TW': '報告問題…', en: 'Report an Issue…' },
    menu: 'help', group: 2,
    run: 'app:openFeedback',
  },
]
