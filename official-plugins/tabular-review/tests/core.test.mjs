// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const core = createRequire(import.meta.url)('../web/review-core.js')
const t = (key) => key
const columns = [
  { id: 'parties', title: '合同主体', prompt: '合同各方是谁？', type: 'text' },
  { id: 'coc', title: '控制权变更', prompt: '是否有控制权变更条款？', type: 'yesno' }
]
const doc = '房屋租赁合同\n甲方：北京某某科技有限公司\n乙方：上海某某贸易有限公司\n\n第十条 一方控制权发生变更的，\n另一方有权解除本合同。'

test('引文必须逐字出现在原文中才生成锚点；换行/空白差异可容忍，编造的引文被拒', () => {
  const hit = core.locateQuote(doc, '“一方控制权发生变更的， 另一方有权解除本合同。”')
  assert.ok(hit)
  assert.equal(hit.quote, '一方控制权发生变更的， 另一方有权解除本合同。')
  // 定位用的引文不跨段，编辑器按段内查找
  assert.equal(hit.locatorQuote, '一方控制权发生变更的，')
  assert.ok(core.locateQuote(doc, '甲方：北京某某科技有限公司'))
  assert.ok(core.locateQuote(doc, '甲方：北京某某 科技有限公司'), '模型多插的空白不影响核验')
  assert.equal(core.locateQuote(doc, '甲方：北京某某网络有限公司'), null)
  assert.equal(core.locateQuote(doc, '甲方'), null, '过短的引文不能作为锚点')
  assert.equal(core.locateQuote(doc, ''), null)
})

test('证据对象对齐 EVIDENCE_CONTRACT：稳定 evidence_id、source_uri、locator 必填', () => {
  const hit = core.locateQuote(doc, '乙方：上海某某贸易有限公司')
  const a = core.evidenceFor('合同/租赁.pdf', hit)
  const b = core.evidenceFor('合同/租赁.pdf', hit)
  assert.equal(a.evidence_id, b.evidence_id)
  assert.notEqual(a.evidence_id, core.evidenceFor('合同/另一份.pdf', hit).evidence_id)
  assert.deepEqual(a.locator, { type: 'pdf', quote: '乙方：上海某某贸易有限公司' })
  assert.equal(a.source_uri, '合同/租赁.pdf')
  assert.equal(core.evidenceFor('a.docx', hit).locator.type, 'docx')
})

test('答案解析容忍代码围栏与多余文字，只收已知列，found=false 或空答案视为未提及', () => {
  const text = '好的：\n```json\n{"answers":[{"id":"parties","found":true,"answer":"甲乙双方","quote":"甲方"},' +
    '{"id":"coc","found":false,"answer":"","quote":""},{"id":"evil","found":true,"answer":"x","quote":"y"}]}\n```'
  const out = core.parseAnswers(text, ['parties', 'coc'])
  assert.deepEqual(Object.keys(out).sort(), ['coc', 'parties'])
  assert.equal(out.parties.found, true)
  assert.equal(out.coc.found, false)
  assert.equal(core.parseAnswers('not json', ['parties']), null)
  assert.equal(core.parseAnswers('{"answers":[{"id":"parties","found":true,"answer":"","quote":"x"}]}', ['parties']).parties.found, false)
})

test('每次请求不超过宿主 ai.request 的 16000 字符上限；长文分段且有上限', () => {
  const long = '条款内容。'.repeat(40000)
  const budget = core.chunkBudget(columns, 'zh-CN', '很长的文件名.docx')
  const { chunks, truncated } = core.chunkText(long, budget)
  assert.equal(chunks.length, core.LIMITS.maxChunks)
  assert.equal(truncated, true)
  chunks.forEach((chunk, i) => {
    const req = core.buildRequest({ fileName: '很长的文件名.docx', chunk, index: i, count: chunks.length, columns, language: 'zh-CN' })
    assert.ok(req.prompt.length + req.system.length <= 16000, 'request too long: ' + (req.prompt.length + req.system.length))
  })
  assert.equal(core.chunkText('短文', budget).chunks.length, 1)
  assert.equal(core.estimateCalls(100, columns, 'zh-CN'), 1)
  assert.equal(core.estimateCalls(long.length, columns, 'zh-CN'), core.LIMITS.maxChunks)
})

test('reviewFile：有核验锚点 → AI 草稿；引文对不上 → 未核验且丢弃答案；后续分段可补上', async () => {
  const text = '第一段。'.repeat(10) + '\n甲方：北京某某科技有限公司\n' + '填充。'.repeat(10)
  const replies = [
    JSON.stringify({ answers: [
      { id: 'parties', found: true, answer: '北京某某科技有限公司', quote: '甲方：北京某某科技有限公司' },
      { id: 'coc', found: true, answer: '是', quote: '编造的条款原文' }
    ] })
  ]
  const asked = []
  const res = await core.reviewFile({ path: '合同/a.docx', text, columns, language: 'zh-CN', ask: async (req) => { asked.push(req); return replies.shift() } })
  assert.equal(asked.length, 1)
  assert.equal(res.cells.parties.status, 'ai_draft')
  assert.equal(res.cells.parties.evidence.locator.quote, '甲方：北京某某科技有限公司')
  assert.equal(res.cells.coc.status, 'unverified')
  assert.equal(res.cells.coc.answer, undefined)
  assert.equal(res.cells.coc.evidence, undefined)
})

test('律师已确认/已修改的格子不再交给 AI；未核验与失败的格子会重试', () => {
  const cells = { parties: { status: 'confirmed' }, coc: { status: 'unverified' } }
  assert.deepEqual(core.pendingColumns(columns, cells).map((c) => c.id), ['coc'])
  assert.deepEqual(core.pendingColumns(columns, { parties: { status: 'edited' }, coc: { status: 'not_found' } }), [])
  assert.deepEqual(core.pendingColumns(columns, { coc: { status: 'error' } }).map((c) => c.id), ['parties', 'coc'])
})

test('格子状态：确认只针对 AI 草稿/已修改；修改保留 AI 原答案', () => {
  const draft = { status: 'ai_draft', answer: 'A', evidence: { evidence_id: 'x' } }
  assert.equal(core.confirmCell(draft).status, 'confirmed')
  assert.equal(core.confirmCell({ status: 'not_found' }).status, 'not_found')
  const edited = core.editCell(draft, ' B ')
  assert.equal(edited.status, 'edited')
  assert.equal(edited.answer, 'B')
  assert.equal(edited.aiAnswer, 'A')
  assert.deepEqual(edited.evidence, { evidence_id: 'x' })
  assert.equal(core.editCell(edited, 'C').aiAnswer, 'A')
  assert.equal(core.confirmCell(edited).status, 'confirmed')
})

test('限频：每分钟最多 10 次，第 11 次等到窗口滑过', async () => {
  let now = 0
  const waits = []
  const acquire = core.createLimiter({ now: () => now, sleep: async (ms) => { waits.push(ms); now += ms } })
  for (let i = 0; i < 10; i++) await acquire()
  assert.deepEqual(waits, [])
  await acquire()
  assert.equal(waits.length, 1)
  assert.ok(now >= 60000)
})

test('重试：超频与模型失败退避重试，权限类错误不重试，取消立刻停', async () => {
  const sleeps = []
  const sleep = async (ms) => { sleeps.push(ms) }
  let n = 0
  const ok = await core.withRetry(async () => { if (n++ < 2) throw Object.assign(new Error('q'), { code: 'quota_exceeded' }); return 'done' }, { sleep })
  assert.equal(ok, 'done')
  assert.deepEqual(sleeps, [30000, 60000])
  let calls = 0
  await assert.rejects(core.withRetry(async () => { calls++; throw Object.assign(new Error('p'), { code: 'permission_denied' }) }, { sleep }), /p/)
  assert.equal(calls, 1)
  await assert.rejects(core.withRetry(async () => 'x', { sleep, isCancelled: () => true }), (e) => e.code === 'cancelled')
})

test('导出：审阅表一行一文件，证据明细一行一格且带引文、定位与 AI 原答案', () => {
  const review = {
    columns,
    rows: [{ path: '合同/a.docx' }, { path: '合同/b.pdf' }],
    cells: {
      '合同/a.docx': {
        parties: { status: 'confirmed', answer: '甲乙', evidence: { evidence_id: 'tr-1', excerpt: '甲方：…', locator: { type: 'docx', quote: '甲方：…' } } },
        coc: { status: 'edited', answer: '否', aiAnswer: '是' }
      },
      '合同/b.pdf': { coc: { status: 'not_found' } }
    }
  }
  const [table, evidence] = core.exportSheets(review, t)
  assert.deepEqual(table.rows[0], ['panel.export.file', '合同主体', '控制权变更'])
  assert.deepEqual(table.rows[1], ['合同/a.docx', '甲乙', '否'])
  assert.deepEqual(table.rows[2], ['合同/b.pdf', '', 'panel.status.not_found'])
  assert.equal(evidence.rows.length, 4)
  assert.deepEqual(evidence.rows[1].slice(3, 7), ['panel.status.confirmed', '甲方：…', 'docx: 甲方：…', 'tr-1'])
  assert.equal(evidence.rows[2][7], '是')
})

test('模板标题与问题都走 l10n 键', () => {
  const cols = core.templateColumns('contract', t)
  assert.equal(cols.length, 9)
  assert.equal(cols[0].title, 'panel.tpl.contract.parties.title')
  assert.equal(cols[0].prompt, 'panel.tpl.contract.parties.prompt')
  assert.deepEqual(core.templateColumns('missing', t), [])
  assert.equal(core.newColumnId([{ id: 'q2' }, { id: 'x' }]), 'q3')
})
