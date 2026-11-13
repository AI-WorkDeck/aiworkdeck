// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// sheet_add_chart 的区域（O7 难任务实测）：单列曾被当成分类标签，导出的图表没有系列；
// 逗号分开的 'A1:A7,D1:D7' = 标签列 + 数据列；多列块照旧首列作标签。
// 跑法：LOWA_ENGINE_DIR=<引擎目录> node tests/lowa-e2e/sheet-chart-ranges.mjs
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { preflight, loadPuppeteer, startServer, launchBrowser, openEditor } from './_boot.mjs'
import { readXlsx, zipPart } from '../../../scripts/eval/office-xml.mjs'
preflight()
const server = await startServer(); const browser = await launchBrowser(await loadPuppeteer())
try {
  const page = await openEditor(browser)
  const ex = (a, p) => page.evaluate((a, p) => window.__loExecutor.executeCommand(a, { ...p, __agent: true }).then(x => ({ ...x, bytes: x.bytes ? Array.from(x.bytes) : undefined })), a, p)
  for (const range of ['D1:D7', 'A1:A7,D1:D7', 'A1:C7']) {
    await ex('load_document', { name: 'l.xlsx', bytes: Array.from(readFileSync(new URL('../../../scripts/eval/fixtures/case-ledger.xlsx', import.meta.url))) })
    await ex('sheet_manage_sheets', { action: 'activate', name: '费用' })
    await ex('sheet_write_cells', { sheet: '费用', startCell: 'D1', rows: [['合计'], ['=B2+C2'], ['=B3+C3'], ['=B4+C4'], ['=B5+C5'], ['=B6+C6'], ['=B7+C7']] })
    const r = await ex('sheet_add_chart', { sheet: '费用', range, chartType: 'line' })
    const out = await ex('export_document', { name: 'l.xlsx' })
    const buf = Buffer.from(Uint8Array.from(out.bytes, b => b & 255))
    const wb = readXlsx(buf)
    const charts = wb.parts().filter(p => /^xl\/charts\/chart\d*\.xml$/.test(p)).map(p => zipPart(buf, p))
    const c = charts[0] || ''
    const series = (c.match(/<c:ser>/g) || []).length
    const cat = (c.match(/<c:cat>[\s\S]*?<c:f>([^<]*)<\/c:f>/) || [])[1] || null
    const want = { 'D1:D7': [1, null], 'A1:A7,D1:D7': [1, '费用!$A$2:$A$7'], 'A1:C7': [2, '费用!$A$2:$A$7'] }[range]
    assert.equal(r.success, true, range)
    assert.equal(series, want[0], range + ': 系列数')
    assert.equal(cat, want[1], range + ': 分类标签')
    assert.ok(/<c:lineChart>/.test(c), range + ': 折线图')
    console.log('PASS', range, JSON.stringify({ ok: r.success, range: r.range }), 'series', (c.match(/<c:ser>/g) || []).length, 'line', /<c:lineChart>/.test(c), 'cat', (c.match(/<c:cat>[\s\S]*?<c:f>([^<]*)<\/c:f>/) || [])[1], 'val', [...c.matchAll(/<c:val>[\s\S]*?<c:f>([^<]*)<\/c:f>/g)].map(m => m[1]).join(' '))
  }
} finally { await browser.close(); server.close() }
