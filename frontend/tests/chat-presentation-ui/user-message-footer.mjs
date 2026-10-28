// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real chat rendering with synthetic messages; no external AI or user workspace.
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import puppeteer from 'puppeteer-core'
const root = fileURLToPath(new URL('../../', import.meta.url))
const fixture = fileURLToPath(new URL('./', import.meta.url))
const source = readFileSync(`${root}src/App.vue`, 'utf8')
const tokens = source.slice(source.indexOf("html,\nhtml[data-theme='light']"), source.indexOf('</style>', source.indexOf("html,\nhtml[data-theme='light']")))
const server = await createServer({ configFile: false, root: fixture, plugins: [vue()], resolve: { alias: { '@': `${root}src` }, dedupe: ['vue'] }, server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } } })
await server.listen()
let browser
const out = process.env.AWD_SHOTS || '/tmp/user-message-footer'
mkdirSync(out, { recursive: true })
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
  const page = await browser.newPage()
  for (const lang of ['zh-CN', 'en-US', 'ar-SA']) {
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?lang=${lang}`)
    await page.waitForFunction(() => window.ready)
    await page.addStyleTag({ content: `${tokens}\nhtml,body,#app {margin:0;height:100%;font-family:system-ui;} *{box-sizing:border-box;} view,scroll-view{display:block;} text{display:inline;} #app{height:100dvh;}` })
    await page.evaluate(lang => {
      document.documentElement.dir = lang === 'ar-SA' ? 'rtl' : 'ltr'
      window.chatState.bubbles.splice(0, window.chatState.bubbles.length,
        { role: 'USER', id: '1', content: 'Hi', timestamp: '10/27 18:29' },
        { role: 'ASSISTANT', id: '2', content: 'Synthetic response' })
    }, lang)
    for (const width of [280, 320, 350, 420, 640]) {
      await page.setViewport({ width, height: 860 })
      await page.hover('.user-bubble')
      const metrics = await page.evaluate(() => {
        const footer = document.querySelector('.bubble-footer'), bubble = document.querySelector('.user-bubble'), next = document.querySelector('.message-row.assistant')
        const f = footer.getBoundingClientRect(), b = bubble.getBoundingClientRect(), n = next.getBoundingClientRect(), list = document.querySelector('.message-list').getBoundingClientRect()
        const labels = [...footer.querySelectorAll('.rollback-text, .bubble-timestamp')].map(el => {
          const range = document.createRange(); range.selectNodeContents(el)
          return { text: el.textContent, lines: new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size }
        })
        return { labels, below: f.top >= b.bottom, separated: n.top >= f.bottom, contained: f.left >= list.left && f.right <= list.right }
      })
      assert.equal(metrics.below, true, `${lang}/${width}: controls stay below bubble`)
      assert.equal(metrics.separated, true, `${lang}/${width}: next reply clears the controls`)
      assert.equal(metrics.contained, true, `${lang}/${width}: controls stay in the panel`)
      assert.equal(metrics.labels.length, 3)
      for (const label of metrics.labels) assert.equal(label.lines, 1, `${lang}/${width}: ${label.text} stays on one line`)
      if (width === 350) await page.screenshot({ path: `${out}/${lang}.png` })
    }
  }
  console.log('PASS: message footer geometry, 3 languages × 5 widths')
} finally {
  await browser?.close()
  await server.close()
}
