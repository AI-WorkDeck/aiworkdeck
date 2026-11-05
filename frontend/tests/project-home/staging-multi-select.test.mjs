// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 教程问题 86（dev-board#1713）：暂存区只能单选，勾两个复选框后「对比」按钮出不来。
// 根因：列表容器 @mousedown=onMouseDown 在无修饰键时清空选择，复选框的 mousedown
// 冒泡上去先清空、再由 tap 勾上一个，永远只剩一个；行点击走 uni 重建的事件对象，
// 不带 metaKey/ctrlKey，Cmd/Ctrl 多选也失效。
//   cd frontend && node --test tests/project-home/staging-multi-select.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('../../src/components/FileStagingArea.vue', import.meta.url), 'utf8')

function makeVm() {
  const body = SRC.slice(SRC.indexOf('<script>') + 8, SRC.indexOf('</script>'))
    .replace(/^import .*$/gm, '')
    .replace(/export default \{/, 'return {')
  const deps = { ICONS: {}, UnlockHint: {}, FileTypeIcon: {}, host: {} }
  const options = new Function(...Object.keys(deps), body)(...Object.values(deps))
  const vm = Object.assign({}, options.data())
  for (const [k, fn] of Object.entries(options.methods)) vm[k] = fn.bind(vm)
  return vm
}

const inItem = { closest: (sel) => (sel === '.staging-item' ? {} : null) }
const blank = { closest: () => null }

test('复选框/文件行上的 mousedown 不清空已有选择，两个复选框能同时勾上', () => {
  const vm = makeVm()
  vm.onMouseDown({ target: inItem })
  vm.toggleCheck(1)
  vm.onMouseDown({ target: inItem })
  vm.toggleCheck(2)
  assert.deepEqual(vm.selectedIds, [1, 2])
})

test('点列表空白处仍清空选择', () => {
  const vm = makeVm()
  vm.selectedIds = [1, 2]
  vm.onMouseDown({ target: blank })
  assert.deepEqual(vm.selectedIds, [])
})

test('uni 重建的 click 对象不带 metaKey 时，读原生 window.event 做 Cmd 多选', () => {
  const vm = makeVm()
  const prev = globalThis.window
  globalThis.window = { event: { type: 'click', metaKey: false, ctrlKey: false, shiftKey: false } }
  try {
    vm.onItemClick({ id: 1 }, { detail: {} })
    globalThis.window.event = { type: 'click', metaKey: true, ctrlKey: false, shiftKey: false }
    vm.onItemClick({ id: 2 }, { detail: {} })
    assert.deepEqual(vm.selectedIds, [1, 2])
  } finally {
    globalThis.window = prev
  }
})

test('模板：复选框阻止 mousedown 冒泡，行点击用 click', () => {
  assert.match(SRC, /class="checkbox-wrapper" @mousedown\.stop/)
  assert.match(SRC, /@click\.stop="onItemClick\(file, \$event\)"/)
})
