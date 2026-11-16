// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 真引擎（台账 B5）：QuickLook 借预热备胎渲染幻灯片后用 load_document{blank} 清场归还。
// 清场后必须是一份干净、未修改的空白 Writer 文档（预览过的内容一个字都不剩），
// 且这台引擎接着装 Word / PPT / Excel 都正常，能编辑。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { preflight, loadPuppeteer, startServer, launchBrowser, openEditor } from './_boot.mjs'

preflight()
const server = await startServer()
const browser = await launchBrowser(await loadPuppeteer())
try {
  const page = await openEditor(browser)
  const exec = (a, p = {}) => page.evaluate((a, p) => window.__loExecutor.executeCommand(a, p), a, p)
  const ok = async (a, p) => { const r = await exec(a, p); assert.equal(r.success, true, a + ': ' + JSON.stringify(r).slice(0, 300)); return r }
  const read = file => Array.from(fs.readFileSync(new URL(file, import.meta.url)))
  const pptx = read('./fixtures/impress-smoke.pptx')
  let pass = 0

  // 1) 模拟预览：装 pptx、取导航与缩略图，再清场
  await ok('load_document', { name: 'preview.pptx', bytes: pptx })
  const nav = await ok('office_get_navigation', {})
  await ok('slide_get_thumbnail', { slideNumber: 1, width: 640, format: 'jpeg', preview: true, documentSeq: nav.documentSeq })
  const reset = await ok('load_document', { blank: true, name: 'blank.docx' })
  assert.equal(reset.blank, true, 'blank reset result: ' + JSON.stringify(reset))
  assert.equal(reset.kind, 'writer', 'blank reset yields a Writer document: ' + JSON.stringify(reset))
  const text = await ok('get_document_text', { startParagraph: 0, maxParagraphs: 50, __agent: true })
  assert.ok(Array.isArray(text.paragraphs) && text.paragraphs.every(p => p.text === ''), 'no previewed content survives: ' + JSON.stringify(text).slice(0, 200))
  const exported = await ok('export_document', { name: 'blank.docx' })
  assert.ok(exported.size > 0, 'blank document exports')
  pass++

  // 2) 清场后的引擎照常装三种格式并能编辑（过继后的真实路径）
  for (const doc of [
    { name: 'next.docx', bytes: read('./fixtures/comment-batch-revisions.docx'), kind: 'writer' },
    { name: 'next.pptx', bytes: pptx, kind: 'impress' },
    { name: 'next.xlsx', bytes: read('../../../scripts/eval/fixtures/case-ledger.xlsx'), kind: 'calc' },
  ]) {
    const r = await ok('load_document', { name: doc.name, bytes: doc.bytes })
    assert.equal(r.kind, doc.kind, doc.name)
    if (doc.kind === 'writer') {
      await ok('insert_at_cursor', { text: 'B5' })
      const t = await ok('get_document_text', { startParagraph: 0, maxParagraphs: 5, __agent: true })
      assert.ok(JSON.stringify(t).includes('B5'), 'typing works after reuse')
    }
    // 回到预览→清场→再装，循环两遍不泄漏、不出错
    await ok('load_document', { blank: true, name: 'blank.docx' })
    pass++
  }
  console.log(JSON.stringify({ pass, fail: 0 }))
} finally {
  await browser.close()
  server.close()
}
