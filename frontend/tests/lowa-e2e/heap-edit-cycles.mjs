#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 真引擎：长合同上反复「改一处 → 自动保存」，引擎内存不得随轮数失控（R-086 浸泡）。
//
// 引擎堆固定 1 GB、不能扩。0.86 浸泡里 150 页合同（修订开启）在可见标签上每轮自动保存
// 约漏 10 MB，第 31 轮 OOM 中止，之后每次保存都失败。每轮的命令与桌面可见标签一致：
// 写一处、整篇 get_document_text（宿主即时审校/写作辅助的读法：bulk + __agent）、
// get_review_context、get_selection、get_ui_state、带快照的 export_document。
//
// 断言的是我们能管住的机制（确定性的），堆增长只报告：
//   1. 每轮至多重建一次段落索引——__agent 读切修订视图再切回不再逼出第二次整篇枚举；
//   2. zetajs 活代理数不随轮数增长——换下的索引显式释放，不再等一场不会来的 V8 GC；
//   3. get_engine_heap（宿主换引擎的依据，不分配内存的高水位扫描）与 malloc 探针一致。
// 余下的增长在 LibreOffice 原生侧（逐段枚举约 0.9 KB/段），由宿主过阈值换引擎兜住。
//
// Run:  npm run test:lowa-heap-cycles   (from frontend/)
// Env:  同 run.mjs；LOWA_HEAP_CYCLES 测量轮数（默认 40）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { here, preflight, loadPuppeteer, startServer, launchBrowser, openEditor } from './_boot.mjs'

const CYCLES = Number(process.env.LOWA_HEAP_CYCLES || 40)
const docPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'awd-heap-')), 'long-contract.docx')
execFileSync('python3', [path.join(here, 'fixtures/gen-long-contract.py'), docPath])
preflight()

// 测试专用 worker 动作（内存注入，同 big-doc.mjs）：数真正的整篇枚举（新造出来的索引数组；
// 切视图后原样取回的旧索引不算）与 zetajs 活代理数。函数声明是可改写的绑定，包一层即可，新旧代码通用。
const DEBUG = `
  debug_heap_state() {
    if (!DEBUG_WRAPPED) {
      DEBUG_WRAPPED = true;
      const orig = buildParaIndex;
      buildParaIndex = function () {
        const ix = orig.apply(this, arguments);
        if (ix && ix.ranges && !ix.ranges.__debugId) { ix.ranges.__debugId = ++DEBUG_INDEX_SEQ; DEBUG_BUILDS++; }
        return ix;
      };
    }
    return { success: true, builds: DEBUG_BUILDS,
      live: zetajs && typeof zetajs.liveProxies === 'function' ? zetajs.liveProxies() : null };
  },
`
function patchServed(urlPath, content) {
  if (urlPath === '/office_thread.js') {
    const s = content.toString('utf8')
    if (!s.includes('const EXEC = {')) throw new Error('office_thread.js: anchor missing')
    return Buffer.from(s.replace('const EXEC = {', 'let DEBUG_INDEX_SEQ = 0, DEBUG_BUILDS = 0, DEBUG_WRAPPED = false;\nconst EXEC = {\n' + DEBUG), 'utf8')
  }
  if (/^\/assets\/editor-.*\.js$/.test(urlPath)) {
    return Buffer.from(content.toString('utf8')
      .replace("'get_hyperlink_at_cursor'", "'get_hyperlink_at_cursor','debug_heap_state'")
      .replace('"get_hyperlink_at_cursor"', '"get_hyperlink_at_cursor","debug_heap_state"'), 'utf8')
  }
  return content
}

const server = await startServer({ patchServed })
const browser = await launchBrowser(await loadPuppeteer())
try {
  const page = await openEditor(browser)
  const exec = (a, p = {}) => page.evaluate((a, p) => window.__loExecutor.executeCommand(a, p), a, p)
  const ok = async (a, p) => { const r = await exec(a, p); assert.notEqual(r && r.success, false, a + ': ' + JSON.stringify(r).slice(0, 300)); return r }
  // 独立的对照量法：malloc 一块 16 MB 再立即 free，地址 + 16 MB ≈ dlmalloc 顶（测试里堆远未满，安全）
  const probeTopMB = () => page.evaluate(() => { const M = globalThis.Module; const p = M._malloc(16 << 20); M._free(p); return (p + (16 << 20)) / 1048576 })

  const loaded = await ok('load_document', { name: 'long-contract.docx', bytes: Array.from(fs.readFileSync(docPath)) })
  assert.equal(loaded.kind, 'writer')
  let snap = 0
  await ok('debug_heap_state') // 装上计数
  const builds = async () => (await ok('debug_heap_state')).builds
  const cycle = async i => {
    const before = await builds()
    await ok('insert_at_cursor', { text: '【第' + i + '轮】' })
    // 宿主的即时审校 / 写作辅助就是这样读的：bulk + __agent（有修订时会切视图再切回）
    const t = await ok('get_document_text', { startParagraph: 0, maxParagraphs: 10000, bulk: true, __agent: true })
    assert.ok(t.totalParagraphs > 1500, 'long fixture: ' + t.totalParagraphs)
    await ok('get_review_context', {})
    await ok('get_selection', {})
    await ok('get_ui_state', {})
    const ex = await ok('export_document', { name: 'long-contract.docx', saveSnapshotId: ++snap })
    assert.ok(ex.size > 10000)
    return (await builds()) - before
  }
  for (let i = 0; i < 3; i++) await cycle(i) // 预热：首轮建索引、排版缓存
  const liveStart = (await ok('debug_heap_state')).live
  const topStart = await probeTopMB()
  let maxRebuilds = 0
  for (let i = 0; i < CYCLES; i++) maxRebuilds = Math.max(maxRebuilds, await cycle(3 + i))
  const liveEnd = (await ok('debug_heap_state')).live
  const topEnd = await probeTopMB()
  console.log(JSON.stringify({ cycles: CYCLES, maxIndexBuildsPerCycle: maxRebuilds, liveProxies: [liveStart, liveEnd],
    heapTopMB: [Math.round(topStart), Math.round(topEnd)], perCycleMB: +((topEnd - topStart) / CYCLES).toFixed(2) }))
  assert.equal(maxRebuilds, 1, `paragraph index rebuilt ${maxRebuilds}× in one edit cycle; view switches must reuse the parked index`)
  assert.ok(Number.isInteger(liveStart) && Number.isInteger(liveEnd), 'zetajs.liveProxies() missing — the proxy release patch is not loaded')
  assert.ok(liveEnd - liveStart <= 200, `live zetajs proxies grew ${liveStart} → ${liveEnd} over ${CYCLES} cycles; retired paragraph proxies are not released`)
  const heap = await ok('get_engine_heap', {})
  const usedMB = heap.usedBytes / 1048576
  console.log(JSON.stringify({ gaugeUsedMB: +usedMB.toFixed(1), probeTopMB: +topEnd.toFixed(1), gaugeLimitMB: heap.limitBytes / 1048576 }))
  assert.equal(heap.limitBytes, 1024 * 1048576, 'engine heap limit')
  // 高水位扫描只读不分配：探针那块 16 MB 释放后尾部留有空闲块标记，所以高水位落在探针顶附近；
  // 必须在探针顶之下 48 MB 到之上 1 MB 之间。
  assert.ok(usedMB <= topEnd + 1 && usedMB >= topEnd - 48, `get_engine_heap ${usedMB.toFixed(1)} MB vs probe top ${topEnd.toFixed(1)} MB`)
  console.log(JSON.stringify({ pass: 1, fail: 0 }))
} finally {
  await browser.close()
  server.close()
}
