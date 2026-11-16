#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 真引擎（0.85.3）：删到段落标记的修订在最终稿视图里会合并段落。#1592 把各视图的段落索引存起来、
// 切回同一视图时原样复用——最终稿视图的段落对象在视图来回切过之后，读出来变成空串、按段号写会落错段。
// 现在只复用内联视图（all）的索引。本测试：AI（__agent）连续读同一份稿三次结果一致且正确；
// 视图来回切过之后，AI 按段号改写一段（合并段本身、以及它后面的段），改中的是那一段、别的段一字不动。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { preflight, loadPuppeteer, startServer, launchBrowser, openEditor } from './_boot.mjs'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-final-view-index-'))
const basePath = path.join(dir, 'base.docx')
execFileSync('python3', ['-I', '-c', `
import zipfile, sys
from xml.sax.saxutils import escape
paras = ['股份有限公司首次公开发行股票的法律意见书', '第一部分：发行人已依法设立并有效存续，主体资格合法有效。',
         '第二部分：发行人的主要财产权属清晰，不存在重大权属纠纷。', '第三部分：本次发行的批准与授权情况如下所列。',
         '发行人股东大会已审议通过本次发行方案。', '董事会已获得办理相关事宜的授权。', '第四部分：结论意见。']
body = ''.join('<w:p><w:r><w:t xml:space="preserve">' + escape(p) + '</w:t></w:r></w:p>' for p in paras)
doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '</w:body></w:document>'
ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', ct); z.writestr('_rels/.rels', rels); z.writestr('word/document.xml', doc)
`, basePath])

// 测试专用 worker 动作：第 4、5 段套编号；从第 3 段第 8 字删到段落标记、再删进第 4 段（列表项）4 个字。
const DEBUG = String.raw`
  debug_cross_paragraph_deletion() {
    const text = xModel.getText();
    const at = function (i, offset) {
      const en = text.createEnumeration(); let k = 0, para = null;
      while (en.hasMoreElements()) { const el = en.nextElement(); if (el.supportsService('com.sun.star.text.Paragraph')) { if (k === i) { para = el; break; } k++; } }
      const c = text.createTextCursorByRange(para.getStart());
      if (offset) c.goRight(offset, false);
      return c;
    };
    for (const i of [4, 5]) { const c = at(i, 0); c.gotoEndOfParagraph(true); c.setPropertyValue('NumberingStyleName', 'Numbering 123'); }
    xModel.setPropertyValue('RecordChanges', true);
    const c = at(3, 8); c.gotoEndOfParagraph(true); c.goRight(1, true); c.goRight(4, true); c.setString('');
    return { success: true };
  },
`
function patchServed(urlPath, content) {
  if (urlPath === '/office_thread.js') {
    const s = content.toString('utf8')
    if (!s.includes('const EXEC = {')) throw new Error('office_thread.js: anchor missing')
    return Buffer.from(s.replace('const EXEC = {', 'const EXEC = {\n' + DEBUG), 'utf8')
  }
  if (/^\/assets\/editor-.*\.js$/.test(urlPath)) {
    return Buffer.from(content.toString('utf8')
      .replace("'get_hyperlink_at_cursor'", "'get_hyperlink_at_cursor','debug_cross_paragraph_deletion'")
      .replace('"get_hyperlink_at_cursor"', '"get_hyperlink_at_cursor","debug_cross_paragraph_deletion"'), 'utf8')
  }
  return content
}

preflight()
const server = await startServer({ patchServed })
const browser = await launchBrowser(await loadPuppeteer())
try {
  const page = await openEditor(browser)
  const exec = (a, p = {}) => page.evaluate((a, p) => window.__loExecutor.executeCommand(a, p), a, p)
  assert.equal((await exec('load_document', { name: 'base.docx', bytes: Array.from(fs.readFileSync(basePath)) })).kind, 'writer')
  assert.equal((await exec('debug_cross_paragraph_deletion')).success, true)
  await exec('set_revision_view', { mode: 'all' })
  const agentRead = async () => (await exec('get_document_text', { startParagraph: 0, maxParagraphs: 50, __agent: true })).paragraphs.map(p => p.text)

  // (a) 读：AI 连续读三次（每次都切到最终稿视图再切回），结果必须一致且是合并后的正确正文
  const reads = [await agentRead(), await agentRead(), await agentRead()]
  console.log(JSON.stringify({ reads: reads.map(r => r[3]) }))
  assert.equal(reads[0][3], '第三部分：本次发东大会已审议通过本次发行方案。', 'final view merges the paragraphs across the deleted mark')
  assert.deepEqual(reads[1], reads[0], 'second AI read must equal the first')
  assert.deepEqual(reads[2], reads[0], 'third AI read must equal the first')

  // (b) 写：视图来回切过之后，AI 按段号改写下一段（最终稿视图里是第 4 段「董事会…」）
  const target = reads[0].indexOf('董事会已获得办理相关事宜的授权。')
  assert.ok(target > 0, JSON.stringify(reads[0]))
  const mod = await exec('modify_paragraph', { index: target, newText: '董事会已获得办理相关事宜的全部授权。', __agent: true })
  assert.notEqual(mod.success, false, JSON.stringify(mod))
  const after = await agentRead()
  console.log(JSON.stringify({ after }))
  assert.equal(after[target], '董事会已获得办理相关事宜的全部授权。', 'the targeted paragraph is the one changed')
  for (let i = 0; i < after.length; i++) if (i !== target) assert.equal(after[i], reads[0][i], `paragraph ${i} must be untouched`)

  // (c) 写合并段本身：旧代码在视图来回切过之后这里抛 RuntimeException（命令失败），现在必须改中且只改它
  assert.equal((await exec('load_document', { name: 'base.docx', bytes: Array.from(fs.readFileSync(basePath)) })).kind, 'writer')
  assert.equal((await exec('debug_cross_paragraph_deletion')).success, true)
  await exec('set_revision_view', { mode: 'all' })
  const before = await agentRead(); await agentRead(); await agentRead()
  const merged = before.indexOf('第三部分：本次发东大会已审议通过本次发行方案。')
  const mod2 = await exec('modify_paragraph', { index: merged, newText: '第三部分：本次发行已经股东大会审议通过。', __agent: true })
  assert.notEqual(mod2.success, false, 'writing the merged paragraph after view toggles: ' + JSON.stringify(mod2))
  const after2 = await agentRead()
  console.log(JSON.stringify({ after2 }))
  assert.equal(after2[merged], '第三部分：本次发行已经股东大会审议通过。')
  for (let i = 0; i < after2.length; i++) if (i !== merged) assert.equal(after2[i], before[i], `paragraph ${i} must be untouched`)
  console.log(JSON.stringify({ pass: 1, fail: 0 }))
} finally {
  await browser.close()
  server.close()
}
