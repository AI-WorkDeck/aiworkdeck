// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import test from 'node:test'
import { isTabVisibleInPane } from '../../src/pages/project-overview/tabVisibility.js'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../src/pages/project-overview/fileOpenTabs.js', import.meta.url), 'utf8')
const body = source.replace(/^\s*import[\s\S]*?from\s*'[^']*'\s*$/gm, '')
  .replace('export const fileOpenTabsMethods = {', 'return {')
const methods = new Function('activityTracker', 'uni', body)({ trackActivePage() {} }, { showModal() { throw Error('unexpected unsupported file') } })
function workspace() {
  const vm = {
    project: { id: 1 }, leftPaneKey: 'desensitize', sidebarCollapsed: false,
    leftFiles: [], rightFiles: [], splitMode: false, focusedPane: 'left',
    lastActiveIdsByMode: { left: {}, right: {} }, $refs: {},
    isFileTypeSupported: () => true, isBrowserTab: () => false,
    focusPane(pane) { this.focusedPane = pane }, saveActiveIdsByMode() {},
    triggerWorkbenchResize() {}, $nextTick(fn) { fn() },
  }
  for (const [name, method] of Object.entries(methods)) vm[name] = method.bind(vm)
  vm.isFileTypeSupported = () => true
  return vm
}

test('clicking document tabs preserves both the active sidebar and its collapsed state', () => {
  for (const panel of ['desensitize', 'search', 'voice', 'market']) {
    for (const collapsed of [true, false]) {
      const vm = workspace(); vm.leftPaneKey = panel; vm.sidebarCollapsed = collapsed
      vm.activateTab({ id: 12 }, 'left')
      assert.equal(vm.leftPaneKey, panel); assert.equal(vm.sidebarCollapsed, collapsed)
      assert.equal(vm.activeFileIdLeft, 12)
    }
  }
})

test('the visible explorer still follows the selected document', () => {
  const vm = workspace(); vm.leftPaneKey = 'files'
  let revealed
  vm.$refs.fileTree = { revealFile(id) { revealed = id } }
  vm.activateTab({ id: 13 }, 'left')
  assert.equal(revealed, 13)
})

test('reopening the same file with a string id retains its tab identity and state', () => {
  const vm = workspace(), tab = { id: 12, name: 'old.docx', pendingLocator: { quote: 'keep' }, editorState: 'keep' }
  vm.leftFiles.push(tab)
  vm.openFile({ id: '12', name: 'new.docx' })
  assert.equal(vm.leftFiles.length, 1); assert.equal(vm.leftFiles[0], tab)
  assert.equal(vm.activeFileIdLeft, 12); assert.equal(tab.id, 12)
  assert.equal(tab.name, 'new.docx'); assert.equal(tab.editorState, 'keep')
})

test('reopening a file in the other split focuses its existing tab', () => {
  const vm = workspace(); vm.splitMode = true; vm.focusedPane = 'left'
  vm.rightFiles.push({ id: 14, name: 'sample.docx' })
  vm.openFile({ id: 14, name: 'sample.docx' }, { locator: { quote: 'target' } })
  assert.equal(vm.leftFiles.length, 0); assert.equal(vm.rightFiles.length, 1)
  assert.equal(vm.focusedPane, 'right'); assert.equal(vm.activeFileIdRight, 14)
  assert.equal(vm.rightFiles[0].pendingLocator.quote, 'target')
})

test('a tab in a hidden right split is revealed instead of duplicated', () => {
  const vm = workspace(); vm.rightFiles.push({ id: 15 })
  vm.openFile({ id: 15 })
  assert.equal(vm.leftFiles.length, 0); assert.equal(vm.splitMode, true)
  assert.equal(vm.focusedPane, 'right')
})

test('different files with identical names remain separate; repeated opens are synchronous and idempotent', () => {
  const vm = workspace()
  for (let i = 0; i < 10; i++) vm.openFile({ id: 1, name: 'same.docx' })
  vm.openFile({ id: 2, name: 'same.docx' })
  assert.deepEqual(vm.leftFiles.map(f => f.id), [1, 2])
})

const page = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
const visible = page.slice(page.indexOf('    isTabVisible(file) {'), page.indexOf('    startRenameProject()'))
const isTabVisible = new Function('isTabVisibleInPane', 'return ({' + visible + '}).isTabVisible')(isTabVisibleInPane)
test('ordinary documents stay visible throughout sidebar workflows', () => {
  for (const leftPaneKey of ['desensitize', 'market', 'home', 'version', 'files']) {
    assert.equal(isTabVisible.call({ leftPaneKey, isMovablePanel: () => false }, { id: 1, fileType: 'docx' }), true)
  }
})

test('image keyboard browsing replaces the current preview without accumulating tabs', () => {
  const vm = workspace()
  vm.openFile({ id: 1, name: 'one.jpg' })
  vm.handleFileTreeNavigate({ id: 2, name: 'two.PNG' })
  vm.handleFileTreeNavigate({ id: 3, name: 'three.jpg' })
  assert.deepEqual(vm.leftFiles.map(file => file.id), [3])
  assert.equal(vm.activeFileIdLeft, 3)
  vm.leftFiles.push({ id: 4, name: 'four.jpg' })
  vm.handleFileTreeNavigate({ id: '4', name: 'four.jpg' })
  assert.equal(vm.leftFiles.length, 2)
  assert.equal(vm.activeFileIdLeft, 4)
})

test('arrows never replace unrelated editors, special tabs, or dirty previews', () => {
  for (const current of [{ id: 1, name: 'edit.docx' }, { id: 1, name: 'edit.md' },
    { id: 1, name: 'special.jpg', tabType: 'browser' }, { id: 1, name: 'dirty.jpg', isDirty: true }]) {
    const vm = workspace(); vm.leftFiles = [current]; vm.activeFileIdLeft = 1
    vm.handleFileTreeNavigate({ id: 2, name: 'photo.jpg' })
    assert.equal(vm.leftFiles[0], current)
    assert.equal(vm.activeFileIdLeft, 1)
  }
  const vm = workspace(); vm.leftFiles = [{ id: 1, name: 'left.jpg' }]; vm.activeFileIdLeft = 1
  vm.rightFiles = [{ id: 2, name: 'right.docx' }]; vm.activeFileIdRight = 2
  vm.splitMode = true; vm.focusedPane = 'right'
  vm.handleFileTreeNavigate({ id: 3, name: 'third.jpg' })
  assert.equal(vm.activeFileIdLeft, 1); assert.equal(vm.activeFileIdRight, 2)
})

test('Quick Look follows tree navigation without opening tabs; double click opens the selected file', () => {
  const vm = workspace(); let focused = 0
  vm.$refs.fileTree = { focusTree() { focused++ } }
  vm.toggleQuickLook({ id: 1, name: 'a.jpg' })
  vm.handleFileTreeNavigate({ id: 2, name: 'b.jpg' })
  vm.handleFileTreeSelect({ id: 3, name: 'c.jpg' })
  assert.equal(vm.quickLookFile.id, 3)
  assert.equal(vm.leftFiles.length, 0)
  vm.handleFileTreeOpen(vm.quickLookFile)
  assert.equal(vm.quickLookFile, null); assert.equal(vm.activeFileIdLeft, 3)
  assert.equal(focused, 1)
})

test('single image click selects without creating a tab; other files retain single-click opening', () => {
  const vm = workspace()
  vm.handleFileTreeSelect({ id: 1, name: 'one.jpg' })
  assert.equal(vm.leftFiles.length, 0)
  vm.handleFileTreeOpen({ id: 1, name: 'one.jpg' })
  assert.equal(vm.leftFiles.length, 1)
  vm.handleFileTreeSelect({ id: 2, name: 'two.jpg' })
  assert.equal(vm.leftFiles.length, 1); assert.equal(vm.activeFileIdLeft, 2)
  vm.handleFileTreeSelect({ id: 3, name: 'draft.docx' })
  assert.equal(vm.leftFiles.length, 2); assert.equal(vm.activeFileIdLeft, 3)
})


test('archives always reach their preview even when project records have a wpsFileId', () => {
  for (const fileType of ['zip', 'rar', '7z', 'ZIP']) {
    assert.equal(methods.isEditorOpenableFile({ fileType, wpsFileId: 'project_1_doc_archive' }), false)
  }
})

test('openFile, closeFile, and special tabs strictly synchronize FileTree selection with the active tab', async () => {
  const vm = workspace()
  vm.useLibreEditor = () => false
  vm.isPlainTextFile = () => false
  vm.isOpenInOtherPane = () => false
  const tree = {
    selectedFileId: null,
    multiSelectedIds: [],
    revealFile(id) {
      this.selectedFileId = id
      this.multiSelectedIds = [id]
      return true
    },
  }
  vm.$refs.fileTree = tree

  // 1) openFile on first file highlights file 101 in FileTree
  vm.openFile({ id: 101, name: 'first.docx', fileType: 'docx' })
  assert.equal(vm.activeFileIdLeft, 101)
  assert.equal(tree.selectedFileId, 101)

  // 2) openFile on second file (e.g. QuickOpen, AI citation, copy tab) immediately moves highlight to 202
  vm.openFile({ id: 202, name: 'second.docx', fileType: 'docx' })
  assert.equal(vm.activeFileIdLeft, 202)
  assert.equal(tree.selectedFileId, 202)

  // 3) Closing active tab 202 falls back to tab 101 and syncs FileTree highlight back to 101
  await vm.closeFile(202, 'left')
  assert.equal(vm.activeFileIdLeft, 101)
  assert.equal(tree.selectedFileId, 101)

  // 4) Activating a special tab (e.g. settings/market/web) clears FileTree highlight so no stale file stays highlighted
  const settingsTab = { id: '__settings__', name: 'Settings', tabType: 'settings' }
  vm.leftFiles.push(settingsTab)
  vm.activateTab(settingsTab, 'left')
  assert.equal(vm.activeFileIdLeft, '__settings__')
  assert.equal(tree.selectedFileId, null)
  assert.deepEqual(tree.multiSelectedIds, [])
})
