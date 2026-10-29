// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real workbench, account entry, request interceptor and login dialog; synthetic API only.
import puppeteer from 'puppeteer-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const compiled = process.env.ACCOUNT_UI_COMPILED === '1'
const base = process.env.ACCOUNT_UI_BASE || 'http://127.0.0.1:5243'
const out = process.env.ACCOUNT_UI_OUT || '/tmp/awd-session-expiry-1623'
fs.mkdirSync(out, { recursive: true })
const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage()
const errors = [], calls = []
let expired = compiled, rejectLogin = false, localOpAttempts = 0, meetingState = 'TRANSCRIBING'
page.on('pageerror', e => errors.push(e.message))
await page.setViewport({ width: 1440, height: 950 })
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('awd_app_language', 'zh-CN')
  localStorage.setItem('awd_site_preselected', '1')
  window.checkbaDesktop = { platform: 'darwin', apiBaseUrl: 'http://127.0.0.1:19999', shell: { openExternal() {} }, model: { status: async () => ({ components: [] }) } }
})
await page.setRequestInterception(true)
page.on('request', async request => {
  const url = new URL(request.url())
  if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin || ['data:', 'blob:'].includes(url.protocol) ? request.continue() : request.abort()
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }
  if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers })
  calls.push(url.pathname)
  let data = {}, raw = false, code = 0
  if (url.pathname === '/api/account/status' || url.pathname === '/api/account/balance') data = { connected: !expired, authExpired: expired, displayName: 'Synthetic QA', available: true, balanceCents: 100 }
  else if (url.pathname === '/api/license/status') { raw = true; data = { unlocked: true, mode: 'account', accountConnected: !expired, trialCodeEnabled: false } }
  else if (url.pathname === '/api/auth/me') data = { id: 7, username: 'synthetic', displayName: 'Synthetic QA', isAdmin: true }
  else if (url.pathname === '/api/site') { raw = true; data = { current: 'cn', pinned: true, multiSite: false, sites: [] } }
  else if (url.pathname.includes('captcha-config')) data = { provider: null }
  else if (url.pathname === '/api/account/login') {
    if (rejectLogin) { raw = true; data = { code: 1, kind: 'UNAUTHORIZED', message: 'Synthetic wrong password' } }
    else { expired = false; data = { connected: true, isNewUser: false } }
  } else if (url.pathname === '/api/projects/open-local') { localOpAttempts++; code = request.headers()['x-session-id'] ? 4010 : 0; data = { id: 7 } }
  else if (url.pathname === '/api/meetings/77') { raw = true; data = { id: 77, status: meetingState, transcriptionMode: 'platform' } }
  else if (url.pathname === '/api/entitlements') data = { features: {}, entitlements: [] }
  else if (url.pathname === '/api/account/trial/balance' || url.pathname === '/api/trial/balance') data = { connected: !expired, available: false }
  else if (/projects$|plugins$|recordings$|list$|members$|sessions$/.test(url.pathname)) data = []
  else if (url.pathname.includes('message-center')) data = { sources: [], conversations: [], unreadCount: 0 }
  const body = raw ? data : { code, data }
  return request.respond({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(body) })
})
try {
  await page.goto(base + '/#/pages/project-overview/project-overview', { waitUntil: 'domcontentloaded' })
  if (!compiled) await page.waitForSelector('.avatar-btn', { timeout: 60000 })
  const originalHash = await page.evaluate(() => location.hash)
  if (!compiled) {
  // A stale local token must recover folder opening without logging out a valid cloud account.
  const opened = await page.evaluate(async () => {
    uni.setStorageSync('checkba_session_id', 'synthetic-stale-session')
    const api = await import('/src/services/api.js')
    return api.openLocalProject({ localRoot: '/synthetic/folder' })
  })
  assert.equal(opened.data.id, 7)
  assert.equal(localOpAttempts, 2)
  assert.notEqual(await page.$('.avatar-btn'), null)
  assert.equal(await page.$('#awd-account-login-host .unlock-card'), null)
  // An asynchronous ASR poll can retain TRANSCRIBING after the upstream key is rejected.
  expired = true
  await page.evaluate(async () => { const api = await import('/src/services/api.js'); await api.getMeetingRecording(77) })
  }
  await page.waitForSelector('#awd-account-login-host .unlock-card', { timeout: 60000 })
  assert.match(await page.$eval('.awd-login-reason', e => e.textContent), /登录已过期/)
  assert.equal(await page.$('.avatar-btn'), null)
  assert.match(await page.$eval('.header-login-btn', e => e.textContent), /登录已过期/)
  await page.screenshot({ path: out + '/expired-dialog.png', fullPage: true })
  await page.click('.awd-login-close')
  await page.waitForSelector('#awd-account-login-host .unlock-card', { hidden: true })
  if (!compiled) await page.evaluate(async () => { const api = await import('/src/services/api.js'); await Promise.all([api.getAccountStatus(), api.getAccountStatus()]) })
  assert.equal(await page.$('#awd-account-login-host .unlock-card'), null)
  assert.match(await page.$eval('.header-login-btn', e => e.textContent), /登录已过期/)
  await page.screenshot({ path: out + '/expired-persistent.png', fullPage: true })
  await page.click('.header-login-btn')
  await page.waitForSelector('#awd-account-login-host .unlock-card')
  await page.type('.unlock-card input[type="tel"]', '13800138000')
  await page.type('.unlock-card input[type="password"]', 'synthetic-password')
  for (const el of await page.$$('.consent-row')) if (await el.evaluate(e => e.getAttribute('aria-checked') !== 'true')) await (await el.$('.consent-mark')).click()
  rejectLogin = true
  await page.click('.unlock-card .unlock-btn')
  await page.waitForFunction(() => document.body.textContent.includes('Synthetic wrong password'))
  assert.equal((await page.$$('#awd-account-login-host .unlock-card')).length, 1)
  rejectLogin = false
  await page.click('.unlock-card .unlock-btn')
  await page.waitForSelector('.avatar-btn')
  assert.equal(await page.$('#awd-account-login-host .unlock-card'), null)
  assert.equal(await page.evaluate(() => location.hash), originalHash)
  await page.screenshot({ path: out + '/recovered.png', fullPage: true })
  if (!compiled) {
  // A failed background submission uses the same path, including the voice plugin's host facade.
  expired = true; meetingState = 'FAILED'
  await page.evaluate(async () => { const api = await import('/src/services/api.js'); await api.getMeetingRecording(77) })
  await page.waitForSelector('#awd-account-login-host .unlock-card')
  assert.equal(await page.$('.avatar-btn'), null)
  await page.click('.awd-login-close')
  }
  fs.writeFileSync(out + '/report.json', JSON.stringify({ compiled, scope: 'Real workbench + synthetic API; no real account, audio upload or paid services', calls, errors }, null, 2))
  assert.deepEqual(errors, [])
} catch (error) {
  await page.screenshot({ path: out + '/failure.png', fullPage: true })
  fs.writeFileSync(out + '/failure.json', JSON.stringify({ error: String(error), errors, calls, text: await page.$eval('body', e => e.innerText) }, null, 2))
  throw error
} finally { await browser.close() }
