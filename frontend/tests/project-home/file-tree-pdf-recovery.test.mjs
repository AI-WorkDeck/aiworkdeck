// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pdfConversionRecoveryOptions } from '../../src/utils/fileTreePdfActions.js'
const source = readFileSync(new URL('../../src/components/FileTree.vue', import.meta.url), 'utf8')

test('failed Office conversion shows persistent recovery and continues built-in PDF export through a dedicated event', async () => {
  const body = source.match(/    async handleContextConvertToPdf\(\) \{\n([\s\S]*?)\n    \},/)[1]
  let modal, toasts = [], emitted = []
  const item = { id: 7, name: '合同.docx', fileType: 'docx' }
  const uni = { showLoading() {}, hideLoading() {}, showModal: o => { modal = o }, showToast: o => toasts.push(o) }
  const run = new Function('uni', 'convertFileToPdf', 'pdfConversionRecoveryOptions', `return async function () { ${body} }`)(
    uni, async () => { throw new Error('LibreOffice unavailable') }, pdfConversionRecoveryOptions)
  await run.call({ contextMenu: { targetItem: item }, projectId: 1, closeContextMenu() {}, $t: k => k, $emit: (...args) => emitted.push(args) })
  assert.equal(toasts.length, 0)
  assert.equal(modal.showCancel, true)
  assert.match(modal.content, /LibreOffice unavailable/)
  assert.match(modal.content, /pdfRecoveryExport/)
  modal.success({ confirm: false }); assert.deepEqual(emitted, [])
  modal.success({ confirm: true }); assert.deepEqual(emitted, [['file-export-pdf', item]])
})

test('mixed merge recovery explicitly asks for individual export, never silently starts another conversion', () => {
  const items = [{ id: 1, name: 'a.pdf' }, { id: 2, name: 'table.xlsx' }, { id: 3, name: 'b.docx' }]
  const opened = []
  const options = pdfConversionRecoveryOptions({ error: new Error('failed'), items, t: k => k, openFile: f => opened.push(f) })
  assert.match(options.content, /pdfRecoveryMerge/)
  options.success({ confirm: true }); assert.deepEqual(opened, [items[1]])
})

test('image/PDF errors do not offer an inapplicable Office editor recovery', () => {
  const opened = []
  const options = pdfConversionRecoveryOptions({ error: new Error('invalid image'), items: [{ name: 'x.png' }], t: k => k, openFile: f => opened.push(f) })
  assert.equal(options.showCancel, false)
  options.success({ confirm: true }); assert.deepEqual(opened, [])
})
