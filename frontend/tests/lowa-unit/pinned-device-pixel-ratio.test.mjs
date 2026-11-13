// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 台账 B1：客体页把 devicePixelRatio 钉在启动值，换到像素比不同的屏幕后引擎（Qt 画布）与
// LibreOffice 的排版比例不再错开。真机回归是 tests/desktop-e2e/resize-recenter.mjs；这里只守
// 「钉值脚本在引擎模块之前执行、且换屏后读到的仍是启动值」，CI 里秒级可跑。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const html = fs.readFileSync(path.resolve(here, '../../src/zetaoffice/editor.html'), 'utf8')

test('editor.html pins devicePixelRatio in an inline script before the engine module loads', () => {
  const pinAt = html.indexOf("Object.defineProperty(window, 'devicePixelRatio'")
  const moduleAt = html.indexOf('<script type="module" src="./editor-main.js">')
  assert.ok(pinAt > 0, 'pin script missing')
  assert.ok(moduleAt > pinAt, 'pin must run before editor-main.js (which boots the engine)')
})

test('after a screen change the page still reports the boot ratio', () => {
  // 取第一段内联脚本（editor.html 自己的文件，按固定标记切片即可）
  const open = html.indexOf('<script>') + '<script>'.length
  const inline = html.slice(open, html.indexOf('</script>', open))
  // 模拟浏览器：devicePixelRatio 是随所在屏幕变化的访问器
  let screenDpr = 2
  class Win {}
  Object.defineProperty(Win.prototype, 'devicePixelRatio', { get: () => screenDpr, configurable: true })
  const window = new Win()
  window.location = { search: '' }
  window.document = { documentElement: { classList: { add() {} } } }
  window.URLSearchParams = URLSearchParams
  window.window = window
  vm.runInNewContext(inline, window)
  assert.equal(window.devicePixelRatio, 2)
  screenDpr = 1 // 拖到 1x 外接屏
  assert.equal(window.devicePixelRatio, 2)
})
