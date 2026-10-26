// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 应用菜单（mac 上是最左边那个以应用名命名的菜单）的**业务补充项**。
//
// 关于 / 隐藏 / 退出 那几条是 Electron roles，由主进程常驻持有，不经这里下发。

import { LOCALE_REGISTRY } from '../../locales/registry.js'

const LANGUAGE_SUBCOMMANDS = [
  {
    id: 'app.lang.system',
    label: { zh: '语言：跟随系统', en: 'Language: Follow System' },
    menu: 'app', group: 3,
    inMenu: false,
    run: 'app:setLang:system',
  },
  ...LOCALE_REGISTRY.map((entry) => ({
    id: `app.lang.${entry.code}`,
    label: { zh: `语言：${entry.nativeName}`, en: `Language: ${entry.nativeName}` },
    menu: 'app', group: 3,
    inMenu: false,
    run: `app:setLang:${entry.code}`,
  })),
]

export const APP_COMMANDS = [
  {
    id: 'app.checkUpdate',
    label: { zh: '检查更新…', en: 'Check for Updates…' },
    menu: 'app', group: 1,
    run: 'app:checkUpdate',
  },
  {
    id: 'app.settings',
    label: { zh: '设置…', en: 'Settings…' },
    accel: 'CmdOrCtrl+,',
    menu: 'app', group: 2,
    run: 'app:openSettings',
  },
  {
    id: 'app.account',
    // 文案里别用 &：Electron 把它当助记符标记吃掉（真机实测菜单显示成
    // 「Account  License…」，中间空两格）。要么写 &&，要么换词——换词更省事。
    label: { zh: '账户与授权…', en: 'Account and License…' },
    menu: 'app', group: 2,
    run: 'app:openAccount',
  },
  {
    id: 'app.logout',
    label: { zh: '退出登录…', en: 'Log Out…' },
    menu: 'app', group: 2,
    run: 'app:logout',
  },
  {
    id: 'app.language',
    label: { zh: '语言', en: 'Language' },
    menu: 'app', group: 3,
    run: 'app:noop',
  },
  ...LANGUAGE_SUBCOMMANDS,
]
