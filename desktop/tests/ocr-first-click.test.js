// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 真实鼠标点顶栏截图按钮 / 框选后的「识别」没反应（tutorial-series#154，dev-board#1713）。
//
// 两个按钮都在 no-drag 区里、@tap 在 H5 编译成 click，DOM 合成点击都能触发；
// 真实点击被吞在 macOS 那一层：主窗口没设 acceptFirstMouse（默认 false），
// 窗口不是 key 时第一下真实点击只用来激活窗口，不进网页。
// 框选窗 show()+focus() 抢走了 key，框选完关掉它后主窗口不一定拿回 key，
// 紧接着点「识别」就是这「第一下」。
// main.js 起手就 new BrowserWindow，node 直接 require 不进来，同 main-window-bounds.test.js 做源码断言。
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const SRC = fs.readFileSync(path.join(__dirname, '../main/main.js'), 'utf8')
const CODE = SRC.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')

test('主窗口接受第一下点击（非 key 时真实点击也进网页）', () => {
  const start = CODE.indexOf('mainWindow = new BrowserWindow(')
  assert.ok(start >= 0, '找不到主窗口的 new BrowserWindow')
  const opts = CODE.slice(start, CODE.indexOf('webPreferences', start))
  assert.match(opts, /acceptFirstMouse:\s*true/)
})

test('框选窗关掉后把焦点还给主窗口', () => {
  const start = CODE.indexOf("ipcMain.handle('checkba:ocr-start-selection'")
  assert.ok(start >= 0, '找不到 checkba:ocr-start-selection')
  const doneStart = CODE.indexOf('const done = (data) =>', start)
  assert.ok(doneStart > start, '找不到框选结束的 done()')
  const done = CODE.slice(doneStart, CODE.indexOf('ipcMain.once(resultChannel', doneStart))
  const close = done.indexOf('closeOcrSelectWin()')
  assert.ok(close >= 0)
  assert.match(done.slice(close), /mainWindow\.focus\(\)/)
})
