#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 真引擎（台账 B11）：长文档上打字时，即时审校/写作辅助的整篇读不得把字挡在后面。
//
// 律师在 150 页合同（修订开启）里打字；停笔后宿主整篇读一遍（bulk + __agent），律师接着打。
// 每个字是一条 insert_at_cursor 命令，与读命令排同一条 office 线程。以前：每打一个字索引作废、
// 下一次读要重建 1800 段（~0.5 s），读又是一条上千段的大命令——字排在后面，实测延迟到 0.86 s。
// 现在：段内打字不重建索引；宿主按页读（READ_PAGE_PARAGRAPHS），字能插在页与页之间。
//
// Run:  node tests/lowa-e2e/typing-during-read.mjs   (from frontend/)
// Env:  同 run.mjs；LOWA_TYPING_PAGE 每页段数（默认取宿主常量 300；设 10000 = 旧的一次读完）；
//       LOWA_TYPING_MAX_MS 单字最大延迟上限（默认 250）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { here, preflight, loadPuppeteer, startServer, launchBrowser, openEditor } from './_boot.mjs'

const hostPage = Number((fs.readFileSync(path.join(here, '../../src/composables/inlineReviewHost.js'), 'utf8').match(/READ_PAGE_PARAGRAPHS = (\d+)/) || [])[1] || 10000)
const PAGE = Number(process.env.LOWA_TYPING_PAGE || hostPage)
const MAX_MS = Number(process.env.LOWA_TYPING_MAX_MS || 250)
const docPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'awd-typing-')), 'long-contract.docx')
execFileSync('python3', [path.join(here, 'fixtures/gen-long-contract.py'), docPath])
preflight()
const server = await startServer()
const browser = await launchBrowser(await loadPuppeteer())
try {
  const page = await openEditor(browser)
  const exec = (a, p = {}) => page.evaluate((a, p) => window.__loExecutor.executeCommand(a, p), a, p)
  assert.equal((await exec('load_document', { name: 'long-contract.docx', bytes: Array.from(fs.readFileSync(docPath)) })).kind, 'writer')
  await exec('set_track_changes', { on: true })
  // 预热：建一次索引、读一遍
  await exec('get_document_text', { startParagraph: 0, maxParagraphs: 10000, bulk: true, __agent: true })

  const rounds = []
  for (let round = 0; round < 4; round++) {
    const r = await page.evaluate(async (PAGE) => {
      const ex = window.__loExecutor, now = () => performance.now()
      // 停笔前打几个字（每个字一条命令，同 IME 提交）
      for (let i = 0; i < 3; i++) await ex.executeCommand('insert_at_cursor', { text: '审', replaceSelection: true })
      // 宿主停笔后整篇读（按页），律师同时接着打字
      const t0 = now()
      const reader = (async () => {
        let start = 0, pages = 0
        for (;;) {
          const res = await ex.executeCommand('get_document_text', { startParagraph: start, maxParagraphs: PAGE, bulk: true, __agent: true })
          pages++
          if (!res || !res.success || !res.truncated) break
          start = res.nextStartParagraph
        }
        return { readMs: Math.round(now() - t0), pages }
      })()
      const keys = []
      for (let i = 0; i < 8; i++) {
        await new Promise(r => setTimeout(r, 120))
        const k0 = now()
        keys.push(ex.executeCommand('insert_at_cursor', { text: '核', replaceSelection: true }).then(() => Math.round(now() - k0)))
      }
      return { ...(await reader), keyMs: await Promise.all(keys) }
    }, PAGE)
    rounds.push(r)
  }
  const all = rounds.flatMap(r => r.keyMs).sort((a, b) => a - b)
  const p95 = all[Math.floor(all.length * 0.95) - 1], max = all[all.length - 1]
  console.log(JSON.stringify({ page: PAGE, rounds, keyP50: all[Math.floor(all.length / 2)], keyP95: p95, keyMax: max }))
  assert.ok(max <= MAX_MS, `a keystroke waited ${max} ms behind the full-document read (limit ${MAX_MS} ms, page=${PAGE})`)
  console.log(JSON.stringify({ pass: 1, fail: 0 }))
} finally {
  await browser.close()
  server.close()
}
