// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real workbench + uni FileTree/QuickLook, synthetic API only. Run against dev:h5.
import puppeteer from 'puppeteer-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const base = process.env.FINDER_PREVIEW_UI_BASE || 'http://127.0.0.1:5188'
const out = process.env.FINDER_PREVIEW_UI_OUT || '/tmp/awd-finder-preview-ui'
fs.mkdirSync(out, { recursive: true })
const project = { id: 42, name: '快览隔离测试', userId: 7, projectType: 'BLANK', localRoot: '/synthetic/quick-look' }
const files = ['01-red.svg', '02-green.svg', '03-blue.svg'].map((name, i) => ({ id: i + 1, projectId: 42, name, fileType: 'svg', fileSize: 200, parentId: null, sortOrder: i, filePath: `/synthetic/${name}` }))
const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message))
await page.setViewport({ width: 1440, height: 1000 })
await page.evaluateOnNewDocument(() => {
  if (location.protocol !== 'about:') {
    localStorage.setItem('awd_app_language', 'zh-CN')
    localStorage.setItem('project_42_leftPaneKey', 'files')
  }
})
await page.setRequestInterception(true)
page.on('request', async req => {
  const url = new URL(req.url())
  if (!url.pathname.startsWith('/api/')) {
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) && !['data:', 'blob:'].includes(url.protocol)) return req.abort()
    return req.continue()
  }
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' }
  if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers })
  let body = []
  if (url.pathname.includes('/download')) return req.respond({ status: 200, headers, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="seagreen"/><text x="100" y="200" font-size="60" fill="white">Synthetic Quick Look</text></svg>' })
  if (url.pathname === '/api/projects/42') body = project
  else if (url.pathname === '/api/projects/my') body = [project]
  else if (url.pathname === '/api/projects/42/files') body = files
  else if (url.pathname === '/api/auth/me') body = { id: 7, username: 'synthetic' }
  else if (url.pathname.includes('/license/status')) body = { mode: 'none', accountConnected: false }
  else if (url.pathname === '/api/account/status') body = { connected: false }
  else if (url.pathname.includes('/version/status')) body = { enabled: false }
  else if (url.pathname.includes('/profile') || url.pathname.includes('/admin/config')) body = {}
  await req.respond({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(body) })
})
try {
  await page.goto(base + '/#/pages/project-overview/project-overview?id=42', { waitUntil: 'networkidle0' })
  await page.waitForSelector('.file-tree .tree-item[data-file-id="1"]', { visible: true })
  await page.click('.file-tree .tree-item[data-file-id="1"]')
  assert.equal(await page.$('.pane-content .file-preview'), null, 'single image click only selects')
  await page.keyboard.press('Space')
  await page.waitForSelector('.quick-look-mask .preview-img', { visible: true })
  assert.equal(await page.$('.pane-content .file-preview'), null, 'quick look does not create a tab')
  await page.keyboard.press('Escape')
  await page.waitForSelector('.quick-look-mask', { hidden: true })
  await page.click('.file-tree .tree-item[data-file-id="1"]', { clickCount: 2 })
  await page.waitForFunction(() => document.querySelector('.pane-content .preview-title')?.textContent === '01-red.svg')
  await page.keyboard.press('ArrowDown')
  await page.waitForFunction(() => document.querySelector('.pane-content .preview-title')?.textContent === '02-green.svg')
  const tabCount = await page.$$eval('.tab-item', elements => elements.length)
  await page.keyboard.press('ArrowDown')
  await page.waitForFunction(() => document.querySelector('.pane-content .preview-title')?.textContent === '03-blue.svg')
  assert.equal(await page.$$eval('.tab-item', elements => elements.length), tabCount)
  await page.keyboard.press('Space')
  await page.waitForSelector('.quick-look-mask .preview-img', { visible: true })
  assert.equal(await page.evaluate(async () => (await import('/src/utils/overlayState.js')).globalOverlayActive.value), true)
  await page.keyboard.press('ArrowUp')
  await page.waitForFunction(() => document.querySelector('.quick-look-mask .preview-title')?.textContent === '02-green.svg')
  assert.equal(await page.$eval('.pane-content .preview-title', element => element.textContent), '03-blue.svg')
  assert.equal(await page.$eval('.quick-look-mask', element => getComputedStyle(element).webkitAppRegion), 'no-drag')
  await page.screenshot({ path: out + '/quick-look.png' })
  await page.keyboard.press('Escape')
  await page.waitForSelector('.quick-look-mask', { hidden: true })
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('file-tree')), true)
  assert.equal(await page.evaluate(async () => (await import('/src/utils/overlayState.js')).globalOverlayActive.value), false)
  await page.keyboard.press('Space')
  await page.waitForSelector('.quick-look-mask', { visible: true })
  await page.keyboard.press('Space')
  await page.waitForSelector('.quick-look-mask', { hidden: true })
  await page.click('.file-tree .tree-item[data-file-id="1"]', { clickCount: 2 })
  await page.waitForFunction(() => document.querySelector('.pane-content .preview-title')?.textContent === '01-red.svg')
  await page.evaluate(() => { const input = document.createElement('input'); input.id = 'typing-safety'; document.querySelector('.file-tree').append(input); input.focus() })
  await page.keyboard.press('Space')
  assert.equal(await page.$('#typing-safety').then(handle => handle.evaluate(el => el.value)), ' ')
  assert.equal(await page.$('.quick-look-mask'), null)
  await page.screenshot({ path: out + '/tab-preview.png' })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, checks: ['single click selects without tab', 'double click opens tab', 'arrow image replacement', 'stable tab count', 'space popup', 'popup navigation', 'Escape and Space close', 'focus restoration', 'native double click', 'input space preserved', 'no-drag mask'], screenshotDirectory: out }))
} catch (error) { await page.screenshot({ path: out + '/failure.png' }); console.error(errors); throw error } finally { await browser.close() }
