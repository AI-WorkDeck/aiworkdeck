#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 真引擎（台账 B11）：宿主整篇读的「最终文本」不切视图，必须与切到「最终稿」视图读到的逐字相同。
//
// 宿主即时审校/写作辅助的 bulk + __agent 读，以前读前切到隐藏删除视图（改过稿后要整篇重排 ~600 ms，
// 律师打的字排在后面）。现在在内联视图里把删除型修订覆盖的字剪掉。本测试逐类构造律师实际会产生的修订，
// 比对新路径与改造前的生产路径（同一条读命令强制切视图）的结果；拿不准的类型（删除里含域、批注锚点、删到段落标记——
// 最终稿视图会合并段落、段号前移）要整份退回切视图。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { preflight, loadPuppeteer, startServer, launchBrowser, openEditor } from './_boot.mjs'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-bulk-final-'))
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

// 测试专用 worker 动作（内存注入）：在引擎里直接构造各类修订；读回剪切计划是否退回切视图。
const DEBUG = String.raw`
  debug_final_plan() { const plan = bodyFinalTextCuts(); return { success: true, fallback: plan.fallback || null }; },
  debug_redline_case(p) {
    const text = xModel.getText();
    const at = function (i, offset) {
      const en = text.createEnumeration(); let k = 0, para = null;
      while (en.hasMoreElements()) { const el = en.nextElement(); if (el.supportsService('com.sun.star.text.Paragraph')) { if (k === i) { para = el; break; } k++; } }
      const c = text.createTextCursorByRange(para.getStart());
      if (offset) c.goRight(offset, false);
      return c;
    };
    const record = function (on) { xModel.setPropertyValue('RecordChanges', on); };
    // 列表：第 4、5 段套内置编号样式
    for (const i of [4, 5]) { const c = at(i, 0); c.gotoEndOfParagraph(true); c.setPropertyValue('NumberingStyleName', 'Numbering 123'); }
    switch (p.name) {
      case 'insert-only': { record(true); text.insertString(at(1, 3), '新增文字', false); break; }
      case 'delete-in-paragraph': { record(true); const c = at(1, 5); c.goRight(4, true); c.setString(''); break; }
      case 'format-only': { record(true); const c = at(2, 0); c.goRight(6, true); c.setPropertyValue('CharWeight', 150); break; }
      case 'whole-paragraph': { record(true); const c = at(2, 0); c.gotoEndOfParagraph(true); c.goRight(1, true); c.setString(''); break; }
      case 'cross-into-list': { record(true); const c = at(3, 8); c.gotoEndOfParagraph(true); c.goRight(1, true); c.goRight(4, true); c.setString(''); break; }
      case 'nested-authors': {
        record(true); setRedlineAuthor('甲律师'); text.insertString(at(1, 5), '另行补充的十二个字的内容', false);
        setRedlineAuthor('乙律师'); const c = at(1, 7); c.goRight(4, true); c.setString(''); break;
      }
      case 'table-cell': {
        const table = xModel.createInstance('com.sun.star.text.TextTable'); table.initialize(2, 2);
        text.insertTextContent(at(6, 0), table, false); table.getCellByName('A1').setString('单元格里的原文内容');
        record(true); const cell = table.getCellByName('A1'); const c = cell.createTextCursor(); c.goRight(2, false); c.goRight(3, true); c.setString(''); break;
      }
      case 'footnote': {
        const fn = xModel.createInstance('com.sun.star.text.Footnote'); text.insertTextContent(at(2, 6), fn, false); fn.setString('脚注里的原文内容');
        record(true); const c = fn.createTextCursor(); c.goRight(2, false); c.goRight(3, true); c.setString(''); break;
      }
      case 'field-in-deletion': {
        const f = xModel.createInstance('com.sun.star.text.TextField.DateTime'); text.insertTextContent(at(1, 4), f, false);
        record(true); const c = at(1, 2); c.goRight(6, true); c.setString(''); break;
      }
      case 'comment-in-deletion': {
        const a = xModel.createInstance('com.sun.star.text.textfield.Annotation'); a.setPropertyValue('Content', '请核实');
        const r = at(2, 3); r.goRight(3, true); text.insertTextContent(r, a, true);
        record(true); const c = at(2, 1); c.goRight(8, true); c.setString(''); break;
      }
      default: return { success: false, message: 'unknown case ' + p.name };
    }
    return { success: true };
  },
`
function patchServed(urlPath, content) {
  if (urlPath === '/office_thread.js') {
    const s = content.toString('utf8')
    const planAnchor = 'function bulkFinalTextPlan(action, p) {'
    if (!s.includes('const EXEC = {') || !s.includes(planAnchor)) throw new Error('office_thread.js: anchor missing')
    // 真值 = 改造前的生产路径（读前切到最终稿视图、读完切回）：测试专用开关强制走它
    return Buffer.from(s.replace('const EXEC = {', 'const EXEC = {\n' + DEBUG)
      .replace(planAnchor, planAnchor + '\n  if (p && p.__forceViewSwitch === true) return null;'), 'utf8')
  }
  if (/^\/assets\/editor-.*\.js$/.test(urlPath)) {
    return Buffer.from(content.toString('utf8')
      .replace("'get_hyperlink_at_cursor'", "'get_hyperlink_at_cursor','debug_redline_case','debug_final_plan'")
      .replace('"get_hyperlink_at_cursor"', '"get_hyperlink_at_cursor","debug_redline_case","debug_final_plan"'), 'utf8')
  }
  return content
}

const CASES = [
  // [name, must the cuts path handle it (true) / must fall back to the view switch (false) / either (null)]
  ['insert-only', true], ['delete-in-paragraph', true], ['format-only', true], ['whole-paragraph', false],
  ['cross-into-list', false], ['nested-authors', true], ['table-cell', true], ['footnote', true],
  // 删除里含域/批注锚点：两条路都行（剪切路径读到的与切视图逐字相同，或整份退回切视图），只要求逐字相同
  ['field-in-deletion', null], ['comment-in-deletion', null],
]
preflight()
const server = await startServer({ patchServed })
const browser = await launchBrowser(await loadPuppeteer())
const results = []
try {
  const page = await openEditor(browser)
  const exec = (a, p = {}) => page.evaluate((a, p) => window.__loExecutor.executeCommand(a, p), a, p)
  const base = Array.from(fs.readFileSync(basePath))
  const texts = r => (r.paragraphs || []).map(x => x.index + ':' + x.text)
  for (const [name, expectCuts] of CASES) {
    assert.equal((await exec('load_document', { name: 'base.docx', bytes: base })).kind, 'writer')
    const built = await exec('debug_redline_case', { name })
    assert.equal(built.success, true, name + ': ' + JSON.stringify(built))
    await exec('set_revision_view', { mode: 'all' })
    const plan = await exec('debug_final_plan')
    const fresh = await exec('get_document_text', { startParagraph: 0, maxParagraphs: 10000, bulk: true, __agent: true })
    // 真值：改造前的生产路径——同一条读命令，强制读前切到最终稿视图、读完切回
    const truth = await exec('get_document_text', { startParagraph: 0, maxParagraphs: 10000, bulk: true, __agent: true, __forceViewSwitch: true })
    const same = JSON.stringify(texts(fresh)) === JSON.stringify(texts(truth))
    results.push({ name, path: plan.fallback ? 'view-switch (' + plan.fallback + ')' : 'cuts', same })
    assert.ok(same, `${name}: bulk final text differs from the switched final view\n new:   ${JSON.stringify(texts(fresh))}\n truth: ${JSON.stringify(texts(truth))}`)
    if (expectCuts !== null) assert.equal(!plan.fallback, expectCuts, `${name}: expected ${expectCuts ? 'the cuts path' : 'a document-level fallback'}, got ${plan.fallback || 'cuts'}`)
  }
  console.log(JSON.stringify(results))
  console.log(JSON.stringify({ pass: 1, fail: 0 }))
} finally {
  if (results.length) console.log(JSON.stringify(results))
  await browser.close()
  server.close()
}
