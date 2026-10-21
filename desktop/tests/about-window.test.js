// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-about-test-'))
const palette = require('../../design/tokens/awd-palette.json')
const windows = []
const external = []
let template
class FakeWindow extends EventEmitter {
  constructor(options) {
    super()
    this.options = options
    this.webContents = new EventEmitter()
    this.webContents.setWindowOpenHandler = (fn) => { this.openHandler = fn }
    windows.push(this)
  }
  setMenu() {}
  loadURL(url) { this.url = url }
  show() { this.shown = true }
  focus() { this.focused = true }
  isDestroyed() { return !!this.closed }
  isMinimized() { return false }
  close() { this.closed = true; this.emit('closed') }
}
const id = require.resolve('electron')
require.cache[id] = { id, filename: id, loaded: true, exports: {
  app: { getVersion: () => '0.68.0', getLocale: () => 'zh-CN', getPath: () => userData },
  BrowserWindow: FakeWindow,
  shell: { openExternal: async (url) => external.push(url) },
  Menu: { buildFromTemplate: (value) => { template = value; return value }, setApplicationMenu() {} },
  ipcMain: { on() {} },
} }
const { initAppMenu } = require('../main/app-menu')
const { setAppLanguage } = require('../main/app-language')
const { showAboutWindow } = require('../main/about-window')
const parent = { isDestroyed: () => false }
test.after(() => fs.rmSync(userData, { recursive: true, force: true }))

test('About menu opens one scrollable local window with one version and complete bilingual legal notices', () => {
  initAppMenu(() => parent)
  const item = template[0].submenu[0]
  assert.equal(item.role, undefined, 'native fixed-height copyright panel would truncate notices')
  item.click()
  const win = windows.at(-1)
  const html = decodeURIComponent(win.url.split(',').slice(1).join(','))
  assert.equal((html.match(/0\.68\.0/g) || []).length, 1)
  for (const text of ['版权所有', 'Copyright 2026', 'AGPL v3.0 or later', '不提供任何担保', 'ABSOLUTELY NO WARRANTY', '再分发修改版时不得', 'Modified versions must not']) assert.ok(html.includes(text), text)
  const tokenBlocks = [...html.matchAll(/:root \{ ([^}]+) \}/g)].map((match) => match[1])
  for (const [index, mode] of ['light', 'dark'].entries()) {
    for (const role of ['text', 'text-2', 'surface', 'border', 'accent-text']) {
      assert.ok(tokenBlocks[index].includes(`--awd-${role}: ${palette.roles[mode][role]};`), `${mode} ${role} must match the authoritative palette`)
    }
  }
  assert.doesNotMatch(html, /[;{]\s*(?:color|background|border(?:-[a-z]+)?):[^;{}]*#[0-9a-f]/i, 'visual styles must consume semantic tokens')
  assert.match(html, /overflow-wrap: anywhere/)
  assert.doesNotMatch(html, /overflow:\s*hidden|text-overflow:\s*ellipsis/)
  assert.deepEqual(win.options.webPreferences, { nodeIntegration: false, contextIsolation: true, sandbox: true })
  win.emit('ready-to-show')
  assert.equal(win.shown, true)
  item.click()
  assert.equal(windows.length, 1)
  assert.equal(win.focused, true)
  win.close()
})

test('English title and links preserve legal content; only three explicit HTTPS destinations leave About', () => {
  setAppLanguage('en-US')
  const win = showAboutWindow(parent)
  assert.equal(win.options.title, 'About AI WorkDeck')
  const html = decodeURIComponent(win.url.split(',').slice(1).join(','))
  assert.match(html, /Version 0.68.0/)
  const urls = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1])
  assert.equal(urls.length, 3)
  for (const url of urls) assert.deepEqual(win.openHandler({ url }), { action: 'deny' })
  assert.deepEqual(external, urls)
  win.openHandler({ url: 'file:///etc/passwd' })
  win.openHandler({ url: urls[0] + '/unexpected' })
  assert.equal(external.length, 3)
  let prevented = false
  win.webContents.emit('will-navigate', { preventDefault() { prevented = true } }, 'https://example.com')
  assert.equal(prevented, true)
  assert.equal(external.length, 3)
  win.webContents.emit('before-input-event', { preventDefault() {} }, { type: 'keyDown', key: 'Escape' })
  assert.equal(win.closed, true)
})

test('About does not create a window while the main window is unavailable or destroyed', () => {
  const count = windows.length
  showAboutWindow(null)
  showAboutWindow({ isDestroyed: () => true })
  assert.equal(windows.length, count)
})
