// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 分屏开合 → 各文档按窗格宽度重新适配缩放（引擎侧语义见 tests/lowa-unit/split-fit-zoom.test.mjs）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const VUE = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
const EDITOR = readFileSync(new URL('../../src/components/LibreOfficeEditor.vue', import.meta.url), 'utf8')

test('splitMode 切换（按钮 / 菜单 / 拖标签 / 侧开都走这里）时，所有编辑器实例都重新适配', () => {
  const watcher = VUE.slice(VUE.indexOf('    splitMode() {'), VUE.indexOf('    activeToolKey()'))
  let tick
  const fitted = []
  new Function(watcher.slice(watcher.indexOf('{') + 1).replace(/\},\s*$/, '')).call({
    splitMode: true, pushMenuState() {}, onActiveOfficeFileChanged() {}, rebindTabsWheel() {},
    $nextTick(fn) { tick = fn },
    _libreRefs: { 'left:1': { fitPaneWidth() { fitted.push('left:1') } }, 'left:2': null },
  })
  assert.equal(typeof tick, 'function', '要等 DOM 更新（窗格宽度变了）之后再适配')
  tick()
  assert.deepEqual(fitted, ['left:1'])
})

test('分屏中新打开的文档就绪后也按半宽窗格适配一次', () => {
  const ready = VUE.slice(VUE.indexOf('    onLibreReady(executor, pane, fileId) {'), VUE.indexOf('    openFile(file, options = {}) {'))
  assert.match(ready, /if \(this\.splitMode\) this\._libreRefs\?\.\[pane \+ ':' \+ fileId\]\?\.fitPaneWidth\?\.\(0\)/)
})

test('编辑器：只对已就绪的 Writer 发 set_zoom{fit}，连发只算最后一次，卸载清计时器', () => {
  const method = EDITOR.slice(EDITOR.indexOf('    fitPaneWidth(delayMs = 400) {'), EDITOR.indexOf('    focusEditor() {'))
  assert.match(method, /clearTimeout\(this\._fitWidthTimer\)/)
  assert.match(method, /if \(!this\.ready \|\| !this\.executor \|\| this\.docKind !== 'writer'\) return/)
  assert.match(method, /executeCommand\('set_zoom', \{ fit: 'width' \}\)/)
  assert.match(method, /this\.uiRefreshKey\+\+/)
  assert.match(EDITOR, /beforeUnmount\(\) \{[\s\S]*clearTimeout\(this\._fitWidthTimer\)/)
})
