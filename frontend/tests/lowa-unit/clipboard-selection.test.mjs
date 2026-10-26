// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const source = fs.readFileSync(new URL('../../src/zetaoffice/public/office_thread.js', import.meta.url), 'utf8')
const helpers = source.slice(source.indexOf('function calcClipboardSelection()'), source.indexOf('// Impress 当前幻灯片'))
const copy = source.slice(source.indexOf('  get_selection(p = {}) {'), source.indexOf('  // [verified] locate matches via'))
const paste = source.slice(source.indexOf('  replace_selection(p) {'), source.indexOf('  // [verified] model-native search'))
function fixture(kind, range) {
  const keys = [], writes = []
  const context = { ctrl: { getSelection: () => range }, xModel: { getSheets: () => ({ getByIndex: () => ({ getName: () => 'Data' }) }) },
    isCalcDoc: () => kind === 'calc', isImpressDoc: () => kind === 'impress', activeCalcSelection() { throw Error('must not use toolbar selection fallback') },
    slideFail: message => ({ success: false, message }), colLetterOf: () => 'A', postNativeKeys: input => { keys.push(...input); return { success: true } } }
  vm.createContext(context)
  vm.runInContext(helpers + '\nthis.EXEC = ({' + copy + paste + '})', context)
  context.EXEC.sheet_write_cells = args => { writes.push(args); return { success: true } }
  return { exec: context.EXEC, keys, writes, context }
}
test('101 rows by 51 columns copy completely in one range read', () => {
  let reads = 0
  const h = fixture('calc', { getRangeAddress: () => ({ StartRow: 0, EndRow: 100, StartColumn: 0, EndColumn: 50, Sheet: 0 }),
    getDataArray: () => { reads++; return Array.from({ length: 101 }, (_, r) => Array.from({ length: 51 }, (_, c) => `${r}:${c}`)) } })
  const r = h.exec.get_selection(); assert.equal(r.success, true); assert.equal(reads, 1)
  assert.equal(r.text.split('\n').length, 101); assert.equal(r.text.split('\n').at(-1).split('\t').at(-1), '100:50')
})
test('oversized or disjoint selection cannot return a successful partial copy', () => {
  const h = fixture('calc', { getRangeAddress: () => ({ StartRow: 0, EndRow: 999999, StartColumn: 0, EndColumn: 10, Sheet: 0 }), getDataArray() { throw Error('must reject before reading') } })
  assert.equal(h.exec.get_selection().success, false)
  assert.throws(() => fixture('calc', { getCount: () => 2, getByIndex() { throw Error('must not take first range') } }).exec.get_selection(), /连续区域/)
})
test('PPT paste uses the native caret route, with paragraph breaks', () => {
  const h = fixture('impress', { getCount: () => 1 })
  assert.equal(h.exec.replace_selection({ text: '中文\r\nnext', clipboard: true }).success, true)
  assert.equal(h.keys.map(k => k.ch).join(''), '中文\rnext')
  assert.equal(h.keys[2].key, 'RETURN')
})
test('PPT copy reads only selected text; a collapsed caret must not copy the entire shape', () => {
  assert.equal(fixture('impress', { getString: () => 'selected' }).exec.get_selection({ clipboard: true }).text, 'selected')
  assert.equal(fixture('impress', { getCount: () => 1, getByIndex: () => ({ getString: () => 'entire shape' }) }).exec.get_selection({ clipboard: true }).text, '')
})

test('plugin shape replacement keeps its model-edit contract and does not post user key events', () => {
  const h = fixture('impress', { getCount: () => 1 })
  h.context.activeImpressContext = () => ({ selectedShape: {}, selectedShapeName: 'Second', slideNumber: 2 })
  const edits = []
  h.exec.slide_set_shape_text = p => { edits.push(p); return { success: true } }
  assert.equal(h.exec.replace_selection({ text: 'replace shape', shapeName: 'Second' }).success, true)
  assert.equal(edits[0].shapeName, 'Second'); assert.deepEqual(h.keys, [])
})


test('Calc clipboard cut clears the exact range contents while retaining formatting', () => {
  const cleared = []
  const h = fixture('calc', { getRangeAddress: () => ({ StartRow: 0, EndRow: 100, StartColumn: 0, EndColumn: 0, Sheet: 0 }), clearContents: flags => cleared.push(flags) })
  const code = source.slice(source.indexOf('  delete_backward(p = {}) {'), source.indexOf('  delete_forward() {'))
  h.context.nativeKeyDoc = () => true
  vm.runInContext('this.cut = ({' + code + '}).delete_backward', h.context)
  assert.equal(h.context.cut({ clipboard: true }).success, true)
  assert.deepEqual(cleared, [23])
  assert.deepEqual(h.keys, [])
  h.context.cut()
  assert.equal(h.keys[0].key, 'BACKSPACE')
})
