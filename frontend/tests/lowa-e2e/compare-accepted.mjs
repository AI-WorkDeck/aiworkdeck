#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 真引擎（台账 B12）：版本对比时新版自身已带修订——默认按「接受原有修订后的正文」比对。
// R-086 真机：短合同第四条有 AI 修订（5→2），「与上一版比对」把比对修订与原有修订叠在一起，
// 律师看到「52050%」、共 5 处。compare_document{acceptExisting:true} 先接受新版原有修订再比对，
// 只剩真正的版本差异；不带该参数（显示原有修订）时维持原样叠加。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { preflight, loadPuppeteer, startServer, launchBrowser, openEditor } from './_boot.mjs'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-cmp-accepted-'))
const basePath = path.join(dir, 'base.docx')
// 最小 docx（标准库 zip），条款文字与真机复现一致
execFileSync('python3', ['-I', '-c', `
import zipfile, sys
from xml.sax.saxutils import escape
paras = ['设备购销合同（虚构示范）', '第四条 违约金：任一方违约，应按合同总价的 50% 向守约方支付违约金。', '第五条 争议解决：提交示范仲裁委员会仲裁。']
body = ''.join('<w:p><w:r><w:t xml:space="preserve">' + escape(p) + '</w:t></w:r></w:p>' for p in paras)
doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '</w:body></w:document>'
ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', ct); z.writestr('_rels/.rels', rels); z.writestr('word/document.xml', doc)
`, basePath])

preflight()
const server = await startServer()
const browser = await launchBrowser(await loadPuppeteer())
try {
  const base = Array.from(fs.readFileSync(basePath))
  const execOn = page => (a, p = {}) => page.evaluate((a, p) => window.__loExecutor.executeCommand(a, p), a, p)
  const exportBytes = page => page.evaluate(async () => {
    const r = await window.__loExecutor.executeCommand('export_document', { name: 'revised.docx' })
    return Array.from(r.bytes || [])
  })

  // 1) 造出「新版」：开修订把 50 改成 20，导出（带一处 AI 式修订）
  const author = await openEditor(browser)
  const a = execOn(author)
  assert.equal((await a('load_document', { name: 'base.docx', bytes: base })).kind, 'writer')
  await a('set_track_changes', { on: true })
  const rep = await a('replace_nth_match', { findText: '50', replaceText: '20', matchIndex: 0, __agent: true })
  assert.equal(rep.success, true, JSON.stringify(rep))
  const revised = await exportBytes(author)
  assert.ok(revised.length > 1000)
  await author.close()

  const compare = async (acceptExisting) => {
    const page = await openEditor(browser)
    const e = execOn(page)
    await e('load_document', { name: 'revised.docx', bytes: revised })
    const cmp = await e('compare_document', { baseBytes: base, ...(acceptExisting ? { acceptExisting: true } : {}) })
    assert.equal(cmp.success, true, JSON.stringify(cmp))
    const revs = await e('list_revisions', { limit: 50 })
    const authors = new Set((revs.revisions || []).map(r => r.author))
    await page.close()
    return { cmp, count: revs.count, authors: [...authors] }
  }

  const accepted = await compare(true)
  const raw = await compare(false)
  console.log(JSON.stringify({ accepted, raw }))
  assert.ok(accepted.cmp.acceptedExisting >= 1, 'the newer version carried a tracked change that should have been accepted first: ' + JSON.stringify(accepted.cmp))
  assert.ok(accepted.authors.every(name => name !== 'AI WorkDeck'), 'accepted mode must not show the newer version’s own (AI) redline: ' + JSON.stringify(accepted.authors))
  assert.ok(accepted.count < raw.count, `accepted mode shows only the version difference (${accepted.count}) — fewer than raw mode, which layers the original redline (${raw.count})`)
  assert.ok(raw.authors.includes('AI WorkDeck'), 'raw mode keeps the original redline visible: ' + JSON.stringify(raw.authors))
  console.log(JSON.stringify({ pass: 1, fail: 0 }))
} finally {
  await browser.close()
  server.close()
}
