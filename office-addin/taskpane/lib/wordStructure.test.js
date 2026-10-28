// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { wordClauses, wordOutline, wordParagraphPage } from './wordStructure.js'
import { executeOfficeCommand } from './officeExecutor.js'
const paragraph = (text, index, extra = {}) => ({ text, index, ...extra })
test('clause map combines automatic labels with manual clauses and excludes subordinate numbering', () => {
  const result = wordClauses([
    paragraph('协议', 0), paragraph('付款', 1, { numbering: { label: '第一条' } }),
    paragraph('一、付款细节', 2), paragraph('第二条 期限', 3), paragraph('正文', 4)
  ])
  assert.equal(result.totalClauseCount, 2)
  assert.equal(result.preambleParagraphs, 1)
  assert.deepEqual(result.clauses.map(c => [c.startParagraph,c.endParagraph]), [[1,2],[3,4]])
  assert.equal(result.clauses[0].autoNumbered, true)
  assert.equal(result.clauses[0].listLabel, '第一条')
})
test('clause cap retains full total and next paragraph; outline uses styles not clause-looking text', () => {
  const list = Array.from({ length: 305 }, (_, i) => paragraph(`第${i+1}条 内容`, i))
  const result = wordClauses(list)
  assert.equal(result.clauseCount, 300)
  assert.equal(result.totalClauseCount, 305)
  assert.equal(result.nextStartParagraph, 300)
  assert.equal(result.truncated, true)
  assert.equal(wordOutline(list).count, 0)
  list[3].headingLevel = 2
  assert.equal(wordOutline(list).outline[0].paragraphIndex, 3)
})
test('paragraph pages bound text and resume without dropping a paragraph', () => {
  const list = Array.from({ length: 5 }, (_, i) => paragraph('a'.repeat(30000), i))
  const first = wordParagraphPage(list)
  assert.equal(first.paragraphs.length, 2)
  assert.equal(first.nextStartParagraph, 2)
  assert.deepEqual(wordParagraphPage(list, { startParagraph: 2 }).paragraphs.map(p=>p.index), [2,3])
})
test('Office native paragraph adapter reads list metadata and dispatches Word-only commands', async () => {
  const items = [
    { load() {}, text: 'Title', styleBuiltIn: 'Other', outlineLevel: 2, isListItem: false },
    { load() {}, text: 'Payment', styleBuiltIn: 'Normal', isListItem: true, listItem: { listString: '第一条', level: 0, load() {} } }
  ]
  const context = { document: { body: { paragraphs: { items, load() {} } } }, async sync() {} }
  globalThis.Office = { context: { host: 'word', requirements: { isSetSupported: () => true } }, HostType: { Word: 'word', Excel: 'excel' } }
  globalThis.Word = { run: callback => callback(context) }
  const outline = await executeOfficeCommand('get_outline', {})
  assert.equal(outline.ok, true)
  assert.deepEqual(outline.data.outline.map(p=>p.level), [2])
  const clauses = await executeOfficeCommand('get_clauses', {})
  assert.equal(clauses.data.clauses[0].listLabel, '第一条')
  const page = await executeOfficeCommand('get_paragraphs', { startParagraph: 1 })
  assert.equal(page.data.paragraphs[0].numbering.available, true)
  Office.context.host = 'excel'
  assert.equal((await executeOfficeCommand('get_outline', {})).ok, false)
  delete globalThis.Word
  delete globalThis.Office
})

test('Office nth replacement preserves other matches and restores tracking', async () => {
  const writes = []
  const items = Array.from({ length: 3 }, (_, index) => ({ text: 'TARGET', load() {}, insertText: text => writes.push({ index, text }) }))
  const doc = { changeTrackingMode: 'off', load() {}, body: { search: (text, opts) => {
    assert.equal(text, 'TARGET'); assert.equal(opts.matchCase, true)
    return { items, load() {} }
  } } }
  globalThis.Office = { context: { host: 'word', requirements: { isSetSupported: () => true } }, HostType: { Word: 'word' } }
  globalThis.Word = { run: callback => callback({ document: doc, async sync() {} }), ChangeTrackingMode: { trackAll: 'all' }, InsertLocation: { replace: 'Replace' } }
  const result = await executeOfficeCommand('replace_nth_match', { findText: 'TARGET', replaceText: 'new\nparagraph', matchIndex: 2 })
  assert.equal(result.ok, true)
  assert.deepEqual(writes, [{ index: 1, text: 'new\nparagraph' }])
  assert.equal(doc.changeTrackingMode, 'off')
  assert.equal((await executeOfficeCommand('replace_nth_match', { findText: 'TARGET', replaceText: '', matchIndex: 4 })).ok, false)
  assert.equal(writes.length, 1)
  delete globalThis.Word
  delete globalThis.Office
})

test('Office paragraph paging loads text only for requested native paragraphs', async () => {
  const loaded = []
  const items = Array.from({ length: 1000 }, (_, index) => ({ text: `p${index}`, styleBuiltIn: 'Normal', isListItem: false, load: () => loaded.push(index) }))
  globalThis.Office = { context: { host: 'word', requirements: { isSetSupported: () => true } }, HostType: { Word: 'word' } }
  globalThis.Word = { run: callback => callback({ document: { body: { paragraphs: { items, load() {} } } }, async sync() {} }) }
  const result = await executeOfficeCommand('get_paragraphs', { startParagraph: 500, maxParagraphs: 2 })
  assert.equal(result.ok, true)
  assert.deepEqual(loaded, [500, 501])
  assert.equal(result.data.totalParagraphs, 1000)
  assert.equal(result.data.nextStartParagraph, 502)
  delete globalThis.Word
  delete globalThis.Office
})

test('unsupported default style profile rejects before Word.run or tracking-mode mutation', async () => {
  const { default: profile } = await import('./house-default.json', { with: { type: 'json' } })
  let runs = 0
  globalThis.Office = { context: { host: 'word', requirements: { isSetSupported: () => true } }, HostType: { Word: 'word' } }
  globalThis.Word = { run: () => { runs++; throw new Error('Must not touch native document') } }
  const result = await executeOfficeCommand('apply_style_profile', { profile, scope: 'document' })
  assert.equal(result.ok, false)
  assert.equal(runs, 0)
  delete globalThis.Word
  delete globalThis.Office
})
