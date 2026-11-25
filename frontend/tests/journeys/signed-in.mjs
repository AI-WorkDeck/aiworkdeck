#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Signed-in first-user journeys against a staging stack (QA lane; Mac mini staging, readiness/staging/MACMINI.md).
// Needs a seeded staging account and a desktop backend whose account link points at the staging website
// (AI_ACCOUNT_BASE_URL=<site origin>), plus `npx uni` (or any H5 build) for the desktop UI.
//
// Per locale (en-US / zh-CN / zh-TW), starting signed out:
//   D1  the first question on the welcome page opens the sign-in sheet; signing in there closes it, sends the
//       question that was typed, and a real AI reply lands in the chat, in the UI language.
//   D2  Settings › AI Settings now lists models (no "connect your account" warning).
//   W1  the website's account page signs in with the same credentials and shows the account.
// AI cost: one short turn per locale. The run never creates, buys or deletes anything; it signs the desktop
// backend out before and after each locale.
//
// Env (credentials only via env, never argv):
//   SIGNED_IN_BASE      H5 origin of the desktop UI            (default http://127.0.0.1:5174)
//   SIGNED_IN_BACKEND   desktop backend linked to staging      (default http://127.0.0.1:9696)
//   SIGNED_IN_SITE      staging website origin                 (required)
//   SIGNED_IN_LOGIN     phone (cn site) or email of a seeded account (required)
//   SIGNED_IN_PASSWORD  its password                           (required)
//   PUPPETEER_EXECUTABLE_PATH, SIGNED_IN_OUT (screenshots + report.json), SIGNED_IN_LOCALES, SIGNED_IN_IGNORE_HTTPS=1 for a local CA
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const BASE = process.env.SIGNED_IN_BASE || 'http://127.0.0.1:5174'
const BACKEND = process.env.SIGNED_IN_BACKEND || 'http://127.0.0.1:9696'
const SITE = process.env.SIGNED_IN_SITE
const LOGIN = process.env.SIGNED_IN_LOGIN
const PASSWORD = process.env.SIGNED_IN_PASSWORD
const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH
const OUT = process.env.SIGNED_IN_OUT || path.join(os.tmpdir(), 'signed-in-out')
const LOCALES = (process.env.SIGNED_IN_LOCALES || 'en-US,zh-CN,zh-TW').split(',')
for (const [k, v] of Object.entries({ SIGNED_IN_SITE: SITE, SIGNED_IN_LOGIN: LOGIN, SIGNED_IN_PASSWORD: PASSWORD, PUPPETEER_EXECUTABLE_PATH: CHROME })) {
  if (!v) { console.error(`${k} is required`); process.exit(2) }
}

const QUESTION = {
  'en-US': 'In one sentence, what is a force majeure clause?',
  'zh-CN': '用一句话解释什么是不可抗力条款。',
  'zh-TW': '用一句話解釋什麼是不可抗力條款。',
}
const SITE_LANG = { 'en-US': 'en', 'zh-CN': 'zh', 'zh-TW': 'zh-hant' }
const SIMPLIFIED_ONLY = '这们个设项语览开关录务计档发应实时间进显为与无会认证账户编辑选择删换页单帮种签网络云题话历类级达动态后说请输从对还没让给过现点击费将该样导识规则'
const CJK = /[㐀-鿿]/g
const MODEL_WARNING = /requires a connected account|需要连接账户|需要連接帳戶|temporarily unavailable|暂不可用|暫不可用/

/** Reply-language check: en-US mostly Latin, zh-CN mostly CJK, zh-TW CJK with no Simplified-only characters. */
function replyLanguageProblem(locale, text) {
  const cjk = (text.match(CJK) || []).length
  const letters = (text.match(/[A-Za-z]/g) || []).length
  if (locale === 'en-US') return cjk > 0 ? `English UI, reply contains ${cjk} CJK characters` : ''
  if (cjk < letters) return `Chinese UI, reply is mostly Latin (${cjk} CJK vs ${letters} letters)`
  if (locale === 'zh-TW') {
    const s = [...new Set([...text].filter((ch) => SIMPLIFIED_ONLY.includes(ch)))]
    if (s.length) return `zh-TW UI, reply contains Simplified-only characters: ${s.join('')}`
  }
  return ''
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const api = (p, init) => fetch(BACKEND + p, init).then((r) => r.json())
const signOutDesktop = () => api('/api/account/disconnect', { method: 'POST' }).catch(() => null)
const failures = []
const report = {}

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1440, height: 900 },
  acceptInsecureCerts: process.env.SIGNED_IN_IGNORE_HTTPS === '1',
})
try {
  for (const locale of LOCALES) {
    const dir = path.join(OUT, locale)
    fs.mkdirSync(dir, { recursive: true })
    await signOutDesktop()
    const ctx = await browser.createBrowserContext()
    const page = await ctx.newPage()
    const r = (report[locale] = { steps: [] })
    await page.evaluateOnNewDocument((api, lang) => {
      window.checkbaDesktop = { apiBaseUrl: api, shell: { openExternal: () => Promise.resolve() }, menu: { onAction: () => {} } }
      localStorage.setItem('app_language', lang)
    }, BACKEND, locale)
    const clickCenter = async (handle) => {
      const box = await handle.boundingBox()
      if (!box) throw new Error('element not visible')
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    }
    const step = async (name, fn) => {
      const t0 = Date.now()
      const s = { name, ok: true }
      try { Object.assign(s, (await fn()) || {}) } catch (e) { s.ok = false; s.error = String(e).slice(0, 400) }
      s.ms = Date.now() - t0
      await page.screenshot({ path: path.join(dir, name + (s.ok ? '' : '-FAIL') + '.png') }).catch(() => {})
      r.steps.push(s)
      if (!s.ok) failures.push(`${locale} ${name}: ${s.error}`)
      console.log(`${s.ok ? '  ✓' : '  ✗'} ${locale} ${name} (${s.ms} ms)${s.note ? ' — ' + s.note : ''}`)
      return s.ok
    }

    const signedIn = await step('D1-first-question-sign-in-and-reply', async () => {
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.welcome-pane textarea', { timeout: 45000 })
      await clickCenter(await page.$('.welcome-pane textarea'))
      await page.keyboard.type(QUESTION[locale])
      await page.keyboard.press('Enter')
      await page.waitForSelector('.awd-login-mask input[type=password]', { visible: true, timeout: 20000 })
      // cn site asks for a phone number (type=tel), intl for an email
      const id = await page.$('.awd-login-mask input[type=tel]') || await page.$('.awd-login-mask input[type=email]')
      if (!id) throw new Error('sign-in sheet has neither a phone nor an email field')
      await clickCenter(id)
      await page.keyboard.type(LOGIN)
      await clickCenter(await page.$('.awd-login-mask input[type=password]'))
      await page.keyboard.type(PASSWORD)
      for (const mark of await page.$$('.awd-login-mask .consent-row .consent-mark')) await clickCenter(mark) // not the row centre: it may hold a link
      const unchecked = await page.$$eval('.awd-login-mask .consent-row', (rows) => rows.filter((r) => r.getAttribute('aria-checked') !== 'true').length)
      if (unchecked) throw new Error(`${unchecked} consent box(es) still unchecked after clicking`)
      const t0 = Date.now()
      await clickCenter(await page.$('.awd-login-mask .unlock-btn'))
      // the mask is position:fixed, so offsetParent can't tell visibility; use its box and style
      await page.waitForFunction(() => {
        const m = document.querySelector('.awd-login-mask')
        if (!m) return true
        const b = m.getBoundingClientRect()
        const cs = getComputedStyle(m)
        return b.width === 0 || b.height === 0 || cs.display === 'none' || cs.visibility === 'hidden'
      }, { timeout: 30000 })
      const signInMs = Date.now() - t0
      const status = await api('/api/account/status')
      if (!status?.data?.connected) throw new Error('sheet closed but the desktop backend is not connected: ' + JSON.stringify(status))
      // the typed question is sent by itself after sign-in; wait for a finished assistant reply
      await page.waitForFunction((q) => [...document.querySelectorAll('.message-row.user')].some((e) => e.innerText.includes(q)), { timeout: 30000 }, QUESTION[locale])
      await page.waitForFunction(() => {
        const a = [...document.querySelectorAll('.message-row.assistant')].pop()
        return a && a.innerText.trim().length > 15 && !document.querySelector('.stop-btn')
      }, { timeout: 180000, polling: 1000 })
      const replyMs = Date.now() - t0
      const reply = await page.evaluate(() => [...document.querySelectorAll('.message-row.assistant')].pop().innerText.trim())
      r.reply = reply.slice(0, 400)
      if (/执行中断|執行中斷|Execution (was )?interrupted|Stream Error|Connection reset/i.test(reply)) {
        throw new Error('the AI turn ended with an error instead of an answer: ' + reply.split('\n')[0].slice(0, 160))
      }
      const problem = replyLanguageProblem(locale, reply.split('\n')[0])
      if (problem) throw new Error(problem + ': ' + reply.slice(0, 120))
      return { note: `signed in ${signInMs} ms, reply after ${replyMs} ms`, signInMs, replyMs }
    })
    if (signedIn) {
      await step('D2-ai-settings-lists-models', async () => {
        await page.goto(BASE + '/#/pages/admin/admin', { waitUntil: 'domcontentloaded' })
        await page.waitForSelector('.nav-item', { timeout: 30000 })
        await sleep(2500)
        const text = await page.evaluate(() => document.body.innerText)
        const m = text.match(MODEL_WARNING)
        if (m) throw new Error('signed in, but AI Settings still says: ' + m[0])
      })
    }
    await signOutDesktop()

    await step('W1-website-account-sign-in', async () => {
      const site = await ctx.newPage()
      try {
        await site.goto(`${SITE}/${SITE_LANG[locale]}/account`, { waitUntil: 'networkidle2', timeout: 90000 })
        await site.waitForSelector('input[type=password]', { visible: true, timeout: 30000 })
        await (await site.$('input:not([type]), input[type=text], input[type=tel], input[type=email]')).type(LOGIN)
        await (await site.$('input[type=password]')).type(PASSWORD)
        const agree = await site.$('input[type=checkbox]')
        if (agree && !(await agree.evaluate((e) => e.checked))) await agree.click()
        await (await site.$('button[type=submit]')).click()
        await site.waitForFunction(() => !document.querySelector('input[type=password]'), { timeout: 30000 })
        await sleep(1500)
        await site.screenshot({ path: path.join(dir, 'W1-website-account.png') })
        const text = await site.evaluate(() => document.body.innerText)
        if (locale === 'en-US' && /[登录賬帳戶余額餘额]/.test(text.split('\n').slice(0, 40).join(''))) {
          return { note: 'signed in; Chinese words in the first screen of the English account page (check screenshot)' }
        }
      } finally {
        await site.close()
      }
    })
    await ctx.close()
  }
} finally {
  await signOutDesktop()
  await browser.close()
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
}

console.log(`\nsigned-in journeys: ${failures.length ? failures.length + ' failure(s)' : 'all passed'}; screenshots in ${OUT}`)
for (const f of failures) console.log('  - ' + f)
process.exit(failures.length ? 1 : 0)
