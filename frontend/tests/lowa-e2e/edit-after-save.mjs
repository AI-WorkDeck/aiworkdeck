// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 保存之后的修改仍要报给宿主（O7 实测的丢改动）：Impress 的 modify 广播只在 false→true 那一下发，
// 自动保存（export_document 带 saveSnapshotId）若把标志复原成 true，之后 AI 单条格式命令（标题改红）
// 宿主就收不到，不标脏、不保存、关标签也不拦。Word / Excel / PPT 各一份。
// 跑法：LOWA_ENGINE_DIR=<引擎目录> node tests/lowa-e2e/edit-after-save.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { preflight, loadPuppeteer, startServer, launchBrowser, openEditor } from './_boot.mjs'
preflight()
const DEBUG = `debug_open_dirty() { let m = null; try { m = !!xModel.isModified(); } catch (e) {} return { success: true, posts: MOD_POSTS, modified: m }; },`
const server = await startServer({ patchServed(url, bytes) {
  if (url === '/office_thread.js') return Buffer.from(bytes.toString().replace('function installModifyListener(model) {', 'let MOD_POSTS = 0;\nfunction installModifyListener(model) {').replace("if (model.isModified()) post('modified');", "if (model.isModified()) { MOD_POSTS++; post('modified'); }").replace('const EXEC = {', 'const EXEC = {\n' + DEBUG))
  if (/^\/assets\/editor-.*\.js$/.test(url)) return Buffer.from(bytes.toString().replace(/(['"])get_hyperlink_at_cursor\1/, m => m + ',"debug_open_dirty"'))
  return bytes
} })
const browser = await launchBrowser(await loadPuppeteer())
try {
  const page = await openEditor(browser)
  const ex = (a, p = {}) => page.evaluate((a, p) => window.__loExecutor.executeCommand(a, { ...p, __agent: true }).then(x => ({ success: x.success, posts: x.posts, modified: x.modified, message: x.message })), a, p)
  const E = new URL('../../../scripts/eval/fixtures/', import.meta.url).pathname
  const docs = [
    ['case-report.pptx', ['slide_set_shape_text', { slideNumber: 4, shapeName: 'Title 1', text: '标题A' }], ['slide_format_text', { slideNumber: 4, shapeName: 'Title 1', color: '#FF0000' }]],
    ['case-ledger.xlsx', ['sheet_write_cells', { startCell: 'H1', rows: [['x']] }], ['sheet_format_cells', { range: 'A1', bold: true }]],
    ['contract.docx', ['insert_at_cursor', { text: '甲' }], ['insert_at_cursor', { text: '乙' }]],
  ]
  for (const [f, first, second] of docs) {
    await ex('load_document', { name: f, bytes: Array.from(fs.readFileSync(E + f)) })
    const s0 = await ex('debug_open_dirty')
    await ex(first[0], first[1]); const s1 = await ex('debug_open_dirty')
    await ex('export_document', { name: f, saveSnapshotId: 1 }); const s2 = await ex('debug_open_dirty')
    const r = await ex(second[0], second[1]); const s3 = await ex('debug_open_dirty')
    assert.equal(s1.posts > s0.posts && s1.modified, true, f + ': 第一笔要报 modified')
    assert.equal(s2.modified, false, f + ': 宿主保存（带 saveSnapshotId）后引擎标志清零')
    assert.equal(s2.posts, s1.posts, f + ': 保存本身不报 modified（否则保存死循环）')
    assert.equal(r.success, true, f + ': 第二笔命令成功')
    assert.ok(s3.posts > s2.posts && s3.modified, f + ': 保存之后的单条格式类修改仍要报给宿主')
    console.log('PASS', f)
  }
} finally { await browser.close(); server.close() }
