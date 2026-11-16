#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 真引擎（台账 B11 后续）：窗口/侧栏改尺寸不该让长文档的段落索引作废。
// 真机：关掉 AI 侧栏（编辑区变宽）后第一次整篇读要 ~540 ms，正好压在律师接着打的字上——
// 引擎重排版面时广播一次 modified，监听器无条件丢了段落索引、下一次读整篇重建（1800 段 ~550 ms）。
// 现在文档未修改、没有命令在途时的 modified 不丢索引；真改了正文照常作废（同一测试里核对）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { here, preflight, loadPuppeteer, startServer, launchBrowser, openEditor } from './_boot.mjs'

const docPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'awd-resize-index-')), 'long-contract.docx')
execFileSync('python3', [path.join(here, 'fixtures/gen-long-contract.py'), docPath])
// 测试专用：数真正的整篇枚举（同 heap-edit-cycles.mjs）
const DEBUG = `
  debug_builds() {
    if (!DEBUG_WRAPPED) {
      DEBUG_WRAPPED = true;
      const orig = buildParaIndex;
      buildParaIndex = function () { const ix = orig.apply(this, arguments); if (ix && ix.ranges && !ix.ranges.__debugId) { ix.ranges.__debugId = ++DEBUG_SEQ; DEBUG_BUILDS++; } return ix; };
    }
    return { success: true, builds: DEBUG_BUILDS };
  },
  debug_true_paragraphs() {
    const en = xModel.getText().createEnumeration(); const out = [];
    while (en.hasMoreElements()) { const el = en.nextElement(); if (el.supportsService('com.sun.star.text.Paragraph')) out.push(String(el.getString() || '')); }
    return { success: true, texts: out };
  },
`
function patchServed(urlPath, content) {
  if (urlPath === '/office_thread.js') {
    const s = content.toString('utf8')
    if (!s.includes('const EXEC = {')) throw new Error('office_thread.js: anchor missing')
    return Buffer.from(s.replace('const EXEC = {', 'let DEBUG_SEQ = 0, DEBUG_BUILDS = 0, DEBUG_WRAPPED = false;\nconst EXEC = {\n' + DEBUG), 'utf8')
  }
  if (/^\/assets\/editor-.*\.js$/.test(urlPath)) {
    return Buffer.from(content.toString('utf8')
      .replace("'get_hyperlink_at_cursor'", "'get_hyperlink_at_cursor','debug_builds','debug_true_paragraphs'")
      .replace('"get_hyperlink_at_cursor"', '"get_hyperlink_at_cursor","debug_builds","debug_true_paragraphs"'), 'utf8')
  }
  return content
}

preflight()
const server = await startServer({ patchServed })
const browser = await launchBrowser(await loadPuppeteer())
try {
  const page = await openEditor(browser, { viewport: { width: 1400, height: 900 } })
  const exec = (a, p = {}) => page.evaluate((a, p) => window.__loExecutor.executeCommand(a, p), a, p)
  const firstPage = () => page.evaluate(async () => {
    const t = performance.now()
    const r = await window.__loExecutor.executeCommand('get_document_text', { startParagraph: 0, maxParagraphs: 300, bulk: true, __agent: true })
    return { ms: Math.round(performance.now() - t), text: r.paragraphs.map(p => p.text).join('\n') }
  })
  assert.equal((await exec('load_document', { name: 'c.docx', bytes: Array.from(fs.readFileSync(docPath)) })).kind, 'writer')
  await exec('set_track_changes', { on: true })
  await exec('debug_builds')
  await exec('insert_at_cursor', { text: '【已保存的一处修改】' })
  await exec('export_document', { name: 'c.docx', saveSnapshotId: 1 }) // 自动保存：文档回到未修改
  const base = await firstPage()
  const b0 = (await exec('debug_builds')).builds
  const samples = []
  for (const [w, h] of [[1000, 900], [1600, 900], [1200, 760]]) {
    await page.setViewport({ width: w, height: h })
    await new Promise(r => setTimeout(r, 1500)) // 让引擎完成重排
    const r = await firstPage()
    samples.push(r.ms)
    assert.equal(r.text, base.text, 'resize must not change what the read returns')
  }
  const b1 = (await exec('debug_builds')).builds
  console.log(JSON.stringify({ firstPageMsAfterResize: samples, rebuilds: b1 - b0 }))
  assert.equal(b1 - b0, 0, 'resizing a saved document must not rebuild the paragraph index')
  assert.ok(Math.max(...samples) < 250, `first read page after a resize took ${Math.max(...samples)} ms`)
  // 对照：真改正文仍然生效（读得到新字）
  await exec('insert_at_cursor', { text: '【新打的字】' })
  const after = await firstPage()
  assert.ok(after.text.includes('【新打的字】'), 'a real edit is still visible to the next read')
  // 对照 2（协调会话要求）：保存后的第一次「结构性」修改由用户真实输入完成（键盘回车、粘贴三段、退格合并），
  // 不是 UNO 命令。每步之前回到未修改 + 改尺寸；之后的读必须与独立重新枚举的段落逐段一致。
  const readAll = async () => (await exec('get_document_text', { startParagraph: 0, maxParagraphs: 10000, bulk: true, __agent: true })).paragraphs.map(p => p.text)
  const truth = async () => (await exec('debug_true_paragraphs')).texts
  await page.focus('[data-lo-ime]')
  let snap = 2
  const steps = {
    'keyboard Enter': async () => { await page.keyboard.press('Enter') },
    'paste three paragraphs (Cmd/Ctrl+V)': async () => {
      // 真实粘贴路径：覆盖层收到 Cmd/Ctrl+V，读系统剪贴板，再交给引擎
      await page.evaluate(() => navigator.clipboard.writeText('粘贴的第一段\n粘贴的第二段\n粘贴的第三段'))
      await page.focus('[data-lo-ime]')
      const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
      await page.keyboard.down(mod); await page.keyboard.press('KeyV'); await page.keyboard.up(mod)
    },
    'Home + Backspace merges two paragraphs': async () => { await page.keyboard.press('Home'); await page.keyboard.press('Backspace') },
  }
  const results = []
  for (const [label, act] of Object.entries(steps)) {
    await exec('export_document', { name: 'c.docx', saveSnapshotId: ++snap }) // 回到未修改
    await page.setViewport({ width: 1100 + snap * 20, height: 900 }); await new Promise(r => setTimeout(r, 1200))
    const before = (await truth()).length
    await act()
    await new Promise(r => setTimeout(r, 1500)) // 覆盖层把按键/粘贴交给引擎
    const got = await readAll(), want = await truth()
    results.push({ label, before, after: want.length, readCount: got.length })
    assert.notEqual(want.length, before, label + ': the user input must change the paragraph count (test setup)')
    assert.deepEqual(got, want, label + ': the read after a real structural edit must match a fresh enumeration')
  }
  console.log(JSON.stringify({ userInput: results }))
  console.log(JSON.stringify({ pass: 1, fail: 0 }))
} finally {
  await browser.close()
  server.close()
}
