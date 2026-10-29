// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Actual Vue components + browser, synthetic legal records only; no retrieval claims.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import puppeteer from 'puppeteer-core'

const root = fileURLToPath(new URL('../../', import.meta.url))
const fixture = fileURLToPath(new URL('./', import.meta.url))
const output = process.env.LEGAL_REFERENCE_SHOTS || '/tmp/aiworkdeck-legal-reference-ui'
mkdirSync(output, { recursive: true })
const app = readFileSync(`${root}src/App.vue`, 'utf8')
const start = app.indexOf("html,\nhtml[data-theme='light']")
assert.ok(start >= 0)
const tokens = app.slice(start, app.indexOf('</style>', start))
const server = await createServer({ configFile: false, root: fixture, plugins: [vue()], resolve: { alias: { '@': `${root}src` }, dedupe: ['vue'] }, server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } } })
await server.listen()
let browser
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewport({ width: 1200, height: 1000, deviceScaleFactor: 1 })
  await page.goto(server.resolvedUrls.local[0])
  await page.waitForFunction(() => window.ready)
  await page.addStyleTag({ content: `${tokens}\nhtml,body,#app{margin:0;height:100%;font-family:var(--awd-font-sans)}*{box-sizing:border-box}.fixture{height:100%;display:grid;grid-template-columns:330px minmax(0,1fr);background:var(--awd-bg)}.fixture-card{padding:12px;min-width:0}.fixture-pane{height:100vh;min-width:0}@media(max-width:600px){.fixture{display:block;height:auto}.fixture-pane{height:750px}}` })
  await page.focus('.reference-open')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Space')
  assert.deepEqual(await page.evaluate(() => window.opened), ['synthetic-law', 'synthetic-law'], 'native keyboard activation emits one open per activation')
  await page.focus('.reference-source-button')
  await page.keyboard.press('Enter')
  assert.deepEqual(await page.evaluate(() => window.openedUrls), ['https://example.org/legal/source'])

  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
    for (const kind of ['LAW', 'CASE', 'PENALTY']) {
      await page.evaluate(kind => {
        window.state.kind = kind
        window.state.sections = kind === 'LAW'
          ? [{ labelKey: 'legalReference.article', text: '第一条\n本段为合成测试资料，用于验证资料卡和阅读页的展示。\n\n第二条\n展示来源、版本和资料边界。' }]
          : [{ labelKey: 'legalReference.facts', text: '本段为合成事实，仅供界面测试。' }, { labelKey: kind === 'CASE' ? 'legalReference.reasoning' : 'legalReference.basis', text: '本段为合成内容，不代表真实法律结论。' }, { labelKey: kind === 'CASE' ? 'legalReference.decision' : 'legalReference.penalty', text: '本段为合成结果，仅供界面测试。' }]
      }, kind)
      await page.waitForFunction(kind => document.querySelector('.legal-reference-pane').dataset.referenceKind === kind, {}, kind)
      assert.equal(await page.$eval('.reference-document-heading', el => getComputedStyle(el).textAlign), kind === 'LAW' ? 'start' : 'center')
      await page.screenshot({ path: `${output}/${kind.toLowerCase()}-${theme}.png`, fullPage: true })
    }
  }
  for (const locale of ['en-US', 'ar-SA', 'zh-CN']) {
    await page.evaluate(locale => window.setLocale(locale), locale)
    await page.setViewport({ width: 320, height: 950 })
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, body: document.body.scrollWidth, card: document.querySelector('.legal-reference-card').scrollWidth, cardWidth: document.querySelector('.legal-reference-card').clientWidth, pane: document.querySelector('.reference-paper').scrollWidth, paneWidth: document.querySelector('.reference-paper').clientWidth }))
    assert.ok(dimensions.body <= dimensions.viewport, `${locale} viewport does not overflow`)
    assert.ok(dimensions.card <= dimensions.cardWidth + 1, `${locale} card wraps`)
    assert.ok(dimensions.pane <= dimensions.paneWidth + 1, `${locale} reading page wraps`)
    assert.equal(await page.$eval('.reference-metadata', el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 1)
    await page.screenshot({ path: `${output}/narrow-${locale}.png`, fullPage: true })
  }
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'file:///etc/passwd', 'https://user:password@example.org/']) {
    await page.evaluate(url => { window.state.url = url }, url)
    await page.waitForFunction(() => !document.querySelector('.reference-source-button'))
  }
  await page.evaluate(() => { window.state.title = '<img src=x onerror=alert(1)>'; window.state.sections = [{ labelKey: 'legalReference.body', text: '<script>window.unsafe = true</script>' }]; window.state.status = 'unverified' })
  assert.equal(await page.$('img'), null)
  assert.equal(await page.evaluate(() => window.unsafe), undefined)
  assert.match(await page.$eval('.reference-status', el => el.textContent), /来源待核验/)
  assert.match(await page.$eval('.reference-provenance', el => el.textContent), /由 AI 整理.*尚未核验/)
  assert.doesNotMatch(await page.$eval('.reference-provenance', el => el.textContent), /以下内容来自检索结果/)
  await page.evaluate(() => { window.state.sections = [{ labelKey: 'legalReference.aiSummary', text: '合成 AI 摘要' }, { labelKey: 'legalReference.excerpt', text: '合成引用节选' }] })
  assert.deepEqual(await page.$$eval('.reference-section h2', elements => elements.map(el => el.textContent)), ['AI 整理', '引用节选'])
  await page.evaluate(() => { window.state.status = 'metadata'; window.state.sections = [] })
  await page.waitForSelector('.reference-empty')
  assert.match(await page.$eval('.reference-empty', el => el.textContent), /未返回正文/)
  assert.match(await page.$eval('.reference-status', el => el.textContent), /仅检索目录/)
  assert.deepEqual(errors, [])
  console.log(`PASS: three document layouts, light/dark, keyboard, 320px in Chinese/English/Arabic, safe URLs, escaped text and absent body. Screenshots: ${output}`)
} finally {
  if (browser) await browser.close()
  await server.close()
}
