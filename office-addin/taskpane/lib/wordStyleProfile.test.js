// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { applyOfficeWordStyleProfile, applyWpsWordStyleProfile, validateWordStyleProfile } from './wordStyleProfile.js'
const profile = () => ({ schemaVersion: 1, name: 'QA', defaults: { font: { western: 'Arial' }, size: { value: 12, unit: 'pt' } }, body: { alignment: 'justify', lineSpacing: { rule: 'atLeast', value: 16, unit: 'pt' }, firstLineIndent: { value: 2, unit: 'chars' } }, headings: [{ level: 1, bold: true, size: { value: 16, unit: 'pt' }, alignment: 'center' }] })
function wps() {
 const styles = new Map([-1, -2, -3, -4, -5, -6, -7].map(id => [id, { Font: {}, ParagraphFormat: {} }]))
 const rows = ['Title', 'Body text'].map(Text => ({ Range: { Text, Font: {}, ListFormat: { ListType: 0 } }, Format: {}, OutlineLevel: 10 }))
 const doc = { Styles: { Item: id => styles.get(id), Add: name => { const style = { Font: {}, ParagraphFormat: {} }; styles.set(name, style); return style } }, Content: { Paragraphs: { Count: rows.length, Item: i => rows[i - 1] } } }
 return { doc, styles, rows }
}
test('WPS updates real style definitions, preserves atLeast and converts chars like desktop', () => {
 const h = wps(); const r = applyWpsWordStyleProfile(h.doc, {}, { profile: profile() })
 assert.equal(h.styles.get(-1).ParagraphFormat.LineSpacingRule, 3)
 assert.equal(h.styles.get(-1).ParagraphFormat.LineSpacing, 16)
 assert.equal(h.styles.get(-1).ParagraphFormat.FirstLineIndent, 24)
 assert.equal(h.rows[0].Range.Font.Size, 16)
 assert.equal(h.rows[1].Range.Font.Size, 12)
 assert.equal(r.paragraphs, 2)
})
test('styles-only changes definitions and leaves direct formatting alone', () => {
 const h = wps(); applyWpsWordStyleProfile(h.doc, {}, { profile: profile(), scope: 'styles-only' })
 assert.equal(h.styles.get(-2).Font.Bold, -1)
 assert.deepEqual(h.rows[0].Range.Font, {})
})
test('selection changes global definitions but only selected paragraphs', () => {
 const h = wps(); const selection = { Range: { Paragraphs: { Count: 1, Item: () => h.rows[1] } } }
 applyWpsWordStyleProfile(h.doc, { Selection: selection }, { profile: profile(), scope: 'selection' })
 assert.deepEqual(h.rows[0].Range.Font, {})
 assert.equal(h.rows[1].Range.Font.Size, 12)
 assert.equal(h.styles.get(-1).Font.Size, 12)
})
test('Office rejects atLeast before touching the document', async () => {
 let touched = false
 await assert.rejects(applyOfficeWordStyleProfile({ get document() { touched = true; throw Error() } }, { profile: profile() }), e => e.unsupportedFields.includes('body.lineSpacing.rule'))
 assert.equal(touched, false)
})
test('default HOUSE applies WPS definitions including table paragraph styles', () => {
 const house = JSON.parse(readFileSync(new URL('../../../backend/src/main/resources/style-profiles/house-default.json', import.meta.url)))
 const h = wps()
 const result = applyWpsWordStyleProfile(h.doc, {}, { profile: house })
 assert.equal(h.styles.get(-1).ParagraphFormat.LineSpacingRule, 3)
 assert.equal(h.styles.get('AWD Table Contents').Font.Size, 10)
 assert.ok(Math.abs(h.styles.get('AWD Table Contents').ParagraphFormat.SpaceAfter - 2.4) < 1e-9)
 assert.equal(h.styles.get('AWD Table Heading').Font.Bold, -1)
 assert.equal(result.styles.length, 9)
})
test('invalid late heading is rejected before any style mutation', () => {
 const h = wps(), p = profile(); p.headings[0].size.value = -1
 assert.throws(() => applyWpsWordStyleProfile(h.doc, {}, { profile: p }))
 assert.deepEqual(h.styles.get(-1).Font, {})
})
test('failure after writing styles exposes partialResult', () => {
 const h = wps(); Object.defineProperty(h.styles.get(-2).Font, 'Size', { set() { throw Error('host failure') } })
 assert.throws(() => applyWpsWordStyleProfile(h.doc, {}, { profile: profile() }), e => e.partialResult?.possiblyApplied === true && e.partialResult.styles.includes('Normal'))
})
test('Office 1.5 updates style definitions and paragraphs with exactly spacing', async () => {
 const previous = globalThis.Office
 globalThis.Office = { context: { requirements: { isSetSupported: () => true } } }
 try {
  const p = profile(); p.body.lineSpacing.rule = 'exactly'
  const targets = new Map(['Normal', 'Heading 1'].map(name => [name, { font: {}, paragraphFormat: {}, isNullObject: false, load() {} }]))
  const para = { text: 'Body', styleBuiltIn: 'Normal', isListItem: false, font: {} }
  const context = { document: { getStyles: () => ({ getByNameOrNullObject: n => targets.get(n) }), body: { paragraphs: { items: [para], load() {} } } }, sync: async () => {} }
  const result = await applyOfficeWordStyleProfile(context, { profile: p })
  assert.equal(targets.get('Normal').paragraphFormat.lineSpacing, 16)
  assert.equal(targets.get('Heading 1').font.bold, true)
  assert.equal(result.paragraphs, 1)
 } finally { globalThis.Office = previous }
})

test('WPS default HOUSE formats table cells, repeat headers, borders and following paragraph', () => {
 const house = JSON.parse(readFileSync(new URL('../../../backend/src/main/resources/style-profiles/house-default.json', import.meta.url)))
 const h = wps(), borders = new Map([-1,-2,-3,-4,-5,-6].map(i => [i, {}]))
 const cells = ['Header', '1234.50'].map(Text => ({ Range: { Text, Font: {}, ParagraphFormat: {} }, Shading: {} }))
 const tableRows = cells.map(cell => ({ Cells: { Count: 1, Item: () => cell } }))
 h.doc.Tables = { Count: 1, Item: () => ({ Range: { Start: 10, End: 30 }, Rows: { Count: 2, Item: i => tableRows[i-1] }, Borders: { Item: i => borders.get(i) } }) }
 h.rows[0].Range.Start = 0; h.rows[1].Range.Start = 30
 const r = applyWpsWordStyleProfile(h.doc, {}, { profile: house })
 assert.equal(r.tables, 1)
 assert.equal(tableRows[0].HeadingFormat, -1)
 assert.equal(tableRows[1].HeadingFormat, 0)
 assert.equal(cells[0].Range.Font.Bold, -1)
 assert.equal(cells[1].Range.ParagraphFormat.Alignment, 2)
 assert.equal(cells[1].Range.ParagraphFormat.LineSpacingRule, 3)
 assert.equal(cells[1].Range.Font.Size, 10)
 assert.equal(cells[1].VerticalAlignment, 1)
 assert.equal(borders.get(-1).LineWidth, 12)
 assert.equal(h.rows[1].Format.SpaceBefore, 18)
})
test('unrepresentable table border width is rejected before any style creation', () => {
 const h = wps(), p = profile(); p.table = { borders: { outside: { width: { value: 1.1, unit: 'pt' } } } }
 assert.throws(() => applyWpsWordStyleProfile(h.doc, {}, { profile: p }), e => e.unsupportedFields.includes('table.borders.outside'))
 assert.equal(h.styles.has('AWD Table Contents'), false)
 assert.deepEqual(h.styles.get(-1).Font, {})
})

test('WPS TOC title updates the localized built-in style via its invariant id', () => {
 const h = wps(), title = { Font: {}, ParagraphFormat: {} }; h.styles.set(-267, title)
 const p = profile(); p.toc = { titleStyle: { size: { value: 18, unit: 'pt' }, bold: true, alignment: 'center' } }
 applyWpsWordStyleProfile(h.doc, {}, { profile: p, scope: 'styles-only' })
 assert.equal(title.Font.Size, 18)
 assert.equal(title.ParagraphFormat.Alignment, 1)
 assert.equal(h.styles.has('TOC Heading'), false)
})

test('pure preflight rejects default Office HOUSE before tracking or host access', () => {
 const house = JSON.parse(readFileSync(new URL('../../../backend/src/main/resources/style-profiles/house-default.json', import.meta.url)))
 assert.throws(() => validateWordStyleProfile({ profile: house }, 'office'), e => e.unsupportedFields.includes('body.lineSpacing.rule'))
 assert.equal(validateWordStyleProfile({ profile: house }, 'wps'), true)
 const p = profile(); p.table = { cell: { byContentType: { number: { alignment: 'right', bold: true } } } }
 assert.throws(() => validateWordStyleProfile({ profile: p }, 'wps'), e => e.unsupportedFields.includes('table.cell.byContentType.number'))
})

test('unsupported schema dimensions fail pure preflight before any native style mutation', () => {
 const fields = [
  ['page', { page: { orientation: 'landscape' } }],
  ['headerFooter', { headerFooter: { header: { text: 'QA' } } }],
  ['numbering', { numbering: { kind: 'decimal' } }],
  ['body.font.theme', { body: { ...profile().body, font: { theme: 'majorHAnsi' } } }],
 ]
 for (const [field, extra] of fields) {
  const h = wps(), p = { ...profile(), ...extra }
  assert.throws(() => validateWordStyleProfile({ profile: p }, 'wps'), e => e.unsupportedFields.includes(field))
  assert.throws(() => applyWpsWordStyleProfile(h.doc, {}, { profile: p }), e => e.unsupportedFields.includes(field))
  assert.deepEqual(h.styles.get(-1).Font, {})
 }
 assert.equal(validateWordStyleProfile({ profile: { ...profile(), source: { fileId: 10 }, confidence: 0.9 }, scope: 'styles-only' }, 'wps'), true)
 for (const scope of ['table', 'paragraph', 'all']) {
  assert.throws(() => validateWordStyleProfile({ profile: profile(), scope }, 'wps'))
 }
})
