// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Workbench side of explorer OCR (tutorial-series#155): request shape, consent dialog, clipboard
// history, file-tree refresh, side-by-side opening, summary and cancel. Real pure utils, stubbed API/UI.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as utils from '../../src/utils/explorerOcr.js'

const source = readFileSync(new URL('../../src/pages/project-overview/explorerOcr.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?from '[^']+'\n/gm, '').replace('export default', 'return')

function fixture({ server, dialog = async () => ({ confirm: true }) } = {}) {
  const calls = []
  const mixin = new Function('recognizeProjectFileText', 'cancelProjectFileOcr', 'promptFeatureNotConfigured', 'showDialog',
    'runOcrBatch', 'summarizeOcrBatch', 'joinCopiedTexts', 'sideBySidePlan', 'openOcrSideBySide', 'ocrOutputName', 'uni', source)(
    async (projectId, fileId, data) => { calls.push(['api', projectId, fileId, { ...data }]); return { code: 0, data: await server(fileId, data, calls) } },
    async (projectId, jobId) => calls.push(['cancelApi', projectId, jobId]),
    e => calls.push(['notConfigured', e.message]),
    async opts => { calls.push(['dialog', opts]); return dialog(opts) },
    utils.runOcrBatch, utils.summarizeOcrBatch, utils.joinCopiedTexts, utils.sideBySidePlan, utils.openOcrSideBySide, utils.ocrOutputName,
    { showToast: p => calls.push(['toast', p.title]) },
  )
  const vm = {
    projectId: 12, leftFiles: [], rightFiles: [], splitMode: false, focusedPane: 'left',
    $t: (key, p) => p ? `${key}${JSON.stringify(p)}` : (key === 'fileTree.ocrOutputSuffix' ? '-识别文字' : key),
    $refs: { fileTree: { loadFiles: async () => calls.push(['reload']) } },
    insertClipboardAndCopy: async (text, opts) => calls.push(['clipboard', text, opts]),
    openFile(file) { calls.push(['open', this.focusedPane, file.id]); (this.focusedPane === 'left' ? this.leftFiles : this.rightFiles).push(file) },
    moveTabTo() {},
    ...mixin.data(), ...mixin.methods,
  }
  return { vm, calls }
}

const pdf = (id, name = `s${id}.pdf`) => ({ id, name, fileType: 'pdf' })

test('copy: one request per file, text joined and saved to clipboard history', async () => {
  const { vm, calls } = fixture({ server: id => ({ status: 'done', text: `T${id}` }) })
  await vm.onExplorerOcr({ action: 'copy', items: [pdf(1), pdf(2)] })
  const api = calls.filter(c => c[0] === 'api')
  assert.deepEqual(api.map(c => [c[1], c[2], c[3].output, c[3].name]), [[12, 1, 'text', undefined], [12, 2, 'text', undefined]])
  assert.equal(api[0][3].jobId, api[1][3].jobId, 'one cancel id for the whole batch')
  assert.deepEqual(calls.find(c => c[0] === 'clipboard').slice(1), ['【s1.pdf】\nT1\n\n【s2.pdf】\nT2', { saveToHistory: true }])
  assert.equal(vm.explorerOcr.running, false)
})

test('consent uses the existing check-to-confirm dialog once, with the server notice text', async () => {
  const { vm, calls } = fixture({ server: (id, data) => data.consentVersion === 'v9'
    ? { status: 'done', file: { id: 100 + id, name: `s${id}-识别文字.txt` } }
    : { status: 'consent_required', notice: 'NOTICE-TEXT', version: 'v9' } })
  await vm.onExplorerOcr({ action: 'txt', items: [pdf(1), pdf(2)] })
  const dialogs = calls.filter(c => c[0] === 'dialog')
  assert.equal(dialogs[0][1].title, 'workbenchOps.ocrConsentTitle')
  assert.ok(dialogs[0][1].content.startsWith('NOTICE-TEXT'))
  assert.equal(dialogs[0][1].checkLabel, 'workbenchOps.ocrConsentCheck', 'must be ticked to confirm, never pre-checked')
  assert.deepEqual(calls.filter(c => c[0] === 'api').map(c => [c[2], c[3].name, c[3].consentVersion || null]),
    [[1, 's1-识别文字.txt', null], [1, 's1-识别文字.txt', 'v9'], [2, 's2-识别文字.txt', 'v9']])
  assert.ok(calls.some(c => c[0] === 'reload'))
})

test('docx: refresh tree, open first result side by side, list the others in the summary', async () => {
  const { vm, calls } = fixture({ server: id => ({ status: 'done', file: { id: 100 + id, name: `s${id}-识别文字.docx` } }) })
  await vm.onExplorerOcr({ action: 'docx', items: [pdf(1), pdf(2)] })
  assert.deepEqual(calls.filter(c => c[0] === 'open').map(c => c.slice(1)), [['left', 1], ['right', 101]])
  assert.equal(vm.splitMode, true)
  const summary = calls.filter(c => c[0] === 'dialog').at(-1)[1]
  assert.match(summary.content, /ocrOthersNotOpened.*s2-识别文字\.docx/)
})

test('one failure is summarised and the others still finish', async () => {
  const { vm, calls } = fixture({ server: id => { if (id === 2) throw new Error('余额不足'); return { status: 'done', text: 'x' } } })
  await vm.onExplorerOcr({ action: 'copy', items: [pdf(1), pdf(2), pdf(3)] })
  assert.equal(calls.filter(c => c[0] === 'api').length, 3)
  const summary = calls.filter(c => c[0] === 'dialog').at(-1)[1]
  assert.match(summary.title, /"done":2,"total":3/)
  assert.match(summary.content, /ocrFailedItem.*s2\.pdf.*余额不足/)
})

test('cancel tells the server (stops the in-flight file) and skips files not started', async () => {
  let vmRef
  const { vm, calls } = fixture({ server: async () => { await vmRef.cancelExplorerOcr(); return { status: 'cancelled' } } })
  vmRef = vm
  await vm.onExplorerOcr({ action: 'txt', items: [pdf(1), pdf(2)] })
  const jobId = calls.find(c => c[0] === 'api')[3].jobId
  assert.deepEqual(calls.find(c => c[0] === 'cancelApi'), ['cancelApi', 12, jobId])
  assert.equal(calls.filter(c => c[0] === 'api').length, 1)
  assert.ok(!calls.some(c => c[0] === 'reload'))
  assert.match(calls.filter(c => c[0] === 'dialog').at(-1)[1].content, /ocrCancelled/)
})

test('a second batch while one runs is refused; OCR not configured prompts setup and stops', async () => {
  const notConfigured = Object.assign(new Error('OCR 未配置'), { featureNotConfigured: true })
  const { vm, calls } = fixture({ server: () => { throw notConfigured } })
  vm.explorerOcr.running = true
  await vm.onExplorerOcr({ action: 'copy', items: [pdf(1)] })
  assert.deepEqual(calls, [['toast', 'workbenchOps.ocrBatchBusy']])
  vm.explorerOcr.running = false
  await vm.onExplorerOcr({ action: 'copy', items: [pdf(1), pdf(2)] })
  assert.equal(calls.filter(c => c[0] === 'api').length, 1)
  assert.ok(calls.some(c => c[0] === 'notConfigured'))
})

test('file tree offers the entry only for OCR targets and hands the whole selection to the host', () => {
  const tree = readFileSync(new URL('../../src/components/FileTree.vue', import.meta.url), 'utf8')
  assert.match(tree, /v-if="canOcrContext\(\)"/)
  for (const action of ['copy', 'txt', 'docx']) assert.match(tree, new RegExp(`handleContextOcr\\('${action}'\\)`))
  assert.match(tree, /\$emit\('ocr-files', \{ action, items \}\)/)
  const page = readFileSync(new URL('../../src/pages/project-overview/project-overview.vue', import.meta.url), 'utf8')
  assert.match(page, /<FileTree[\s\S]*?@ocr-files="onExplorerOcr"/)
})
