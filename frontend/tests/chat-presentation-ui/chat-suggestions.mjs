// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real ChatInterface, keyboard and SSE; synthetic model/HTTP responses, no production service.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import puppeteer from 'puppeteer-core'
const root = fileURLToPath(new URL('../../', import.meta.url))
const fixture = fileURLToPath(new URL('./', import.meta.url))
const app = readFileSync(`${root}src/App.vue`, 'utf8')
const tokens = app.slice(app.indexOf("html,\nhtml[data-theme='light']"), app.indexOf('</style>', app.indexOf("html,\nhtml[data-theme='light']")))
const server = await createServer({ configFile: false, root: fixture, plugins: [vue()], resolve: { alias: { '@': `${root}src` }, dedupe: ['vue'] }, server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } } })
await server.listen()
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage()
const errors = []
page.on('pageerror', e => { errors.push(e.message); console.error('BROWSER', e.message) })
await page.evaluateOnNewDocument(() => {
  window.checkbaDesktop = {}
  window.suggestionExpiries = []
  const timer = window.setTimeout
  window.setTimeout = (fn, ms, ...args) => {
    if (ms === 5 * 60 * 1000) window.suggestionExpiries.push(fn)
    return timer(fn, ms, ...args)
  }
})
const wait = (fn, arg) => page.waitForFunction(fn, { timeout: 8000 }, arg)
const sse = (event, data) => page.evaluate(({ event, data }) => window.sseController.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)), { event, data })
const finish = async () => { await sse('text_delta', { content: '<final>三项风险已整理。</final>' }); await sse('bubble_end', { status: 'finished' }) }
const type = text => page.evaluate(text => { const input = document.querySelector('.chat-input-rich'); input.textContent = text; input.dispatchEvent(new Event('input', { bubbles: true })) }, text)
const submit = async text => { await type(text); await page.evaluate(() => window.chatState.handleSubmit('steer')) }
const shown = () => wait(() => !!document.querySelector('.suggestion-text'))
try {
  await page.setViewport({ width: 380, height: 920 })
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?provider=local`)
  await wait(() => window.ready)
  await page.addStyleTag({ content: `${tokens}\nhtml,body,#app{margin:0;height:100%;font-family:system-ui;}*{box-sizing:border-box;}view,scroll-view{display:block;}text{display:inline;}#app{height:100dvh;}` })
  await page.evaluate(() => {
    window.suggestionRequests = []; window.suggestionFeedback = []
    const original = uni.request
    uni.request = options => {
      if (options.url.includes('/api/ai/suggestions')) {
        if (options.url.endsWith('/feedback')) {
          window.suggestionFeedback.push({ url: options.url, ...options.data }); options.success({ statusCode: 200, data: { ok: true } }); return
        }
        window.suggestionRequests.push(options.data)
        const answer = () => options.success({ statusCode: 200, data: { id: `s-${window.suggestionRequests.length}`, sourceMessageId: 10, text: '请逐条列出修改建议。' } })
        if (window.delaySuggestion) window.releaseSuggestion = answer
        else answer()
        return
      }
      return original(options)
    }
    const originalFetch = window.fetch
    window.fetch = (...args) => {
      if (window.failNextChat && String(args[0]).endsWith('/api/agent/chat')) {
        window.failNextChat = false
        return Promise.resolve(new Response('synthetic failure', { status: 500 }))
      }
      return originalFetch(...args)
    }
  })
  assert.equal(await page.evaluate(() => window.suggestionRequests.length), 0, 'history must not generate suggestions')
  await submit('请审查这份合成合同。'); await finish(); await shown()
  assert.equal(await page.evaluate(() => window.suggestionRequests.length), 1)
  // Editing area only. Shift+Tab and IME keep ordinary keyboard behavior.
  await page.focus('.chat-input-rich')
  let count = await page.evaluate(() => window.chatPosts.length)
  await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift')
  await page.focus('.chat-input-rich')
  await page.$eval('.chat-input-rich', el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', isComposing: true, bubbles: true })))
  assert.equal(await page.evaluate(() => window.chatPosts.length), count)
  await page.keyboard.press('Tab')
  await wait(n => window.chatPosts.length === n + 1, count)
  await wait(() => window.suggestionFeedback.length === 1)
  assert.equal(await page.evaluate(() => window.chatPosts.at(-1).message), '请逐条列出修改建议。')
  assert.equal(await page.evaluate(() => window.suggestionFeedback[0].clientRequestId === window.chatPosts.at(-1).clientRequestId), true)
  // Click means edit, never send; then user changes the message and sends it.
  await finish(); await shown()
  await page.click('.suggestion-text')
  assert.equal(await page.evaluate(() => window.chatPosts.length), count + 1)
  await type('只列第三条的建议。'); await page.focus('.chat-input-rich'); await page.keyboard.press('Enter')
  await wait(() => window.suggestionFeedback.length === 2)
  assert.equal(await page.evaluate(() => window.chatPosts.at(-1).message), '只列第三条的建议。')
  // Failed submission must not create acceptance feedback; retry retains the suggestion identity.
  await finish(); await shown(); await page.evaluate(() => { window.failNextChat = true })
  await page.focus('.chat-input-rich'); await page.keyboard.press('Tab')
  await wait(() => window.lastToast?.includes('保留'))
  assert.equal(await page.evaluate(() => window.suggestionFeedback.length), 2)
  assert.equal(await page.$eval('.chat-input-rich', el => el.textContent), '请逐条列出修改建议。')
  await page.focus('.chat-input-rich'); await page.keyboard.press('Enter')
  await wait(() => window.suggestionFeedback.length === 3)
  // An outstanding model reply cannot overwrite or reappear after the user types.
  await page.evaluate(() => { window.delaySuggestion = true }); await finish()
  await wait(() => !!window.releaseSuggestion)
  await type('我已经在写新的指令'); await page.evaluate(() => { window.releaseSuggestion(); window.releaseSuggestion = null })
  await page.waitForFunction(() => !document.querySelector('.suggestion-text'))
  assert.equal(await page.$eval('.chat-input-rich', el => el.textContent), '我已经在写新的指令')
  // Conversation change invalidates an outstanding request and its feedback ownership.
  await submit('继续核验'); await finish(); await wait(() => !!window.releaseSuggestion)
  await page.evaluate(async () => { await window.chat.loadMessages('another', []); window.releaseSuggestion(); window.releaseSuggestion = null })
  assert.equal(await page.$('.suggestion-text'), null)
  // Toggle off suppresses new model requests; a new identity gets its own default.
  await page.click('.suggestion-toggle'); count = await page.evaluate(() => window.suggestionRequests.length)
  await submit('关闭状态的一轮'); await finish()
  assert.equal(await page.evaluate(() => window.suggestionRequests.length), count)
  await page.evaluate(() => { uni.setStorageSync('checkba_user', { id: 1002 }); window.dispatchEvent(new Event('focus')); window.delaySuggestion = false })
  await submit('另一用户的一轮'); await finish(); await shown()
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
    await page.setViewport({ width: 320, height: 920 })
    assert.ok(await page.$eval('.chat-suggestion-control', el => el.scrollWidth <= el.clientWidth + 1), 'narrow composer remains contained')
    await page.screenshot({ path: `/tmp/awd-chat-suggestions-${theme}.png` })
  }
  // Losing focus to other controls never sends; keyboard dismissal remains accessible.
  await page.focus('.suggestion-dismiss'); await page.keyboard.press('Enter')
  await wait(() => window.suggestionFeedback.at(-1)?.dismissed === true)
  // Expiry, active document/model changes and hidden composer are all hard invalidation boundaries.
  await submit('新的一轮'); await finish(); await shown()
  await page.evaluate(() => window.suggestionExpiries.at(-1)())
  await wait(() => !document.querySelector('.suggestion-text'))
  await submit('再核验'); await finish(); await shown()
  await page.evaluate(() => { window.chatFixtureProps.activeTab = { id: 12, name: '另一份合成合同.docx', fileType: 'docx' } })
  await wait(() => !document.querySelector('.suggestion-text'))
  await submit('隐藏面板时完成')
  count = await page.evaluate(() => window.suggestionRequests.length)
  await page.$eval('.chat-input-rich', el => { el.style.display = 'none' })
  await finish()
  await wait(() => !window.chatState.isStreaming)
  assert.equal(await page.evaluate(() => window.suggestionRequests.length), count)
  await page.$eval('.chat-input-rich', el => { el.style.display = '' })
  // A live completion while a draft already exists must not request or replace it.
  await submit('输入中结束'); await type('正在写的草稿'); await finish()
  await wait(() => !window.chatState.isStreaming)
  assert.equal(await page.evaluate(() => window.suggestionRequests.length), count)
  assert.equal(await page.$eval('.chat-input-rich', el => el.textContent), '正在写的草稿')
  assert.deepEqual(errors, [])
  console.log('PASS: suggestions, Tab/IME, edit, receipt failure/retry, stale response, switch identity/conversation, toggle, themes')
} finally { await browser.close(); await server.close() }
