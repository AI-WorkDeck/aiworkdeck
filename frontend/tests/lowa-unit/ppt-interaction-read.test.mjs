// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const source = fs.readFileSync(process.env.PPT_INTERACTION_SOURCE || new URL('../../src/zetaoffice/public/office_thread.js', import.meta.url), 'utf8')
const helper = source.slice(source.indexOf('function activeImpressSelection()'), source.indexOf('function activeImpressContext('))
const method = source.slice(source.indexOf('  get_ui_state(p = {}) {'), source.indexOf('  // 段落样式清单'))
function fixture(selection, count = 1000) {
  let fullReads = 0
  const forbidden = () => { throw Error('interaction must not enumerate or mutate the slide') }
  const page = { getPropertyValue: name => { assert.equal(name, 'Number'); return 3 }, getCount: () => count,
    getByIndex: forbidden, getNotesPage: forbidden, getMasterPage: forbidden }
  const state = { ctrl: { getCurrentPage: () => page, getSelection: () => selection, getPropertyValue: () => 100 },
    xModel: { getDrawPages: () => ({ getCount: () => 5, getByIndex: forbidden }), getMasterPages: forbidden,
      getUndoManager: () => ({ isUndoPossible: () => true, isRedoPossible: () => false }) },
    docSeq: 9, docKindOf: () => 'impress', isCalcDoc: () => false, isImpressDoc: () => true,
    unoSameDrawPage: (a, b) => a === b,
    shapeCharFormat: shape => { assert.equal(shape, selection?.getByIndex?.(0) || selection); return { fontName: 'TestFont', fontSize: 21, bold: true } },
    impressShapeDetail: shape => ({ name: shape.getName(), index: 1, shapeIndex: 0, text: 'selected text', left: 12, top: 15 }),
    activeImpressContext: () => { fullReads++; return { selectedShape: null, slideNumber: 3, currentSlideIndex: 2, slideCount: 5,
      shapeCount: count, selectedShapeIndex: -1, selectedShapeName: '', notesText: 'Notes', masterPages: ['Master'], shapes: [{ name: 'All shapes' }] } },
    errStr: String }
  vm.createContext(state)
  vm.runInContext(helper + '\nthis.read = ({' + method + '}).get_ui_state', state)
  return { read: params => state.read(params), fullReads: () => fullReads }
}
function shape(name = 'Selected') {
  return { getName: () => name, getPosition: () => ({}), getSize: () => ({}), getShapeType: () => 'TextShape', setName() { throw Error('must not name shape') } }
}
test('interaction reads selected object without enumerating a dense slide or inventing an index', () => {
  const selected = shape()
  const h = fixture({ getCount: () => 1, getByIndex: () => selected })
  const r = h.read({ scope: 'selection' })
  assert.equal(h.fullReads(), 0)
  assert.equal(r.scope, 'selection'); assert.equal(r.character.font, 'TestFont'); assert.equal(r.character.bold, true)
  assert.equal(r.impress.slideNumber, 3); assert.equal(r.impress.shapeCount, 1000)
  assert.equal(r.impress.selectedShapeName, 'Selected'); assert.equal(r.impress.selectedShapeIndex, -1)
  assert.equal(r.impress.selectedShape.shapeIndex, -1); assert.equal('index' in r.impress.selectedShape, false)
  assert.equal(r.impress.selectedShape.left, 12); assert.equal(r.undo.canUndo, true)
  for (const field of ['shapes', 'masterPages', 'notesText', 'layout', 'widthPt']) assert.equal(field in r.impress, false)
})
test('empty and text-range selections never fall back to the first slide object', () => {
  for (const selected of [null, { getCount: () => 0 }, { getString: () => 'actual selection' }]) {
    const h = fixture(selected)
    const r = h.read({ scope: 'selection' })
    assert.equal(r.impress.selectedShape, null); assert.equal(r.impress.selectedShapeName, '')
    assert.equal(r.selection.hasShape, false); assert.equal(h.fullReads(), 0)
    assert.equal(r.selection.collapsed, !selected?.getString)
  }
})
test('unnamed selected shapes remain unnamed and have no invented page index', () => {
  const r = fixture(shape('')).read({ scope: 'selection' })
  assert.equal(r.impress.selectedShapeName, ''); assert.equal(r.impress.selectedShapeIndex, -1)
  assert.equal(r.impress.selectedShape.name, '')
})
test('default and unrecognised scopes preserve the complete tool/plugin response', () => {
  const h = fixture(null)
  for (const params of [undefined, {}, { scope: 'other' }]) {
    const r = h.read(params)
    assert.equal('scope' in r, false); assert.equal(r.impress.notesText, 'Notes')
    assert.equal(r.impress.masterPages[0], 'Master'); assert.equal(r.impress.shapes[0].name, 'All shapes')
  }
  assert.equal(h.fullReads(), 3)
})
