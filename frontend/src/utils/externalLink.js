// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { host } from '@/services/host.js'

// 打开外部链接（官网、GitHub 等站外页面）的统一出口。
// - 桌面端（Electron）：走系统浏览器，host.shell.openExternal（preload 暴露，
//   主进程 checkba:shell-open-external 处理）。注意不能依赖 window.open 降级：
//   主进程 setWindowOpenHandler 会把 http(s) 转成 checkba:browser-open-new-tab 事件，
//   而该事件只有 project-overview 页消费，解锁页等场景会静默失效。
// - 浏览器端：host.shell 缺席，走 window.open 新标签页。
export function openExternalUrl(url) {
  if (!url || !/^https?:\/\//i.test(url)) return
  try {
    const shell = host.shell
    if (shell && typeof shell.openExternal === 'function') {
      shell.openExternal(url)
      return
    }
    window.open(url, '_blank')
  } catch (e) {
    console.warn('打开外部链接失败:', e)
  }
}

// Plugin login/checkout must not report "opened" when the browser rejected it.
// Keep the legacy fire-and-forget helper above unchanged for existing callers.
export async function openExternalUrlChecked(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username.length > 0 || url.password.length > 0) throw new Error('Invalid external URL')
  const shell = host.shell
  if (shell && typeof shell.openExternal === 'function') {
    const result = await shell.openExternal(url.href)
    if (result?.ok === false) throw new Error(result.message || 'System browser could not open the page')
    return
  }
  const tab = window.open('', '_blank')
  if (!tab) throw new Error('浏览器阻止打开页面，请允许弹出窗口后重试 / Browser blocked the page; allow pop-ups and retry')
  try {
    tab.opener = null
    tab.location.replace(url.href)
  } catch (error) { tab.close(); throw error }
}
