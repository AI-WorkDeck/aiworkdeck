// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// V7 D1：AI 工具 compare_docx_redline 经 editor_command 下发宿主动作 compare_docx_files。
// 它必须在「当前有没有开着编辑器」的检查之前被拦下（用的是借来的隐藏引擎），走与工作台
// 「比对稿」同一条 runDocxComparison 链路，成功回新文件 id，失败回错误，引擎一律归还。
// 桩法同 agent-editor-booting-wait：剥壳求值。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createSerialQueue } from '../../src/utils/asyncSerialize.js'
import { DOC_MUTATED_EVENT, DOC_MUTATED_DEBOUNCE_MS, isDocMutatingAction } from '../../src/utils/docEvents.js'
import { actionBudgetMs } from '../../src/composables/zetaOfficeRelay.js'
import { isDocxDoc, runDocxComparison } from '../../src/utils/docxComparison.js'

const SRC = readFileSync(new URL('../../src/pages/project-overview/agentClientActions.js', import.meta.url), 'utf8')

function makeVm({ canWrite = true, runResult } = {}) {
  const sent = []
  const created = []
  const released = []
  const body = SRC
    .replace(/^import .*$/gm, '')
    .replace(/export function shouldFlushDocStream[\s\S]*?\n\}\n/, '')
    .replace(/export const agentClientActionMethods = \{/, 'return {')
  const methods = new Function('sendEditorResult', 'getFileDetail', 'fetchProjectFileBytes', 'createComparisonFile',
    'isDocxDoc', 'runDocxComparison', 'createSerialQueue', 'uni',
    'DOC_MUTATED_EVENT', 'DOC_MUTATED_DEBOUNCE_MS', 'isDocMutatingAction', 'actionBudgetMs', body)(
    async (conversationId, requestId, success, data, error) => { sent.push({ requestId, success, data, error }) },
    async (projectId, fileId) => ({ id: fileId, name: fileId === 1 ? '合同v1.docx' : '合同v2.docx', fileType: 'docx' }),
    async (id) => new Uint8Array([id, 1, 2, 3]),
    async (projectId, payload) => { created.push({ projectId, payload }); return { id: 50, name: payload.name } },
    isDocxDoc, runDocxComparison, createSerialQueue, { showToast: () => {}, $emit: () => {} },
    DOC_MUTATED_EVENT, DOC_MUTATED_DEBOUNCE_MS, isDocMutatingAction, actionBudgetMs)
  const vm = {
    projectId: 9, canWriteProject: canWrite, $t: (k, p) => (p && p.name ? `${k}:${p.name}` : k),
    userDisplayName: '张律师', currentUser: {}, _libreRefs: {},
    libreOfficeActive: false, libreOfficeExecutor: null, // 没开任何编辑器
    acquireLibreHiddenInstance: async () => ({
      run: async (action) => (runResult ? runResult(action) : action === 'export_document'
        ? { success: true, bytes: new Uint8Array([9, 9, 9]) } : { success: true }),
    }),
    releaseLibreHiddenInstance: (h) => released.push(h),
  }
  for (const [k, fn] of Object.entries(methods)) vm[k] = fn.bind(vm)
  return { vm, sent, created, released }
}

const action = { tool: 'editor_command', action: 'compare_docx_files', requestId: 'r1', conversationId: 'c1',
  params: { baseFileId: 1, revisedFileId: 2 } }

test('没开编辑器也能跑：成功回新文件 id，原件字节只读，引擎归还', async () => {
  const { vm, sent, created, released } = makeVm()
  await vm.handleEditorCommand(action)
  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0], { requestId: 'r1', success: true, data: { fileId: 50, fileName: 'editor.compare.resultName:合同v2' }, error: undefined })
  assert.equal(created.length, 1)
  assert.equal(created[0].projectId, 9)
  assert.equal(created[0].payload.baseFileId, 1)
  assert.equal(created[0].payload.revisedFileId, 2)
  assert.equal(released.length, 1)
})

test('没有项目写权限：不借引擎，回错误', async () => {
  const { vm, sent, created, released } = makeVm({ canWrite: false })
  await vm.handleEditorCommand(action)
  assert.equal(sent[0].success, false)
  assert.equal(sent[0].error, 'workbenchOps.compareNoWritePermission')
  assert.equal(created.length, 0)
  assert.equal(released.length, 0)
})

test('原生比较失败：回错误、不落盘、引擎仍归还', async () => {
  const { vm, sent, created, released } = makeVm({ runResult: () => ({ success: false }) })
  await vm.handleEditorCommand(action)
  assert.equal(sent[0].success, false)
  assert.equal(sent[0].error, 'editor.compare.failBuild')
  assert.equal(created.length, 0)
  assert.equal(released.length, 1)
})
