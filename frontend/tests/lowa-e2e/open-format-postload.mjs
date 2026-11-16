// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 真引擎计时：打开后宿主马上要跑的只读命令（工具栏 get_ui_state、导航清单、缩略图）各格式的耗时。
import fs from 'node:fs'
import { preflight, loadPuppeteer, startServer, launchBrowser, openEditor } from './_boot.mjs'

preflight()
const read = file => Array.from(fs.readFileSync(new URL(file, import.meta.url)))
const extra = (process.env.OPEN_TIMING_FILES || '').split(',').filter(Boolean)
const docs = extra.length ? extra.map(f => ({ name: f.split('/').pop(), bytes: Array.from(fs.readFileSync(f)), slides: /\.pptx$/i.test(f) })) : [
  { name: 'contract.docx', bytes: read('../../../scripts/eval/fixtures/contract.docx') },
  { name: 'case-report.pptx', bytes: read('../../../scripts/eval/fixtures/case-report.pptx'), slides: true },
  { name: 'impress-smoke.pptx', bytes: read('./fixtures/impress-smoke.pptx'), slides: true },
  { name: 'case-ledger.xlsx', bytes: read('../../../scripts/eval/fixtures/case-ledger.xlsx') },
]
// OPEN_POSTLOAD_STRIP_LEAK=1：服务 soffice.js 时去掉 Embind 调试版的泄漏告警栈（office-tier1 O8 对照）
const LEAK_RE = /var err=new Error\(`Embind found a leaked C\+\+ instance[\s\S]*?info\.leakWarning=err\.stack\.replace\(\/\^Error: \/,""\);/
const server = await startServer({ patchServed(url, bytes) {
  if (process.env.OPEN_POSTLOAD_STRIP_LEAK === '1' && url === '/lowa/soffice.js') {
    const s = bytes.toString('utf8'); if (!LEAK_RE.test(s)) throw new Error('leak-warning anchor not found')
    return Buffer.from(s.replace(LEAK_RE, ''))
  }
  return bytes
} })
const browser = await launchBrowser(await loadPuppeteer())
try {
  for (const doc of docs) {
    const page = await openEditor(browser)
    const exec = (a, p = {}) => page.evaluate((a, p) => window.__loExecutor.executeCommand(a, p), a, p)
    // 在页面里计时、只回传小结果：大回包（导出的字节）经 CDP 序列化回 node 要好几秒，那不是产品里的开销
    const time = async (label, a, p) => {
      const o = await page.evaluate(async (a, p) => { const t0 = performance.now(); const r = await window.__loExecutor.executeCommand(a, p); const ms = Math.round(performance.now() - t0); const small = r && r.bytes ? { success: r.success, size: r.size } : r; return { ms, r: small } }, a, p)
      return { label, ms: o.ms, ok: o.r && o.r.success !== false, r: o.r }
    }
    await exec('warm_engine')
    const out = [await time('load', 'load_document', { name: doc.name, bytes: doc.bytes, authorName: 't' })]
    out.push(await time('ui_state', 'get_ui_state', {}))
    out.push(await time('ui_state#2', 'get_ui_state', {}))
    out.push(await time('ui_state(sel)', 'get_ui_state', { scope: 'selection' }))
    out.push(await time('fonts', 'list_fonts', {}))
    const nav = await time('nav', 'office_get_navigation', {})
    out.push(nav)
    if (doc.slides) {
      const n = (nav.r.items || nav.r.slides || []).length || 3
      for (let i = 1; i <= Math.min(n, 6); i++) out.push(await time('thumb' + i, 'slide_get_thumbnail', { slideNumber: i, width: 320, documentSeq: nav.r.documentSeq }))
    }
    if (doc.slides) { out.push(await time('goto3', 'slide_goto', { slideNumber: 3 })); out.push(await time('page3', 'slide_get_page', { slideNumber: 3 })); out.push(await time('export', 'export_document', { name: 'o.pptx' })) }
    else if (/xlsx$/.test(doc.name)) { out.push(await time('write', 'sheet_write_cells', { startCell: 'A2', rows: [['x']] })); out.push(await time('export', 'export_document', { name: 'o.xlsx' })) }
    else { out.push(await time('export', 'export_document', { name: 'o.docx' })) }
    console.log(doc.name.padEnd(20), out.map(o => `${o.label}=${o.ms}${o.ok ? '' : '!'}`).join(' '))
    await page.close()
  }
} finally {
  await browser.close()
  server.close()
}
