// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createProjectVersionActionRunner, createProjectVersionMergeApi, versionActionMayWrite } from '../../src/utils/projectVersionAction.js'
import { protectProjectVersionEditors } from '../../src/utils/projectVersionEditors.js'
import { pendingDocumentSaveFileIds } from '../../src/utils/checkpointSaveBarrier.js'
import { flushDirtyEditors } from '../../src/pages/project-overview/flushDirtyEditors.js'

const source = readFileSync(new URL('../../src/pages/project-overview/agentClientActions.js', import.meta.url), 'utf8')
let sequence = 0
function harness() {
  const calls = [], receipts = []
  let session = 'session', executed = false
  const env = {
    createProjectVersionActionRunner, createProjectVersionMergeApi, versionActionMayWrite, protectProjectVersionEditors, pendingDocumentSaveFileIds, flushDirtyEditors,
    setGlobalOverlay: active => calls.push(active ? 'block' : 'unblock'),
    getApiBaseUrl: () => 'local', getSessionId: () => session, getCurrentUser: () => ({ id: 4 }), getCloudAccountGeneration: () => 1,
    getProjectVersionActionState: async () => ({ data: { valid: !executed, status: executed ? 'succeeded' : 'prepared', projectId: vm.projectId, operation: 'commit', result: { success: true }, canContinue: true } }),
    executeProjectVersionAction: async () => { executed = true; calls.push('execute'); return { data: { status: 'succeeded', result: { success: true } } } },
    getVersionStatus: async () => ({ data: { enabled: true } }),
    sendEditorResult: async (...args) => receipts.push(args),
    uni: { showLoading() {}, hideLoading() {}, $emit() {} },
  }
  const body = source.replace(/^import .*$/gm, '').replace(/^export /gm, '') + '\nreturn agentClientActionMethods'
  const methods = new Function(...Object.keys(env), body)(...Object.values(env))
  const vm = { projectId: `host-${++sequence}`, hasNamedProject: true, isClientView: false,
    leftFiles: [], rightFiles: [], _plainTextRefs: {}, _libreRefs: {}, collabRefreshToken: 0,
    $refs: { chatInterface: { currentConversationId: 'conversation' } }, $t: key => key,
    isActiveOverviewInstance: () => true, isDrawioFile: file => file.fileType === 'drawio',
    useLibreEditor: () => false, isPlainTextFile: file => file.fileType === 'txt',
    onVersionPanelStatusChanged: async () => {}, openProjectVersionPanel: () => {},
  }
  for (const [name, fn] of Object.entries(methods)) vm[name] = fn.bind(vm)
  const action = { tool: 'editor_command', action: 'project_version_action', requestId: 'request', conversationId: 'conversation',
    params: { operationId: 'operation', projectId: vm.projectId, operation: 'commit' } }
  return { vm, calls, receipts, action, switchAccount: () => { session = 'another' } }
}

test('无活动文档的项目指令走真实宿主路由并保留结构化回执', async () => {
  const h = harness()
  await h.vm.handleClientAction(h.action)
  assert.deepEqual(h.calls, ['block', 'execute', 'unblock'])
  assert.equal(h.receipts[0][2], true)
  assert.deepEqual(h.receipts[0][3], { success: true, operationId: 'operation', hostReloaded: true, message: null })
})

test('宿主先保存脏文本，完成真实重载之后才确认成功', async () => {
  const h = harness()
  const file = { id: 1, fileType: 'txt' }
  const editor = { file, dirty: true, saving: false,
    flushSave: async () => { h.calls.push('save'); editor.dirty = false; return true },
    prepareCheckpointRestore: async () => { h.calls.push('prepare'); return true },
    reloadFromBackend: async () => { h.calls.push('reload'); return true }, failCheckpointRestore: () => {},
  }
  h.vm.leftFiles.push(file); h.vm._plainTextRefs.left = editor
  await h.vm.handleClientAction(h.action)
  assert.deepEqual(h.calls, ['block', 'save', 'prepare', 'execute', 'reload', 'unblock'])
  assert.equal(h.receipts[0][3].success, true)
})

test('保存期间换账户，旧请求不执行且业务失败不丢 operationId', async () => {
  const h = harness()
  const editor = { file: { id: 1 }, dirty: true,
    flushSave: async () => { editor.dirty = false; h.switchAccount(); return true } }
  h.vm._plainTextRefs.left = editor
  await h.vm.handleClientAction(h.action)
  assert.ok(!h.calls.includes('execute'))
  assert.equal(h.receipts[0][2], true)
  assert.equal(h.receipts[0][3].operationId, 'operation')
  assert.equal(h.receipts[0][3].code, 'aiActionExpired')
})

test('会话不匹配和未关闭流程图都在保存前拒绝', async () => {
  for (const kind of ['conversation', 'diagram']) {
    const h = harness()
    if (kind === 'conversation') h.action.conversationId = 'other'
    else h.vm.leftFiles.push({ id: 2, fileType: 'drawio' })
    await h.vm.handleClientAction(h.action)
    assert.deepEqual(h.calls, [])
    assert.equal(h.receipts[0][3].success, false)
  }
})
