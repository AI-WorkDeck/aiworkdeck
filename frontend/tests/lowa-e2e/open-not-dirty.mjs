// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 真引擎：只打开文档、跑宿主 ready 后的纯视图命令，不得向宿主报 modified（教程反馈 15）；
// 真编辑仍要报。Word / PPT / Excel 各一份。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { preflight, loadPuppeteer, startServer, launchBrowser, openEditor } from './_boot.mjs'

const DEBUG = `debug_open_dirty() { let m = null; try { m = !!xModel.isModified(); } catch (e) {} return { success: true, posts: MOD_POSTS, modified: m }; },`
preflight()
const server = await startServer({ patchServed(url, bytes) {
  if (url === '/office_thread.js') {
    const source = bytes.toString()
    for (const anchor of ['function installModifyListener(model) {', "if (model.isModified()) post('modified');", 'const EXEC = {']) assert.ok(source.includes(anchor), anchor)
    return Buffer.from(source
      .replace('function installModifyListener(model) {', 'let MOD_POSTS = 0;\nfunction installModifyListener(model) {')
      .replace("if (model.isModified()) post('modified');", "if (model.isModified()) { MOD_POSTS++; post('modified'); }")
      .replace('const EXEC = {', 'const EXEC = {\n' + DEBUG))
  }
  if (/^\/assets\/editor-.*\.js$/.test(url)) return Buffer.from(bytes.toString().replace(/(['"])get_hyperlink_at_cursor\1/, m => m + ',"debug_open_dirty"'))
  return bytes
} })
const browser = await launchBrowser(await loadPuppeteer())
try {
  const page = await openEditor(browser)
  const exec = (a, p = {}) => page.evaluate((a, p) => window.__loExecutor.executeCommand(a, p), a, p)
  const ok = async (a, p) => { const r = await exec(a, p); assert.equal(r.success, true, a + ': ' + JSON.stringify(r)); return r }
  const read = file => Array.from(fs.readFileSync(new URL(file, import.meta.url)))
  const docs = [
    // docs/template.docx：装载后纯视图命令会引出 modify 广播的那一类真实样本。
    { name: 'template.docx', bytes: read('../../../docs/template.docx'), writer: true },
    { name: 'comment-batch-revisions.docx', bytes: read('./fixtures/comment-batch-revisions.docx'), writer: true },
    { name: 'impress-smoke.pptx', bytes: read('./fixtures/impress-smoke.pptx') },
    // 原用 data/ 下的项目样本，data/ 已出库（泄露处置），改用入库的评测台账样本
    { name: 'case-ledger.xlsx', bytes: read('../../../scripts/eval/fixtures/case-ledger.xlsx') },
  ]
  for (const doc of docs) {
    await ok('load_document', { name: doc.name, bytes: doc.bytes, authorName: '测试用户' })
    const loaded = await ok('debug_open_dirty')
    assert.equal(loaded.modified, false, doc.name + ': 装载后模型不应是 modified')
    // 宿主 ready 之后的纯视图/只读命令（工具栏 bootstrap、写作辅助取正文、审阅面板）
    await ok('set_chrome', { menubar: false, statusbar: false, toolbars: false })
    if (doc.writer) {
      await ok('set_view_options', { formattingMarks: false, ruler: true, paragraphMarks: true, lineBreaks: true, spaces: true, tabs: true, textBoundaries: false })
      await ok('adopt_legacy_links', {})
      await ok('get_document_text', { startParagraph: 0, maxParagraphs: 200, __agent: true })
      await ok('list_revisions', { limit: 200 })
    }
    await ok('get_ui_state', {})
    await new Promise(resolve => setTimeout(resolve, 1500))
    const settled = await ok('debug_open_dirty')
    assert.equal(settled.posts, loaded.posts, doc.name + ': 只打开不得向宿主报 modified ' + JSON.stringify({ loaded, settled }))
    assert.equal(settled.modified, false, doc.name)
    if (doc.writer) {
      await ok('insert_at_cursor', { text: '真编辑' })
      const edited = await ok('debug_open_dirty')
      assert.ok(edited.posts > settled.posts && edited.modified, doc.name + ': 真编辑仍报 modified')
    }
    console.log('PASS ' + doc.name + ': open is clean, real edit still dirties')
  }
} finally {
  await browser.close()
  server.close()
}
