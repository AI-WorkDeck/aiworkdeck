// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 教程问题 76（dev-board#1713）：分屏时把右侧文件全部关掉，右窗格空着、分屏不退出。
// 修法：closeFile 关完右侧最后一个标签后调 toggleSplitMode 退出分屏（右侧已空，无需落盘与并入）。
//   cd frontend && node --test tests/project-home/split-auto-exit-on-right-empty.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const load = (rel, exportName, params, args) => {
  const src = readFileSync(new URL(rel, import.meta.url), 'utf8')
  const body = src.replace(/^\s*import[\s\S]*?from\s*'[^']*'\s*$/gm, '')
    .replace(`export const ${exportName} = {`, 'return {')
  return new Function(...params, body)(...args)
}
const tabs = load('../../src/pages/project-overview/fileOpenTabs.js', 'fileOpenTabsMethods',
  ['activityTracker', 'uni'], [{ trackActivePage() {} }, { showToast() {} }])
const split = load('../../src/pages/project-overview/tabDragSplit.js', 'tabDragSplitMethods',
  ['activityTracker', 'rightPanelMaxWidth', 'leftPanelMaxWidth', 'bindHorizontalWheelAll', 'uni', 'window'],
  [{ trackActivePage() {} }, () => 0, () => 0, () => {}, { showToast() {} }, { event: null }])

function workspace(left, right) {
  const vm = {
    splitMode: true, focusedPane: 'right', leftPaneKey: 'files',
    leftFiles: left, rightFiles: right,
    activeFileIdLeft: left[0]?.id ?? null, activeFileIdRight: right[0]?.id ?? null,
    lastActiveIdsByMode: { left: {}, right: {} }, $refs: {}, _libreRefs: {}, _plainTextRefs: {},
    saveActiveIdsByMode() {}, triggerWorkbenchResize() {}, $nextTick(fn) { fn && fn() }, $t: k => k,
  }
  for (const [k, fn] of Object.entries({ ...tabs, ...split })) vm[k] = fn.bind(vm)
  vm.useLibreEditor = () => false
  vm.isPlainTextFile = () => false
  vm.isBrowserTab = () => false
  vm.isOpenInOtherPane = () => false
  vm.evictPdfKeepAlive = () => {}
  Object.defineProperty(vm, 'activeFileLeft', { get() { return this.leftFiles.find(f => f.id === this.activeFileIdLeft) || null } })
  Object.defineProperty(vm, 'activeFileRight', { get() { return this.rightFiles.find(f => f.id === this.activeFileIdRight) || null } })
  return vm
}

test('右侧最后一个标签关掉后自动退出分屏，焦点回左侧', async () => {
  const vm = workspace([{ id: 1, name: 'a.pdf' }], [{ id: 2, name: 'b.pdf' }])
  await vm.closeFile(2, 'right')
  assert.equal(vm.splitMode, false)
  assert.equal(vm.focusedPane, 'left')
  assert.deepEqual(vm.leftFiles.map(f => f.id), [1])
})

test('右侧还剩标签时不退出分屏', async () => {
  const vm = workspace([{ id: 1, name: 'a.pdf' }], [{ id: 2, name: 'b.pdf' }, { id: 3, name: 'c.pdf' }])
  await vm.closeFile(2, 'right')
  assert.equal(vm.splitMode, true)
})

test('左侧关空不触发退出分屏', async () => {
  const vm = workspace([{ id: 1, name: 'a.pdf' }], [{ id: 2, name: 'b.pdf' }])
  await vm.closeFile(1, 'left')
  assert.equal(vm.splitMode, true)
})
