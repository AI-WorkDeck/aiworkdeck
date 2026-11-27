#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Q23 real-engine regression: AI edits to figures must be redlined as whole tokens.
// Before, 70% → 30% was recorded as deleted 7 + inserted 3 + unchanged 0%, which reads
// as 730% (firstday-1125 QA, 11-ai-done.png). Both AI write paths are checked: a
// paragraph rewrite (modify_paragraph → applyMinimalRedline) and find_replace's native
// replaceAll fast path. Text that is not a number keeps char-level granularity.
//
// Run:  npm run test:lowa-number-tokens        (from frontend/)
// Prerequisites and env as run.mjs (dist/zetaoffice + engine + Chrome, see _boot.mjs).
import { preflight, loadPuppeteer, startServer, launchBrowser, openEditor } from './_boot.mjs'

const ORIGINAL = '甲方应于签订后五个工作日内支付合同总价的70%作为预付款；验收合格后支付20%；剩余10%于质保期满后支付，总价¥860,000元。'
const REWRITE = '甲方应于签订后五个工作日内支付合同总价的30%作为预付款；验收合格后支付40%；剩余30%于质保期满后支付，总价¥960,000元。'

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
  const rows = async () => ((await exec('debug_revisions')).redlines || []).map((r) => [r.type, r.text])
  const accepted = async () => (await exec('get_document_text', { __agent: true })).paragraphs.map((x) => x.text).join('|')
  const reset = async (text) => {
    await exec('set_track_changes', { on: false })
    await exec('ui_command', { name: 'select_all' })
    await exec('replace_selection', { text })
    await exec('goto', { type: 'end' })
    await exec('set_track_changes', { on: true })
  }
  const deleted = (rs) => rs.filter((r) => r[0] === 'Delete').map((r) => r[1]).sort()
  const inserted = (rs) => rs.filter((r) => r[0] === 'Insert').map((r) => r[1]).sort()

  console.log('== 1) Paragraph rewrite: each changed figure is one delete + one insert of the whole number ==')
  await reset(ORIGINAL)
  const mp = await exec('modify_paragraph', { index: 0, newText: REWRITE, __agent: true })
  check('modify_paragraph succeeded', mp && mp.success, JSON.stringify(mp))
  let rs = await rows()
  check('deleted tokens are 10% 20% 70% 860,000', JSON.stringify(deleted(rs)) === JSON.stringify(['10%', '20%', '70%', '860,000'].sort()), JSON.stringify(rs))
  check('inserted tokens are 30% 30% 40% 960,000', JSON.stringify(inserted(rs)) === JSON.stringify(['30%', '30%', '40%', '960,000'].sort()), JSON.stringify(rs))
  check('accepted text equals the rewrite', (await accepted()) === REWRITE, await accepted())

  console.log('== 2) find_replace fast path (native replaceAll) also replaces the whole figure ==')
  await reset(ORIGINAL)
  const fr = await exec('find_replace', { findText: '总价的70%', replaceText: '总价的30%', replaceAll: true, __agent: true })
  check('find_replace replaced 1', fr && fr.success && fr.replaced === 1, JSON.stringify(fr))
  rs = await rows()
  check('one Delete 70% + one Insert 30%', JSON.stringify(rs.map((r) => r.join(':')).sort()) === JSON.stringify(['Delete:70%', 'Insert:30%']), JSON.stringify(rs))

  console.log('== 3) Words keep char-level granularity ==')
  await reset('甲方应于三日内付款。')
  await exec('modify_paragraph', { index: 0, newText: '乙方应于三日内付款。', __agent: true })
  rs = await rows()
  check('only 甲 → 乙 is redlined', JSON.stringify(rs.map((r) => r.join(':')).sort()) === JSON.stringify(['Delete:甲', 'Insert:乙']), JSON.stringify(rs))
} finally {
  await browser.close()
  server.close()
}
console.log('\n' + passed + ' passed, ' + failed + ' failed')
process.exit(failed ? 1 : 0)
