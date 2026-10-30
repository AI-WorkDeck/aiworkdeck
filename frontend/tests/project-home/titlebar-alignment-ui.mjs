// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real uni-app workbench, synthetic HTTP only. Platform classes exercise CSS,
// not native Windows/macOS titlebar behavior or a signed Electron package.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import puppeteer from 'puppeteer-core'
const base = process.env.TITLEBAR_BASE || 'http://127.0.0.1:5199'
const out = process.env.TITLEBAR_OUT || '/tmp/titlebar-alignment'
await mkdir(out, { recursive: true })
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const results = [], failures = []
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  let language = 'zh-CN'
  await page.setRequestInterception(true)
  page.on('request', async req => {
    const url = new URL(req.url())
    if (!url.pathname.startsWith('/api/')) {
      if (url.origin !== new URL(base).origin && !['data:', 'blob:'].includes(url.protocol)) return req.abort()
      return req.continue()
    }
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' }
    if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers })
    const project = { id: 42, name: language === 'zh-CN' ? '15-合成诉讼项目' : '15-Synthetic Litigation Project', userId: 7, myRole: 'OWNER', projectType: 'BLANK', createdAt: '2026-10-27T12:00:00', manager: 'Synthetic Owner' }
    let body = []
    if (url.pathname === '/api/projects/42') body = project
    else if (url.pathname === '/api/projects/my') body = [project]
    else if (url.pathname === '/api/auth/me') body = { id: 7, username: 'synthetic', role: 'USER' }
    else if (url.pathname === '/api/plugins/market/list') body = { plugins: [], accountConnected: false }
    else if (url.pathname === '/api/plugins/bundled') body = { plugins: [] }
    else if (url.pathname.includes('/license/status')) body = { mode: 'none', accountConnected: false }
    else if (url.pathname === '/api/account/status') body = { connected: false }
    else if (url.pathname.includes('/version/status')) body = { enabled: false }
    else if (url.pathname.includes('/profile') || url.pathname.includes('/admin/config')) body = {}
    else if (url.pathname.includes('/telemetry/settings')) body = { enabled: false }
    return req.respond({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(body) })
  })
  for (const lang of ['zh-CN', 'en-US']) {
    language = lang
    await page.evaluateOnNewDocument(lang => {
      localStorage.setItem('checkba_user', JSON.stringify({ type: 'object', data: { id: 7, username: 'synthetic', role: 'USER' } }))
      localStorage.setItem('app_language', lang)
      localStorage.setItem('awd_app_language', lang)
      localStorage.setItem('awd_theme', 'light')
    }, lang)
    await page.setViewport({ width: 1920, height: 900 })
    await page.goto(base + '/?titlebarLanguage=' + lang + '#/pages/project-overview/project-overview?id=42', { waitUntil: 'networkidle0', timeout: 90000 })
    await page.waitForSelector('.project-name-edit', { visible: true })
    for (const platform of ['web', 'mac', 'win']) {
      await page.evaluate(platform => {
        const classes = document.documentElement.classList
        for (const name of ['is-mac', 'is-win', 'is-desktop', 'is-fullscreen']) classes.remove(name)
        if (platform !== 'web') classes.add('is-desktop', 'is-' + platform)
      }, platform)
      for (const width of [1920, 1440, 1024, 720]) {
        await page.setViewport({ width, height: 900 })
        await page.waitForFunction(width => document.querySelector('.page-project-overview').classList.contains('compact-mode') === (width <= 1360), {}, width)
        // Existing size transitions must settle before measuring final layout.
        await new Promise(done => setTimeout(done, 350))
        const geometry = await page.evaluate(() => {
          const box = element => {
            const r = element.getBoundingClientRect()
            return { x: r.x, y: r.y, width: r.width, height: r.height, centerX: r.x + r.width / 2, centerY: r.y + r.height / 2 }
          }
          const names = ['.header-left', '.header-center', '.header-right', '.project-title-row', '.project-name-edit', '.project-switcher', '.switcher-arrow', '.project-status-badge', '.status-text', '.project-meta', '.meta-item', '.mode-switch-capsule', '.mode-switch-label', '.top-bar-btn', '.account-entry-btn']
          const items = {}
          for (const selector of names) {
            const element = document.querySelector('.project-header ' + selector)
            if (!element || !element.getClientRects().length) continue
            const range = document.createRange(); range.selectNodeContents(element)
            const r = range.getBoundingClientRect()
            items[selector] = { ...box(element), textCenterY: r.height ? r.y + r.height / 2 : null, lineHeight: getComputedStyle(element).lineHeight, display: getComputedStyle(element).display }
          }
          const header = box(document.querySelector('.project-header'))
          return { header, items }
        })
        const name = `${lang}-${platform}-${width}`
        results.push({ name, ...geometry })
        for (const selector of ['.project-name-edit', '.project-switcher']) {
          const item = geometry.items[selector]
          if (Math.abs(item.textCenterY - item.centerY) > 2) failures.push(`${name} ${selector}: text center differs by ${(item.textCenterY - item.centerY).toFixed(2)}px`)
        }
        const leftContent = ['.project-title-row', '.project-meta'].map(selector => geometry.items[selector]).filter(Boolean)
        const leftEnd = Math.max(...leftContent.map(item => item.x + item.width))
        const groups = [{ x: geometry.items['.header-left'].x, width: leftEnd - geometry.items['.header-left'].x }, ...['.header-center', '.header-right'].map(selector => geometry.items[selector]).filter(Boolean)]
        for (let index = 1; index < groups.length; index++) {
          if (groups[index - 1].x + groups[index - 1].width > groups[index].x + 0.5) failures.push(`${name}: header groups overlap`)
        }
        const title = geometry.items['.project-name-edit'], status = geometry.items['.status-text']
        if (title.width < 20) failures.push(`${name}: project title has no usable text width`)
        if (status && Math.abs(status.textCenterY - title.centerY) > 2) failures.push(`${name}: status text is off center`)
        const rowCenter = geometry.items['.header-right'].centerY
        for (const selector of ['.header-left', '.header-center']) {
          const item = geometry.items[selector]
          if (item && Math.abs(item.centerY - rowCenter) > 1) failures.push(`${name} ${selector}: row center differs by ${(item.centerY - rowCenter).toFixed(2)}px`)
        }
        if (width === 1920 || width === 720) await page.screenshot({ path: `${out}/${name}.png`, clip: { x: 0, y: 0, width, height: 130 } })
        if (width === 720) {
          await page.click('.project-switcher')
          await page.waitForSelector('.switcher-menu', { visible: true })
          const dropdownVisible = await page.$eval('.switcher-menu', el => {
            const r = el.getBoundingClientRect()
            return el.contains(document.elementFromPoint(r.left + 16, r.top + 16))
          })
          if (!dropdownVisible) failures.push(`${name}: project switcher dropdown is clipped`)
          await page.click('.switcher-mask', { offset: { x: width - 10, y: 160 } })
          await page.waitForSelector('.switcher-menu', { hidden: true })
        }
      }
    }
  }
  await writeFile(`${out}/report.json`, JSON.stringify({ results, failures, errors }, null, 2))
  console.log(JSON.stringify({ cases: results.length, failures, errors }, null, 2))
  assert.deepEqual(errors, [], 'workbench must render without page errors')
  if (process.env.TITLEBAR_RECORD_ONLY !== '1') assert.deepEqual(failures, [], 'header text and group centers must align')
} finally { await browser.close() }
