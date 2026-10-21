// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real ChatInterface + SSE parser + choice component; all API requests are synthetic.
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import puppeteer from 'puppeteer-core'
const root = fileURLToPath(new URL('../../', import.meta.url))
const fixture = fileURLToPath(new URL('./', import.meta.url))
const output = '/tmp/awd-ocr-routing-ui-1387'
mkdirSync(output, { recursive: true })
const source = readFileSync(`${root}src/App.vue`, 'utf8')
const tokens = source.slice(source.indexOf("html,\nhtml[data-theme='light']"), source.indexOf('</style>', source.indexOf("html,\nhtml[data-theme='light']")))
const server = await createServer({ configFile: false, root: fixture, plugins: [vue()], resolve: { alias: { '@': `${root}src` }, dedupe: ['vue'] }, server: { host: '127.0.0.1', port: 5237, strictPort: true, fs: { allow: [root] } } })
await server.listen()
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage(), errors = [], blocked = []
page.on('pageerror', error => errors.push(error.message))
await page.setRequestInterception(true)
page.on('request', request => {
  if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:5237/')) { blocked.push(request.url()); request.abort() }
  else request.continue()
})
const send = (event, data) => page.evaluate(({ event, data }) => window.sseController.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)), { event, data })
const choice = async (id, localAvailable = true) => {
  const conversationId = await page.evaluate(() => window.chatState.currentConversationId)
  await send('client_action', { action: 'ocr_route_required', conversationId, decisionId: id, version: '2026-10-21', fileId: 7,
    reason: '本地扫描件识别组件尚未准备好。', notice: '云端识别会将文档页面图片发送至阿里云 OCR，平台通道按页消耗 Credits。', localAvailable })
  await page.waitForSelector('.ocr-choice')
}
try {
  await page.setViewport({ width: 440, height: 1000 })
  await page.goto('http://127.0.0.1:5237/')
  await page.waitForFunction(() => window.ready)
  await page.addStyleTag({ content: `${tokens}\nhtml,body,#app{margin:0;height:100%;font-family:system-ui}*{box-sizing:border-box}view,scroll-view{display:block}text{display:inline}#app{height:100dvh}` })
  await page.evaluate(() => {
    window.ocrPosts = []
    window.ocrCancels = []
    const request = uni.request
    uni.request = options => {
      if (options.url.includes('/api/ocr/routing/cancel')) {
        window.ocrCancels.push(options.data); options.success({ statusCode: 200, data: { code: 0, data: { cancelled: true } } }); return {}
      }
      if (options.url.includes('/api/ocr/routing/choice')) {
        window.ocrPosts.push(options.data); options.success({ statusCode: 200, data: { code: 0, data: { accepted: true } } }); return {}
      }
      return request(options)
    }
    document.querySelector('.chat-input-rich').textContent = '把合成扫描件转换成 Word'
    return window.chatState.handleSubmit('steer')
  })
  await page.waitForFunction(() => window.chatState.isStreaming)
  await choice('synthetic-first')
  await page.screenshot({ path: output + '/choice-light.png' })
  assert.equal(await page.evaluate(() => window.ocrPosts.length), 0)
  await page.click('.ocr-cancel')
  await page.waitForFunction(() => window.ocrCancels.length === 1)
  assert.equal(await page.evaluate(() => window.ocrCancels[0].decisionId), 'synthetic-first')
  assert.equal(await page.evaluate(() => window.chatPosts.length), 1)
  await choice('synthetic-second')
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark')
  await page.screenshot({ path: output + '/choice-dark.png' })
  assert.equal(await page.$eval('.ocr-remember', element => element.getAttribute('aria-checked')), 'false')
  await page.click('.ocr-remember')
  await page.click('.ocr-actions button:first-child')
  await page.waitForFunction(() => window.ocrPosts.length === 1)
  assert.equal(await page.evaluate(() => window.chatPosts.length), 1, 'no steering while original reply still streams')
  await send('bubble_end', { status: 'awaiting_input', reason: 'component_required' })
  await page.waitForFunction(() => window.chatPosts.length === 2)
  assert.equal(await page.evaluate(() => window.chatPosts.at(-1).message), '把合成扫描件转换成 Word')
  assert.equal(await page.evaluate(() => window.ocrPosts[0].remember), true)
  assert.equal(await page.evaluate(() => window.ocrPosts[0].decisionId), 'synthetic-second')
  await choice('synthetic-old-runtime', false)
  assert.equal(await page.$eval('.ocr-actions button:nth-child(2)', element => element.disabled), true)
  await page.click('.ocr-cancel')
  await page.evaluate(async root => {
    const request = uni.request
    window.ocrSettingsCalls = []
    uni.request = options => {
      if (options.url.endsWith('/api/ocr/routing')) {
        if (options.method === 'PUT') window.ocrSettingsCalls.push(options.data)
        options.success({ statusCode: 200, data: { code: 0, data: { choice: options.data?.choice || 'ask',
          notice: '页面图片发送至阿里云 OCR，按页计费。', version: '2026-10-21' } } }); return {}
      }
      return request(options)
    }
    const vueUrl = performance.getEntriesByType('resource').find(entry => /\/vue\.js\?/.test(entry.name))?.name
    if (!vueUrl) throw new Error('Shared Vue runtime was not loaded')
    const { createApp, h } = await import(vueUrl)
    const { default: Settings } = await import('/@fs/' + root + 'src/components/admin/OcrRoutingSettings.vue')
    const element = document.createElement('div'); element.id = 'ocr-settings-test'; document.body.append(element)
    createApp({ render: () => h(Settings) }).mount(element)
  }, root)
  await page.waitForFunction(() => [...document.querySelectorAll('#ocr-settings-test button')].some(b => b.textContent === '允许云端识别并计费' && !b.disabled))
  await page.evaluate(() => [...document.querySelectorAll('#ocr-settings-test button')].find(b => b.textContent === '允许云端识别并计费').click())
  await page.waitForFunction(() => window.ocrSettingsCalls.length === 1)
  assert.deepEqual(await page.evaluate(() => window.ocrSettingsCalls[0]), { choice: 'cloud', version: '2026-10-21' })
  await page.evaluate(() => [...document.querySelectorAll('#ocr-settings-test button')].find(b => b.textContent === '每次询问').click())
  await page.waitForFunction(() => window.ocrSettingsCalls.length === 2)
  assert.equal(await page.evaluate(() => window.ocrSettingsCalls[1].choice), 'ask')
  assert.deepEqual(errors, [])
  assert.deepEqual(blocked, [])
  console.log(JSON.stringify({ passed: true, checks: ['real SSE choice card', 'cancel has no upload or resume', 'default remember=false', 'cloud choice authenticated request', 'wait current turn then automatic original-message resume', 'old-runtime local option disabled', 'light/dark screenshot', 'explicit remember checkbox', 'real settings save and withdrawal'], output }))
} catch (error) { await page.screenshot({ path: output + '/failure.png' }); console.error(errors); throw error }
finally { await browser.close(); await server.close() }
