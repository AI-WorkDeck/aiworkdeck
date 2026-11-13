// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const core = require('../web/pitch-core.js')
const lib = JSON.parse(readFileSync(new URL('./fixtures/library-qiheng.json', import.meta.url), 'utf8'))

test('vendored review-core.js and xlsx.js stay identical to tabular-review', () => {
  for (const name of ['review-core.js', 'xlsx.js']) {
    assert.equal(readFileSync(new URL('../web/' + name, import.meta.url), 'utf8'),
      readFileSync(new URL('../../tabular-review/web/' + name, import.meta.url), 'utf8'), name)
  }
})

test('library digest never sends real client names to the model', () => {
  const digest = core.libraryDigest(lib, '国有企业 常年法律顾问 业绩', 20000)
  for (const c of lib.credentials) assert.ok(!digest.text.includes(c.client), c.client)
  assert.ok(digest.text.includes(lib.credentials[0].clientAlias))
  assert.equal(digest.omitted, 0)
  const small = core.libraryDigest(lib, '建设工程', 900)
  assert.ok(small.text.length <= 900)
  assert.ok(small.omitted > 0)
})

test('lawfirm import maps filed and closed matters, keeps lawyer edits on re-import', () => {
  const overview = {
    allIntakes: [
      { id: 11, status: 'APPROVED_FILED', title: '某仲裁案', clientName: '甲公司', practiceAreaLabel: '争议解决', leadLawyerName: '王律师', teamMemberNames: '李律师、赵律师', contractAmountCents: 12345600, filedAt: '2025-03-01T00:00:00' },
      { id: 12, status: 'CONFLICT_PENDING', title: '在审', clientName: '乙公司' },
      { id: 13, status: 'CLOSED', title: '已结案', clientName: '丙公司', leadLawyerName: '王律师', createdAt: '2023-05-01' }
    ],
    users: [{ id: 1, displayName: '王律师' }, { id: 2, displayName: '钱助理' }]
  }
  const first = core.fromLawfirm(overview, core.emptyLibrary())
  assert.equal(first.credentials, 2)
  assert.deepEqual(first.library.credentials.map((c) => c.title), ['某仲裁案', '已结案'])
  assert.equal(first.library.credentials[0].amount, '¥123,456.00')
  assert.equal(first.library.credentials[0].year, '2025')
  assert.deepEqual(first.library.credentials[0].lawyers, ['王律师', '李律师', '赵律师'])
  assert.deepEqual(first.library.lawyers.map((l) => l.name).sort(), ['李律师', '王律师', '赵律师', '钱助理'].sort())
  first.library.credentials[0].clientAlias = '某大型制造企业'
  const again = core.fromLawfirm(overview, first.library)
  assert.equal(again.credentials, 0)
  assert.equal(again.lawyers, 0)
  assert.equal(again.library.credentials[0].clientAlias, '某大型制造企业')
})

test('extracted requirements are de-duplicated and quotes verified against the source text', () => {
  const chunk = '第三章 投标人资格要求\n1. 依法设立的律师事务所，执业满10年。\n2. 通过ISO 9001质量管理体系认证。\n评分标准：类似业绩每项2分，最高10分。'
  const parts = [{ chunk, data: { tenderer: '青川城投', project: '常年顾问', items: [
    { kind: 'qualification', text: '执业满10年', quote: '依法设立的律师事务所，执业满10年。' },
    { kind: 'qualification', text: '执业满 10 年', quote: '重复' },
    { kind: 'qualification', text: 'ISO 9001 认证', quote: '编造的原文，不在文件里' },
    { kind: 'scoring', text: '类似业绩', score: '10分', quote: '类似业绩每项2分，最高10分。' },
    { kind: 'other', text: '无效类型' }
  ] } }]
  const got = core.collectItems('招标文件.docx', parts)
  assert.equal(got.tenderer, '青川城投')
  assert.equal(got.items.length, 3)
  assert.ok(got.items[0].source && got.items[0].source.locator.quote.includes('执业满10年'))
  assert.equal(got.items[1].source, null) // 找不到原文：保留但标未核验
  assert.equal(got.items[2].score, '10')
})

test('match results drop invented ids, never overwrite edited rows, and demote unsupported "met"', () => {
  const items = [
    { id: 'r1', kind: 'qualification', text: 'a', status: 'pending', evidence: [] },
    { id: 'r2', kind: 'qualification', text: 'b', status: 'missing', evidence: [], gap: '律师填的', edited: true },
    { id: 'r3', kind: 'scoring', text: 'c', score: '10', status: 'pending', evidence: [] }
  ]
  const reply = JSON.stringify({ results: [
    { id: 'r1', status: 'met', evidence: ['c1', 'c999', 'firm'], note: '共有c1、c2两项' },
    { id: 'r2', status: 'met', evidence: ['q1'] },
    { id: 'r3', status: 'met', evidence: ['nope'], gap: 'x' }
  ] })
  assert.equal(core.applyMatch(items, reply, lib, ['r1', 'r2', 'r3']), true)
  assert.deepEqual(items[0].evidence, ['c1', 'firm'])
  assert.equal(items[0].note, '共有「' + lib.credentials[0].clientAlias + '常年法律顾问」、「' + lib.credentials[1].clientAlias + '常年法律顾问」两项')
  assert.equal(items[0].status, 'met')
  assert.equal(items[1].status, 'missing')
  assert.equal(items[1].gap, '律师填的')
  assert.equal(items[2].status, 'partial')
  assert.equal(core.applyMatch(items, 'not json', lib), false)
  const s = core.summary(items)
  assert.deepEqual([s.met, s.partial, s.missing, s.points, s.pointsAtRisk], [1, 1, 1, 10, 10])
})

test('match requests stay within the ai.request size limit', () => {
  const big = core.normalizeLibrary(lib)
  for (let i = 0; i < 300; i++) big.credentials.push(Object.assign({}, lib.credentials[i % 10], { id: 'x' + i }))
  const items = Array.from({ length: 20 }, (_, i) => ({ id: 'r' + i, kind: 'scoring', text: '类似业绩 国有企业 常年法律顾问 要求 '.repeat(5), score: '5' }))
  const reqs = core.matchRequests(big, items, 'zh-CN', '2026-11-12')
  assert.equal(reqs.length, 3)
  for (const r of reqs) assert.ok(r.system.length + r.prompt.length <= 16000, String(r.system.length + r.prompt.length))
  assert.ok(reqs[0].omitted > 0)
})

test('recommendation favours cited evidence and puts the most senior lawyer first', () => {
  const matrix = { items: [{ id: 'r1', text: '近三年国有企业常年法律顾问业绩', evidence: ['c1', 'c2', 'c3', 'l2'] }] }
  const rec = core.recommend(lib, matrix, '常年法律顾问')
  assert.deepEqual(rec.credentials.slice(0, 3).sort(), ['c1', 'c2', 'c3'])
  assert.equal(rec.lawyers[0], 'l1')
  assert.ok(rec.lawyers.includes('l2'))
  assert.equal(rec.qualifications.length, lib.qualifications.length)
  assert.equal(rec.services.length, 1)
})

test('aliases: missing ones are reported, real names collected for leak checks', () => {
  const l = core.normalizeLibrary(JSON.parse(JSON.stringify(lib)))
  l.credentials[0].clientAlias = ''
  assert.deepEqual(core.missingAliases(l, ['c1', 'c2']).map((c) => c.id), ['c1'])
  assert.ok(core.secretNames(lib).length >= 10)
  for (const v of ['北京云杉数智科技有限公司', '云杉数智科技', '云杉数智']) assert.ok(core.nameVariants('北京云杉数智科技有限公司（示例）').includes(v), v)
  assert.ok(!core.secretNames(lib).includes('城市发展'))
  assert.equal(core.maskClients(lib, lib.credentials[0].clientAlias), lib.credentials[0].clientAlias)
  assert.ok(core.nameVariants('鼎盛连锁零售有限公司').includes('鼎盛连锁零售'))
  const masked = core.maskClients(lib, '鼎盛连锁零售劳动用工合规及集体劳动争议处理')
  assert.ok(!masked.includes('鼎盛连锁零售'), masked)
  assert.equal(core.maskClients(lib, '为' + lib.credentials[0].client + '提供服务'), '为' + lib.credentials[0].clientAlias + '提供服务')
})

test('merge keeps ids unique and updates same-source entries', () => {
  const a = core.normalizeLibrary(lib)
  const b = { credentials: [{ id: 'c1', title: '新业绩', client: '丁公司' }, Object.assign({}, lib.credentials[1], { summary: '更新' })] }
  const m = core.mergeLibrary(a, b)
  assert.equal(m.added, 1)
  assert.equal(new Set(m.library.credentials.map((c) => c.id)).size, m.library.credentials.length)
  assert.equal(m.library.credentials.find((c) => c.id === 'c2').summary, '更新')
})
