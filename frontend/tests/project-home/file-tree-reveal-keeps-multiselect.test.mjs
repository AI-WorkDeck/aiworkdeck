// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 教程问题 89（dev-board#1713）：资源管理器里 Cmd 多选几个文件后关掉一个标签，多选被清空。
// 根因：关标签 → syncFileTreeSelectionWithActiveTab → FileTree.revealFile 把
// multiSelectedIds 覆盖成 [新激活文件]。修法：多选 ≥2 项时只移动 selectedFileId。
//   cd frontend && node --test tests/project-home/file-tree-reveal-keeps-multiselect.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('../../src/components/FileTree.vue', import.meta.url), 'utf8')

function makeTree() {
  const body = SRC.slice(SRC.indexOf('<script>') + 8, SRC.indexOf('</script>'))
    .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"]\s*$/gm, '')
    .replace(/export default \{/, 'return {')
  // 依赖全部按名字注入空桩：revealFile 用不到它们
  const names = [...new Set([...SRC.slice(0, SRC.indexOf('</script>')).matchAll(/^import\s+(?:\{([^}]*)\}|(\w+))/gm)]
    .flatMap(m => (m[1] || m[2]).split(',').map(s => s.trim().split(/\s+as\s+/).pop()).filter(Boolean)))]
  const options = new Function(...names, body)(...names.map(() => () => {}))
  const vm = Object.assign({}, options.data.call({ $t: k => k }))
  for (const [k, fn] of Object.entries(options.methods)) vm[k] = fn.bind(vm)
  Object.assign(vm, {
    showTree: false, isTagView: false, displayFiles: [],
    saveSnapshotToCache() {}, scheduleRefCountsFetch() {}, $nextTick() {}, $el: null,
    allFiles: [{ id: 1, parentId: null }, { id: 2, parentId: null }, { id: 3, parentId: null }],
  })
  return vm
}

test('多选 ≥2 项时 revealFile 只移动单选焦点，不覆盖多选', () => {
  const vm = makeTree()
  vm.multiSelectedIds = [1, 2]
  assert.equal(vm.revealFile(3), true)
  assert.equal(vm.selectedFileId, 3)
  assert.deepEqual(vm.multiSelectedIds, [1, 2])
})

test('未多选（0/1 项）时仍同步成当前文件', () => {
  const vm = makeTree()
  vm.multiSelectedIds = [1]
  vm.revealFile(3)
  assert.deepEqual(vm.multiSelectedIds, [3])
})

const TABS = readFileSync(new URL('../../src/pages/project-overview/fileOpenTabs.js', import.meta.url), 'utf8')
test('关掉最后一个文件标签（无激活文件）时也保留 ≥2 项多选', () => {
  const body = TABS.replace(/^\s*import[\s\S]*?from\s*'[^']*'\s*$/gm, '')
    .replace('export const fileOpenTabsMethods = {', 'return {')
  const methods = new Function('activityTracker', 'uni', body)({ trackActivePage() {} }, {})
  const tree = { isTagView: false, displayFiles: [], selectedFileId: 1, multiSelectedIds: [1, 2] }
  const vm = { leftPaneKey: 'files', splitMode: false, focusedPane: 'left', leftFiles: [], rightFiles: [],
    activeFileIdLeft: null, activeFileLeft: null, $refs: { fileTree: tree }, isBrowserTab: () => false, $nextTick(fn) { fn() } }
  methods.syncFileTreeSelectionWithActiveTab.call(vm)
  assert.equal(tree.selectedFileId, null)
  assert.deepEqual(tree.multiSelectedIds, [1, 2])
})
