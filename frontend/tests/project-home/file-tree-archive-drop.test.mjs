// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readArchiveEntryDrag, isArchiveEntryDrag, ARCHIVE_ENTRY_MIME } from '../../src/utils/archiveEntryDrag.js'
import { nativeEvent, nativeDataTransfer, claimExternalDrop } from '../../src/utils/fileTreeExternalDrop.js'
const source = readFileSync(new URL('../../src/components/FileTree.vue', import.meta.url), 'utf8')
const body = source.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"]\s*$/gm, '').replace('export default {', 'return {')
function harness(failure = false) {
  const calls = [], toasts = []
  const stubs = { FileTypeIcon: {}, TagChip: {}, TagSelector: {}, TagManager: {},
    readArchiveEntryDrag, isArchiveEntryDrag, nativeEvent, nativeDataTransfer, claimExternalDrop,
    importArchiveEntry: async (...args) => { calls.push(args); if (failure) throw new Error('extract failed') },
  }
  const options = new Function(...Object.keys(stubs), body)(...Object.values(stubs))
  const vm = { ...options.data(), projectId: 42, showTree: true, $t: key => key,
    loadFiles: async () => calls.push('reload'), windowedDisplayFiles: [{ id: 7, isFolder: true }, { id: 8, parentId: 7 }] }
  Object.assign(vm, Object.fromEntries(Object.entries(options.methods).map(([key, method]) => [key, method.bind(vm)])))
  vm.loadFiles = async () => calls.push('reload')
  vm.isNodeDropTarget = () => false
  globalThis.uni = { showToast: ({ title }) => toasts.push(title) }
  return { vm, calls, toasts }
}
function drop(projectId = 42) {
  const payload = { projectId, fileId: 99, path: 'photos/a.png' }
  return { dataTransfer: { types: [ARCHIVE_ENTRY_MIME, 'Files'], getData: type => type === ARCHIVE_ENTRY_MIME ? JSON.stringify(payload) : '' }, preventDefault() {}, stopPropagation() {} }
}
test('archive entry drops extract a copy into folder, sibling parent, and root; never move original', async () => {
  for (const target of ['folder', 'file', 'root', 'blank']) {
    const { vm, calls } = harness(), event = drop()
    if (target === 'folder' || target === 'file') await vm.handleDrop(event, target === 'folder' ? 0 : 1)
    else if (target === 'root') await vm.onRootDrop(event)
    else await vm.onTreeDrop(event)
    assert.deepEqual(calls, [[42, 99, 'photos/a.png', target === 'folder' || target === 'file' ? 7 : null], 'reload'])
    await vm.onTreeDrop(event)
    assert.equal(calls.length, 2, 'bubbling must not import twice')
  }
})
test('archive drops reject other projects and recycle, and remove highlighting after failure', async () => {
  for (const recycled of [false, true]) {
    const { vm, calls } = harness(); if (recycled) vm.viewMode = 'recycle'
    await vm.onTreeDrop(drop(recycled ? 42 : 43))
    assert.deepEqual(calls, [])
  }
  const { vm, calls, toasts } = harness(true)
  vm.externalDragActive = vm.rootDropActive = vm.stagingDragOver = true; vm.dragOverIndex = 1
  await vm.onTreeDrop(drop())
  assert.deepEqual(toasts, ['extract failed']); assert.equal(calls.length, 1)
  assert.equal(vm.externalDragActive || vm.rootDropActive || vm.stagingDragOver, false)
  assert.equal(vm.dragOverIndex, -1)
})
test('archive drag uses copy feedback without enabling the editor link overlay', () => {
  const { vm } = harness(), event = drop()
  vm.onTreeDragEnter(event); vm.onTreeDragOver(event); vm.handleDragOver(event, 1)
  assert.equal(vm.externalDragActive, true); assert.equal(vm.isAnyDragging, false)
  assert.equal(vm.dragOverIndex, 1); assert.equal(event.dataTransfer.dropEffect, 'copy')
  vm.resetExternalDrag(); assert.equal(vm.externalDragActive, false); assert.equal(vm.dragOverIndex, -1)
})
