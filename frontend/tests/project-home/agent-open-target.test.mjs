// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createSerialQueue } from '../../src/utils/asyncSerialize.js'
const source = readFileSync(new URL('../../src/pages/project-overview/agentClientActions.js', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '').replace(/export function shouldFlushDocStream[\s\S]*?\n\}\n/, '')
  .replace('export const agentClientActionMethods = {', 'return {')
function fixture(getDetail) {
  let resolve
  const detail = new Promise(r => { resolve = r })
  const calls = [], replies = []
  const methods = new Function('getFileDetail', 'sendEditorResult', 'uni', 'isDocMutatingAction', 'actionBudgetMs', 'createSerialQueue', source)(
    getDetail || (() => detail), async (...args) => replies.push(args), { showToast() {} }, () => false, () => 11000, createSerialQueue)
  const vm = { projectId: 1, $refs: {}, focusedPane: 'left', activeFileIdLeft: 1, activeFileIdRight: null,
    libreOfficeActive: true, libreOfficeExecutor: { fileId: 1, executeCommand: async () => { calls.push(1); return { success: true } } },
    $t: k => k, resolveLibreExecutorFileId: e => e?.fileId,
    openFile(file) { this.activeFileIdLeft = file.id; this.libreOfficeExecutor = { fileId: file.id, executeCommand: async () => { calls.push(file.id); return { success: true } } } },
    ...methods }
  vm.replyIfEditorLoadFailed = async () => false
  return { vm, resolve, calls, replies }
}
const command = { action: 'slide_get_overview', params: {}, conversationId: 'c', editorRunId: 'run1', requestId: 'r' }
for (const ext of ['pptx', 'docx', 'xlsx']) test(`${ext}: wait for the opened target, never execute on reference`, async () => {
  const f = fixture()
  const opening = f.vm.handleEditorOpenFile({ fileId: 2, conversationId: 'c', editorRunId: 'run1' })
  const action = { pptx: 'slide_get_overview', docx: 'get_document_text', xlsx: 'sheet_get_overview' }[ext]
  const executing = f.vm.handleEditorCommand({ ...command, action })
  assert.deepEqual(f.calls, [])
  f.resolve({ id: 2, name: 'new.' + ext }); await opening; await executing
  assert.deepEqual(f.calls, [2])
})
test('failed open blocks commands instead of editing the reference', async () => {
  const f = fixture(); const opening = f.vm.handleEditorOpenFile({ fileId: 2, conversationId: 'c', editorRunId: 'run1' })
  f.resolve(null); await opening; await f.vm.handleEditorCommand(command)
  assert.deepEqual(f.calls, []); assert.equal(f.replies.at(-1)[2], false)
})
test('user switch during detail fetch prevents late opening and writing', async () => {
  const f = fixture(); const opening = f.vm.handleEditorOpenFile({ fileId: 2, conversationId: 'c', editorRunId: 'run1' })
  f.vm.activeFileIdLeft = 3; f.resolve({ id: 2, name: 'new.pptx' }); await opening
  await f.vm.handleEditorCommand(command)
  assert.equal(f.vm.activeFileIdLeft, 3); assert.deepEqual(f.calls, [])
})
test('PDF does not reuse the old Office executor', async () => {
  const f = fixture(); f.vm.openFile = function(file) { this.activeFileIdLeft = file.id }
  const opening = f.vm.handleEditorOpenFile({ fileId: 2, conversationId: 'c', editorRunId: 'run1' })
  f.resolve({ id: 2, name: 'reference.pdf' }); await opening; await f.vm.handleEditorCommand(command)
  assert.deepEqual(f.calls, [])
})
test('timed-out detail lookup cannot open later', async () => {
  const f = fixture(); f.vm.editorBootWaitCapMs = () => 0
  const opening = f.vm.handleEditorOpenFile({ fileId: 2, conversationId: 'c', editorRunId: 'run1' })
  await f.vm.handleEditorCommand(command)
  f.resolve({ id: 2, name: 'new.pptx' }); await opening
  assert.equal(f.vm.activeFileIdLeft, 1); assert.deepEqual(f.calls, [])
})
test('switch after opening blocks commands to the old target', async () => {
  const f = fixture(); const opening = f.vm.handleEditorOpenFile({ fileId: 2, conversationId: 'c', editorRunId: 'run1' })
  f.resolve({ id: 2, name: 'new.pptx' }); await opening
  f.vm.activeFileIdLeft = 3; await f.vm.handleEditorCommand(command)
  assert.deepEqual(f.calls, [])
})
test('superseded conversation opening cannot steal focus', async () => {
  const f = fixture()
  const first = f.vm.handleEditorOpenFile({ fileId: 2, conversationId: 'c', editorRunId: 'run1' })
  const second = f.vm.handleEditorOpenFile({ fileId: 2, conversationId: 'other', editorRunId: 'other1' })
  f.resolve({ id: 2, name: 'new.pptx' }); await Promise.all([first, second])
  await f.vm.handleEditorCommand(command)
  assert.deepEqual(f.calls, [])
})
test('a switch during the awaited load-failure check does not redirect execution', async () => {
  const f = fixture(); const opening = f.vm.handleEditorOpenFile({ fileId: 2, conversationId: 'c', editorRunId: 'run1' })
  f.resolve({ id: 2, name: 'new.pptx' }); await opening
  f.vm.replyIfEditorLoadFailed = async () => { f.vm.activeFileIdLeft = 3; return false }
  await f.vm.handleEditorCommand(command)
  assert.deepEqual(f.calls, [])
})
test('opened target still loading returns retryable booting and can recover', async () => {
  const f = fixture(); f.vm.editorBootWaitCapMs = () => 0
  f.vm.openFile = function(file) { this.activeFileIdLeft = file.id; this.libreOfficeActive = false }
  const opening = f.vm.handleEditorOpenFile({ fileId: 2, conversationId: 'c', editorRunId: 'run1' })
  f.resolve({ id: 2, name: 'new.pptx' }); await opening; await f.vm.handleEditorCommand(command)
  assert.equal(f.replies.at(-1)[3].code, 'EDITOR_BOOTING')
  assert.equal(f.replies.at(-1)[3].retryable, true)
  f.vm.libreOfficeActive = true
  f.vm.libreOfficeExecutor = { fileId: 2, executeCommand: async () => { f.calls.push(2); return { success: true } } }
  await f.vm.handleEditorCommand(command); assert.deepEqual(f.calls, [2])
})
test('new user run can edit its newly selected document without an open event', async () => {
  const f = fixture(); const opening = f.vm.handleEditorOpenFile({ fileId: 2, conversationId: 'c', editorRunId: 'run1' })
  f.resolve({ id: 2, name: 'new.pptx' }); await opening
  f.vm.activeFileIdLeft = 3
  f.vm.libreOfficeExecutor = { fileId: 3, executeCommand: async () => { f.calls.push(3); return { success: true } } }
  await f.vm.handleEditorCommand({ ...command, editorRunId: 'run2', targetFileId: 3 })
  assert.deepEqual(f.calls, [3])
  await f.vm.handleEditorCommand({ ...command, targetFileId: 2 })
  await f.vm.handleEditorOpenFile({ fileId: 2, conversationId: 'c', editorRunId: 'run1' })
  assert.deepEqual(f.calls, [3]); assert.equal(f.vm.activeFileIdLeft, 3)
})
test('explicit target mismatch rejects even without a preceding open', async () => {
  const f = fixture(); await f.vm.handleEditorCommand({ ...command, targetFileId: 2 })
  assert.deepEqual(f.calls, []); assert.equal(f.replies.at(-1)[2], false)
})
test('new run retires an in-flight detail lookup', async () => {
  const f = fixture(); const opening = f.vm.handleEditorOpenFile({ fileId: 2, conversationId: 'c', editorRunId: 'run1' })
  await f.vm.handleEditorCommand({ ...command, editorRunId: 'run2', targetFileId: 1 })
  f.resolve({ id: 2, name: 'new.pptx' }); await opening
  assert.deepEqual(f.calls, [1]); assert.equal(f.vm.activeFileIdLeft, 1)
})
test('legacy commands without run metadata retain active-editor behavior across turns', async () => {
  const f = fixture(); const opening = f.vm.handleEditorOpenFile({ fileId: 2, conversationId: 'c' })
  f.resolve({ id: 2, name: 'new.pptx' }); await opening
  f.vm.activeFileIdLeft = 1
  f.vm.libreOfficeExecutor = { fileId: 1, executeCommand: async () => { f.calls.push(1); return { success: true } } }
  await f.vm.handleEditorCommand({ ...command, editorRunId: undefined })
  assert.deepEqual(f.calls, [1])
})
test('run replaced during load check rejects the already-awaiting command', async () => {
  const f = fixture()
  f.vm.replyIfEditorLoadFailed = async () => { f.vm.acceptAgentEditorRun({ ...command, editorRunId: 'run2' }); return false }
  await f.vm.handleEditorCommand({ ...command, targetFileId: 1 })
  assert.deepEqual(f.calls, [])
})
test('real client_action dispatcher preserves run and target metadata across asynchronous open', async () => {
  const f = fixture()
  let dispatchedCommand
  const execute = f.vm.handleEditorCommand.bind(f.vm)
  f.vm.handleEditorCommand = action => { dispatchedCommand = execute(action); return dispatchedCommand }
  // These are the event shapes emitted by EditorBridgeService and forwarded unchanged by ChatInterface.
  f.vm.handleClientAction({ action: 'doc_open_file', fileId: 2, conversationId: 'c', editorRunId: 'run1' })
  assert.equal(f.vm._agentEditorRuns.get('c').current, 'run1')
  assert.equal(f.vm._agentOpenTargets.get('c').fileId, 2)
  f.vm.handleClientAction({ ...command, tool: 'editor_command', targetFileId: 2 })
  assert.deepEqual(f.calls, [])
  f.resolve({ id: 2, name: 'new.pptx' })
  await dispatchedCommand
  assert.deepEqual(f.calls, [2])
  // The same dispatcher must preserve a subsequent explicit mismatch, not silently drop its field.
  f.vm.handleClientAction({ ...command, editorRunId: 'run2', tool: 'editor_command', targetFileId: 3 })
  await dispatchedCommand
  assert.deepEqual(f.calls, [2]); assert.equal(f.replies.at(-1)[2], false)
})
test('same run asynchronous A then synchronous B replaces target and edits B', async () => {
  const f = fixture(async (_, id) => ({ id, name: id + '.docx' }))
  await f.vm.handleEditorOpenFile({ fileId: 2, conversationId: 'c', editorRunId: 'run1' })
  await f.vm.handleEditorOpenFileSync({ action: 'doc_open_file_sync', params: { fileId: 3 }, requestId: 'sync', conversationId: 'c', editorRunId: 'run1' })
  assert.equal(f.replies.at(-1)[2], true)
  assert.equal(f.vm._agentOpenTargets.get('c').fileId, 3)
  assert.deepEqual(f.calls, [3]) // stream_flush must execute in B, not A.
  await f.vm.handleEditorCommand({ ...command, targetFileId: 3 })
  assert.deepEqual(f.calls, [3, 3])
})
test('synchronous target failure blocks later edits to the old file', async () => {
  const f = fixture(async () => null)
  await f.vm.handleEditorOpenFileSync({ action: 'doc_open_file_sync', params: { fileId: 3 }, requestId: 'sync', conversationId: 'c', editorRunId: 'run1' })
  await f.vm.handleEditorCommand({ ...command, targetFileId: 3 })
  assert.deepEqual(f.calls, []); assert.equal(f.replies.at(-1)[2], false)
})
test('synchronous target waits for its own executor, never stream-flushes the reference', async () => {
  const f = fixture(async (_, id) => ({ id, name: id + '.docx' })); f.vm.editorBootWaitCapMs = () => 0
  f.vm.openFile = function(file) { this.activeFileIdLeft = file.id }
  await f.vm.handleEditorOpenFileSync({ action: 'doc_open_file_sync', params: { fileId: 3 }, requestId: 'sync', conversationId: 'c', editorRunId: 'run1' })
  assert.deepEqual(f.calls, []); assert.equal(f.replies.at(-1)[3].code, 'EDITOR_BOOTING')
})
test('user switch during synchronous detail lookup rejects late open and flush', async () => {
  const f = fixture()
  const opening = f.vm.handleEditorOpenFileSync({ action: 'doc_open_file_sync', params: { fileId: 3 }, requestId: 'sync', conversationId: 'c', editorRunId: 'run1' })
  await Promise.resolve(); await Promise.resolve()
  f.vm.activeFileIdLeft = 4; f.resolve({ id: 3, name: 'B.docx' }); await opening
  assert.equal(f.vm.activeFileIdLeft, 4); assert.deepEqual(f.calls, []); assert.equal(f.replies.at(-1)[2], false)
})
test('current run open target supersedes a stale source hint from an internal open tool', async () => {
  const f = fixture(async (_, id) => ({ id, name: id + '.pptx' }))
  await f.vm.handleEditorOpenFile({ fileId: 2, conversationId: 'c', editorRunId: 'run1' })
  await f.vm.handleEditorCommand({ ...command, targetFileId: 1 })
  assert.deepEqual(f.calls, [2])
})
test('stale source hint cannot authorize a third document after user switches', async () => {
  const f = fixture(async (_, id) => ({ id, name: id + '.pptx' }))
  await f.vm.handleEditorOpenFile({ fileId: 2, conversationId: 'c', editorRunId: 'run1' })
  f.vm.activeFileIdLeft = 3
  f.vm.libreOfficeExecutor = { fileId: 3, executeCommand: async () => { f.calls.push(3); return { success: true } } }
  await f.vm.handleEditorCommand({ ...command, targetFileId: 1 })
  assert.deepEqual(f.calls, []); assert.equal(f.replies.at(-1)[2], false)
})
