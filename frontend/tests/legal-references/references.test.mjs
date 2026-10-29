// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { referencesFromEntity, referenceFromModel, legalMessageParts, referencesFromTools, safeLegalUrl, legalReadableText } from '../../src/utils/legalReferences.js'
import { legalReferenceTabMethods } from '../../src/pages/project-overview/legalReferenceTab.js'
import { serializeTab } from '../../src/pages/project-overview/tabSnapshot.js'
import { isContextEligibleTab } from '../../src/pages/project-overview/activeTabContext.js'
const model = { kind: 'PENALTY', title: 'Synthetic decision', documentNumber: 'TEST-1', summary: 'AI summary', excerpt: 'Source excerpt', url: 'https://example.org/decision', status: 'verified' }
const fence = value => '```legal-reference\n' + JSON.stringify(value) + '\n```\n'

test('model references never acquire verification from status/source/url', () => {
  const ref = referenceFromModel(model)
  assert.equal(ref.status, 'unverified')
  assert.equal(ref.sections[0].labelKey, 'legalReference.aiSummary')
  assert.equal(ref.sections[1].text, 'Source excerpt')
  assert.equal(referenceFromModel({ kind: 'OTHER', title: 'x' }), null)
  assert.equal(referenceFromModel({ kind: 'LAW' }), null)
})
test('safe sources reject executable, relative, data and credential URLs', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,x', '/api/secrets', 'file:///a', 'https://user:pass@example.org']) assert.equal(safeLegalUrl(value), '')
  assert.equal(safeLegalUrl('[source](https://example.org/x)'), 'https://example.org/x')
})
test('complete object and array cards retain surrounding answer; incomplete or invalid blocks survive', () => {
  const parts = legalMessageParts('Before\n' + fence([model, { ...model, kind: 'CASE' }]) + 'After')
  assert.deepEqual(parts.map(p => p.type), ['text', 'reference', 'reference', 'text'])
  assert.equal(parts.at(-1).text, 'After')
  for (const input of ['```legal-reference\n{"kind":', fence({ kind: 'unknown' }), fence([])]) assert.equal(legalMessageParts(input)[0].text, input)
})
test('law metadata is not promoted to statutory body; all candidates retain separate versions', () => {
  const refs = referencesFromEntity({ kind: 'LAW', name: 'Query', retrievalStatus: 'OK', detail: { source: 'pkulaw', result: { Data: [
    { Title: 'Test act', DocumentNO: '2020-A', IssueDepartment: 'Test authority', TimelinessDic: '已废止' },
    { Title: 'Test act', article: '第二条　Synthetic original text', TimelinessDic: '现行有效', url: 'https://example.org/act' },
  ] } } })
  assert.equal(refs.length, 2)
  assert.equal(refs[0].status, 'metadata')
  assert.equal(refs[0].sections.length, 0)
  assert.equal(refs[1].status, 'retrieved')
  assert.equal(refs[1].sections[0].text, 'Synthetic original text')
  assert.notEqual(refs[0].id, refs[1].id)
})
test('cases decode MCP envelopes, preserve facts/reasoning/result and reject failed stale content', () => {
  const entity = { kind: 'CASE', name: 'Query', retrievalStatus: 'OK', fetchedAt: '2026-10-29', detail: { result: { content: [{ type: 'text', text: JSON.stringify([{ title: 'Test case', case_number: 'TEST-CASE', facts: 'Facts', reason: 'Reasons', judgment: 'Decision' }]) }] } } }
  const [ref] = referencesFromEntity(entity)
  assert.deepEqual(ref.sections.map(x => x.text), ['Facts', 'Reasons', 'Decision'])
  assert.equal(ref.retrievedAt, '2026-10-29')
  const [failure] = referencesFromEntity({ ...entity, retrievalStatus: 'UNAVAILABLE' })
  assert.equal(failure.status, 'unavailable')
  assert.equal(failure.sections.length, 0)
})
test('completed legal tools render from historical process records without trusting XML; truncated JSON is omitted', () => {
  const output = JSON.stringify({ data: [{ title: 'Act', article: '第一条　Original' }] })
  const item = { type: 'tool', status: 'success', code: 'legal_tools.law_search({"query":"x"})', output }
  const refs = referencesFromTools([{ items: [item, item, { ...item, output: output.slice(0, -4) }, { ...item, status: 'loading' }, { ...item, code: 'search_web({})' }] }])
  assert.equal(refs.length, 1)
  assert.equal(refs[0].status, 'unverified')
})
test('reader opens beside every document format, retains editor, deduplicates and survives snapshots', () => {
  for (const fileType of ['docx', 'pptx', 'xlsx', 'pdf']) {
    const reference = referenceFromModel(model)
    const host = { leftFiles: [{ id: 1, fileType }], rightFiles: [], activeFileIdLeft: 1, splitMode: false, $nextTick: fn => fn(), triggerWorkbenchResize() {} }
    legalReferenceTabMethods.openLegalReferenceTab.call(host, reference)
    assert.equal(host.splitMode, true)
    assert.equal(host.activeFileIdLeft, 1)
    assert.equal(host.focusedPane, 'right')
    assert.equal(host.rightFiles.length, 1)
    assert.equal(isContextEligibleTab(host.rightFiles[0]), false)
    host.splitMode = false
    legalReferenceTabMethods.openLegalReferenceTab.call(host, reference)
    assert.equal(host.splitMode, true)
    assert.equal(host.rightFiles.length, 1)
    const saved = serializeTab(host.rightFiles[0])
    assert.deepEqual(saved.legalReference, reference)
    assert.notEqual(saved.legalReference, reference)
  }
})

test('copy and document actions receive readable references, including the unverified boundary', () => {
  const text = legalReadableText('Answer\n' + fence(model), key => key)
  assert.ok(text.includes('Synthetic decision'))
  assert.ok(text.includes('legalReference.status.unverified'))
  assert.ok(text.includes('https://example.org/decision'))
  assert.ok(!text.includes('```') && !text.includes('"kind"'))
})
test('different provenance snapshots never activate an old reader', () => {
  const entity = { kind: 'LAW', name: 'Act', detail: { source: 'A', result: { title: 'Act', content: 'Original' } } }
  const a = referencesFromEntity(entity)[0]
  const b = referencesFromEntity({ ...entity, fetchedAt: '2026-10-29', retrievalNote: 'Version warning' })[0]
  assert.notEqual(a.id, b.id)
})

test('streaming hides unfinished card data; nested fenced examples stay ordinary code', () => {
  const incomplete = 'Answer\n```legal-reference\n{"kind":"LAW"'
  assert.equal(legalMessageParts(incomplete, true)[0].text, 'Answer\n')
  assert.equal(legalMessageParts(incomplete)[0].text, incomplete)
  const nested = '````markdown\n' + fence(model) + '````\n'
  assert.equal(legalMessageParts(nested)[0].text, nested)
})

test('source field aliases and legal category labels preserve their meaning', () => {
  const [law] = referencesFromEntity({ kind: 'LAW', detail: { authoritative: { title: 'Act', original_text: 'Text', implement_date: '2024-07-01' } } })
  assert.equal(law.metadata.find(x => x.labelKey.endsWith('effectiveDate')).value, '2024-07-01')
  const [caseRef] = referencesFromEntity({ kind: 'CASE', detail: { recognition: { title: 'Case', caseFlag: 'TEST-CASE', court: 'Court' } } })
  assert.equal(caseRef.metadata.find(x => x.labelKey.endsWith('caseNumber')).value, 'TEST-CASE')
  const [procedure] = referencesFromEntity({ kind: 'CASE', detail: { result: { title: 'Case', court: 'Court', trial_procedure: '二审' } } })
  assert.ok(!procedure.metadata.some(x => x.labelKey.endsWith('cause')))
  const modelCase = referenceFromModel({ kind: 'CASE', title: 'Case', authority: 'Court', documentNumber: 'TEST-CASE', date: '2026-10-29' })
  assert.deepEqual(modelCase.metadata.map(x => x.labelKey), ['legalReference.caseNumber', 'legalReference.court', 'legalReference.judgmentDate'])
})
