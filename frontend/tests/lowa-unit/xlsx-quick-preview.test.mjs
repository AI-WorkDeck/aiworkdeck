// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 表格冷启动预览（office-tier1 O10）：从 xlsx 读出打开后的第一屏。
// 每个用例在测试里现造 xlsx，钉住：活动表、滚动位置/冻结窗格、样式与数字格式、
// 第一屏有对象时不预览、大表流式读够就停。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { readXlsxFirstScreen, formatNumber, colName, colIndex } from '../../src/composables/xlsxQuickPreview.js'

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const REL = t => 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/' + t

async function book({ sheets, activeTab = 0, styles = '', shared = null, sheetRels = {}, extra = {} }) {
  const zip = new JSZip()
  zip.file('xl/workbook.xml', `<workbook ${NS}><bookViews><workbookView activeTab="${activeTab}"/></bookViews><sheets>`
    + sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>')
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="${REL('worksheet')}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `<Relationship Id="rS" Type="${REL('styles')}" Target="styles.xml"/>`
    + (shared ? `<Relationship Id="rSS" Type="${REL('sharedStrings')}" Target="sharedStrings.xml"/>` : '') + '</Relationships>')
  sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, `<worksheet ${NS}>${s.xml}</worksheet>`))
  zip.file('xl/styles.xml', `<styleSheet ${NS}>${styles}</styleSheet>`)
  if (shared) zip.file('xl/sharedStrings.xml', `<sst ${NS}>${shared.map(t => `<si><t>${t}</t></si>`).join('')}</sst>`)
  for (const [n, rels] of Object.entries(sheetRels)) {
    zip.file(`xl/worksheets/_rels/sheet${n}.xml.rels`, '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + rels.map(r => `<Relationship Id="${r.id}" Type="${REL(r.type)}" Target="${r.target}"/>`).join('') + '</Relationships>')
  }
  for (const [path, body] of Object.entries(extra)) zip.file(path, body)
  return zip.generateAsync({ type: 'uint8array' })
}
const inline = (ref, text) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`
const num = (ref, v, s = 0) => `<c r="${ref}" s="${s}"><v>${v}</v></c>`
const texts = (screen, rowIndex) => {
  const row = screen.rows.find(r => r.index === rowIndex)
  return Object.fromEntries(Object.entries(row.cells).map(([c, v]) => [colName(Number(c)), v.text]))
}

test('column letters round-trip', () => {
  for (const [i, n] of [[0, 'A'], [25, 'Z'], [26, 'AA'], [701, 'ZZ'], [702, 'AAA']]) {
    assert.equal(colName(i), n)
    assert.equal(colIndex(n), i)
  }
})

test('number formats used in fee ledgers render like Calc', () => {
  assert.equal(formatNumber(1280000, '#,##0'), '1,280,000')
  assert.equal(formatNumber(1234.5, '#,##0.00'), '1,234.50')
  assert.equal(formatNumber(0.155, '0.0%'), '15.5%')
  assert.equal(formatNumber(1234.5, '[$¥-804]#,##0.00'), '¥1,234.50')
  assert.equal(formatNumber(-1234, '#,##0;(#,##0)'), '(1,234)')
  assert.equal(formatNumber(-5, '0'), '-5')
  assert.equal(formatNumber(45718, 'yyyy-mm-dd'), '2025-03-02')
  assert.equal(formatNumber(45718, 'yyyy/m/d'), '2025/3/2')
  assert.equal(formatNumber(45718, 'yyyy-mm-dd'), '2025-03-02', 'builtin 14 under the zh-CN engine locale')
  assert.equal(formatNumber(45718, 'yyyy\\-mm\\-dd'), '2025-03-02', 'LibreOffice escapes the separator')
  assert.equal(formatNumber(45718.5625, 'yyyy/m/d hh:mm'), '2025/3/2 13:30')
  assert.equal(formatNumber(45718.5625, 'h:mm AM/PM'), '1:30 PM')
  assert.equal(formatNumber(45718, 'yyyy"年"m"月"d"日"'), '2025年3月2日')
  assert.equal(formatNumber(0.5, 'h:mm'), '12:00')
  assert.equal(formatNumber(123456789012345678, 'General').startsWith('1.23457E'), true, 'huge numbers fall back to scientific like Calc')
  assert.equal(formatNumber(0.1 + 0.2, 'General'), '0.3')
})

test('the checked-in eval ledger: active sheet, headers, shared strings, dates and thousands', async () => {
  const screen = await readXlsxFirstScreen(readFileSync(new URL('../../../scripts/eval/fixtures/case-ledger.xlsx', import.meta.url)))
  assert.ok(screen)
  assert.equal(screen.sheets[screen.active], '台账')
  const head = texts(screen, 0)
  assert.equal(head.A, '案号')
  assert.equal(texts(screen, 1).D, '1,280,000')
  assert.match(texts(screen, 1).E, /^2025[-/]0?3[-/]0?2$/)
  assert.equal(screen.rows.find(r => r.index === 1).cells[3].align, 'right', 'numbers right-aligned')
})

test('opens where the user left it: active tab, saved scroll position, frozen header row', async () => {
  const rows = Array.from({ length: 200 }, (_, i) => `<row r="${i + 1}">${inline('A' + (i + 1), 'r' + (i + 1))}${num('B' + (i + 1), i + 1)}</row>`).join('')
  const buf = await book({
    activeTab: 2,
    sheets: [
      { name: '封面', xml: '<sheetData/>' },
      { name: '隐藏', hidden: true, xml: '<sheetData/>' },
      { name: '明细', xml: `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A120" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${rows}</sheetData>` },
    ],
  })
  const screen = await readXlsxFirstScreen(buf)
  assert.deepEqual(screen.sheets, ['封面', '明细'], 'hidden sheets get no tab')
  assert.equal(screen.active, 1)
  assert.equal(screen.rows[0].index, 0, 'frozen header row stays on top')
  assert.equal(screen.rows[1].index, 119, 'then the saved scroll position')
  assert.equal(texts(screen, 119).A, 'r120')
})

test('a hidden active tab falls back to the first visible sheet', async () => {
  const buf = await book({ activeTab: 1, sheets: [{ name: 'A', xml: `<sheetData><row r="1">${inline('A1', 'x')}</row></sheetData>` }, { name: 'B', hidden: true, xml: '<sheetData/>' }] })
  const screen = await readXlsxFirstScreen(buf)
  assert.equal(screen.sheets[screen.active], 'A')
})

test('styles: bold header, solid fill, custom number format, hidden rows and columns, merged title', async () => {
  const styles = '<numFmts><numFmt numFmtId="164" formatCode="[$¥-804]#,##0.00"/></numFmts>'
    + '<fonts><font><sz val="11"/></font><font><b/><sz val="11"/></font></fonts>'
    + '<fills><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/></patternFill></fill></fills>'
    + '<cellXfs><xf numFmtId="0" fontId="0" fillId="0"/><xf numFmtId="0" fontId="1" fillId="2"><alignment horizontal="center"/></xf><xf numFmtId="164" fontId="0" fillId="0"/></cellXfs>'
  const buf = await book({
    styles,
    sheets: [{ name: 'S', xml: '<cols><col min="2" max="2" width="20" customWidth="1"/><col min="3" max="3" width="9" hidden="1"/></cols><sheetData>'
      + `<row r="1"><c r="A1" s="1" t="inlineStr"><is><t>收费明细</t></is></c></row>`
      + `<row r="2" hidden="1">${inline('A2', 'secret')}</row>`
      + `<row r="3">${inline('A3', '甲')}${num('B3', 1234.5, 2)}${inline('C3', 'hidden col')}</row>`
      + '</sheetData><mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells>' }],
  })
  const screen = await readXlsxFirstScreen(buf)
  const title = screen.rows.find(r => r.index === 0).cells[0]
  assert.equal(title.bold, true)
  assert.equal(title.fill, '#DDEBF7')
  assert.equal(title.align, 'center')
  assert.ok(!screen.rows.some(r => r.index === 1), 'hidden row skipped')
  assert.ok(!screen.columns.some(c => c.index === 2), 'hidden column skipped')
  assert.equal(screen.columns.find(c => c.index === 1).width, 145, 'custom width in px (20 chars)')
  assert.equal(texts(screen, 2).B, '¥1,234.50')
  assert.deepEqual(screen.merges, [{ from: { col: 0, row: 0 }, to: { col: 1, row: 0 } }])
})

const drawingXml = (col, row) => `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"><xdr:twoCellAnchor><xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from></xdr:twoCellAnchor></xdr:wsDr>`
const simpleSheet = `<sheetData><row r="1">${inline('A1', 'x')}</row></sheetData><drawing r:id="rD"/>`

test('a picture or chart on the first screen: no preview (the grid would be wrong)', async () => {
  const buf = await book({ sheets: [{ name: 'S', xml: simpleSheet }], sheetRels: { 1: [{ id: 'rD', type: 'drawing', target: '../drawings/drawing1.xml' }] }, extra: { 'xl/drawings/drawing1.xml': drawingXml(7, 0) } })
  assert.equal(await readXlsxFirstScreen(buf), null)
})

test('a picture far below the first screen does not block the preview', async () => {
  const buf = await book({ sheets: [{ name: 'S', xml: simpleSheet }], sheetRels: { 1: [{ id: 'rD', type: 'drawing', target: '../drawings/drawing1.xml' }] }, extra: { 'xl/drawings/drawing1.xml': drawingXml(1, 500) } })
  assert.ok(await readXlsxFirstScreen(buf))
})

test('form buttons block the preview; comment markers do not', async () => {
  const vml = type => `<xml xmlns:x="urn:schemas-microsoft-com:office:excel"><v:shape><x:ClientData ObjectType="${type}"><x:Anchor>1, 15, 0, 2, 3, 15, 4, 2</x:Anchor></x:ClientData></v:shape></xml>`
  const make = type => book({ sheets: [{ name: 'S', xml: `<sheetData><row r="1">${inline('A1', 'x')}</row></sheetData><legacyDrawing r:id="rV"/>` }],
    sheetRels: { 1: [{ id: 'rV', type: 'vmlDrawing', target: '../drawings/vmlDrawing1.vml' }] }, extra: { 'xl/drawings/vmlDrawing1.vml': vml(type) } })
  assert.equal(await readXlsxFirstScreen(await make('Button')), null)
  assert.ok(await readXlsxFirstScreen(await make('Note')))
})

test('a 20 000-row sheet reads only the first screen, with shared strings looked up lazily', async () => {
  const n = 20000
  const shared = Array.from({ length: n }, (_, i) => '当事人' + i)
  const rows = Array.from({ length: n }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}" t="s"><v>${i}</v></c>${num('B' + (i + 1), i * 1000)}</row>`).join('')
  const buf = await book({ shared, sheets: [{ name: '台账', xml: `<sheetData>${rows}</sheetData>` }] })
  const t = performance.now()
  const screen = await readXlsxFirstScreen(buf)
  const ms = performance.now() - t
  assert.equal(screen.rows.length, 60)
  // 回归：流式循环中途停下后 matchAll 沿用 lastIndex，曾把所有行跳过（大表全空）
  assert.equal(texts(screen, 0).A, '当事人0')
  assert.equal(texts(screen, 59).A, '当事人59')
  assert.ok(ms < 1500, `first screen of a big sheet in ${Math.round(ms)}ms`)
})

test('not an xlsx (or an encrypted CFB container): null, never throws', async () => {
  assert.equal(await readXlsxFirstScreen(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0])), null)
  assert.equal(await readXlsxFirstScreen(new Uint8Array(0)), null)
})

test('a formula without a cached value (script-generated files): no preview, since the total would show blank', async () => {
  const make = v => book({ sheets: [{ name: 'S', xml: `<sheetData><row r="1">${num('A1', 1)}${num('A2', 2)}</row><row r="3"><c r="A3"><f>SUM(A1:A2)</f>${v}</c></row></sheetData>` }] })
  assert.equal(await readXlsxFirstScreen(await make('')), null)
  const ok = await readXlsxFirstScreen(await make('<v>3</v>'))
  assert.equal(texts(ok, 2).A, '3', 'cached value shown like the engine')
})

test('row heights follow Calc: auto rows re-fit to the font, custom heights are kept', async () => {
  const buf = await book({
    styles: '<fonts><font><sz val="11"/></font></fonts><cellXfs><xf numFmtId="0" fontId="0" fillId="0"/></cellXfs>',
    sheets: [{ name: 'S', xml: `<sheetFormatPr defaultRowHeight="15"/><sheetData><row r="1" ht="15">${inline('A1', 'a')}</row><row r="2" ht="40" customHeight="1">${inline('A2', 'b')}</row></sheetData>` }],
  })
  const screen = await readXlsxFirstScreen(buf)
  assert.equal(screen.rows[0].height, 22, '11pt font: Calc fits ~16.5pt rows (engine screenshot O10)')
  assert.equal(screen.rows[1].height, 53, 'customHeight kept')
  assert.equal(screen.rows[2].height, 22, 'empty rows use the fitted default too')
})
