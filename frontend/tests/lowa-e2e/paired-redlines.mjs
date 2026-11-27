#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Q25 real-engine regression: an AI replacement is recorded as a Delete redline plus an
// Insert redline. Shown as two cards, accepting the deletion and rejecting the insertion
// left 「调整附件一的功能范围」 with no subject (firstday-1125 QA, 13-accept-reject.png).
// The review panel and the in-document balloons both build cards with groupRevisions();
// this test runs that grouping on what the engine really lists, resolves the paired card
// the way the panel does (one resolve_revisions call with all its indices), and checks
// the resulting paragraph for accept and for reject. It also shows the half-accept that
// the pairing now prevents still breaks the sentence on this engine.
//
// Run:  npm run test:lowa-paired-redlines        (from frontend/)
// Prerequisites and env as run.mjs (dist/zetaoffice + engine + Chrome, see _boot.mjs).
import { preflight, loadPuppeteer, startServer, launchBrowser, openEditor } from './_boot.mjs'
import { groupRevisions } from '../../src/utils/reviewGrouping.js'

const ORIGINAL = '乙方有权根据开发进展自行调整附件一的功能范围。'
const FIND = '乙方有权根据开发进展自行调整附件一的功能范围'
const REPLACE = '如需调整附件一的功能范围，须经甲方书面确认'
const USER = '张律师'

preflight()
const puppeteer = await loadPuppeteer()
const server = await startServer({})

let passed = 0, failed = 0
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  PASS ' + label) }
  else { failed++; console.log('  FAIL ' + label + (detail ? '  [' + detail + ']' : '')) }
}

const browser = await launchBrowser(puppeteer)
try {
  const page = await openEditor(browser, { clipboard: false })
  const exec = (a, p) => page.evaluate((a2, p2) => window.__loExecutor.executeCommand(a2, p2 || {}), a, p)
  // Accepted text: what the paragraph reads once every remaining redline is accepted.
  const body = async () => (await exec('get_document_text', { __agent: true })).paragraphs.map((x) => x.text).join('|')
  const reset = async (text) => {
    await exec('set_track_changes', { on: false })
    await exec('ui_command', { name: 'select_all' })
    await exec('replace_selection', { text })
    await exec('goto', { type: 'end' })
    await exec('set_track_changes', { on: true })
  }
  const listed = async () => {
    const lr = await exec('list_revisions', { limit: 500 })
    return { lr, groups: groupRevisions(lr.revisions || [], { selfAuthor: USER }) }
  }
  // The panel's resolveGroup: all indices of the card, descending, one call, with its fence.
  const resolveCard = async (g, lr, action) => exec('resolve_revisions', {
    indices: g.items.map((r) => r.index).sort((a, b) => b - a), action,
    revision: lr.revision, documentSeq: lr.documentSeq,
    expectedRevisions: g.items.map((r) => ({ index: r.index, identifier: r.identifier, type: r.type, text: r.text, author: r.author, timestamp: r.timestamp })),
  })
  const aiReplace = async () => {
    await reset(ORIGINAL)
    const fr = await exec('find_replace', { findText: FIND, replaceText: REPLACE, replaceAll: true, __agent: true })
    if (!fr || !fr.success) throw new Error('find_replace failed: ' + JSON.stringify(fr))
    return listed()
  }

  await exec('load_document', { authorName: USER })

  console.log('== 1) An AI replacement becomes one 替换 card plus the separate trailing insertion ==')
  let { lr, groups } = await aiReplace()
  const rows = (lr.revisions || []).map((r) => [r.type, r.author, r.text])
  check('engine records the replacement as Delete + Insert (plus the trailing Insert)',
    rows.length === 3 && rows.filter((r) => r[0] === 'Delete').length === 1, JSON.stringify(rows))
  const rep = groups.filter((g) => g.typeKey === 'replace')
  check('exactly one paired card', rep.length === 1, JSON.stringify(groups.map((g) => [g.typeKey, g.text, g.insText])))
  check('paired card shows 乙方有权根据开发进展自行 → 如需',
    rep[0] && rep[0].text === '乙方有权根据开发进展自行' && rep[0].insText === '如需', JSON.stringify(rep[0] && [rep[0].text, rep[0].insText]))
  check('two cards in total, not three', groups.length === 2, JSON.stringify(groups.map((g) => g.typeKey)))

  console.log('== 2) Accepting the paired card applies both halves ==')
  let res = await resolveCard(rep[0], lr, 'accept')
  check('resolve_revisions resolved both redlines', res && res.success && (res.results || []).filter((r) => r.success).length === 2, JSON.stringify(res))
  let after = await listed()
  check('only the trailing insertion is left', after.lr.revisions.length === 1 && after.lr.revisions[0].type === 'Insert'
    && after.lr.revisions[0].text === '，须经甲方书面确认', JSON.stringify(after.lr.revisions.map((r) => [r.type, r.text])))
  check('paragraph keeps its subject: 如需调整…', (await body()) === REPLACE + '。', await body())

  console.log('== 3) Rejecting the paired card restores both halves ==')
  ;({ lr, groups } = await aiReplace())
  res = await resolveCard(groups.find((g) => g.typeKey === 'replace'), lr, 'reject')
  check('resolve_revisions resolved both redlines', res && res.success && (res.results || []).filter((r) => r.success).length === 2, JSON.stringify(res))
  after = await listed()
  check('only the trailing insertion is left', after.lr.revisions.length === 1 && after.lr.revisions[0].type === 'Insert', JSON.stringify(after.lr.revisions.map((r) => [r.type, r.text])))
  check('paragraph reads the original subject: 乙方有权…调整…',
    (await body()) === '乙方有权根据开发进展自行调整附件一的功能范围，须经甲方书面确认。', await body())

  console.log('== 4) Why: resolving the halves separately (the old two-card UI) breaks the sentence ==')
  ;({ lr } = await aiReplace())
  const del = lr.revisions.find((r) => r.type === 'Delete')
  await exec('resolve_revisions', { indices: [del.index], action: 'accept' })
  const ins = (await exec('list_revisions', { limit: 500 })).revisions.find((r) => r.type === 'Insert' && r.text === '如需')
  await exec('resolve_revisions', { indices: [ins.index], action: 'reject' })
  check('half-accept leaves 调整附件一的功能范围 with no subject (the bug the pairing prevents)',
    (await body()).startsWith('调整附件一的功能范围'), await body())

  console.log('== 5) A user edit right next to an AI edit is not paired ==')
  await reset(ORIGINAL)
  await exec('find_replace', { findText: '乙方', replaceText: '', replaceAll: true, __agent: true })
  await exec('goto', { type: 'start' })
  await exec('insert_at_cursor', { text: '甲方' })
  ;({ groups } = await listed())
  check('AI deletion and user insertion stay two cards',
    groups.length === 2 && !groups.some((g) => g.typeKey === 'replace'), JSON.stringify(groups.map((g) => [g.typeKey, g.author, g.text])))
} finally {
  await browser.close()
  server.close()
}
console.log('\n' + passed + ' passed, ' + failed + ' failed')
process.exit(failed ? 1 : 0)
