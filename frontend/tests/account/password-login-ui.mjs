// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real Vue components, isolated browser and synthetic APIs; no live accounts or SMS.
import puppeteer from 'puppeteer-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const out = process.env.AUTH_UI_OUT || '/tmp/awd-auth-ui'
fs.mkdirSync(out, { recursive: true })
const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: true })
const calls = []
const errors = []
try {
  const page = await browser.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewport({ width: 420, height: 1000 })
  await page.evaluateOnNewDocument(() => { localStorage.setItem('awd_addin_lang', 'zh') })
  await page.setRequestInterception(true)
  page.on('request', async req => {
    const url = new URL(req.url())
    if (url.pathname.startsWith('/api/')) {
      if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'} })
      const body = req.postData() ? JSON.parse(req.postData()) : {}
      calls.push({ path: url.pathname, body })
      let data = {}
      if (url.pathname.includes('captcha-config')) data = { provider: null, accountIdentity: 'phone' }
      else if (url.pathname.endsWith('/account-login') && body.code) data = { passwordSetupRequired: true, setupToken: 'restricted-fixture', account: body.phone, expiresAt: Date.now() + 300000 }
      else if (url.pathname.endsWith('/account-login')) data = { token: 'awdt_fixture_only' }
      else if (url.pathname.endsWith('/my')) data = []
      else data = { ok: true }
      return req.respond({ status: 200, contentType:'application/json', headers:{'Access-Control-Allow-Origin':'*'}, body:JSON.stringify({code:0,data}) })
    }
    if (url.hostname !== '127.0.0.1' && url.protocol.startsWith('http')) return req.respond({status:200,body:''})
    return req.continue()
  })
  const click = async text => {
    const buttons = await page.$$('button')
    for (const button of buttons) if ((await button.evaluate(e => e.textContent.trim())) === text) { await button.click(); return }
    throw new Error(`Missing button ${text}`)
  }
  await page.goto((process.env.ADDIN_AUTH_UI_BASE || 'http://127.0.0.1:3199') + '/taskpane.html', {waitUntil:'networkidle0'})
  await page.click('.login-btn')
  await page.waitForSelector('input[autocomplete="current-password"]')
  assert.equal(await page.$('input[autocomplete="one-time-code"]'), null, 'daily sign-in must not request a code')
  assert.equal(await page.$eval('.login-method-links', e => getComputedStyle(e).display), 'flex')
  assert.ok(await page.$eval('.login-method-links', e => parseFloat(getComputedStyle(e).columnGap) >= 12))
  await page.screenshot({path:out+'/addin-password.png',fullPage:true})
  await click('首次使用 / 创建密码')
  await page.type('input[type="tel"]','13800138000')
  await page.type('input[autocomplete="one-time-code"]','123456')
  await click('验证并继续')
  await page.waitForSelector('input[autocomplete="new-password"]')
  assert.equal(await page.evaluate(() => localStorage.getItem('awd_addin_token')), null)
  const newInputs = await page.$$('input[autocomplete="new-password"]')
  await newInputs[0].type(' unique-password ')
  await newInputs[1].type('mismatch')
  const before = calls.length
  await click('创建密码')
  await page.waitForFunction(() => document.body.textContent.includes('两次输入的密码不一致'))
  assert.equal(calls.length,before,'confirmation mismatch must not submit')
  await newInputs[1].click({clickCount:3}); await newInputs[1].type(' unique-password ')
  await page.screenshot({path:out+'/addin-setup.png',fullPage:true})
  await click('创建密码')
  await page.waitForFunction(() => !document.querySelector('.settings'))
  const setup = calls.find(c => c.path.endsWith('/password/setup'))
  assert.equal(setup.body.password,' unique-password ')
  const login = calls.find(c => c.path.endsWith('/account-login') && c.body.password)
  assert.equal(login.body.password,' unique-password ')
  assert.equal(login.body.account,'13800138000')
  assert.ok(calls.indexOf(setup) < calls.indexOf(login))
  await page.evaluate(() => localStorage.clear())
  await page.reload({waitUntil:'networkidle0'}); await page.click('.login-btn')
  await click('忘记密码')
  await page.type('input[type="tel"]','13800138000')
  await click('获取验证码')
  await page.waitForFunction(() => document.body.textContent.includes('验证码已发送'))
  assert.ok(calls.some(c => c.path.endsWith('/password/reset/send-code')))
  await page.type('input[autocomplete="one-time-code"]','654321')
  const resetInputs = await page.$$('input[autocomplete="new-password"]')
  await resetInputs[0].type('new-password-2'); await resetInputs[1].type('new-password-2')
  await click('重置密码')
  await page.waitForSelector('input[autocomplete="current-password"]')
  assert.ok(calls.some(c => c.path.endsWith('/password/reset') && c.body.code === '654321'))
  await page.screenshot({path:out+'/addin-reset-done.png',fullPage:true})
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({passed:true, screenshots:out, requests:calls.map(c=>c.path)},null,2))
} finally { await browser.close() }
