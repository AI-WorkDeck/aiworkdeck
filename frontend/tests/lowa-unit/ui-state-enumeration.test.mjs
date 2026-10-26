// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const worker = fs.readFileSync(new URL('../../src/zetaoffice/public/office_thread.js', import.meta.url), 'utf8')
function source(start, end) {
  const from = worker.indexOf(start), to = worker.indexOf(end, from)
  assert.ok(from >= 0 && to > from, `worker source boundaries: ${start}`)
  return worker.slice(from, to)
}
const namesSource = source('function ensureShapeNames(', '// 形状文字：')
const impressSource = source('function activeImpressContext(', 'function impressShapeDetail(')
const calcSource = source('function activeCalcSelection(', 'function activeCalcRangeName(')
const ensureNames = new Function(namesSource + '\nreturn ensureShapeNames;')()
const { isTableShape, shapeKind } = new Function(source('function isTableShape(', '// 按 shapeName（') + '\nreturn { isTableShape, shapeKind };')()
const sameDrawPage = new Function(source('function unoSameDrawPage(', '// 用 .uno:MovePage') + '\nreturn unoSameDrawPage;')()

test('plain text shapes are classified without reading the unsupported table Model property', () => {
  const reads = []
  const item = {
    supportsService: name => name === 'com.sun.star.drawing.TextShape',
    getPropertySetInfo: () => ({ hasPropertyByName: () => false }),
    getPropertyValue(key) { reads.push(key); throw Error('UnknownPropertyException') },
  }
  assert.equal(shapeKind(item), 'text')
  assert.deepEqual(reads, [], 'catching a native unknown-property exception cannot undo WASM corruption')
})

test('new table shapes remain recognized by their supported Model when service detection fails', () => {
  const reads = [], model = { getRows() {}, getColumns() {} }
  const item = {
    supportsService: () => false,
    getPropertySetInfo: () => ({ hasPropertyByName: key => key === 'Model' }),
    getPropertyValue(key) { reads.push(key); return model },
  }
  assert.equal(shapeKind(item), 'table')
  assert.deepEqual(reads, ['Model'])
  model.getColumns = undefined
  assert.equal(isTableShape(item), false, 'an advertised non-table Model must not become a table')
})

test('a shape with unavailable property metadata is not speculatively queried for Model', () => {
  const reads = []
  const item = {
    getPropertySetInfo() { throw Error('disposed') },
    getPropertyValue(key) { reads.push(key); throw Error('UnknownPropertyException') },
  }
  assert.equal(isTableShape(item), false)
  assert.deepEqual(reads, [])
})

test('selected shapes are rejected as pages without reading their unsupported Number property', () => {
  const reads = []
  const selected = {
    getPropertySetInfo: () => ({ hasPropertyByName: () => false }),
    getPropertyValue(key) { reads.push(key); throw Error('UnknownPropertyException') },
  }
  const page = {
    getPropertySetInfo: () => ({ hasPropertyByName: key => key === 'Number' }),
    getPropertyValue: () => 2,
  }
  assert.equal(sameDrawPage(selected, page), false)
  assert.equal(sameDrawPage(page, selected), false)
  assert.deepEqual(reads, [])
})

test('draw page identity still compares supported Number values across UNO wrappers', () => {
  const page = number => ({
    getPropertySetInfo: () => ({ hasPropertyByName: key => key === 'Number' }),
    getPropertyValue: () => number,
  })
  assert.equal(sameDrawPage(page(3), page(3)), true)
  assert.equal(sameDrawPage(page(3), page(4)), false)
  const unavailable = { getPropertySetInfo() { throw Error('disposed') } }
  assert.equal(sameDrawPage(unavailable, unavailable), true)
  assert.equal(sameDrawPage(unavailable, page(3)), false)
})

function shape(name, kind = 'text', text = '正文') {
  return {
    name, kind, text, writes: [],
    getName() { return this.name },
    setName(value) { this.name = value; this.writes.push(value) },
    getPosition: () => ({ X: 100, Y: 200 }),
    getSize: () => ({ Width: 300, Height: 400 }),
  }
}
function drawPage(shapes) {
  return {
    shapes, visits: [],
    getCount() { return this.shapes.length },
    getByIndex(i) { this.visits.push(i); if (!this.shapes[i]) throw Error('removed'); return this.shapes[i] },
    getPropertyValue: key => ({ Number: 2, Width: 28000, Height: 15750, Layout: 1 })[key],
    getMasterPage: () => ({ getName: () => '母版二' }),
    getNotesPage: () => ({ text: '备注完整正文' }),
  }
}
function impress(page, selected = null) {
  const state = {
    xModel: {
      getDrawPages: () => ({ getCount: () => 7 }),
      getMasterPages: () => ({ getCount: () => 2, getByIndex: i => ({ getName: () => ['母版一', '母版二'][i] }) }),
    },
    ctrl: { getCurrentPage: () => page, getSelection: () => selected ? { getCount: () => 1, getByIndex: () => selected } : null },
    hmmToPt: value => value / 100, notesPageText: notes => notes.text,
    layoutNameOf: () => '标题+内容', locatePageIndex: () => 1,
    shapeKind: item => item.kind, shapeText: item => item.text,
    unoSameDrawPage: (a, b) => a === b,
    resolveShape: (owner, p) => {
      const index = owner.shapes.findIndex(item => item?.name === p.shapeName)
      return index < 0 ? {} : { index, shape: owner.shapes[index], name: owner.shapes[index].name }
    },
  }
  return new Function(...Object.keys(state), namesSource + impressSource + '\nreturn activeImpressContext;')(...Object.values(state))
}

test('named Impress shapes are acquired only once during name validation', () => {
  const items = Array.from({ length: 100 }, (_, i) => shape('shape-' + i))
  const page = drawPage(items)
  ensureNames(page)
  assert.deepEqual(items.map(item => item.name), items.map((_, i) => 'shape-' + i))
  assert.ok(items.every(item => item.writes.length === 0))
  assert.equal(page.visits.length, items.length, 'named shapes must not cross UNO twice just to check their names')
})

test('unnamed shapes avoid all existing generated names, including later shapes', () => {
  const items = [shape('__awd_shape_0'), shape(''), shape('__awd_shape_2'), shape('')]
  const page = drawPage(items)
  ensureNames(page)
  assert.deepEqual(items.map(item => item.name), ['__awd_shape_0', '__awd_shape_1', '__awd_shape_2', '__awd_shape_3'])
  assert.deepEqual(items.map(item => item.writes), [[], ['__awd_shape_1'], [], ['__awd_shape_3']])
  assert.deepEqual(page.visits, [0, 1, 2, 3], 'unnamed references must be reused from the same acquisition pass')
})

test('unavailable name access and setters do not prevent other shapes receiving unique names', () => {
  const missingGetter = shape(''); delete missingGetter.getName
  const throwingGetter = shape(''); throwingGetter.getName = () => { throw Error('not named') }
  const missingSetter = shape(''); delete missingSetter.setName
  const throwingSetter = shape(''); throwingSetter.setName = () => { throw Error('read only') }
  const last = shape('')
  const page = drawPage([shape('__awd_shape_0'), missingGetter, throwingGetter, missingSetter, throwingSetter, last])
  assert.doesNotThrow(() => ensureNames(page))
  assert.equal(missingGetter.name, '__awd_shape_1')
  assert.equal(throwingGetter.name, '__awd_shape_2')
  assert.equal(missingSetter.name, '')
  assert.equal(throwingSetter.name, '')
  assert.equal(last.name, '__awd_shape_5')
})

test('shape names are rediscovered after page structure changes between calls', () => {
  const old = shape(''), page = drawPage([old])
  ensureNames(page)
  assert.equal(old.name, '__awd_shape_0')
  const inserted = shape(''), later = shape('__awd_shape_1')
  page.shapes = [inserted, later, old]
  ensureNames(page)
  assert.equal(inserted.name, '__awd_shape_2')
  assert.equal(old.name, '__awd_shape_0')
  assert.equal(later.name, '__awd_shape_1')
})

test('Impress context preserves complete metadata while acquiring each shape once', () => {
  const title = shape('title', 'title', '题目'), selected = shape('body', 'text', '正文'.repeat(30))
  const table = shape('table', 'table', '')
  const page = drawPage([title, selected, table])
  const read = impress(page, selected), result = read()
  assert.equal(result.page, page)
  assert.equal(result.targetShape, selected)
  assert.equal(result.selectedRawShape, selected)
  assert.equal(result.fallbackShape, title)
  assert.equal(result.selectedShapeName, 'body')
  assert.equal(result.selectedShapeIndex, 1)
  assert.equal(result.slideNumber, 2)
  assert.equal(result.slideCount, 7)
  assert.equal(result.currentSlideIndex, 1)
  assert.equal(result.layout, 1)
  assert.equal(result.layoutName, '标题+内容')
  assert.equal(result.masterName, '母版二')
  assert.deepEqual(result.masterPages, ['母版一', '母版二'])
  assert.equal(result.notesText, '备注完整正文')
  assert.equal(result.slideWidthMm, 280)
  assert.equal(result.slideHeightMm, 157.5)
  assert.equal(result.widthPt, 280)
  assert.equal(result.heightPt, 157.5)
  assert.equal(result.shapeCount, 3)
  assert.deepEqual(result.shapes.map(item => [item.index, item.shapeIndex, item.name, item.kind, item.text, item.isTable]), [
    [1, 0, 'title', 'title', '题目', false], [2, 1, 'body', 'text', selected.text.slice(0, 40), false], [3, 2, 'table', 'table', '', true],
  ])
  assert.deepEqual(result.shapes[1], {
    index: 2, shapeIndex: 1, name: 'body', shapeName: 'body', kind: 'text', type: 'text',
    text: selected.text.slice(0, 40), isTable: false, left: 1, top: 2, width: 3, height: 4,
  })
  assert.deepEqual(page.visits, [0, 1, 2], 'context should reuse validated shape references within this read only')
  page.shapes = [table, shape('new', 'text', '新内容')]
  page.visits = []
  const next = read()
  assert.deepEqual(next.shapes.map(item => item.name), ['table', 'new'])
  assert.equal(next.shapes[1].text, '新内容')
  assert.deepEqual(page.visits, [0, 1])
})

test('failed shape acquisition does not renumber surviving Impress shapes', () => {
  const page = drawPage([shape('first'), null, shape('third')])
  const result = impress(page)()
  assert.deepEqual(result.shapes.map(item => [item.name, item.index, item.shapeIndex]), [['first', 1, 0], ['third', 3, 2]])
  assert.equal(result.shapeCount, 2)
  assert.equal(result.selectedShapeName, 'first')
  assert.equal(result.selectedShapeIndex, 0)
})

function calc(names, mode = 'bulk', activeIndex = 0, missingIndex = -1) {
  const calls = { bulk: 0, index: [], names: 0 }
  const state = { names }
  const sheets = {
    getCount: () => state.names.length,
    getByIndex(i) {
      calls.index.push(i)
      if (i === missingIndex) throw Error('unavailable sheet')
      return { getName() { calls.names++; return state.names[i] } }
    },
  }
  if (mode !== 'missing') sheets.getElementNames = () => { calls.bulk++; if (mode === 'throws') throw Error('unavailable bulk API'); return state.names.slice() }
  const cell = { value: '原值' }
  const activeSheet = {
    getName: () => state.names[activeIndex], getCellByPosition: () => cell,
    isProtected: () => true,
    getRows: () => ({ getByIndex: () => ({ getPropertyValue: () => 1800 }) }),
    getColumns: () => ({ getByIndex: () => ({ getPropertyValue: () => 2400 }) }),
  }
  const selection = { getRangeAddress: () => ({ StartColumn: 1, EndColumn: 3, StartRow: 2, EndRow: 4, Sheet: activeIndex }), getIsMerged: () => true }
  const env = {
    xModel: { getSheets: () => sheets, getPropertyValue: () => ({ hasByName: name => name === '__awd_af_' + activeIndex, getByName: () => ({ getPropertyValue: () => true }) }) },
    ctrl: { getActiveSheet: () => activeSheet, getSelection: () => selection, hasFrozenPanes: () => true },
    colLetterOf: n => String.fromCharCode(65 + n), sheetRangeName: () => 'B3:D5', hmmToPt: n => n / 100,
  }
  return { calls, state, cell, selection, read: new Function(...Object.keys(env), calcSource + '\nreturn activeCalcSelection;')(...Object.values(env)) }
}

test('Calc obtains ordered sheet names in one bulk read with the original 50-name cap', () => {
  const names = Array.from({ length: 60 }, (_, i) => '工作表' + i)
  const h = calc(names, 'bulk', 55), result = h.read()
  assert.deepEqual(result.sheetNames, names.slice(0, 50))
  assert.equal(result.sheetCount, 60)
  assert.equal(result.sheetName, '工作表55')
  assert.equal(result.sheetIndex, 55)
  assert.equal(result.sheetIdx, 55)
  assert.equal(result.cell, h.cell)
  assert.equal(result.selRange, h.selection)
  assert.deepEqual([result.col, result.row, result.endCol, result.endRow, result.rowCount, result.colCount], [1, 2, 3, 4, 3, 3])
  assert.deepEqual([result.address, result.cellName, result.range, result.rangeName], ['B3', 'B3', 'B3:D5', 'B3:D5'])
  assert.deepEqual([result.merged, result.hasFrozenPanes, result.autoFilter, result.protected], [true, true, true, true])
  assert.deepEqual([result.rowHeightPt, result.colWidthPt], [18, 24])
  assert.deepEqual(h.calls, { bulk: 1, index: [], names: 0 }, 'sheet-name lookup must not make 50 extra UNO object round-trips')
})

for (const mode of ['missing', 'throws']) {
  test(`Calc preserves indexed fallback when bulk sheet-name lookup is ${mode}`, () => {
    const h = calc(['一', '二', '三'], mode, 2, 1), result = h.read()
    assert.deepEqual(result.sheetNames, ['一', '三'])
    assert.equal(result.sheetCount, 3)
    assert.equal(result.sheetName, '三')
    assert.equal(result.sheetIndex, 2)
    assert.deepEqual(h.calls.index, [0, 1, 2])
    assert.equal(h.calls.bulk, mode === 'throws' ? 1 : 0)
  })
}

test('Calc sheet rename/reorder is visible on the next state read without persistent cache', () => {
  const h = calc(['甲', '乙'])
  assert.deepEqual(h.read().sheetNames, ['甲', '乙'])
  h.state.names = ['乙', '丙', '甲']
  const next = h.read()
  assert.deepEqual(next.sheetNames, ['乙', '丙', '甲'])
  assert.equal(next.sheetCount, 3)
  assert.equal(next.sheetName, '乙')
  assert.equal(h.calls.bulk, 2)
  assert.deepEqual(h.calls.index, [])
})

function formattingReader(selectedShape) {
  const env = {
    docSeq: 4, docKindOf: () => 'impress', isCalcDoc: () => false, isImpressDoc: () => true,
    activeImpressContext: () => ({ selectedShape, selectedShapeIndex: 2, selectedShapeName: '目标形状', slideNumber: 3, slideCount: 5 }),
    impressShapeDetail: () => ({ name: '目标形状', isTable: false }),
    xModel: { getUndoManager: () => ({ isUndoPossible: () => false, isRedoPossible: () => false }) },
    ctrl: { getPropertyValue: () => 90 }, errStr: String, enumEq: (a, b) => a === b,
    css: { awt: { FontSlant: { NONE: 0 }, FontUnderline: { NONE: 0 }, FontStrikeout: { NONE: 0 } }, style: { ParagraphAdjust: {} } },
  }
  return new Function(...Object.keys(env),
    source('function shapeCharFormat(', '// Calc 当前活动工作表') + '\nreturn ({' +
    source('  get_ui_state() {', '  // 段落样式清单') +
    source('  get_formatting(p) {', '  // [格式] 全文应用标准格式') + '});')(...Object.values(env))
}

for (const action of ['get_ui_state', 'get_formatting']) {
  for (const reason of ['non-text shape', 'missing text properties']) {
    test(`${action} keeps Impress toolbar state usable for ${reason}`, () => {
      const selected = reason === 'non-text shape'
        ? { getText() { throw Error('no text interface') } }
        : { getText: () => ({ getString: () => '' }) }
      const result = formattingReader(selected)[action]({})
      assert.equal(result.success, true)
      assert.equal(result.docKind, 'impress')
      assert.equal(result.character.bold, false)
      assert.equal(result.character.sizePt, 18)
      assert.equal(result.impress.selectedShape.name, '目标形状')
      assert.equal(result.impress.slideCount, 5)
    })
  }
  test(`${action} still returns actual formatting when a text shape supplies it`, () => {
    const selected = {
      getText: () => ({ getString: () => '' }),
      getPropertyValue: key => ({ CharFontName: 'Aptos', CharFontNameAsian: '宋体', CharHeight: 24, CharWeightAsian: 150, CharWeight: 150, CharColor: 0x123456 })[key],
    }
    const result = formattingReader(selected)[action]({})
    assert.equal(result.success, true)
    assert.equal(result.character.bold, true)
    assert.equal(result.character.sizePt, 24)
    assert.equal(result.character.fontAsian, '宋体')
    assert.equal(result.character.color, '#123456')
  })
}
