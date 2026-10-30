// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
const source = readFileSync(process.env.SLIDE_WORKER_SOURCE || new URL('../../src/zetaoffice/public/office_thread.js', import.meta.url), 'utf8')
function method(name, realm) {
  const syncStart = source.indexOf(`  ${name}(p) {`)
  const start = syncStart >= 0 ? syncStart : source.indexOf(`  async ${name}(p) {`)
  const end = source.indexOf('\n  },', start) + 5
  return vm.runInContext(`({${source.slice(start, end)}})`, realm)[name]
}
function textObject(initial) {
  let value = initial
  const writes = []
  return {
    getString: () => value,
    setString: () => { throw new Error('Whole-frame write destroys formatting') },
    writes,
    createTextCursor: () => {
      let start = 0, end = 0
      return {
        gotoStart() { start = end = 0 },
        goRight(n, select) { if (select) end += n; else start = end = end + n; return end <= value.length },
        getString: () => value.slice(start, end),
        setString(replacement) { writes.push({ start, end, replacement }); value = value.slice(0, start) + replacement + value.slice(end) }
      }
    }
  }
}
function properties(values) {
  return {
    getPropertySetInfo: () => ({ hasPropertyByName: name => Object.hasOwn(values, name) }),
    getPropertyValue(name) { assert.ok(Object.hasOwn(values, name), `unsupported UNO access: ${name}`); return values[name] },
    setPropertyValue(name, value) { values[name] = value }
  }
}
function setup(shapes = []) {
  const pages = []
  const page = () => Object.assign(properties({ Width: 25400, Height: 19050, Layout: 20 }), {
    shapes: [], getCount() { return this.shapes.length }, getByIndex(i) {
      const shape = this.shapes[i]
      shape.supportsService ||= service => service === 'com.sun.star.presentation.TitleTextShape' && shape.kind === 'title'
      return shape
    },
    getMasterPage: () => ({ getName: () => 'master' }), add(shape) { this.shapes.push(shape) }
  })
  pages.push(page()); pages[0].shapes = shapes
  const collection = { getCount: () => pages.length, getByIndex: i => pages[i],
    insertNewByIndex(index) { const added = page(); added.shapes.push({ kind: 'placeholder' }); pages.splice(Math.min(index + 1, pages.length), 0, added); return added } }
  const realm = vm.createContext({
    xModel: { getDrawPages: () => collection, createInstance: () => properties({}), setModified() {} },
    isImpressDoc: () => true, ensureShapeNames: () => {}, shapeKind: s => s.kind || 'text',
    shapeText: s => s.getText?.().getString() || '', slideFail: error => ({ success: false, error, message: error }),
    errStr: e => e.message, locatePageIndex: page => pages.indexOf(page), movePageTo: () => -1,
    suspendModifyListener() {}, resumeModifyListener() {},
    Module: { resumeMainLoop() {} },
    ctrl: null, shortAny: n => n, layoutNameOf: () => 'blank',
    css: { drawing: { FillStyle: { NONE: { value: 0 }, SOLID: { value: 1 } }, LineStyle: { NONE: { value: 0 }, SOLID: { value: 1 } } },
      awt: { FontSlant: { NONE: { value: 0 }, ITALIC: { value: 2 } } },
      style: { ParagraphAdjust: { LEFT: { value: 0 }, CENTER: { value: 3 } } } },
    enumEq: (a, b) => (a?.value ?? a) === (b?.value ?? b),
    hmmToPt: n => Math.round(n / 35.28 * 100) / 100,
    parseColor: s => /^#[0-9a-f]{6}$/i.test(s) ? parseInt(s.slice(1), 16) : null
  })
  vm.runInContext(source.slice(source.indexOf('function resolveShape('), source.indexOf('// 备注页正文形状定位')), realm)
  const helperStart = source.indexOf('function slideError(')
  if (helperStart >= 0) vm.runInContext(source.slice(helperStart, source.indexOf('// Calc 当前活动工作表')), realm)
  realm.resolvePage = p => ({ page: pages[p.slideNumber - 1], index: p.slideNumber - 1 })
  return { realm, pages, collection, replace: method('slide_replace_text', realm), add: method('slide_add_page', realm), layout: method('slide_set_layout', realm) }
}
const shape = (name, text) => ({ getName: () => name, getText: () => text })
test('default replaces exactly one occurrence and never rewrites the whole frame', () => {
  const text = textObject('费用100元，补充100元')
  const s = setup([shape('body', text)])
  const result = s.replace({ searchText: '100', replaceText: '200', all: false })
  assert.equal(result.success, true); assert.equal(result.replaced, 1)
  assert.equal(text.getString(), '费用200元，补充100元')
  assert.deepEqual(text.writes, [{ start: 2, end: 5, replacement: '200' }])
})
test('all applies variable-length replacements right to left; explicit empty string deletes', () => {
  const text = textObject('甲100乙100丙'), s = setup([shape('body', text)])
  assert.equal(s.replace({ searchText: '100', replaceText: '', all: true }).replaced, 2)
  assert.equal(text.getString(), '甲乙丙')
  assert.deepEqual(text.writes.map(w => w.start), [5, 1])
})
test('targeting rejects stale text, missing replacement and duplicate names without writing', () => {
  const text = textObject('100'), other = textObject('100')
  let s = setup([shape('body', text)])
  assert.equal(s.replace({ searchText: '100', replaceText: '200', slideNumber: 1, shapeName: 'body', expectedText: '90' }).success, false)
  assert.equal(s.replace({ searchText: '100' }).success, false)
  s = setup([shape('body', text), shape('body', other)])
  assert.equal(s.replace({ searchText: '100', replaceText: '200', slideNumber: 1, shapeName: 'body' }).success, false)
  assert.equal(text.writes.length + other.writes.length, 0)
})
test('shape target leaves another shape with identical text unchanged', () => {
  const a = textObject('100'), b = textObject('100'), s = setup([shape('a', a), shape('b', b)])
  assert.equal(s.replace({ searchText: '100', replaceText: '200', slideNumber: 1, shapeName: 'b', expectedText: '100' }).replaced, 1)
  assert.equal(a.getString(), '100'); assert.equal(b.getString(), '200')
})
test('table replacement changes only first occurrence and reports cell coordinates', () => {
  const cell = textObject('100 + 100')
  const table = { getRows: () => ({ getCount: () => 1 }), getColumns: () => ({ getCount: () => 1 }), getCellByPosition: () => cell }
  const s = setup([{ kind: 'table', getName: () => 'table', getPropertyValue: () => table }])
  const result = s.replace({ searchText: '100', replaceText: '200' })
  assert.equal(cell.getString(), '200 + 100'); assert.equal(result.replaced, 1)
  assert.equal(result.hits[0].row, 0); assert.equal(result.hits[0].col, 0)
})
test('insert uses returned page identity even when it has placeholders and an older page is empty', () => {
  const s = setup()
  const result = s.add({})
  assert.equal(result.success, true); assert.equal(result.slideNumber, 2)
  assert.equal(s.pages.length, 2); assert.equal(s.pages[1].shapes.length, 1)
})
test('failed positioning explicitly reports created page and forbids automatic retry', () => {
  const s = setup(), insert = s.collection.insertNewByIndex
  s.collection.insertNewByIndex = () => { const added = insert(0); s.pages.splice(s.pages.indexOf(added), 1); s.pages.unshift(added); return added }
  const result = s.add({})
  assert.equal(result.success, false); assert.equal(result.created, true)
  assert.equal(result.retryable, false); assert.equal(result.slideNumber, 1)
  assert.equal(s.pages.length, 2); assert.equal(result.errorCode, 'SLIDE_INSERT_PARTIAL')
})
test('background writes independently of layout and round trips through page inspection', () => {
  const s = setup(), result = s.layout({ slideNumber: 1, backgroundColor: '#123456' })
  assert.equal(result.success, true)
  assert.equal(result.background.format.FillColor, '#123456')
  assert.equal(s.pages[0].getPropertyValue('Layout'), 20)
  assert.equal(s.layout({ slideNumber: 1, backgroundColor: 'bad' }).success, false)
})
test('bounded paragraph/run inspection preserves different styles and reports truncation', () => {
  const s = setup()
  const enumeration = items => { let i = 0; return { hasMoreElements: () => i < items.length, nextElement: () => items[i++] } }
  const run = (text, size) => Object.assign(properties({ CharHeight: size, CharFontNameAsian: '宋体' }), { getString: () => text })
  const para = Object.assign(properties({ ParaTopMargin: 3528, ParaFirstLineIndent: 1764 }), {
    getString: () => '标题正文', createEnumeration: () => enumeration([run('标题', 28), run('正文', 18)])
  })
  s.realm.referenceShape = { getText: () => ({ createEnumeration: () => enumeration([para]) }) }
  let result = vm.runInContext('slideTextDetails(referenceShape)', s.realm)
  assert.equal(result.available, true); assert.equal(result.truncated, false)
  assert.deepEqual(Array.from(result.paragraphs[0].runs, r => r.format.fontSize), [28, 18])
  assert.equal(result.paragraphs[0].format.spaceBeforePt, 100)
  s.realm.referenceShape = { getText: () => ({ createEnumeration: () => enumeration(Array(51).fill(para)) }) }
  result = vm.runInContext('slideTextDetails(referenceShape)', s.realm)
  assert.equal(result.truncated, true); assert.equal(result.paragraphs.length, 50)
})

test('UNO enum objects become explicit paint and text values, never object strings', () => {
  const s = setup()
  s.realm.paint = properties({ FillStyle: { value: 1 }, LineStyle: { value: 0 }, FillColor: 0x123456 })
  s.realm.textStyle = properties({ CharPosture: { value: 2 }, ParaAdjust: 3 })
  const paint = vm.runInContext('slidePaintFormat(paint)', s.realm)
  assert.equal(paint.FillStyle, 'solid'); assert.equal(paint.LineStyle, 'none')
  const style = vm.runInContext('slideTextStyle(textStyle)', s.realm)
  assert.equal(style.italic, true); assert.equal(style.fontSlant, 'italic'); assert.equal(style.alignment, 'center')
  s.realm.textStyle = properties({ CharPosture: { value: 0 } })
  assert.equal(vm.runInContext('slideTextStyle(textStyle).italic', s.realm), false)
  s.realm.textStyle = properties({ CharPosture: {} })
  const unknown = vm.runInContext('slideTextStyle(textStyle)', s.realm)
  assert.equal(unknown.italic, null); assert.equal(unknown.fontSlant, 'unknown')
})

test('first middle insertion uses the zero-based predecessor required by Impress', () => {
  const s = setup()
  assert.equal(s.add({}).success, true)
  const originalLast = s.pages[1]
  const result = s.add({ position: 1 })
  assert.equal(result.success, true); assert.equal(result.slideNumber, 2)
  assert.equal(s.pages.length, 3); assert.equal(s.pages[2], originalLast)
})

function formattingSetup() {
  const values = { CharHeightAsian: 20, CharHeight: 18 }, writes = []
  const cur = {
    ...properties(values), gotoStart() {}, gotoEnd() {}, goRight: () => true, getString: () => 'body',
    setPropertyValue(key, value) { values[key] = value; writes.push(key) }
  }
  const s = setup([shape('body', { getString: () => 'some body text', createTextCursor: () => cur })])
  s.realm.ptToMm100 = n => Math.round(Number(n) * 2540 / 72)
  s.realm.setCharProp = (target, key, value) => target.setPropertyValue(key, value)
  s.realm.HOUSE = { bodyPt: 12 }
  s.realm.css.style.LineSpacing = function (value) { Object.assign(this, value) }
  vm.runInContext(source.slice(source.indexOf('function effectiveCharHeightPt('), source.indexOf('// 解析下划线参数')), s.realm)
  vm.runInContext(source.slice(source.indexOf('function parseLineSpacingSpec('), source.indexOf('// ---- 标准格式')), s.realm)
  return { ...s, values, writes, format: method('slide_format_text', s.realm) }
}
test('paragraph spacing and hanging indents use Word point units and anchor cursor', () => {
  const s = formattingSetup()
  const result = s.format({ slideNumber: 1, shapeName: 'body', anchorText: 'body',
    spaceBeforePt: 6, spaceAfterPt: 12, firstLineIndentPt: -10, leftIndentPt: 10, rightIndentPt: 0,
    lineSpacingMode: 'exactly', lineSpacingValue: 24 })
  assert.equal(result.success, true)
  for (const [key, pt] of Object.entries({ ParaTopMargin: 6, ParaBottomMargin: 12, ParaFirstLineIndent: -10, ParaLeftMargin: 10, ParaRightMargin: 0 }))
    assert.equal(s.values[key], Math.round(pt * 2540 / 72))
  assert.equal(s.values.ParaLineSpacing.Mode, 3)
  assert.equal(s.values.ParaLineSpacing.Height, Math.round(24 * 2540 / 72))
})
test('relative paragraph units follow CJK font size and existing parameter precedence', () => {
  const s = formattingSetup()
  assert.equal(s.format({ slideNumber: 1, shapeName: 'body', spaceBeforePt: 3, spaceBeforeLines: 2,
    spaceAfterLines: 0.5, firstLineIndentPt: 9, firstLineIndentChars: 2,
    leftIndentPt: 7, leftIndentChars: 1, lineSpacingMode: 'multiple', lineSpacingValue: 1.5 }).success, true)
  assert.equal(s.values.ParaTopMargin, Math.round(3 * 2540 / 72))
  assert.equal(s.values.ParaBottomMargin, Math.round(12 * 2540 / 72))
  assert.equal(s.values.ParaFirstLineIndent, Math.round(40 * 2540 / 72))
  assert.equal(s.values.ParaLeftMargin, Math.round(20 * 2540 / 72))
  assert.equal(s.values.ParaLineSpacing.Height, 150)
})
test('invalid paragraph inputs are rejected before changing text formatting', () => {
  for (const invalid of [{ spaceBeforePt: -1 }, { leftIndentPt: Infinity }, { lineSpacingMode: 'wrong' },
    { lineSpacingValue: 2 }, { lineSpacingMode: 'exactly', lineSpacingValue: 999999 }]) {
    const s = formattingSetup()
    assert.equal(s.format({ slideNumber: 1, shapeName: 'body', fontSize: 30, ...invalid }).error, 'SLIDE_INVALID_PARAGRAPH_FORMAT')
    assert.deepEqual(s.writes, [])
  }
})
test('generic paragraph formatting delegates Impress spacing instead of dropping it', () => {
  const s = formattingSetup(), calls = []
  s.realm.activeImpressContext = () => ({ slideNumber: 1, selectedShapeName: 'body' })
  s.realm.EXEC = { slide_format_text: p => { calls.push(p); return { success: true } } }
  const generic = method('set_paragraph_format', s.realm)
  assert.equal(generic({ spaceAfterPt: 8, firstLineIndentChars: 2, lineSpacingMode: '1.5' }).success, true)
  assert.equal(calls[0].spaceAfterPt, 8); assert.equal(calls[0].firstLineIndentChars, 2)
  assert.equal(generic({ headingLevel: 1 }).error, 'SLIDE_UNSUPPORTED_PARAGRAPH_STYLE')
  assert.equal(calls.length, 1)
})

test('nonzero right indent is rejected before any write because PPTX export loses it', () => {
  for (const rightIndentPt of [4, -4]) {
    const s = formattingSetup()
    assert.equal(s.format({ slideNumber: 1, shapeName: 'body', fontSize: 30,
      spaceAfterPt: 12, rightIndentPt }).error, 'SLIDE_RIGHT_INDENT_UNSUPPORTED')
    assert.deepEqual(s.writes, [])
  }
})

function tableStyleSetup() {
  const s = setup(), cells = Array.from({ length: 2 }, () => Array.from({ length: 2 }, () => {
    const values = {}, props = properties(values)
    return { ...props, values, createTextCursor: () => ({ ...props, gotoStart() {}, gotoEnd() {} }) }
  }))
  s.realm.resolveSlideTable = () => ({ shapeName: 'table', table: {
    getRows: () => ({ getCount: () => 2 }), getColumns: () => ({ getCount: () => 2 }),
    getCellByPosition: (c, r) => cells[r][c]
  } })
  s.realm.css.awt.FontWeight = { BOLD: 150, NORMAL: 100 }
  s.realm.setCharProp = (target, key, value) => target.setPropertyValue(key, value)
  return { ...s, cells, style: method('slide_table_set_style', s.realm) }
}
test('table header range gets dark background and white text without changing body', () => {
  const s = tableStyleSetup()
  const result = s.style({ slideNumber: 1, row: 0, fillColor: '#183247', color: '#ffffff', bold: true, fontName: 'Arial', fontSize: 18, alignment: 'center' })
  assert.equal(result.success, true); assert.equal(result.cells.cellsOk, 2)
  for (const cell of s.cells[0]) {
    assert.equal(cell.values.FillColor, 0x183247); assert.equal(cell.values.CharColor, 0xffffff)
    assert.equal(cell.values.CharHeight, 18); assert.equal(cell.values.CharWeight, 150)
  }
  assert.deepEqual(s.cells[1].map(c => c.values), [{}, {}])
})
test('table formatting defaults to full table and rejects invalid range before writes', () => {
  let s = tableStyleSetup()
  assert.equal(s.style({ slideNumber: 1, fontSize: 16 }).cells.cellsOk, 4)
  for (const bad of [{ row: 2 }, { row: 1, endRow: 0 }, { fontSize: 0 }, { fillColor: '' }]) {
    s = tableStyleSetup()
    assert.equal(s.style({ slideNumber: 1, color: '#ffffff', ...bad }).error, 'SLIDE_INVALID_CELL_FORMAT')
    assert.ok(s.cells.flat().every(c => Object.keys(c.values).length === 0))
  }
})
test('table formatting reports partial writes honestly and retains legacy headerBold', () => {
  let s = tableStyleSetup()
  assert.equal(s.style({ slideNumber: 1, headerBold: true }).headerBold.cellsOk, 2)
  assert.equal(s.cells[1][0].values.CharWeight, undefined)
  s = tableStyleSetup(); s.cells[0][1].setPropertyValue = () => { throw new Error('unsupported') }
  const result = s.style({ slideNumber: 1, row: 0, fillColor: '#183247' })
  assert.equal(result.success, false); assert.equal(result.error, 'SLIDE_CELL_FORMAT_PARTIAL')
  assert.equal(result.cellsOk, 1)
})
test('ordinary text formatting routes table users to the cell tool', () => {
  const s = setup([{ kind: 'table', getName: () => 'table' }])
  assert.equal(method('slide_format_text', s.realm)({ slideNumber: 1, shapeName: 'table', color: '#ffffff' }).error, 'SLIDE_TABLE_TEXT_TOOL_REQUIRED')
})

test('table row heights report text-enforced minimums and reject invalid requests before mutation', () => {
  const s = tableStyleSetup(), heights = [1000, 1000]
  const table = s.realm.resolveSlideTable().table
  table.getRows = () => ({ getCount: () => 2, getByIndex: r => ({
    setPropertyValue: (key, value) => { heights[r] = Math.max(500, value) }, getPropertyValue: () => heights[r]
  }) })
  s.realm.resolveSlideTable = () => ({ shapeName: 'table', table })
  s.realm.ptToMm100 = n => Math.round(n * 2540 / 72)
  assert.equal(s.style({ slideNumber: 1, rowHeightsPt: [0], color: '#ffffff' }).success, false)
  assert.ok(s.cells.flat().every(c => Object.keys(c.values).length === 0))
  const result = s.style({ slideNumber: 1, rowHeightsPt: [10, 30] })
  assert.equal(result.rowHeights.rowsOk, 2)
  assert.ok(result.rowHeights.actualPt[0] > 10)
  assert.ok(Math.abs(result.rowHeights.actualPt[1] - 30) < 0.1)
})
test('new table distributes requested dimensions after growing rows and columns', () => {
  const s = setup(), heights = [0], widths = [0]
  const dimension = values => ({ getCount: () => values.length,
    insertByIndex: (at, count) => values.splice(at, 0, ...Array(count).fill(1000)),
    getByIndex: i => ({ setPropertyValue: (_, v) => { values[i] = v }, getPropertyValue: () => values[i] }) })
  const table = { getRows: () => dimension(heights), getColumns: () => dimension(widths),
    getCellByPosition: () => ({ setString() {} }) }
  const added = { getName: () => 'table', getPropertyValue: () => table, setPosition() {},
    setSize: size => { heights[0] = size.Height; widths[0] = size.Width },
    getSize: () => ({ Height: heights.reduce((a, b) => a + b), Width: widths.reduce((a, b) => a + b) }) }
  s.realm.xModel.createInstance = () => added
  s.realm.css.awt.Size = function (v) { Object.assign(this, v) }
  s.realm.css.awt.Point = function (v) { Object.assign(this, v) }
  s.realm.ptToMm100 = n => Math.round(n * 2540 / 72)
  const result = method('slide_add_table', s.realm)({ slideNumber: 1, rows: 5, cols: 3, width: 600, height: 220 })
  assert.equal(result.success, true)
  assert.ok(heights.every(h => h === Math.round(44 * 2540 / 72)))
  assert.ok(widths.every(w => w === Math.round(200 * 2540 / 72)))
  assert.ok(Math.abs(result.height - 220) < 0.1)
  assert.equal(result.exceedsRequestedSize, false)
})

test('table data validates every nonempty rectangular row before creating a shape', () => {
  for (const rowsJson of [[], [[]], [['a'], null], [['a'], []], [['a'], ['b', 'c']]]) {
    const s = setup()
    s.realm.xModel.createInstance = () => { throw new Error('Must validate before creation') }
    const result = method('slide_add_table', s.realm)({ slideNumber: 1, rowsJson })
    assert.equal(result.success, false)
    assert.equal(result.errorCode, 'SLIDE_INVALID_TABLE_DATA')
    assert.equal(s.pages[0].shapes.length, 0)
  }
})
test('table cell write failure reports the existing shape and exact failed cell without retry', () => {
  const s = setup(), writes = []
  const dimension = { getCount: () => 2 }
  const table = { getRows: () => dimension, getColumns: () => dimension,
    getCellByPosition: (col, row) => ({ setString(value) {
      if (row === 0 && col === 1) throw new Error('cell write rejected')
      writes.push({ row, col, value })
    } }) }
  const added = { getName: () => 'existing-table', getPropertyValue: () => table, setPosition() {}, setSize() {} }
  s.realm.xModel.createInstance = () => added
  s.realm.css.awt.Size = function (v) { Object.assign(this, v) }
  s.realm.css.awt.Point = function (v) { Object.assign(this, v) }
  s.realm.ptToMm100 = n => Math.round(n * 2540 / 72)
  const result = method('slide_add_table', s.realm)({ slideNumber: 1, rowsJson: [['a', 'b'], ['c', 'd']] })
  assert.equal(result.success, false)
  assert.equal(result.errorCode, 'SLIDE_TABLE_WRITE_PARTIAL')
  assert.equal(result.created, true); assert.equal(result.retryable, false)
  assert.equal(result.shapeName, 'existing-table')
  assert.equal(result.row, 0); assert.equal(result.col, 1)
  assert.equal(s.pages[0].shapes.length, 1)
  assert.deepEqual(writes, [{ row: 0, col: 0, value: 'a' }])
})

test('invalid legacy table options cannot partially apply new cell formatting', () => {
  for (const invalid of [{ borderColor: 'bad' }, { borderWidthPt: -1 }, { borderWidthPt: Infinity },
    { headerFill: '' }, { columnWidthsPt: [10, 0] }, { columnWidthsPt: '10' }, { columnWidthsPt: [] }]) {
    const s = tableStyleSetup()
    const result = s.style({ slideNumber: 1, row: 0, fillColor: '#183247', bold: true, ...invalid })
    assert.equal(result.error, 'SLIDE_INVALID_CELL_FORMAT')
    assert.ok(s.cells.flat().every(cell => Object.keys(cell.values).length === 0))
  }
})
test('legacy setter failures report partial outcome and forbid blind retry', () => {
  const s = tableStyleSetup()
  s.realm.setCharProp = () => { throw new Error('unsupported font') }
  const result = s.style({ slideNumber: 1, fillColor: '#183247', headerBold: true })
  assert.equal(result.success, false)
  assert.equal(result.error, 'SLIDE_CELL_FORMAT_PARTIAL')
  assert.equal(result.retryable, false); assert.equal(result.outcomeUnknown, true)
  assert.equal(result.applied.headerBold.cellsFailed, 2)
  assert.equal(s.cells[0][0].values.FillColor, 0x183247)
})

test('native chart rejects mismatched, nonfinite and invalid pie data before creating shapes', () => {
  const s = setup(), addChart = method('slide_add_chart', s.realm)
  let created = 0
  s.realm.xModel.createInstance = () => { created++; throw new Error('must not create') }
  const good = { slideNumber: 1, chartType: 'column', categories: ['A', 'B'], series: [{ name: 'Value', values: [1, 2] }], left: 0, top: 0, width: 400, height: 200 }
  for (const change of [
    { series: [{ name: 'Value', values: [1] }] },
    { series: [{ name: 'Value', values: [1, Infinity] }] },
    { chartType: 'pie', series: [{ name: 'Value', values: [-1, 2] }] },
    { chartType: 'pie', series: [{ name: 'Value', values: [0, 0] }] },
    { chartType: 'scatter' }, ...['invented','toString','constructor','__proto__'].map(chartType=>({chartType})), { width: -1 }, { left: NaN }
  ]) assert.equal(addChart({ ...good, ...change }).success, false)
  assert.equal(created, 0)
})

test('slide transition validates before mutation and reports interrupted writes honestly', () => {
  const s = setup(), transition = method('slide_set_transition', s.realm)
  const values = { TransitionType: 0, TransitionSubtype: 0, TransitionDuration: 2 }
  const writes = []
  s.pages[0].setPropertyValue = (name, value) => { writes.push(name); values[name] = value }
  s.pages[0].getPropertyValue = name => values[name]
  for (const p of [...['unknown','toString','constructor','__proto__'].map(effect=>({effect})), { effect: 'fade', durationSeconds: NaN }, { effect: 'fade', durationSeconds: 6 }])
    assert.equal(transition({ slideNumber: 1, ...p }).success, false)
  assert.equal(writes.length, 0)
  const result = transition({ slideNumber: 1, effect: 'fade', durationSeconds: 0.6 })
  assert.equal(result.success, true); assert.equal(result.transition.type, 37); assert.equal(result.transition.subtype, 101)
  assert.ok(!writes.includes('Change'), 'must preserve advancement mode')
  s.pages[0].setPropertyValue = () => { throw new Error('setter failed') }
  const failed = transition({ slideNumber: 1, effect: 'push' })
  assert.equal(failed.success, false); assert.equal(failed.outcomeUnknown, true); assert.equal(failed.retryable, false)
})

test('image geometry validation allows intended bleed but rejects invalid rectangles before decoding', () => {
  const s = setup(), addImage = method('slide_add_image', s.realm)
  let decoded = 0
  s.realm.atob = () => { decoded++; return '' }
  const p = { slideNumber: 1, left: -30, top: -20, width: 900, height: 500, base64: '' }
  assert.equal(addImage({ ...p, width: 0 }).success, false)
  assert.equal(addImage({ ...p, fit: 'invented' }).success, false)
  assert.equal(decoded, 0)
  assert.equal(addImage(p).errorCode, 'SLIDE_INVALID_IMAGE')
  assert.equal(decoded, 1, 'negative position is valid intentional bleed')
})


test('chart styling requires exact shape identity and typed nonempty changes', () => {
  const s = setup(); const style = method('slide_format_chart', s.realm)
  for (const p of [{fontSize:16}, {shapeName:'chart'}, {shapeName:'chart',showGrid:'false'}, {shapeName:'chart',showLegend:1}]) {
    assert.equal(style(p).errorCode, 'SLIDE_INVALID_CHART_STYLE')
  }
})

test('slideshow wakes the office render loop only for running navigation', async () => {
  let running = false, index = 1, wakes = 0
  const controller = {
    activate() {}, gotoNextSlide() { index++ }, gotoPreviousSlide() { index-- },
    getCurrentSlideIndex: () => index,
  }
  const presentation = { isRunning: () => running, getController: () => controller,
    startWithArguments() { running = true }, end() { running = false } }
  const realm = vm.createContext({
    isImpressDoc: () => true, activeImpressContext: () => ({ slideNumber: 2 }),
    resolvePage: () => ({ page: { getName: () => 'second' } }), mkProp: (name, value) => ({ name, value }),
    docSeq: 1, slideShowViewState: null, restoreSlideShowView() {}, setTimeout,
    ctrl: { getConfigurationController: () => ({
      getRequestedConfiguration: () => ({ getResources: () => [] }),
      update() {}, hasPendingRequests: () => false,
    }) }, css: { drawing: { framework: { AnchorBindingMode: { DIRECT: 0 } } } },
    Module: { resumeMainLoop() { wakes++ } },
    xModel: { getPresentation: () => presentation, getDrawPages: () => ({ getCount: () => 5 }) },
    slideError: errorCode => ({ success: false, errorCode }),
  })
  const show = method('slide_show_control', realm)
  assert.equal((await show({ operation: 'state' })).running, false); assert.equal(wakes, 0)
  assert.equal((await show({ operation: 'start' })).running, true); assert.equal(wakes, 3)
  assert.equal((await show({ operation: 'next' })).slideNumber, 3); assert.equal(wakes, 4)
  assert.equal((await show({ operation: 'previous' })).slideNumber, 2); assert.equal(wakes, 5)
  assert.equal((await show({ operation: 'state' })).slideNumber, 2); assert.equal(wakes, 5)
  assert.equal((await show({ operation: 'end' })).running, false); assert.equal(wakes, 5)
  assert.equal((await show({ operation: 'next' })).errorCode, 'SLIDE_SHOW_NOT_RUNNING'); assert.equal(wakes, 5)
})

test('image cover uses native pixel-to-logic conversion on both standard and Retina devices', () => {
  for (const dpi of [96, 192]) {
    const s = setup(); const values = {}; let conversions = 0;
    const shape = {setSize() {},setPosition() {},getName:()=> 'image',setPropertyValue:(k,v)=>{values[k]=v;}};
    s.realm.xModel.createInstance = () => shape;
    s.realm.atob = () => 'png'; s.realm.context = {}; s.realm.mkProp = (Name,Value)=>({Name,Value});
    s.realm.ptToMm100 = p => Math.round(p*2540/72);
    const Size = class {constructor(v){Object.assign(this,v);}};
    Object.assign(s.realm.css.awt, {Size,Point:Size,Toolkit:{create:()=>({createScreenCompatibleDevice:()=>({
      convertSizeToLogic:(pixels,unit)=>{conversions++;assert.equal(unit,0);return {Width:Math.round(pixels.Width*2540/dpi),Height:Math.round(pixels.Height*2540/dpi)};}
    })})}});
    s.realm.css.util = {MeasureUnit:{MM_100TH:0}};
    s.realm.css.io = {SequenceInputStream:{createStreamFromSequence:()=>({})}};
    s.realm.css.text = {GraphicCrop:Size};
    s.realm.css.graphic = {GraphicProvider:{create:()=>({queryGraphic:()=>({getPropertyValue:name=>
      name==='Size100thMM'?{Width:0,Height:0}:{Width:1672,Height:940}})})}};
    const result=method('slide_add_image',s.realm)({slideNumber:1,base64:'png',left:-20,top:-20,width:580,height:660,fit:'cover'});
    assert.equal(result.success,true,JSON.stringify(result));assert.equal(conversions,1);
    const crop=values.GraphicCrop, naturalWidth=Math.round(1672*2540/dpi);
    assert.ok(Math.abs((crop.Left+crop.Right)/naturalWidth-(1-(580/660)/(1672/940)))<0.0001);
    assert.ok(crop.Left+crop.Right<naturalWidth);
  }
});


test('shape text marks modified only after a real successful write and preserves newline bytes', () => {
  for (const replacement of ['first\nsecond', String.raw`first\nsecond`]) {
    let value = 'old', marked = 0
    const text = { getString: () => value, setString: v => { value = v } }
    const s = setup([shape('body', text)])
    s.realm.xModel.setModified = flag => { assert.equal(flag, true); marked++ }
    const setText = method('slide_set_shape_text', s.realm)
    assert.equal(setText({ slideNumber: 1, shapeName: 'body', text: replacement }).success, true)
    assert.equal(value, replacement); assert.equal(marked, 1)
    assert.equal(setText({ slideNumber: 1, shapeName: 'body', text: replacement }).success, true)
    assert.equal(marked, 1)
    text.setString = () => { throw new Error('write failed') }
    assert.equal(setText({ slideNumber: 1, shapeName: 'body', text: 'different' }).success, false)
    assert.equal(marked, 1)
  }
})

test('replacement marks each successful write, including before a later partial failure', () => {
  const text = textObject('a a'), s = setup([shape('body', text)])
  let marked = 0
  s.realm.xModel.setModified = flag => { assert.equal(flag, true); marked++ }
  assert.equal(s.replace({ searchText: 'missing', replaceText: 'b', all: true }).replaced, 0)
  assert.equal(s.replace({ searchText: 'a', replaceText: 'a', all: true }).replaced, 0)
  assert.equal(marked, 0)
  const cursor = text.createTextCursor
  let calls = 0
  text.createTextCursor = () => {
    if (++calls === 2) throw new Error('second replacement failed')
    return cursor()
  }
  const result = s.replace({ searchText: 'a', replaceText: 'b', all: true })
  assert.equal(result.success, false); assert.equal(result.outcomeUnknown, true)
  assert.equal(text.getString(), 'a b'); assert.equal(marked, 1)
})


test('adding a page checks only title identity on existing objects while retaining title protection', () => {
  const calls = []
  const shapes = Array.from({ length: 24 }, (_, i) => ({
    supportsService(service) { calls.push([i, service]); assert.equal(service, 'com.sun.star.presentation.TitleTextShape'); return false },
    getPropertyValue() { throw Error('unrelated model/geometry reads must not run') }
  }))
  const h = setup(shapes)
  assert.equal(h.add({}).success, true)
  assert.equal(calls.length, shapes.length)
  assert.equal(h.pages.length, 2)
})


function observeInsertListener(h) {
  const calls = { removed: 0, added: 0, notifications: 0, modified: false, attached: true, wakes: 0 };
  h.realm.Module.resumeMainLoop = () => {
    assert.equal(calls.attached, true, 'restore the modify listener before waking Qt');
    assert.equal(calls.added, 1);
    assert.equal(calls.notifications, calls.modified ? 1 : 0, 'finish modification reporting before waking Qt');
    calls.wakes++;
  };
  Object.assign(h.realm, { modifyListener: {}, exportInFlight: false, invalidateParaIndex() {},
    post: cmd => { if (cmd === 'modified') calls.notifications++ } });
  Object.assign(h.realm.xModel, {
    removeModifyListener() { calls.removed++; calls.attached = false },
    addModifyListener() { calls.added++; calls.attached = true },
    isModified: () => calls.modified,
    lockControllers() { throw Error('must not lock the view controller') },
  });
  vm.runInContext(source.slice(source.indexOf('let modifySuspended = 0;'), source.indexOf('// ---- 自建工具栏：选区变化上报')), h.realm);
  const insert = h.collection.insertNewByIndex;
  h.collection.insertNewByIndex = index => {
    assert.equal(calls.attached, false, 'pause before the first native mutation');
    calls.modified = true;
    return insert(index);
  };
  return calls;
}
test('page insertion restores the real modify listener once and preserves prior title and page identity', () => {
  let title = 'Original title';
  const oldTitle = { kind: 'title', getText: () => ({ getString: () => title, setString: value => { title = value } }) };
  const h = setup([oldTitle]), calls = observeInsertListener(h);
  const oldPage = h.pages[0], insert = h.collection.insertNewByIndex;
  h.collection.insertNewByIndex = index => { const page = insert(index); title = ''; return page };
  const result = h.add({ layout: 1 });
  assert.equal(result.success, true); assert.equal(result.slideNumber, 2);
  assert.equal(h.pages[0], oldPage); assert.equal(title, 'Original title');
  assert.equal(calls.wakes, 1);
  assert.equal(calls.attached, true); assert.equal(calls.removed, 1); assert.equal(calls.added, 1); assert.equal(calls.notifications, 1);
});
test('uncertain insertion and partial initialization both restore listener and announce possible edits', () => {
  for (const failure of ['insert', 'layout', 'locate', 'name']) {
    const h = setup(), calls = observeInsertListener(h), insert = h.collection.insertNewByIndex;
    if (failure === 'insert') h.collection.insertNewByIndex = index => { insert(index); throw Error('insert failed after mutation') };
    if (failure === 'layout') h.collection.insertNewByIndex = index => { const page = insert(index); page.setPropertyValue = () => { throw Error('layout failed') }; return page };
    if (failure === 'locate') h.realm.locatePageIndex = () => -1;
    if (failure === 'name') h.realm.ensureShapeNames = () => { throw Error('naming failed') };
    const result = h.add({ layout: 1 });
    assert.equal(result.success, false); assert.equal(result.retryable, false);
    assert.equal(result.errorCode, failure === 'insert' ? 'SLIDE_INSERT_UNCERTAIN' : 'SLIDE_INSERT_PARTIAL');
    assert.equal(h.pages.length, 2); assert.equal(calls.attached, true);
    assert.equal(calls.wakes, 1, failure + ' must wake the possibly changed view');
    assert.equal(calls.removed, 1); assert.equal(calls.added, 1); assert.equal(calls.notifications, 1);
  }
});
test('rejected page position does not suspend listeners or emit a modification', () => {
  const h = setup(), calls = observeInsertListener(h);
  assert.equal(h.add({ position: 99 }).success, false);
  assert.equal(calls.removed, 0); assert.equal(calls.added, 0); assert.equal(calls.notifications, 0);
  assert.equal(calls.wakes, 0, 'parameter rejection never enters the native mutation batch');
});
test('failure before a native insertion leaves clean state clean and restores the listener', () => {
  const h = setup(), calls = observeInsertListener(h);
  h.collection.insertNewByIndex = () => { assert.equal(calls.attached, false); throw Error('no insertion') };
  const result = h.add({});
  assert.equal(result.errorCode, 'SLIDE_INSERT_UNCERTAIN'); assert.equal(h.pages.length, 1);
  assert.equal(calls.attached, true); assert.equal(calls.removed, 1); assert.equal(calls.added, 1);
  assert.equal(calls.notifications, 0);
  assert.equal(calls.wakes, 1, 'an attempted insertion still completes the Qt batch');
});
test('a title placeholder removed by insertion is rebuilt on the original retained page', () => {
  const oldTitle = { kind: 'title', getText: () => ({ getString: () => 'Retained title' }) };
  const h = setup([oldTitle]), calls = observeInsertListener(h), originalPage = h.pages[0];
  const insert = h.collection.insertNewByIndex;
  h.collection.insertNewByIndex = index => { const added = insert(index); originalPage.shapes = []; return added };
  let restoredText = '', restoredPosition, restoredSize;
  const restored = { kind: 'title',
    setPosition: value => { restoredPosition = value }, setSize: value => { restoredSize = value },
    getText: () => ({ getString: () => restoredText, setString: value => { restoredText = value } }) };
  h.realm.css.awt.Point = function (value) { Object.assign(this, value) };
  h.realm.css.awt.Size = function (value) { Object.assign(this, value) };
  h.realm.xModel.createInstance = service => { assert.equal(service, 'com.sun.star.presentation.TitleTextShape'); return restored };
  const result = h.add({});
  assert.equal(result.success, true); assert.equal(result.slideNumber, 2);
  assert.equal(h.pages[0], originalPage); assert.equal(originalPage.shapes[0], restored);
  assert.equal(restoredText, 'Retained title'); assert.ok(restoredPosition.X > 0); assert.ok(restoredSize.Width > 0);
  assert.equal(calls.wakes, 1);
  assert.equal(calls.attached, true); assert.equal(calls.removed, 1); assert.equal(calls.added, 1); assert.equal(calls.notifications, 1);
});
test('title restoration failure reports the inserted page and restores modification reporting', () => {
  const oldTitle = { kind: 'title', getText: () => ({ getString: () => 'Retained title' }) };
  const h = setup([oldTitle]), calls = observeInsertListener(h), originalPage = h.pages[0];
  const insert = h.collection.insertNewByIndex;
  h.collection.insertNewByIndex = index => { const added = insert(index); originalPage.shapes = []; return added };
  h.realm.xModel.createInstance = () => { throw Error('cannot reconstruct title') };
  const result = h.add({});
  assert.equal(result.success, false); assert.equal(result.errorCode, 'SLIDE_INSERT_PARTIAL');
  assert.equal(result.stage, 'restore-title'); assert.equal(result.created, true); assert.equal(result.retryable, false);
  assert.equal(result.slideNumber, 2); assert.equal(h.pages.length, 2); assert.equal(h.pages[0], originalPage);
  assert.equal(calls.wakes, 1);
  assert.equal(calls.attached, true); assert.equal(calls.removed, 1); assert.equal(calls.added, 1); assert.equal(calls.notifications, 1);
});
