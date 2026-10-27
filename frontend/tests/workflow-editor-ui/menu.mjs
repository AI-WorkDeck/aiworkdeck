// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Teleported menu geometry on the production Vue component. This fixture uses
// plain Vue, so opening uses the real contextmenu event, not synthetic Uni tap.
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import puppeteer from 'puppeteer-core'

const root = fileURLToPath(new URL('../../', import.meta.url))
const fixture = fileURLToPath(new URL('../chat-presentation-ui/', import.meta.url))
const output = process.argv[2] || '/tmp/awd-workflow-menu-1532'
mkdirSync(output, { recursive: true })
const source = readFileSync(`${root}src/App.vue`, 'utf8')
const tokens = source.slice(source.indexOf("html,\nhtml[data-theme='light']"), source.indexOf('</style>', source.indexOf("html,\nhtml[data-theme='light']")))
const negative = process.env.WORKFLOW_MENU_NEGATIVE === 'visibility'
const negativePlugin = { name: 'negative-menu-owner', enforce: 'pre', transform(code, id) {
  if (!negative || !id.endsWith('/ChatInterface.vue')) return null
  const needle = 'watch([() => props.visible, () => props.projectId], closeBuiltinWorkflowContextMenu)'
  assert(code.includes(needle), 'negative control must find the owner visibility guard')
  return code.replace(needle, '')
} }
const server = await createServer({ configFile: false, root: fixture, plugins: [negativePlugin, vue()], resolve: { alias: { '@': `${root}src` }, dedupe: ['vue'] }, server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } } })
await server.listen()
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage()
const results = { variants: [], errors: [] }
page.on('pageerror', e => results.errors.push(e.message))
await page.evaluateOnNewDocument(() => { window.checkbaDesktop = {} })
try {
  for (const width of [320, 1000]) {
    await page.setViewport({ width, height: 900 })
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?lang=zh-CN`)
    await page.waitForFunction(() => window.ready)
    await page.addStyleTag({ content: `${tokens}\nhtml,body,#app{margin:0;height:100%;font-family:system-ui;}*{box-sizing:border-box;}view,scroll-view{display:block;}text{display:inline;}#app{position:fixed;right:0;width:min(320px,100vw);height:100dvh;}.chat-interface{width:100%;height:100%;}` })
    await page.evaluate(() => window.chat.loadMessages('synthetic-empty', []))
    await page.click('.composer-advanced-summary')
    await page.click('.builtin-workflows-summary')
    const card = await page.$('.builtin-workflow-card')
    const box = await card.boundingBox()
    await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2, { button: 'right' })
    await page.waitForSelector('.bw-context-menu', { visible: true })
    const bounds = await page.$eval('.bw-context-menu', el => {
      const r = el.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, viewport: innerWidth, insideChat: !!el.closest('.chat-interface') }
    })
    assert.equal(bounds.insideChat, false)
    assert(bounds.left >= 0 && bounds.right <= width && bounds.top >= 0 && bounds.bottom <= 900)
    await page.screenshot({ path: `${output}/${width}-right-edge.png` })
    results.variants.push({ width, bounds })
  }
  await page.keyboard.press('Escape')
  results.escapeDismisses = await page.$eval('.bw-context-mask', el => !el.checkVisibility()).catch(() => true)
  assert.equal(results.escapeDismisses, true, 'Escape must dismiss the menu')
  const lastCard = await page.$('.builtin-workflow-card')
  const lastBox = await lastCard.boundingBox()
  await page.mouse.click(lastBox.x + lastBox.width - 4, lastBox.y + lastBox.height / 2, { button: 'right' })
  await page.waitForSelector('.bw-context-menu', { visible: true })
  await page.evaluate(() => { window.chatFixtureProps.visible = false })
  await new Promise(resolve => setTimeout(resolve, 50))
  results.hiddenOwnerDismisses = await page.$eval('.bw-context-mask', el => !el.checkVisibility()).catch(() => true)
  assert.equal(results.hiddenOwnerDismisses, true, 'hiding the owner must dismiss its teleported menu')
  assert.equal(results.errors.length, 0)
  writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
} catch (error) {
  results.failure = error.message
  throw error
} finally {
  writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2))
  await browser.close()
  await server.close()
}
