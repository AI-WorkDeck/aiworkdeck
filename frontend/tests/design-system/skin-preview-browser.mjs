// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// node tests/design-system/skin-preview-browser.mjs (Chrome required).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import puppeteer from 'puppeteer-core'
const root = new URL('../../../', import.meta.url)
const read = p => readFileSync(new URL(p, root), 'utf8')
const source = read('frontend/src/components/MarketDetailPane.vue')
const sandbox = source.match(/class="mdp-theme-preview-frame"\s+sandbox="([^"]+)"/)[1]
const pushBody = source.match(/pushThemePreview\(\) \{([\s\S]*?)\n    \},/)[1]
const ids = ['theme-inkwash-zen', 'theme-anime-twilight', 'theme-aurora-glass']
const server = createServer((req, res) => {
  if (req.url === '/') {
    res.setHeader('Content-Type', 'text/html')
    res.end(`<html><body><iframe id="preview" sandbox="${sandbox}"></iframe></body></html>`)
  } else if (req.url === '/api/plugins/sdk/awd-plugin-sdk.js') {
    res.setHeader('Content-Type', 'text/javascript'); res.end(read('sdk/plugin-sdk/awd-plugin-sdk.js'))
  } else if (ids.some(id => req.url === `/${id}.html`)) {
    res.setHeader('Content-Type', 'text/html'); res.end(read(`official-plugins/${req.url.slice(1, -5)}/web/index.html`))
  } else { res.writeHead(404); res.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  await page.evaluate(() => localStorage.setItem('synthetic-session', 'test-only'))
  for (const id of ids) {
    await page.$eval('#preview', (el, url) => { el.src = url }, `/${id}.html`)
    const frame = await (await page.$('#preview')).contentFrame()
    await frame.waitForFunction(() => !!window.awd)
    const denied = await frame.evaluate(() => {
      const result = {}
      for (const key of ['document', 'localStorage']) {
        try { void window.parent[key]; result[key] = false } catch { result[key] = true }
      }
      return result
    })
    assert.deepEqual(denied, { document: true, localStorage: true }, id)
    assert.ok(await frame.$eval('.title', el => el.textContent.trim()), `${id} gallery rendered`)
    for (const theme of ['dark', 'light']) {
      await page.evaluate(({ body, theme }) => {
        const push = new Function('getResolvedTheme', 'collectThemeTokens', body)
        push.call({ $refs: { themePreview: document.querySelector('#preview') } }, () => theme, () => ({ '--awd-font-sans': 'monospace' }))
      }, { body: pushBody, theme })
      await frame.waitForFunction(t => document.documentElement.dataset.theme === t, {}, theme)
      assert.equal(await frame.evaluate(() => document.documentElement.style.getPropertyValue('--awd-font-sans')), 'monospace')
    }
    await frame.evaluate(() => window.postMessage({ awd: 1, type: 'theme', theme: 'dark' }, '*'))
    await frame.evaluate(() => new Promise(resolve => setTimeout(resolve, 30)))
    assert.equal(await frame.evaluate(() => document.documentElement.dataset.theme), 'light', 'non-parent theme message rejected')
    console.log(`PASS ${id}: rendered, isolated, light/dark synchronization, message source guard`)
  }
  await page.$eval('#preview', el => { el.setAttribute('sandbox', 'allow-scripts allow-same-origin'); el.src = '/theme-inkwash-zen.html' })
  const unsafe = await (await page.$('#preview')).contentFrame()
  await unsafe.waitForFunction(() => !!window.awd)
  assert.equal(await unsafe.evaluate(() => parent.localStorage.getItem('synthetic-session')), 'test-only')
  console.log('PASS negative control: old sandbox exposes host storage')
} finally {
  if (browser) await browser.close()
  await new Promise(resolve => server.close(resolve))
}
