// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real desktop workbench rendering with synthetic intercepted HTTP; never uses a real account/backend.
import puppeteer from 'puppeteer-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const base = process.env.MOBILE_BACKUP_UI_BASE || 'http://127.0.0.1:5198'
const out = process.env.MOBILE_BACKUP_UI_OUT || '/tmp/awd-mobile-backup-ui-1208'
fs.mkdirSync(out, { recursive: true })
const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'] })
const results = []
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' }
async function fixture(initial = {}) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1360, height: 900 })
  let state = { available: true, enabled: false, decided: false, subscriptionActive: true, consentVersion: '2026-10-11', accountScope: 'synthetic-account-a', ...initial }
  let failSave = false, holdGet = false, holdPut = false
  const pendingGets = [], pendingPuts = [], puts = [], errors = []
  const respond = (req, body, status = 200) => req.respond({ status, contentType: 'application/json', headers, body: JSON.stringify(body) })
  page.on('pageerror', error => errors.push(error.message))
  await page.evaluateOnNewDocument(() => {
    if (location.protocol !== 'about:') localStorage.setItem('awd_app_language', 'zh-CN')
    window.checkbaDesktop = { ocr: {}, shell: { openExternal() {} } }
  })
  await page.setRequestInterception(true)
  page.on('request', async req => {
    const url = new URL(req.url())
    if (!url.pathname.startsWith('/api/')) {
      if (url.origin !== new URL(base).origin && !['data:', 'blob:', 'about:'].includes(url.protocol)) return req.abort()
      return req.continue()
    }
    if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers })
    if (url.pathname === '/api/mobile-receive/backup-consent') {
      if (req.method() === 'GET') {
        const snapshot = { ...state }
        if (holdGet) { pendingGets.push(() => respond(req, snapshot)); return }
        return respond(req, snapshot)
      }
      const input = JSON.parse(req.postData()); puts.push(input)
      if (failSave) return respond(req, { code: 1, message: 'Synthetic network failure' }, 503)
      const next = { ...state, ...input, decided: true }
      if (holdPut) { pendingPuts.push(() => respond(req, next)); return }
      state = next
      return respond(req, next)
    }
    const project = { id: 42, name: '备份合成项目', projectName: '备份合成项目', userId: 7, localRoot: '/synthetic/备份', projectType: 'BLANK' }
    let body = []
    if (url.pathname === '/api/projects/42') body = project
    else if (url.pathname === '/api/projects/my') body = [project]
    else if (url.pathname === '/api/auth/me') body = { id: 7, username: 'synthetic' }
    else if (url.pathname === '/api/mobile-receive/status') body = { active: false, items: [] }
    else if (url.pathname.includes('/license/status')) body = { mode: 'none', accountConnected: false }
    else if (url.pathname === '/api/account/status') body = { connected: false }
    else if (url.pathname.includes('/version/status')) body = { enabled: false }
    else if (url.pathname.includes('/profile') || url.pathname.includes('/admin/config')) body = {}
    await respond(req, body)
  })
  await page.goto(base + '/#/pages/project-overview/project-overview?id=42', { waitUntil: 'networkidle0' })
  await page.waitForSelector('.backup-trigger', { visible: true })
  return { page, puts, errors, get state() { return state }, setState(next) { state = { ...state, ...next } },
    failSave(value) { failSave = value }, holdGet(value) { holdGet = value }, holdPut(value) { holdPut = value },
    pendingGets, pendingPuts }
}
async function clickButton(page, text) {
  const buttons = await page.$$('.backup-actions > *')
  for (const button of buttons) {
    if ((await button.evaluate(el => el.textContent)).trim() === text) { await button.click(); return }
  }
  throw Error('Missing backup button: ' + text)
}
async function scenario(name, run) {
  try { await run(); results.push({ name, passed: true }) }
  catch (error) { results.push({ name, passed: false, error: error.message }) }
}
try {
  await scenario('large-file backup pending is visible and keeps local-first explanation', async () => {
    const f = await fixture({ enabled: true, decided: true,
      objectBackup: { state: 'pending', pendingObjects: 2, lastError: '云端空间不足，本地版本已保留' } })
    try {
      assert.match(await f.page.$eval('.backup-trigger', el => el.textContent), /待同步/)
      await f.page.click('.backup-trigger')
      await f.page.waitForSelector('.backup-dialog', { visible: true })
      const text = await f.page.$eval('.backup-dialog', el => el.textContent)
      assert.match(text, /大文件和音视频的历史版本/)
      assert.match(text, /断网或云空间不足不影响本地保存/)
      assert.match(text, /云端空间不足/)
      assert.match(text, /保留本机文件和本地版本/)
      await f.page.screenshot({ path: out + '/large-file-pending-light.png' })
      await f.page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
      await f.page.screenshot({ path: out + '/large-file-pending-dark.png' })
      assert.deepEqual(f.errors, [])
    } finally { await f.page.close() }
  })
  await scenario('first explicit decline persists false and keeps local workbench usable', async () => {
    const f = await fixture()
    try {
      await f.page.waitForSelector('.backup-dialog', { visible: true })
      await f.page.screenshot({ path: out + '/first-consent.png' })
      assert.doesNotMatch(await f.page.$eval('.backup-dialog', el => el.textContent), /已同意备份/)
      await clickButton(f.page, '暂不开启')
      await f.page.waitForSelector('.backup-dialog', { hidden: true })
      assert.equal(f.puts.length, 1); assert.equal(f.puts[0].enabled, false)
      assert.equal(f.state.decided, true)
      assert.ok(await f.page.$('.page-project-overview'))
      assert.deepEqual(f.errors, [])
    } finally { await f.page.close() }
  })
  await scenario('explicit enable then settings disable', async () => {
    const f = await fixture()
    try {
      await clickButton(f.page, '同意并开启')
      await f.page.waitForSelector('.backup-dialog', { hidden: true })
      assert.equal(f.state.enabled, true)
      await f.page.click('.backup-trigger')
      await f.page.waitForSelector('.backup-dialog', { visible: true })
      await clickButton(f.page, '关闭云端备份')
      await f.page.waitForSelector('.backup-dialog', { hidden: true })
      assert.deepEqual(f.puts.map(x => x.enabled), [true, false])
      assert.equal(f.state.enabled, false)
    } finally { await f.page.close() }
  })
  await scenario('non-subscriber has explanation, subscribe link, and no direct enable action', async () => {
    const f = await fixture({ subscriptionActive: false })
    try {
      const text = await f.page.$eval('.backup-dialog', el => el.textContent)
      assert.match(text, /需要有效订阅/)
      assert.match(text, /前往开通订阅/)
      assert.doesNotMatch(text, /是否开启文件云端备份/)
      assert.doesNotMatch(text, /同意并开启/)
      await clickButton(f.page, '暂不开启')
      await f.page.waitForSelector('.backup-dialog', { hidden: true })
      assert.equal(f.puts[0].enabled, false)
    } finally { await f.page.close() }
  })
  await scenario('failed consent write remains undecided and can dismiss without blocking local work', async () => {
    const f = await fixture()
    try {
      f.failSave(true)
      await clickButton(f.page, '同意并开启')
      await f.page.waitForSelector('.backup-error', { visible: true })
      assert.equal(f.state.decided, false); assert.equal(f.state.enabled, false)
      await f.page.screenshot({ path: out + '/network-error.png' })
      await clickButton(f.page, '暂不开启')
      await f.page.waitForSelector('.backup-dialog', { hidden: true })
      assert.equal(f.puts.length, 1)
      assert.ok(await f.page.$('.page-project-overview'))
    } finally { await f.page.close() }
  })
  await scenario('account change ignores the previous account late save response', async () => {
    const f = await fixture()
    try {
      f.holdPut(true)
      await clickButton(f.page, '同意并开启')
      await f.page.waitForFunction(() => document.querySelector('.backup-actions > *').hasAttribute('disabled') || document.querySelector('.backup-actions > *').classList.contains('uni-button-disabled'))
      assert.equal(f.pendingPuts.length, 1)
      f.setState({ accountScope: 'synthetic-account-b', enabled: false, decided: true, subscriptionActive: false })
      await f.page.evaluate(() => window.dispatchEvent(new CustomEvent('awd:account-changed')))
      await f.page.waitForSelector('.backup-dialog', { hidden: true })
      await f.pendingPuts.shift()()
      await new Promise(resolve => setTimeout(resolve, 100))
      await f.page.waitForFunction(() => document.querySelector('.backup-trigger')?.textContent.includes('未开启'))
      await f.page.click('.backup-trigger')
      await f.page.waitForSelector('.backup-dialog', { visible: true })
      assert.doesNotMatch(await f.page.$eval('.backup-dialog', el => el.textContent), /同意并开启|关闭云端备份/)
    } finally { await f.page.close() }
  })
  await scenario('account change ignores the previous account late GET response', async () => {
    const f = await fixture({ enabled: true, decided: true })
    try {
      f.holdGet(true)
      await f.page.click('.backup-trigger')
      await f.page.waitForSelector('.backup-dialog', { visible: true })
      assert.equal(f.pendingGets.length, 1)
      f.holdGet(false)
      f.setState({ accountScope: 'synthetic-account-b', enabled: false, decided: false, subscriptionActive: false })
      await f.page.evaluate(() => window.dispatchEvent(new CustomEvent('awd:account-changed')))
      await f.page.waitForFunction(() => document.querySelector('.backup-dialog')?.textContent.includes('需要有效订阅'))
      await f.pendingGets.shift()()
      await new Promise(resolve => setTimeout(resolve, 100))
      await f.page.waitForFunction(() => document.querySelector('.backup-trigger')?.textContent.includes('未开启'))
      assert.doesNotMatch(await f.page.$eval('.backup-dialog', el => el.textContent), /同意并开启|关闭云端备份/)
    } finally { await f.page.close() }
  })
  await scenario('keyboard Tab reaches consent actions within the dialog', async () => {
    const f = await fixture()
    try {
      await f.page.waitForSelector('.backup-dialog', { visible: true })
      await f.page.focus('.backup-dialog')
      await f.page.keyboard.press('Tab')
      const focus = await f.page.evaluate(() => ({ tag: document.activeElement.tagName,
        inActions: !!document.activeElement.closest('.backup-actions'),
        nativeButtons: document.querySelectorAll('.backup-dialog button').length,
        uniButtons: document.querySelectorAll('.backup-dialog uni-button').length }))
      assert.equal(focus.inActions, true, JSON.stringify(focus))
      await f.page.keyboard.press('Enter')
      await f.page.waitForSelector('.backup-dialog', { hidden: true })
      assert.equal(f.puts.length, 1)
      assert.equal(f.puts[0].enabled, false)
    } finally { await f.page.close() }
  })
  await scenario('late settings GET does not revert the just-saved decision', async () => {
    const f = await fixture({ enabled: true, decided: true })
    try {
      f.holdGet(true)
      await f.page.click('.backup-trigger')
      await f.page.waitForSelector('.backup-dialog', { visible: true })
      assert.equal(f.pendingGets.length, 1)
      await clickButton(f.page, '关闭云端备份')
      await f.page.waitForSelector('.backup-dialog', { hidden: true })
      assert.equal(f.state.enabled, false)
      await f.pendingGets.shift()()
      await new Promise(resolve => setTimeout(resolve, 100))
      await f.page.waitForFunction(() => document.querySelector('.backup-trigger')?.textContent.includes('未开启'), { timeout: 1500 })
    } finally { await f.page.close() }
  })
} finally {
  fs.writeFileSync(out + '/results.json', JSON.stringify(results, null, 2))
  await browser.close()
}
console.log(JSON.stringify({ results, screenshotDirectory: out }, null, 2))
if (results.some(result => !result.passed)) process.exitCode = 1
