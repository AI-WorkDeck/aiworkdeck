// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { startExternalFileDrag } from '../../src/utils/fileLocalDrag.js'

const source = readFileSync(new URL('../../src/components/FileTree.vue', import.meta.url), 'utf8')
const body = source.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"]\s*$/gm, '')
  .replace('export default {', 'return {')

function makeVm(overrides = {}) {
  const calls = { emits: [], renames: [], dialogs: [], deletes: [], focused: 0, scrolled: 0 }
  const stubs = {
    FileTypeIcon: {}, TagChip: {}, TagSelector: {}, TagManager: {}, ICONS: {},
    renameFile: async (...args) => { calls.renames.push(args); return { name: args[2] } },
    deleteFile: async (...args) => calls.deletes.push(args),
    showDialog: async options => { calls.dialogs.push(options); return { confirm: false } },
    ...overrides,
  }
  const options = new Function(...Object.keys(stubs), body)(...Object.values(stubs))
  const vm = { ...options.data(), projectId: 42, selectionMode: false, showTree: true,
    displayFiles: [], allFiles: [], checkedIds: [],
    $t: key => key, $emit: (...args) => calls.emits.push(args), $nextTick: fn => fn(),
    $el: { focus: () => calls.focused++, querySelectorAll: () => [] },
  }
  for (const [key, method] of Object.entries(options.methods)) vm[key] = method.bind(vm)
  vm.loadFiles = async () => {}
  vm.calls = calls
  return vm
}
function event(key, extra = {}) {
  return { key, preventDefault() { this.defaultPrevented = true }, stopPropagation() {}, ...extra }
}
function rows(vm, count = 3) {
  vm.displayFiles = Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `${i + 1}.txt`, parentId: null }))
  vm.allFiles = [...vm.displayFiles]
  return vm.displayFiles
}
globalThis.uni = { showToast() {}, $emit() {} }

test('directions select visible rows from the first item without opening files or toggling checks', async () => {
  const vm = makeVm(); rows(vm)
  vm.files = [{ id: 999, name: 'hidden' }, ...vm.displayFiles]
  await vm.handleKeyDown(event('ArrowDown'))
  assert.equal(vm.selectedFileId, 1)
  await vm.handleKeyDown(event('ArrowDown'))
  assert.equal(vm.selectedFileId, 2)
  assert.deepEqual(vm.multiSelectedIds, [2])
  assert.equal(vm.calls.emits.some(([name]) => name === 'file-select'), false)
  vm.selectionMode = true; vm.checkedMap = { 1: true }
  await vm.handleKeyDown(event('ArrowUp'))
  assert.equal(vm.selectedFileId, 1)
  assert.deepEqual(vm.checkedMap, { 1: true })
})

test('left and right expand/collapse then navigate parent and child', async () => {
  const vm = makeVm()
  const folder = { id: 1, name: 'folder', isFolder: true, parentId: null }
  const child = { id: 2, name: 'child', parentId: 1 }
  vm.displayFiles = [folder, child]; vm.allFiles = [...vm.displayFiles]
  vm.selectedFileId = 1
  vm.toggleFolder = id => vm.expandedFolders.has(id) ? vm.expandedFolders.delete(id) : vm.expandedFolders.add(id)
  await vm.handleKeyDown(event('ArrowRight')); assert.equal(vm.expandedFolders.has(1), true)
  await vm.handleKeyDown(event('ArrowRight')); assert.equal(vm.selectedFileId, 2)
  await vm.handleKeyDown(event('ArrowLeft')); assert.equal(vm.selectedFileId, 1)
  await vm.handleKeyDown(event('ArrowLeft')); assert.equal(vm.expandedFolders.has(1), false)
})

test('navigation reveals the 101st sibling before scrolling; recycle uses visible recycle rows', async () => {
  const vm = makeVm(); rows(vm, 101)
  vm.selectedFileId = 100
  vm.$el.querySelectorAll = () => [{ getAttribute: () => '101', scrollIntoView: () => vm.calls.scrolled++ }]
  await vm.handleKeyDown(event('ArrowDown'))
  assert.equal(vm.selectedFileId, 101)
  assert.equal(vm.revealCounts[vm.windowParentKey(null)], 101)
  assert.equal(vm.calls.scrolled, 1)
  vm.viewMode = 'recycle'; vm.displayFiles = [{ id: 777, name: 'recycled' }]
  await vm.handleKeyDown(event('ArrowDown'))
  assert.equal(vm.selectedFileId, 777)
})

test('Enter renames one selected item, Escape cancels, native value wins over delayed v-model', async () => {
  const vm = makeVm(); rows(vm); vm.selectedFileId = 1; vm.multiSelectedIds = [1]
  await vm.handleKeyDown(event('Enter')); assert.equal(vm.renamingId, 1)
  vm.tempRenameValue = 'draft'
  await vm.handleRenameKeydown(event('Escape'))
  assert.equal(vm.renamingId, null); assert.equal(vm.calls.renames.length, 0)
  await vm.handleKeyDown(event('Enter'))
  await vm.handleRenameKeydown(event('Enter', { target: { value: 'latest.txt' } }))
  assert.deepEqual(vm.calls.renames, [[42, 1, 'latest.txt']])
  assert.equal(vm.calls.focused, 2)
  vm.multiSelectedIds = [1, 2]
  await vm.handleKeyDown(event('Enter')); assert.equal(vm.renamingId, null)
})

test('IME, editing targets, controls, dialogs and repeated destructive keys leave tree untouched', async () => {
  const vm = makeVm(); rows(vm); vm.multiSelectedIds = [1]; vm.selectedFileId = 1
  for (const key of ['Delete', 'Backspace', 'Enter', 'ArrowDown']) {
    await vm.handleKeyDown(event(key, { isComposing: true }))
    await vm.handleKeyDown(event(key, { keyCode: 229 }))
    await vm.handleKeyDown(event(key, { target: { closest: () => ({}) } }))
  }
  await vm.handleKeyDown(event('Delete', { repeat: true }))
  vm.showFolderSelector = true; await vm.handleKeyDown(event('Delete'))
  assert.equal(vm.calls.dialogs.length, 0); assert.equal(vm.renamingId, null); assert.equal(vm.selectedFileId, 1)
  vm.handleRename(vm.allFiles[0]); vm.renameComposing = true
  await vm.handleRenameKeydown(event('Enter')); await vm.handleRenameConfirm({ detail: { value: 'wrong' } })
  assert.equal(vm.renamingId, 1); assert.equal(vm.calls.renames.length, 0)
})

test('Delete and Mac Backspace use existing confirmation, cancellation performs no delete', async () => {
  const vm = makeVm(); rows(vm); vm.selectedFileId = 1; vm.multiSelectedIds = [1]
  await vm.handleKeyDown(event('Delete'))
  await vm.handleKeyDown(event('Backspace', { metaKey: true }))
  assert.equal(vm.calls.dialogs.length, 2)
  assert.equal(vm.calls.dialogs.every(d => d.danger), true)
  assert.deepEqual(vm.calls.deletes, [])
  vm.multiSelectedIds = [1, 2]
  let release
  vm.showDeleteConfirmDialog = () => new Promise(resolve => { release = resolve })
  const pending = vm.handleKeyDown(event('Delete'))
  assert.deepEqual(vm.deleteBatchIds, [1, 2]); assert.equal(vm.deleteIsBatch, true)
  await vm.handleKeyDown(event('Delete'))
  assert.equal(vm.keyboardDeletePending, true)
  release(); await pending; assert.equal(vm.keyboardDeletePending, false)
})

test('focus belongs to the current tree and does not steal input focus', () => {
  const vm = makeVm()
  vm.focusTree({ target: { closest: () => ({}) } }); assert.equal(vm.calls.focused, 0)
  vm.focusTree({ target: { closest: () => null } }); assert.equal(vm.calls.focused, 1)
  assert.doesNotMatch(source.slice(source.indexOf('    focusTree('), source.indexOf('    toggleSortMenu(')), /document\.querySelector/)
})

test('recycle delete stays hard, read-only and deselected rows never delete or rename', async () => {
  const vm = makeVm(); rows(vm); vm.viewMode = 'recycle'; vm.recycleBin = [...vm.allFiles]
  vm.selectedFileId = 1; vm.multiSelectedIds = [1]
  await vm.handleKeyDown(event('Enter')); assert.equal(vm.renamingId, null)
  await vm.handleKeyDown(event('Delete')); assert.equal(vm.deleteMode, 'hard')
  vm.viewMode = 'files'; vm.allFiles[0].readOnly = true
  await vm.handleKeyDown(event('Enter')); await vm.handleKeyDown(event('Delete'))
  assert.equal(vm.calls.dialogs.length, 1); assert.equal(vm.renamingId, null)
  vm.allFiles[0].readOnly = false; vm.multiSelectedIds = []
  await vm.handleKeyDown(event('Delete')); assert.equal(vm.calls.dialogs.length, 1)
})

// Actual uni-h5 shape: key/code survive, but target is a plain metadata object;
// modifier, IME, repeat and defaultPrevented flags only exist on window.event.
function uniKey(key) {
  return { type: 'keydown', key, code: key, target: { id: '', dataset: {} }, currentTarget: {} }
}

test('uni key-bearing wrappers use native target, flags and preventDefault rather than losing safety checks', async () => {
  const vm = makeVm(); rows(vm); vm.selectedFileId = 1; vm.multiSelectedIds = [1]
  const previous = globalThis.window
  try {
    for (const flags of [
      { target: { closest: () => ({}) } }, { defaultPrevented: true },
      { isComposing: true }, { keyCode: 229 }, { repeat: true }, { altKey: true }, { shiftKey: true },
    ]) {
      globalThis.window = { event: event('Delete', { type: 'keydown', ...flags }) }
      await vm.handleKeyDown(uniKey('Delete'))
    }
    assert.equal(vm.calls.dialogs.length, 0)
    globalThis.window = { event: event('Enter', { type: 'keydown', ctrlKey: true }) }
    await vm.handleKeyDown(uniKey('Enter')); assert.equal(vm.renamingId, null)
    const native = event('ArrowDown', { type: 'keydown', target: { closest: () => null } })
    globalThis.window = { event: native }
    await vm.handleKeyDown(uniKey('ArrowDown'))
    assert.equal(vm.selectedFileId, 2); assert.equal(native.defaultPrevented, true)
    assert.equal(vm.calls.emits.some(([name]) => name === 'file-select'), false)
  } finally { globalThis.window = previous }
})

test('uni mousedown wrappers cannot steal input focus and unrelated native events are ignored', () => {
  const vm = makeVm(); const previous = globalThis.window
  try {
    globalThis.window = { event: { type: 'mousedown', target: { closest: () => ({}) } } }
    vm.focusTree({ type: 'mousedown', target: { dataset: {} } })
    assert.equal(vm.calls.focused, 0)
    globalThis.window = { event: { type: 'keydown', target: { closest: () => null } } }
    vm.focusTree({ type: 'mousedown', target: { closest: () => ({}) } })
    assert.equal(vm.calls.focused, 0)
    vm.focusTree(); assert.equal(vm.calls.focused, 1)
  } finally { globalThis.window = previous }
})

test('uni rename keydown and confirm preserve IME guards and the actual input value', async () => {
  const vm = makeVm(); rows(vm); vm.handleRename(vm.allFiles[0]); const previous = globalThis.window
  try {
    globalThis.window = { event: event('Enter', { type: 'keydown', isComposing: true, target: { value: 'unfinished' } }) }
    await vm.handleRenameKeydown(uniKey('Enter'))
    await vm.handleRenameConfirm({ type: 'confirm', detail: { value: 'unfinished' }, target: {} })
    assert.equal(vm.calls.renames.length, 0); assert.equal(vm.renamingId, 1)
    globalThis.window = { event: event('Enter', { type: 'keydown', target: { value: 'actual.txt' } }) }
    await vm.handleRenameKeydown(uniKey('Enter'))
    assert.deepEqual(vm.calls.renames, [[42, 1, 'actual.txt']])
    vm.handleRename(vm.allFiles[1])
    globalThis.window = { event: event('Enter', { type: 'keydown', target: { value: 'confirmed.txt' } }) }
    await vm.handleRenameConfirm({ type: 'confirm', detail: { value: 'stale.txt' }, target: {} })
    assert.deepEqual(vm.calls.renames[1], [42, 2, 'confirmed.txt'])
  } finally { globalThis.window = previous }
})

test('installed uni Input actually forwards composition events for every inline rename input', async () => {
  const runtime = readFileSync(new URL('../../node_modules/@dcloudio/uni-h5/dist/uni-h5.es.js', import.meta.url), 'utf8')
  const start = runtime.indexOf('  function initField() {')
  const end = runtime.indexOf('  watch([() => state2.selectionStart', start)
  assert.ok(start >= 0 && end > start, 'locate the installed Input event registration implementation')
  const inputs = [...source.matchAll(/<input\b[^>]*class="rename-input"[^>]*\/>/g)].map(match => match[0])
  assert.equal(inputs.length, 3)
  for (const input of inputs) {
    const vm = makeVm(); rows(vm); vm.handleRename(vm.allFiles[0])
    const handlers = new Map()
    const field = { value: '候选字', selectionEnd: 3, addEventListener: (type, fn) => handlers.set(type, fn) }
    const props2 = { ignoreCompositionEvent: !input.includes(':ignore-composition-event="false"') }
    const trigger = type => {
      const expression = input.match(new RegExp(`@${type}="([^"]+)"`))?.[1]
      if (expression) new Function(`with(this) { ${expression} }`).call(vm)
    }
    const vars = { fieldRef: { value: field }, state2: {}, props2, trigger, beforeInput: null,
      isFunction: value => typeof value === 'function', triggerInput: () => {},
      checkSelection: () => {}, checkCursor: () => {}, getFieldSelectionEnd: value => value.selectionEnd,
    }
    new Function(...Object.keys(vars), runtime.slice(start, end) + '\ninitField();')(...Object.values(vars))
    const composing = { type: 'compositionstart', data: '候选', stopPropagation() { this.stopped = true } }
    handlers.get('compositionstart')(composing)
    assert.equal(composing.stopped, true, 'uni consumes the native event internally')
    assert.equal(vm.renameComposing, true, 'the component must receive uni’s forwarded event')
    await vm.handleRenameConfirm({ type: 'confirm', detail: { value: '候选' } })
    assert.equal(vm.calls.renames.length, 0)
    handlers.get('compositionend')({ type: 'compositionend', data: '候选字', stopPropagation() {} })
    assert.equal(vm.renameComposing, false)
    await vm.handleRenameConfirm({ type: 'confirm', detail: { value: '完成.txt' } })
    assert.deepEqual(vm.calls.renames, [[42, 1, '完成.txt']])
  }
})

test('a vanished member rejects the entire selected drag rather than silently exporting the survivor', () => {
  const dragged = [], prefetched = [], toasts = []
  const vm = makeVm({
    host: { fs: { startDrag: paths => { dragged.push(paths); return { ok: true } } } },
    startExternalFileDrag, getApiBaseUrl: () => '', getAuthHeaders: () => ({}),
    nativeEvent: e => e, nativeDataTransfer: () => null,
    getFileLocalPath: () => {}, prefetchLocalFilePath: id => prefetched.push(id),
  })
  rows(vm, 2); vm.allFiles[0].localPath = '/tmp/kept.txt'
  vm.multiSelectedIds = [1, 2]; vm.allFiles = [vm.allFiles[0]]
  assert.deepEqual(vm.externalDragItems(vm.allFiles[0]), [vm.allFiles[0], undefined])
  vm.onItemPrimeDrag(vm.allFiles[0]); assert.deepEqual(prefetched, [1])
  vm.recordDragStartPoint = () => {}
  vm.rootDropActive = vm.externalDragActive = vm.stagingDragOver = vm.isAnyDragging = true
  const previous = globalThis.uni
  globalThis.uni = { $emit() {}, showToast: message => toasts.push(message.title) }
  try { vm.handleDragStart({}, vm.allFiles[0], 0) } finally { globalThis.uni = previous }
  assert.deepEqual(dragged, [], 'even the surviving file must not reach native drag')
  assert.deepEqual(toasts, ['fileTree.externalDragFailed'])
  assert.equal(vm.draggedFileId, 1, 'native failure does not cancel the independent internal HTML drag')
  vm.handleDragEnd()
  assert.equal(vm.rootDropActive || vm.externalDragActive || vm.stagingDragOver || vm.isAnyDragging, false)
})
