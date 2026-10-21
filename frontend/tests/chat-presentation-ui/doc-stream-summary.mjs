// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real ChatInterface + SSE + Markdown rendering, synthetic chat and document content only.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import puppeteer from 'puppeteer-core'

const root = fileURLToPath(new URL('../../', import.meta.url))
const fixture = fileURLToPath(new URL('./', import.meta.url))
const artifacts = mkdtempSync(`${tmpdir()}/awd-doc-stream-summary-`)
const source = readFileSync(`${root}src/App.vue`, 'utf8')
const tokens = source.slice(source.indexOf("html,\nhtml[data-theme='light']"), source.indexOf('</style>', source.indexOf("html,\nhtml[data-theme='light']")))
const server = await createServer({
  configFile: false, root: fixture, cacheDir: `${artifacts}/vite`, plugins: [vue()],
  resolve: { alias: { '@': `${root}src` }, dedupe: ['vue'] },
  server: { host: '127.0.0.1', port: 0, fs: { allow: [root, fileURLToPath(new URL('../../node_modules', import.meta.url))] } },
})
await server.listen()
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message))
const wait = (fn, arg) => page.waitForFunction(fn, { timeout: 10000 }, arg)
const send = (event, data) => page.evaluate(({ event, data }) => {
  window.sseController.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
}, { event, data })
const text = content => send('text_delta', { content })
const answer = () => page.evaluate(() => [...document.querySelectorAll('.message-row.assistant')].at(-1)?.querySelector('[data-chat-answer]')?.textContent.trim() || '')
const start = async () => {
  await page.evaluate(async () => {
    document.querySelector('.chat-input-rich').textContent = '请调整这封示例信的开头与结尾。'
    await window.chatState.handleSubmit('steer')
  })
  await wait(() => window.chatState.isStreaming && window.sseController)
  await text('<process name="修改示例信"><tool_code>doc_start_stream({})</tool_code><tool_output status="SUCCESS">已准备写入</tool_output></process>')
  await send('doc_stream_data', { content: '尊敬的主席：仅供测试的信件正文。' })
  await text('尊敬的主席：仅供测试的信件正文。')
  await wait(() => [...document.querySelectorAll('.message-row.assistant [data-chat-answer]')].at(-1)?.textContent.includes('正在向文档流式写入'))
}
const SUMMARY = '已调整信件的开头与结尾，保留原有事实和署名。'

try {
  await page.setViewport({ width: 440, height: 900 })
  await page.goto(server.resolvedUrls.local[0])
  await page.addStyleTag({ content: `${tokens}\nhtml,body,#app{margin:0;height:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}*{box-sizing:border-box;}view,scroll-view{display:block;}text{display:inline;}#app{height:100dvh;}` })
  await wait(() => window.ready)
  await page.evaluate(() => window.loadFixture('single'))

  // A fallback summary starts after doc_stream_end, while the same bubble is still live.
  await start()
  await send('doc_stream_end', { wrote: true })
  for (const part of ['<fi', 'nal>', SUMMARY.slice(0, 8), SUMMARY.slice(8), '</final>']) await text(part)
  await send('bubble_end', { status: 'finished', documentEdited: true })
  await wait(() => !window.chatState.isStreaming)
  await wait(summary => [...document.querySelectorAll('.message-row.assistant')].at(-1)?.querySelector('[data-chat-answer]')?.textContent.trim() === summary, SUMMARY)
  assert.equal(await answer(), SUMMARY)
  await page.evaluate(() => [...document.querySelectorAll('.message-row.assistant')].at(-1).scrollIntoView({ block: 'end' }))
  await page.screenshot({ path: `${artifacts}/summary-after-stream.png` })

  // A same-response final may arrive before end. It must replace the transient placeholder.
  await start()
  await text(`<final>${SUMMARY}</final>`)
  await text('这段仍是文档正文，不应混进总结。')
  await send('doc_stream_end', { wrote: true })
  await send('bubble_end', { status: 'finished', documentEdited: true })
  await wait(() => !window.chatState.isStreaming)
  await wait(summary => [...document.querySelectorAll('.message-row.assistant')].at(-1)?.querySelector('[data-chat-answer]')?.textContent.trim() === summary, SUMMARY)
  assert.equal(await answer(), SUMMARY)

  // Stop/error do not leave a false "still writing" or fabricate a success summary.
  await start()
  await send('cancelled', {})
  await wait(() => !window.chatState.isStreaming)
  assert.equal(await answer(), '')
  await page.evaluate(() => [...document.querySelectorAll('.message-row.assistant')].at(-1).scrollIntoView({ block: 'end' }))
  await page.screenshot({ path: `${artifacts}/cancelled-stream.png` })
  assert.deepEqual(errors, [], 'browser runtime errors')
  console.log(`PASS: final after/before doc_stream_end, body suppression, cancelled placeholder; screenshots: ${artifacts}`)
} catch (error) {
  console.error(await page.evaluate(() => ({bubbles: window.chatState?.bubbles?.map(b => ({content:b.content, timeline:b.timeline, isEditorStreaming:b.isEditorStreaming})), text: document.querySelector(".message-list")?.textContent})))
  throw error
} finally {
  await browser.close()
  await server.close()
}
