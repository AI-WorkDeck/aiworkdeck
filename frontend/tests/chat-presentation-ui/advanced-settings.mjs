// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real ChatInterface settings disclosures; synthetic identity, conversations and HTTP only.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage()
await page.evaluateOnNewDocument(() => { window.checkbaDesktop = {} })
const errors = []
page.on('pageerror', e => errors.push(e.message))
const visible = selector => page.$eval(selector, el => el.checkVisibility())
try {
  for (const lang of ['zh-CN', 'en-US']) {
    for (const theme of ['light', 'dark']) {
      for (const empty of [true, false]) {
        await page.setViewport({ width: 350, height: 900, deviceScaleFactor: 2 })
        await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?lang=${lang}`)
        await page.waitForFunction(() => window.ready)
        await page.addStyleTag({ content: `${tokens}\nhtml,body,#app{margin:0;height:100%;font-family:system-ui;}*{box-sizing:border-box;}view,scroll-view{display:block;}text{display:inline;}#app{height:100dvh;}` })
        await page.evaluate(({ theme, empty }) => {
          document.documentElement.dataset.theme = theme
          if (empty) window.chat.loadMessages('synthetic-empty', [])
        }, { theme, empty })
        await page.waitForSelector('.composer-advanced-summary')
        const wrapper = empty ? '.empty-middle-section' : '.input-area-wrapper'
        assert.equal(await page.$eval('.composer-advanced-settings', el => el.open), false)
        for (const selector of ['.builtin-workflows-summary', '.suggestion-toggle', '.decision-assist-summary']) assert.equal(await visible(selector), false)
        const before = await page.$eval('.decision-assist-switch', el => el.getAttribute('aria-checked'))
        for (const key of ['Enter', 'Space']) {
          await page.focus('.composer-advanced-summary')
          await page.keyboard.press(key)
          assert.equal(await page.$eval('.composer-advanced-settings', el => el.open), true)
          assert.equal(await page.$eval('.decision-assist-switch', el => el.getAttribute('aria-checked')), before, 'opening settings never enables Jev')
          await page.keyboard.press(key)
          assert.equal(await page.$eval('.composer-advanced-settings', el => el.open), false)
        }
        await page.evaluate(() => document.activeElement?.blur())
        await (await page.$(wrapper)).screenshot({ path: `/tmp/awd-advanced-${lang}-${theme}-${empty ? 'empty' : 'conversation'}-closed.png` })
        await page.click('.composer-advanced-summary')
        for (const selector of ['.builtin-workflows-summary', '.suggestion-toggle', '.decision-assist-summary']) assert.equal(await visible(selector), true)
        await page.click('.builtin-workflows-summary')
        assert.equal(await page.$eval('.builtin-workflows-fold', el => el.open), true)
        await page.click('.builtin-workflows-summary')
        const suggestionBefore = await page.$eval('.suggestion-toggle', el => el.getAttribute('aria-pressed'))
        await page.click('.suggestion-toggle')
        assert.notEqual(await page.$eval('.suggestion-toggle', el => el.getAttribute('aria-pressed')), suggestionBefore)
        await page.click('.suggestion-toggle')
        await page.click('.suggestion-settings summary')
        assert.equal(await visible('.suggestion-settings p'), true)
        await page.click('.suggestion-settings summary')
        await page.click('.decision-assist-summary')
        assert.equal(await visible('.decision-assist-switch'), true)
        assert.equal(await page.$eval('.decision-assist-switch', el => el.getAttribute('aria-checked')), before)
        await page.click('.decision-assist-summary')
        for (const width of [320, 350, 420]) {
          await page.setViewport({ width, height: 900, deviceScaleFactor: 2 })
          assert.ok(await page.$eval('.composer-advanced-settings', el => el.scrollWidth <= el.clientWidth + 1), `${lang} ${theme} ${empty} ${width}`)
        }
        await (await page.$('.composer-advanced-settings')).screenshot({ path: `/tmp/awd-advanced-${lang}-${theme}-${empty ? 'empty' : 'conversation'}-open.png` })
        assert.equal((await page.$eval('.builtin-workflows-adv-btn', el => el.textContent)).trim(), lang === 'zh-CN' ? '编辑规则' : 'Edit rules')
        await page.click('.builtin-workflows-adv-btn')
        await page.waitForSelector('.bw-editor-dialog')
        assert.ok(await page.$('.fixture-workflow-tab .bw-editor-dialog'), 'rules open in the workspace host')
        assert.equal(await page.$('.chat-interface .bw-editor-dialog'), null, 'editor is outside the narrow chat')
        for (const width of [320, 600, 1000]) {
          await page.setViewport({ width, height: 900, deviceScaleFactor: 2 })
          assert.ok(await page.$eval('.bw-editor-dialog', el => el.scrollWidth <= el.clientWidth + 1), `workflow width ${width}`)
          assert.ok(await page.$eval('.bw-editor-main', el => el.scrollWidth <= el.clientWidth + 1), `workflow form width ${width}`)
        }
      }
    }
  }
  assert.deepEqual(errors, [])
  console.log('PASS: advanced settings default collapse, mouse/Enter/Space, three settings reachable, Jev consent unchanged, edit rules, empty/conversation layouts, bilingual themes, 320/350/420px')
} finally { await browser.close(); await server.close() }
