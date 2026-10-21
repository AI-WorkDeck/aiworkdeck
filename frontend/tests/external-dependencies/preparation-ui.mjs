// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import puppeteer from 'puppeteer-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const base = process.env.EXTERNAL_UI_BASE || 'http://127.0.0.1:5211'
const out = '/tmp/awd-external-preparation-ui-1388'
fs.mkdirSync(out, { recursive: true })
const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage()
let checks = 0
const errors = []
page.on('pageerror', e => errors.push(e.message))
await page.setViewport({ width: 1440, height: 1100 })
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('awd_app_language', 'zh-CN')
  localStorage.setItem('checkba_user', JSON.stringify({ type: 'object', data: { id: 7, username: 'synthetic', isAdmin: true } }))
  window.__externalLinks = []
  window.checkbaDesktop = {
    platform: 'win32',
    shell: { openExternal: async url => { window.__externalLinks.push(url); return { ok: true } } },
    model: { status: async () => ({ components: [] }) },
  }
})
await page.setRequestInterception(true)
page.on('request', async request => {
  const url = new URL(request.url())
  if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin || ['data:', 'blob:'].includes(url.protocol) ? request.continue() : request.abort()
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }
  if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers })
  let body = {}
  if (url.pathname === '/api/external-dependencies') body = { code: 0, platform: 'windows', dependencies: [{ id: 'libreoffice', status: 'MISSING' }, { id: 'docker', status: ++checks > 1 ? 'AVAILABLE' : 'DAEMON_UNAVAILABLE' }, { id: 'tmeet', status: 'MISSING_OR_FAILED' }] }
  else if (url.pathname === '/api/auth/me') body = { code: 0, data: { id: 7, username: 'synthetic', isAdmin: true } }
  else if (url.pathname.includes('optional-components')) body = { code: 0, components: [] }
  else if (url.pathname.includes('list') || url.pathname.includes('members')) body = []
  return request.respond({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(body) })
})
try {
  await page.goto(base + '/#/pages/admin/admin?nav=components', { waitUntil: 'networkidle0' })
  await page.waitForSelector('.external-item', { visible: true, timeout: 30000 })
  assert.match(await page.$eval('body', el => el.textContent), /Docker 未启动/)
  const guide = await page.$('.external-actions .external-btn')
  await guide.click()
  assert.equal((await page.evaluate(() => window.__externalLinks)).length, 1)
  assert.equal(checks, 1, 'opening guide does not claim installation')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.waitForFunction(() => [...document.querySelectorAll('.external-item')].some(el => el.textContent.includes('Docker Desktop') && el.textContent.includes('程序可启动')))
  assert.equal(checks, 2)
  await page.screenshot({ path: out + '/prepared.png', fullPage: true })
  assert.deepEqual(errors, [])
  fs.writeFileSync(out + '/report.json', JSON.stringify({ checks, errors, scope: 'real settings UI; synthetic API, no installation or network' }, null, 2))
} catch (e) { await page.screenshot({ path: out + '/failure.png', fullPage: true }); fs.writeFileSync(out + '/failure.json', JSON.stringify({ checks, errors, text: await page.$eval('body', el => el.textContent) })); throw e }
finally { await browser.close() }
