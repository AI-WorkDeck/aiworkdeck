// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 「已自动合入的相邻段落，请过目」（2026-11-15）：本机提示点开过一次才消失、总览行 / 版本记录 / 版本入口角标的说法
import test from 'node:test'
import assert from 'node:assert/strict'

const store = new Map()
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }
const { addMergeNeighborNotice, unseenMergeNeighborNotices, markMergeNeighborNoticeSeen } = await import('../../src/utils/mergeNeighborNotices.js')
const { mergeRowText } = await import('../../src/utils/mergeRows.js')
const { historyMergeLines } = await import('../../src/utils/historyMerges.js')
const { versionEntryState } = await import('../../src/utils/versionEntryState.js')

const t = (key, params) => (params === undefined ? key : `${key}(${JSON.stringify(params)})`)
const N = [{ key: 'p1', side: 'T', baseText: '第二条 原文', mainText: '第二条 原文', otherText: '第二条 稿改' }]

test('提示存在本机，点开过一次才消失；按项目分开', () => {
  const id = addMergeNeighborNotice(7, { path: '合同.docx', neighbors: N, sides: { main: '主稿', other: '稿' } })
  addMergeNeighborNotice(8, { path: '别的.docx', neighbors: N })
  assert.equal(unseenMergeNeighborNotices(7).length, 1)
  assert.equal(unseenMergeNeighborNotices(7)[0].neighbors[0].otherText, '第二条 稿改')
  markMergeNeighborNoticeSeen(7, id)
  assert.equal(unseenMergeNeighborNotices(7).length, 0)
  assert.equal(unseenMergeNeighborNotices(8).length, 1)
  assert.equal(addMergeNeighborNotice(7, { path: '空.docx', neighbors: [] }), null, 'nothing to review, nothing recorded')
})

test('裁决总览：已自动合入的那一行带上「含 N 处相邻段落的改动，请过目」', () => {
  const text = mergeRowText(t, { path: '合同.docx', kind: 'DOCX', decision: 'AUTO', state: 'MERGED', mainChanges: 1, otherChanges: 2, neighborCount: 2 })
  assert.match(text, /version\.mergeRowNeighbors\(\{"count":2\}\)$/)
  const plain = mergeRowText(t, { path: '合同.docx', kind: 'DOCX', decision: 'AUTO', state: 'MERGED', mainChanges: 1, otherChanges: 2 })
  assert.doesNotMatch(plain, /mergeRowNeighbors/)
})

test('版本记录：自动合并那一行列出相邻段落；逐处裁决里的 N 说成「相邻段落，自动合入了某侧的改动」', () => {
  const auto = historyMergeLines(t, { mergeContext: 'adopt', merges: [{ path: '合同.docx', mode: 'auto', mainCount: 1, otherCount: 1, decisions: [{ key: 'p1', side: 'T', action: 'N' }] }] })
  assert.match(auto[0].text, /mergeNeighborsHistory/)
  const manual = historyMergeLines(t, { mergeContext: 'adopt', merges: [{ path: '合同.docx', mode: 'manual', decisions: [{ key: 'p2', side: 'T', action: 'A' }, { key: 'p1', side: 'T', action: 'N' }] }] })
  assert.match(manual[0].full, /mergeDecisionNeighbor/)
})

test('版本入口：没别的角标时挂一个小圆点，标题里说有几份待过目；更要紧的角标优先', () => {
  const e = versionEntryState(t, { status: { enabled: true }, review: 1 })
  assert.equal(e.badge, '•')
  assert.match(e.title, /mergeNeighborsPending/)
  assert.equal(versionEntryState(t, { status: { enabled: true, changedCount: 3 }, review: 1 }).badge, '3')
  assert.equal(versionEntryState(t, { status: { enabled: true } }).badge, '')
})
