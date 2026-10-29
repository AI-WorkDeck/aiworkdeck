// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real ChatInterface/SSE and workbench tab method, synthetic HTTP and source records.
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import puppeteer from 'puppeteer-core'
const root = fileURLToPath(new URL('../../', import.meta.url))
const artifacts = mkdtempSync(`${tmpdir()}/legal-chat-`)
const source = readFileSync(`${root}src/App.vue`, 'utf8')
const tokens = source.slice(source.indexOf("html,\nhtml[data-theme='light']"), source.indexOf('</style>', source.indexOf("html,\nhtml[data-theme='light']")))
const server = await createServer({ configFile: false, root: fileURLToPath(new URL('./', import.meta.url)), cacheDir: `${artifacts}/vite`, plugins: [vue()], resolve: { alias: { '@': `${root}src` }, dedupe: ['vue'] }, server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } } })
await server.listen()
let browser
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewport({ width: 1300, height: 950 })
  await page.goto(server.resolvedUrls.local[0])
  await page.waitForFunction(() => window.legalReady)
  await page.addStyleTag({ content: `${tokens}\nhtml,body{margin:0;height:100%;font-family:var(--awd-font-sans)}*{box-sizing:border-box}view,scroll-view{display:block}text{display:inline}body{display:grid;grid-template-columns:420px minmax(0,1fr)}#app,#reader{height:100vh;min-width:0}` })
  await page.evaluate(async () => {
    window.loadFixture('single')
    document.querySelector('.chat-input-rich').textContent = '查询合成测试法规、案例与处罚。'
    await window.chatState.handleSubmit('steer')
  })
  await page.waitForFunction(() => window.chatState.isStreaming && window.sseController)
  const send = (event, data) => page.evaluate(({ event, data }) => window.sseController.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)), { event, data })
  const text = content => send('text_delta', { content })
  await text('<process name="检索"><tool_code>law_search({"query":"synthetic"})</tool_code><tool_output status="SUCCESS">' + JSON.stringify({ data: [{ title: '合成法规检索条目', article: '第一条　仅用于自动化测试。', url: 'https://example.org/law' }] }) + '</tool_output></process>')
  await page.waitForSelector('.legal-reference-card')
  const references = ['LAW', 'CASE', 'PENALTY'].map(kind => ({ kind, title: `合成${kind}资料`, documentNumber: 'TEST-1', summary: '这是 AI 整理的测试摘要。', excerpt: '这是测试摘录。', url: `https://example.org/${kind}`, status: 'verified' }))
  const final = '<final>以下资料供核对。\n```legal-reference\n' + JSON.stringify(references) + '\n```\n请查看来源原文。</final>'
  for (let offset = 0; offset < final.length; offset += 23) await text(final.slice(offset, offset + 23))
  await send('bubble_end', { status: 'finished' })
  await page.waitForFunction(() => !window.chatState.isStreaming && document.querySelectorAll('.legal-reference-card').length === 4)
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.message-row.assistant')].at(-1).querySelectorAll('[data-chat-answer] pre').length), 0, 'complete references hide raw JSON')
  for (const kind of ['LAW', 'CASE', 'PENALTY']) {
    const selector = `.legal-reference-card[data-reference-kind="${kind}"] .reference-open`
    await page.focus(selector)
    await page.keyboard.press('Enter')
    await page.waitForFunction(kind => document.querySelector('.legal-reference-pane')?.dataset.referenceKind === kind, {}, kind)
    await page.click('.reference-source-button')
    assert.equal(await page.evaluate(() => window.openedLegalUrl), `https://example.org/${kind}`)
    assert.equal(await page.evaluate(() => window.legalHost.activeFileIdLeft), 1)
    assert.equal(await page.evaluate(() => window.legalHost.splitMode), true)
    await page.screenshot({ path: `${artifacts}/chat-${kind}.png` })
  }
  await page.click('.legal-reference-card[data-reference-kind="PENALTY"] .reference-open')
  assert.equal(await page.evaluate(() => window.legalHost.rightFiles.length), 3, 'duplicate open activates the same tab')
  assert.ok((await page.$eval('.reference-provenance', el => el.textContent)).includes('待核验'))
  // Recreate the bubble from retained content/processes, as history rendering does.
  await page.evaluate(async () => {
    const last = window.chatState.bubbles.filter(b => b.role === 'ASSISTANT').at(-1)
    window.savedLegalBubble = JSON.parse(JSON.stringify(last))
    window.chatState.bubbles.splice(0)
  })
  await page.waitForFunction(() => !document.querySelector('.legal-reference-card'))
  await page.evaluate(() => window.chatState.bubbles.push(window.savedLegalBubble))
  await page.waitForFunction(() => document.querySelectorAll('.legal-reference-card').length === 4)
  assert.deepEqual(errors, [])
  console.log(`PASS real chat SSE, three reader types, keyboard/source actions, dedupe, retained bubble replay; ${artifacts}`)
} finally { await browser?.close(); await server.close() }
