// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import puppeteer from 'puppeteer-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const base = process.env.ACCOUNT_UI_BASE || 'http://127.0.0.1:5217'
const out = process.env.ACCOUNT_UI_OUT || '/tmp/awd-admin-account-1415'
fs.mkdirSync(out, { recursive: true })
const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage()
let statusMode = 'pending', requests = 0
const errors = []
page.on('pageerror', e => errors.push(e.message))
await page.setViewport({ width: 1440, height: 1100 })
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('awd_app_language', 'zh-CN')
  localStorage.setItem('checkba_user', JSON.stringify({ type: 'object', data: { id: 7, username: 'synthetic', isAdmin: true } }))
  window.checkbaDesktop = { platform: 'darwin', model: { status: async () => ({ components: [] }) } }
})
await page.setRequestInterception(true)
page.on('request', async request => {
  const url = new URL(request.url())
  if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin || ['data:', 'blob:'].includes(url.protocol) ? request.continue() : request.abort()
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }
  if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers })
  let body = {}
  if (url.pathname === '/api/account/status') {
    requests++
    while (statusMode === 'pending') await new Promise(resolve => setTimeout(resolve, 20))
    if (statusMode === 'failed') return request.respond({ status: 503, headers, contentType: 'application/json', body: JSON.stringify({ code: 1, message: 'Synthetic temporary failure' }) })
    body = { code: 0, data: { connected: statusMode === 'connected', displayName: '合成已登录用户', platformAiAvailable: false } }
  } else if (url.pathname === '/api/auth/me') body = { code: 0, data: { id: 7, username: 'synthetic', displayName: '合成用户', isAdmin: true } }
  else if (url.pathname === '/api/account/usage') body = { code: 0, data: { rows: [], platform: {} } }
  else if (url.pathname.includes('list') || url.pathname.includes('members')) body = []
  return request.respond({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(body) })
})
const bodyText = () => page.$eval('body', el => el.textContent)
try {
  await page.goto(base + '/#/pages/admin/admin?nav=account', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.body.textContent.includes('正在确认登录状态'))
  assert.doesNotMatch(await bodyText(), /登录 AI WorkDeck 账户|未登录：手机端同步/)
  statusMode = 'connected'
  await page.waitForSelector('.account-card')
  assert.match(await bodyText(), /合成已登录用户/)
  assert.equal(await page.$('.wallet-main') !== null, true)
  assert.equal(await page.$('.account-login-btn'), null)
  await page.screenshot({ path: out + '/connected.png', fullPage: true })
  statusMode = 'failed'
  await page.evaluate(() => uni.$emit('awd:account-changed', { connected: true }))
  await page.waitForFunction(() => document.body.textContent.includes('暂时无法确认登录状态'))
  assert.equal(await page.$('.account-login-btn'), null)
  statusMode = 'connected'
  await page.evaluate(() => [...document.querySelectorAll('.comp-btn')].find(el => el.textContent.includes('重新获取')).click())
  await page.waitForSelector('.account-card')
  statusMode = 'disconnected'
  await page.evaluate(() => uni.$emit('awd:account-changed', { connected: false }))
  await page.waitForSelector('.account-login-btn')
  assert.equal(await page.$('.account-card'), null)
  assert.deepEqual(errors, [])
  fs.writeFileSync(out + '/report.json', JSON.stringify({ requests, errors, scope: 'Real AdminPane route, account event, loading/error/retry/disconnected; synthetic API, no user account' }, null, 2))
} finally { statusMode = 'disconnected'; await browser.close() }
