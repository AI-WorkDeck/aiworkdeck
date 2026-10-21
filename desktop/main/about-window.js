// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const { app, BrowserWindow, shell } = require('electron')
const { t, getAppLanguage } = require('./app-language')

const SOURCE_URL = 'https://github.com/AI-WorkDeck/aiworkdeck'
const LEGAL_URLS = [SOURCE_URL, `${SOURCE_URL}/blob/master/LICENSE`, `${SOURCE_URL}/blob/master/legal/TRADEMARKS.md`]
let aboutWindow = null

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// macOS 原生 About 的 copyright 高度固定，不能承载完整双语许可告示。
// 使用无脚本的本地页面；正文自然换行、滚动，不依赖主工作台是否加载成功。
function aboutHtml() {
  return `<!doctype html><html lang="${getAppLanguage()}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="color-scheme" content="light dark"><title>${t({ zh: '关于 AI WorkDeck', en: 'About AI WorkDeck' })}</title>
<style>
/* Generated from design/tokens/awd-palette.json; parity checked by about-window.test.js. */
:root { --awd-text: #2B2A26; --awd-text-2: #6B675C; --awd-surface: #FCFBF7; --awd-border: #DDD8CA; --awd-accent-text: #2E5A50; }
* { box-sizing: border-box; }
body { margin: 0; padding: 32px; font: 14px/1.65 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: var(--awd-text); background: var(--awd-surface); overflow-wrap: anywhere; }
header { margin-bottom: 26px; }
h1 { margin: 0; font-size: 26px; letter-spacing: -.5px; }
p { margin: 0 0 16px; }
.version { color: var(--awd-text-2); margin: 4px 0 0; }
.english { display: block; color: var(--awd-text-2); margin-top: 4px; }
nav { display: flex; flex-wrap: wrap; gap: 8px 18px; padding: 18px 0; margin: 4px 0 18px; border-top: 1px solid var(--awd-border); border-bottom: 1px solid var(--awd-border); }
a { color: var(--awd-accent-text); text-underline-offset: 3px; }
a:focus-visible { outline: 2px solid currentColor; outline-offset: 4px; }
@media (prefers-color-scheme: dark) { :root { --awd-text: #EDE9DF; --awd-text-2: #B0AA9C; --awd-surface: #221F1A; --awd-border: #3D372E; --awd-accent-text: #89A8A0; } }
</style></head><body><header><h1>AI WorkDeck</h1><p class="version">${t({ zh: '版本', en: 'Version' })} ${escapeHtml(app.getVersion())}</p></header>
<main>
<p>版权所有 2026 北京京微资易科技有限公司及 AI WorkDeck 贡献者<span class="english" lang="en">Copyright 2026 Beijing Jingwei Ziyi Technology Co., Ltd. and AI WorkDeck contributors</span></p>
<p>本软件依 GNU Affero General Public License v3.0 或更高版本发布，不提供任何担保。<span class="english" lang="en">Released under the GNU AGPL v3.0 or later, with ABSOLUTELY NO WARRANTY.</span></p>
<nav aria-label="${t({ zh: '源代码与法律声明', en: 'Source code and legal notices' })}">
<a href="${LEGAL_URLS[0]}" target="_blank" rel="noreferrer">源代码 / Source code</a>
<a href="${LEGAL_URLS[1]}" target="_blank" rel="noreferrer">许可证全文 / Full license</a>
<a href="${LEGAL_URLS[2]}" target="_blank" rel="noreferrer">商标说明 / Trademark notice</a>
</nav>
<p>「AI WorkDeck」为北京京微资易科技有限公司的商标，再分发修改版时不得使用该名称作为产品名。<span class="english" lang="en">“AI WorkDeck” is a trademark of Beijing Jingwei Ziyi Technology Co., Ltd. Modified versions must not use this name as their product name when redistributed.</span></p>
</main></body></html>`
}

function showAboutWindow(parent) {
  // 主窗口 getter 在退出准备期间返回 null，不再新建窗口打断退出。
  if (!parent || parent.isDestroyed()) return
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    if (aboutWindow.isMinimized()) aboutWindow.restore()
    aboutWindow.show()
    aboutWindow.focus()
    return aboutWindow
  }
  const win = new BrowserWindow({
    title: t({ zh: '关于 AI WorkDeck', en: 'About AI WorkDeck' }),
    parent, width: 560, height: 620, minWidth: 380, minHeight: 360,
    show: false, minimizable: false, maximizable: false, autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  })
  aboutWindow = win
  win.setMenu(null)
  win.on('closed', () => { aboutWindow = null })
  win.once('ready-to-show', () => win.show())
  const openLegalLink = (url) => {
    if (LEGAL_URLS.includes(url)) shell.openExternal(url).catch((error) => console.warn('[about] open link failed:', error.message))
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    openLegalLink(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    openLegalLink(url)
  })
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.key === 'Escape' || (input.key.toLowerCase() === 'w' && (input.meta || input.control)))) {
      event.preventDefault()
      win.close()
    }
  })
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(aboutHtml())}`)
  return win
}

module.exports = { showAboutWindow }
