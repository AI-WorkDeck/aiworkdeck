// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 真引擎计时：Word / PPT / Excel 在「备胎」上的打开耗时（load_document 往返）。
// 每轮一个全新引擎，先跑产品的 warm_engine（与 librePool 备胎空闲时相同），再计时装入目标文档，
// 然后再装同格式第二份（看「模块已热」的下限）。OPEN_TIMING_ROUNDS 默认 3；OPEN_TIMING_NO_WARM=1 跳过预热做对照。
// 用法：LOWA_ENGINE_DIR=… PUPPETEER_EXECUTABLE_PATH=… node tests/lowa-e2e/open-format-timing.mjs
import fs from 'node:fs'
import { preflight, loadPuppeteer, startServer, launchBrowser, openEditor } from './_boot.mjs'

preflight()
const ROUNDS = Number(process.env.OPEN_TIMING_ROUNDS || 3)
const WARM = process.env.OPEN_TIMING_NO_WARM !== '1'
const read = file => Array.from(fs.readFileSync(new URL(file, import.meta.url)))
// OPEN_TIMING_FILES=逗号分隔的本机文件路径：改测这些真实文件（不入库，只读）
const extra = (process.env.OPEN_TIMING_FILES || '').split(',').filter(Boolean)
const docs = extra.length ? extra.map(f => ({ name: f.split('/').pop(), bytes: Array.from(fs.readFileSync(f)) })) : [
  { name: 'contract.docx', bytes: read('../../../scripts/eval/fixtures/contract.docx') },
  { name: 'case-report.pptx', bytes: read('../../../scripts/eval/fixtures/case-report.pptx') },
  { name: 'impress-smoke.pptx', bytes: read('./fixtures/impress-smoke.pptx') },
  { name: 'case-ledger.xlsx', bytes: read('../../../scripts/eval/fixtures/case-ledger.xlsx') },
]
const server = await startServer()
const browser = await launchBrowser(await loadPuppeteer())
const results = {}
try {
  for (let round = 0; round < ROUNDS; round++) {
    for (const doc of docs) {
      const page = await openEditor(browser)
      const exec = (a, p = {}) => page.evaluate((a, p) => window.__loExecutor.executeCommand(a, p), a, p)
      const warm = WARM ? await exec('warm_engine') : { skipped: true }
      const timed = async name => {
        const t0 = Date.now()
        const r = await exec('load_document', { name, bytes: doc.bytes, authorName: '测试用户' })
        if (!r.success) throw new Error(doc.name + ': ' + JSON.stringify(r).slice(0, 200))
        return Date.now() - t0
      }
      const first = await timed(doc.name)
      const second = await timed('again-' + doc.name)
      ;(results[doc.name] ||= []).push({ first, second, warmMs: warm.ms ?? null })
      console.log(`round ${round + 1} ${doc.name}: first=${first}ms second=${second}ms warm=${warm.ms ?? 'skipped'}ms`)
      await page.close()
    }
  }
  const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
  console.log('\nmedian over ' + ROUNDS + ' rounds (warm_engine ' + (WARM ? 'on' : 'off') + '):')
  for (const [name, rs] of Object.entries(results)) console.log(`  ${name.padEnd(22)} first=${med(rs.map(r => r.first))}ms second=${med(rs.map(r => r.second))}ms`)
  if (process.env.OPEN_TIMING_OUT) fs.writeFileSync(process.env.OPEN_TIMING_OUT, JSON.stringify(results, null, 1))
} finally {
  await browser.close()
  server.close()
}
