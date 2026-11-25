// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// X-S2 / X5: with the app language on zh-TW, the native menu bar is Traditional — both the
// shell's own items and the labels the renderer pushes (its command table only has {zh,en}).
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-menu-zhtw-'))
let built = null
const handlers = []
const electronId = require.resolve('electron')
require.cache[electronId] = {
  id: electronId, filename: electronId, loaded: true,
  exports: {
    app: { isPackaged: true, getVersion: () => '0.0.0-test', getPath: () => userDataDir, getLocale: () => 'zh-TW', setAboutPanelOptions() {} },
    Menu: { buildFromTemplate: (tpl) => { built = tpl; return {} }, setApplicationMenu() {} },
    ipcMain: { on(ch, fn) { if (ch === 'checkba:menu-state') handlers.push(fn) } },
    dialog: { showMessageBoxSync: () => 0 },
    webContents: { getFocusedWebContents: () => null },
  },
}
const lang = require('../main/app-language')
const { initAppMenu } = require('../main/app-menu')
const TABLE = require('../main/zh-hant-table.json')

function labels(items, out = []) {
  for (const it of items || []) { if (it && it.label) out.push(it.label); if (it && Array.isArray(it.submenu)) labels(it.submenu, out) }
  return out
}

test('zh-TW: renderer-pushed and shell menu labels are Traditional', () => {
  lang.setAppLanguage('zh-TW')
  initAppMenu(() => ({ isDestroyed: () => false, webContents: { send() {}, reload() {} } }))
  for (const fn of handlers) fn({}, { flags: {}, menus: [
    { id: 'file', label: '文件', items: [{ id: 'file.newProject', label: '新建项目…' }, { id: 'file.openFolder', label: '打开文件夹…' }] },
    { id: 'app', items: [{ id: 'app.checkUpdate', label: '检查更新…' }, { id: 'app.settings', label: '设置…' }] },
    { id: 'edit', items: [] },
  ] })
  const all = labels(built)
  assert.ok(all.includes('關於 AI WorkDeck'), all.join(' | '))
  assert.ok(all.includes('檢查更新…'), all.join(' | '))
  assert.ok(all.includes('設定…'), all.join(' | '))
  assert.ok(all.includes('檔案'), 'the File menu reads 檔案')
  const simplified = new Set(Object.keys(TABLE.chars))
  for (const l of all) assert.deepStrictEqual([...l].filter((c) => simplified.has(c)), [], l)
})

test('zh-CN keeps the renderer labels untouched', () => {
  lang.setAppLanguage('zh-CN')
  for (const fn of handlers) fn({}, { flags: {}, menus: [{ id: 'app', items: [{ id: 'app.checkUpdate', label: '检查更新…' }] }, { id: 'edit', items: [] }] })
  assert.ok(labels(built).includes('检查更新…'))
})
