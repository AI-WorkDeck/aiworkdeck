// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { resumePdfExport, fileTreePdfRecoveryMethods } from '../../src/pages/project-overview/fileTreePdfRecovery.js'
const file = { id: 7, name: 'contract.docx' }
const tick = () => new Promise(r => setTimeout(r, 10))
function setup({ existing = false } = {}) {
  const calls = [], tab = { ...file, dirty: true, filePath: '/current' }
  const vm = { projectId: 1, leftFiles: existing ? [tab] : [], rightFiles: [], _libreRefs: {},
    ...fileTreePdfRecoveryMethods,
    activateTab: (...args) => calls.push(['activate', ...args]),
    handleFileTreeOpen(f) { calls.push(['open', f]); this.leftFiles.push({ ...f }) },
  }
  const editor = { file, ready: false, executor: {}, async exportPdf(options) { calls.push(['export', options]); return true } }
  return { vm, editor, calls, tab }
}

test('ordinary file open waits for actual target readiness and exports exactly once', async () => {
  const { vm, editor, calls } = setup()
  const pending = resumePdfExport(vm, file, { pollMs: 1 })
  vm._libreRefs['left:7'] = editor
  await tick(); assert.deepEqual(calls.map(c => c[0]), ['open'])
  editor.ready = true
  assert.equal(await pending, true)
  assert.deepEqual(calls.map(c => c[0]), ['open', 'export'])
  assert.equal(vm.pdfRecovery, null)
})

test('existing dirty tab is activated without assigning stale file metadata or saving', async () => {
  const { vm, editor, calls, tab } = setup({ existing: true })
  vm._libreRefs['left:7'] = editor; editor.ready = true
  assert.equal(await resumePdfExport(vm, { ...file, dirty: false, filePath: '/stale' }), true)
  assert.deepEqual(calls.map(c => c[0]), ['activate', 'export'])
  assert.equal(tab.dirty, true); assert.equal(tab.filePath, '/current')
})

for (const statusKey of ['saveFailed', 'movedSaveFailed']) test(statusKey + ' still permits exporting current edits', async () => {
  const { vm, editor, calls } = setup({ existing: true })
  Object.assign(editor, { ready: true, dirty: true, isError: true, statusKey, docLoadFailed: false })
  editor.retryLoad = () => { throw new Error('must not reload unsaved edits') }
  vm._libreRefs['left:7'] = editor
  assert.equal(await resumePdfExport(vm, file, { retry: true }), true)
  assert.deepEqual(calls.map(c => c[0]), ['activate', 'export'])
})

test('timeout retains the target for an in-place retry', async () => {
  const { vm, editor, calls } = setup()
  assert.equal(await resumePdfExport(vm, file, { timeoutMs: 2, pollMs: 1 }), false)
  assert.equal(vm.pdfRecovery.phase, 'failed')
  vm._libreRefs['left:7'] = editor; editor.ready = true
  assert.equal(await vm.retryFileTreePdfExport(), true)
  assert.equal(calls.filter(c => c[0] === 'open').length, 1)
  assert.equal(calls.filter(c => c[0] === 'export').length, 1)
})

for (const action of ['cancel', 'project', 'close']) test(action + ' prevents late ready from exporting', async () => {
  const { vm, editor, calls } = setup()
  const pending = resumePdfExport(vm, file, { pollMs: 1 })
  vm._libreRefs['left:7'] = editor
  if (action === 'cancel') vm.cancelFileTreePdfExport()
  if (action === 'project') vm.projectId = 2
  if (action === 'close') vm.leftFiles = []
  editor.ready = true
  assert.equal(await pending, false)
  assert.equal(calls.filter(c => c[0] === 'export').length, 0)
  if (action === 'cancel') assert.equal(vm.leftFiles.length, 1, 'cancel must not close the editor')
})

test('guard also invalidates an export already waiting for engine bytes', async () => {
  const { vm, editor } = setup()
  vm._libreRefs['left:7'] = editor; editor.ready = true
  let finish, guard
  editor.exportPdf = options => { guard = options.isCurrent; return new Promise(r => { finish = r }) }
  const pending = resumePdfExport(vm, file)
  assert.equal(guard(), true)
  vm.leftFiles = []
  assert.equal(guard(), false)
  finish(false)
  assert.equal(await pending, false)
})

test('failed editor gets a local retry without replacing a dirty editor', async () => {
  const { vm, editor } = setup({ existing: true })
  editor.ready = true; editor.docLoadFailed = true; editor.dirty = true
  let reloads = 0; editor.retryLoad = () => { reloads++; editor.docLoadFailed = false }
  vm._libreRefs['left:7'] = editor
  assert.equal(await resumePdfExport(vm, file), false)
  assert.equal(await vm.retryFileTreePdfExport(), false)
  assert.equal(reloads, 0)
  editor.dirty = false
  assert.equal(await vm.retryFileTreePdfExport(), true)
  assert.equal(reloads, 1)
})
