// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real task pane with blocked third-party verification and synthetic account APIs.
import puppeteer from 'puppeteer-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const out = process.env.AUTH_UI_OUT || '/tmp/awd-compatible-auth-ui'
fs.mkdirSync(out, { recursive: true })
const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: true })
const image = process.env.CAPTCHA_PNG ? 'data:image/png;base64,' + fs.readFileSync(process.env.CAPTCHA_PNG).toString('base64') : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZQ0AAAAASUVORK5CYII='
const calls = [], errors = []
let rejectCode = false, rejectChallenge = false, sequence = 0
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 360, height: 1000 })
  page.on('pageerror', e => errors.push(e.message))
  await page.evaluateOnNewDocument(() => localStorage.setItem('awd_addin_lang', 'zh'))
  await page.setRequestInterception(true)
  page.on('request', async req => {
    const url = new URL(req.url())
    if (url.pathname.startsWith('/api/')) {
      const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }
      if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers })
      const body = req.postData() ? JSON.parse(req.postData()) : {}
      calls.push({ path: url.pathname, body })
      let data = { ok: true }, code = 0, message = ''
      if (url.pathname.includes('captcha-config')) data = { provider: 'aliyun', sceneId: 'synthetic', prefix: 'synthetic', accountIdentity: 'phone' }
      else if (url.pathname.endsWith('/captcha-challenge')) {
        if (rejectChallenge) return req.abort('failed')
        data = { id: 'fixture-' + (++sequence), image, expiresAt: Date.now() + 180000 }
      } else if (url.pathname.endsWith('/send-code') && rejectCode) { code = 1; message = '安全验证失败，请更换图片后重试' }
      else if (url.pathname.endsWith('/my')) data = []
      return req.respond({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ code, data, message }) })
    }
    if (url.hostname !== '127.0.0.1' && url.protocol.startsWith('http')) return req.abort('blockedbyclient')
    return req.continue()
  })
  const click = async text => {
    for (const button of await page.$$('button')) if ((await button.evaluate(e => e.textContent.trim())) === text) { await button.click(); return }
    throw new Error('Missing action: ' + text)
  }
  await page.goto((process.env.ADDIN_AUTH_UI_BASE || 'http://127.0.0.1:3199') + '/taskpane.html', { waitUntil: 'networkidle0' })
  await page.click('.login-btn')
  await click('首次使用 / 创建密码')
  await page.type('input[type="tel"]', '13800138000')
  await click('获取验证码')
  await page.waitForFunction(() => document.body.textContent.includes('安全验证组件无法加载'))
  assert.equal(calls.filter(c => c.path.endsWith('/send-code')).length, 0)
  await click('使用兼容验证')
  await page.waitForSelector('.compatible-image-row img')
  await page.type('.compatible-verification input', 'ABCD12')
  rejectCode = true
  await click('获取验证码')
  await page.waitForFunction(() => document.body.textContent.includes('安全验证失败，请更换图片'))
  assert.equal(await page.$('.compatible-image-row img'), null, 'failed challenge must be discarded')
  assert.equal(calls.find(c => c.path.endsWith('/send-code')).body.captchaToken, 'local:fixture-1:ABCD12')
  rejectCode = false
  await click('使用兼容验证')
  await page.waitForSelector('.compatible-image-row img')
  await page.type('.compatible-verification input', 'BCDE23')
  await page.screenshot({ path: out + '/addin-compatible.png', fullPage: true })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'narrow pane must not overflow')
  await click('获取验证码')
  await page.waitForFunction(() => document.body.textContent.includes('验证码已发送'))
  assert.equal(calls.filter(c => c.path.endsWith('/send-code')).length, 2)
  // Fresh page avoids the real resend cooldown; recovery requests use a distinct purpose.
  await page.reload({ waitUntil: 'networkidle0' })
  await page.click('.login-btn')
  await click('忘记密码')
  await page.type('input[type="tel"]', '13800138000')
  await click('使用兼容验证')
  await page.waitForSelector('.compatible-image-row img')
  assert.equal(calls.filter(c => c.path.endsWith('/captcha-challenge')).at(-1).body.purpose, 'reset')
  await page.type('.compatible-verification input', 'CDEF34')
  await click('获取验证码')
  await page.waitForFunction(() => document.body.textContent.includes('验证码已发送'))
  assert.ok(calls.some(c => c.path.endsWith('/password/reset/send-code') && c.body.captchaToken === 'local:fixture-3:CDEF34'))
  await page.reload({ waitUntil: 'networkidle0' }); await page.click('.login-btn'); await click('首次使用 / 创建密码')
  await page.type('input[type="tel"]', '13800138000')
  rejectChallenge = true
  await click('使用兼容验证')
  await page.waitForFunction(() => document.querySelector('.status.error')?.textContent.includes('后端'))
  await page.screenshot({ path: out + '/addin-network-error.png', fullPage: true })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, screenshots: out, requests: calls.map(c => c.path) }))
} finally { await browser.close() }
