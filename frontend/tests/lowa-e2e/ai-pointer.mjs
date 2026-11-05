#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 「指哪儿打哪儿」真实引擎回归：get_ai_pointer（选区 / 光标段落 + 锚点 + 段号）→
// replace_at_position 一步改中；replace_selection 的 expectedText 在选区已变时拒绝。
// 同时守住副作用：取指针不改文档内容、不留撤销步、不保留选区之外的变化。
import { preflight, loadPuppeteer, startServer, launchBrowser, openEditor } from './_boot.mjs'

const results = []
function check(name, ok, detail) { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`) }

preflight()
const puppeteer = await loadPuppeteer()
const server = await startServer()
const browser = await launchBrowser(puppeteer)
try {
  const page = await openEditor(browser)
  const exec = async (a, p = {}) => {
    const t = Date.now()
    const r = await page.evaluate((a, p) => Promise.race([window.__loExecutor.executeCommand(a, p), new Promise((res) => setTimeout(() => res({ success: false, timeout: true }), 60000))]), a, p)
    console.log('  ' + a + ' ' + (Date.now() - t) + 'ms')
    return r
  }
  await exec('goto', { type: 'start' })
  for (const t of ['第一条 甲方应按期付款。', '第二条 甲方应按期交货。', '第三条 甲方违约应赔偿。']) {
    await exec('insert_at_cursor', { text: t }); await exec('insert_paragraph')
  }
  const textOf = async () => ((await exec('get_document_text', {})).paragraphs || []).map((p) => p.text).join('\n')
  const before = await textOf()

  // 光标落在第二条段内（无选区）
  await exec('select_paragraph', { index: 1 }); await exec('collapse_selection', { to: 'start' })
  const undoBefore = await exec('get_ui_state').catch(() => ({}))
  const cur = await exec('get_ai_pointer')
  check('无选区时返回光标段落', cur.success && cur.kind === 'cursor' && /第二条/.test(cur.paragraphText) && cur.paragraphIndex === 1, cur)
  check('光标段落带锚点', !!cur.anchorId, cur.anchorId)
  check('取指针不改正文', (await textOf()) === before)

  // 用锚点一步替换整段里的「甲方」→ 只改中第二条
  const rep = await exec('replace_at_position', { anchor: cur.anchorId, newText: '第二条 委托方应按期交货。' })
  const after = await textOf()
  check('按光标锚点一步改中第二条', rep.success && /第二条 委托方应按期交货/.test(after) && /第一条 甲方应按期付款/.test(after) && /第三条 甲方违约/.test(after), { rep: rep.success, after })

  // 选区指针
  await exec('select_paragraph', { index: 2 })
  const sel = await exec('get_ai_pointer')
  check('有选区时返回选区文字+锚点+段号', sel.success && sel.kind === 'selection' && /第三条/.test(sel.selectionText) && !!sel.anchorId && sel.paragraphIndex === 2, sel)
  const selAfter = await exec('get_selection')
  check('取指针后选区仍在', /第三条/.test(selAfter.text || selAfter.selectedText || ''), selAfter)

  // expectedText：选区已变 → 拒绝；一致 → 写入
  await exec('select_paragraph', { index: 0 })
  const stale = await exec('replace_selection', { text: 'X', expectedText: sel.selectionText })
  check('选区已变时 replace_selection 拒绝', stale.success === false && /第一条/.test(JSON.stringify(stale)), stale)
  check('拒绝时正文未改', !/^X$/m.test(await textOf()))
  await exec('select_paragraph', { index: 2 })
  const ok = await exec('replace_selection', { text: '第三条 委托方违约应赔偿。', expectedText: sel.selectionText })
  check('选区一致时 replace_selection 写入', ok.success === true && /第三条 委托方违约/.test(await textOf()), ok)

  // 副作用：撤销一步应撤回上一笔真编辑，而不是一个看不见的书签插入
  const u = await exec('undo', { steps: 1 })
  check('撤销一步撤回最近一笔真编辑', /第三条 甲方违约/.test(await textOf()), { u: u.success, text: await textOf() })
} finally {
  await browser.close(); server.close()
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
