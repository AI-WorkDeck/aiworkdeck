// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// V7 D1（compare_docx_redline）的引擎侧验收：用 scripts/eval 的合同 v1/v2 夹具跑
// build_comparison_document（宿主动作 compare_docx_files 内部就是这一条），断言
// ① 产出带原生修订：改动落在第三条（10→15）与第五条（10%→20%）、新增第七条；
// ② 第一/四/六条没有修订，第二条只差空白也不产生修订；
// ③ 全部接受 = v2 正文，全部拒绝 = v1 正文（比对稿不改变任何一边的语义）。
// 运行：cd frontend && npm run build:zetaoffice && node tests/lowa-e2e/comparison-contract-versions.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { preflight, startServer, launchBrowser, loadPuppeteer, openEditor, here } from './_boot.mjs'

const fixture = name => Array.from(fs.readFileSync(path.resolve(here, '../../../scripts/eval/fixtures', name)))
preflight()
const server = await startServer()
const browser = await launchBrowser(await loadPuppeteer())
try {
  const page = await openEditor(browser)
  const exec = (action, params = {}) => page.evaluate(async (action, params) => {
    const result = await window.__loExecutor.executeCommand(action, params)
    if (result.bytes) result.bytes = Array.from(result.bytes)
    return result
  }, action, params)
  const ok = async (action, params) => {
    const result = await exec(action, params)
    assert.equal(result.success, true, action + ': ' + JSON.stringify(result))
    return result
  }
  const text = async () => (await ok('get_document_text')).paragraphs.map(x => x.text.replace(/\s+/g, ''))
  const v1 = fixture('compare-v1.docx')
  const v2 = fixture('compare-v2.docx')

  await ok('load_document', { bytes: v1, name: 'v1.docx', authorName: '测试用户' })
  const v1Text = await text()
  await ok('load_document', { bytes: v2, name: 'v2.docx', authorName: '测试用户' })
  const v2Text = await text()

  await ok('build_comparison_document', { baseBytes: v1, revisedBytes: v2 })
  const revisions = (await ok('list_revisions')).revisions
  assert.ok(revisions.length > 0, 'comparison must produce native revisions')
  const touched = revisions.map(x => x.text).join('|')
  assert.ok(/15|5/.test(touched) && /20|2/.test(touched), 'payment period and penalty ratio changes are revised: ' + touched)
  assert.ok(revisions.some(x => x.type === 'Insert' && x.text.includes('保密')), 'new clause 7 is an insertion')
  assert.ok(!revisions.some(x => /转让价款为人民币|1000/.test(x.text)), 'whitespace-only clause 2 must not be revised')
  assert.ok(!revisions.some(x => /交割|仲裁/.test(x.text)), 'untouched clauses must not be revised')

  const compared = (await ok('export_document', { name: 'compare.docx' })).bytes
  for (const [action, expected] of [['accept', v2Text], ['reject', v1Text]]) {
    await ok('load_document', { bytes: compared, name: 'compare.docx', authorName: '测试用户' })
    await ok('resolve_all_revisions', { action })
    assert.deepEqual(await text(), expected, action + ' projection')
  }
  console.log('PASS: contract v1/v2 comparison -> native redlines, accept == v2, reject == v1, unchanged/whitespace-only clauses untouched')
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
