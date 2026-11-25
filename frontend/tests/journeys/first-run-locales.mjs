#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// First-run journey of a new lawyer, in en-US / zh-CN / zh-TW (QA lane, readiness POLISH Q-items).
//
// A signed-out, fresh desktop install: welcome tab -> every settings section -> plugin marketplace ->
// login page -> type a first question and press Enter (must open the sign-in sheet and keep the text).
// Every step: the page's anchor must render, no uncaught page error, and the visible text must be in the
// chosen language (en-US: no CJK; zh-TW: no Simplified-only characters; zh-CN: no Traditional-only characters).
// Known, already-filed defects live in KNOWN below with their POLISH ID; a fix must delete its entry
// (the run fails on a KNOWN entry that no longer reproduces, so the list cannot go stale).
//
// Prereqs (same as tests/app-e2e): a fresh desktop-profile backend (isolated user.home) and `npx uni` pointing at it.
// Env: JOURNEY_BASE (default http://127.0.0.1:5174), JOURNEY_BACKEND (default http://127.0.0.1:9696),
//      PUPPETEER_EXECUTABLE_PATH, JOURNEY_OUT (screenshots + report.json; default <tmp>/journeys-out).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const BASE = process.env.JOURNEY_BASE || 'http://127.0.0.1:5174'
const BACKEND = process.env.JOURNEY_BACKEND || 'http://127.0.0.1:9696'
const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH
const OUT = process.env.JOURNEY_OUT || path.join(os.tmpdir(), 'journeys-out')
const LOCALES = (process.env.JOURNEY_LOCALES || 'en-US,zh-CN,zh-TW').split(',')
if (!CHROME) { console.error('PUPPETEER_EXECUTABLE_PATH is required'); process.exit(2) }

// Characters whose Traditional and Simplified forms differ; common in UI copy.
const SIMPLIFIED_ONLY = '这们个设项语览开关录务计档发应实时间进显为与无会认证账户编辑选择删换页单帮种签网络云题话历类级达动态后说请输从对还没让给过现点击费将该样导识规则'
const TRADITIONAL_ONLY = '這們個設項語覽開關錄務計檔發應實時間進顯為與無會認證帳戶編輯選擇刪換頁單幫種簽網絡雲題話歷類級達動態後說請輸從對還沒讓給過現點擊費將該樣導識規則'
const CJK = /[㐀-鿿]/

// Lines that are user data, not product copy (the run creates nothing, but app-e2e may share a backend).
const USER_DATA = [/^QA走查_\d+/]

// Already filed in readiness/POLISH.md. step: regex on the step name; line: regex on the offending line.
const KNOWN = [
  { id: 'Q6', locale: 'zh-TW', step: /^settings-/, line: /默认版/ },
]

function wrongLanguage(locale, text) {
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean).filter((l) => !USER_DATA.some((re) => re.test(l)))
  if (locale === 'en-US') return lines.filter((l) => CJK.test(l))
  if (locale === 'zh-TW') return lines.filter((l) => [...l].some((ch) => SIMPLIFIED_ONLY.includes(ch)))
  if (locale === 'zh-CN') return lines.filter((l) => [...l].some((ch) => TRADITIONAL_ONLY.includes(ch)))
  return []
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const failures = []
const knownHit = new Set()
const report = {}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1440, height: 900 } })
try {
  for (const locale of LOCALES) {
    const dir = path.join(OUT, locale)
    fs.mkdirSync(dir, { recursive: true })
    const ctx = await browser.createBrowserContext()
    const page = await ctx.newPage()
    const r = (report[locale] = { steps: [], pageErrors: [] })
    page.on('pageerror', (e) => r.pageErrors.push({ url: page.url(), error: String(e).slice(0, 300) }))
    await page.evaluateOnNewDocument((api, lang) => {
      window.checkbaDesktop = { apiBaseUrl: api, shell: { openExternal: () => Promise.resolve() }, menu: { onAction: () => {} } }
      localStorage.setItem('app_language', lang)
    }, BACKEND, locale)

    const clickCenter = async (handle) => {
      const box = await handle.boundingBox()
      if (!box) throw new Error('element not visible')
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2) // uni @tap needs real mouse events
    }
    const step = async (name, fn, { scanSelector } = {}) => {
      const t0 = Date.now()
      const errorsBefore = r.pageErrors.length
      const s = { name, ok: true }
      let reached = false
      try {
        await fn()
        reached = true
        await sleep(600)
        const text = await page.evaluate((sel) => (sel ? document.querySelector(sel) : document.body)?.innerText || '', scanSelector || null)
        const wrong = wrongLanguage(locale, text)
        const unknown = wrong.filter((line) => {
          const k = KNOWN.find((k) => k.locale === locale && k.step.test(name) && k.line.test(line))
          if (k) knownHit.add(k.id)
          return !k
        })
        if (unknown.length) { s.ok = false; s.wrongLanguage = unknown.slice(0, 10) }
        const newErrors = r.pageErrors.slice(errorsBefore)
        if (newErrors.length) { s.ok = false; s.pageErrors = newErrors }
      } catch (e) {
        s.ok = false
        s.error = String(e).slice(0, 300)
      }
      s.ms = Date.now() - t0
      await page.screenshot({ path: path.join(dir, name + (s.ok ? '' : '-FAIL') + '.png') }).catch(() => {})
      r.steps.push(s)
      if (!s.ok) failures.push(`${locale} ${name}: ${JSON.stringify({ ...s, name: undefined })}`)
      console.log(`${s.ok ? '  ✓' : '  ✗'} ${locale} ${name} (${s.ms} ms)`)
      return reached // later steps depend on the page being there, not on its copy being clean
    }

    await step('welcome', async () => {
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.welcome-pane .welcome-hero', { timeout: 45000 })
    })
    const settingsOk = await step('settings', async () => {
      await page.goto(BASE + '/#/pages/admin/admin', { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.nav-item', { timeout: 30000 })
    })
    if (settingsOk) {
      const count = (await page.$$('.nav-item')).length
      for (let i = 0; i < count; i++) {
        const label = await page.evaluate((i) => document.querySelectorAll('.nav-item')[i].innerText.trim(), i)
        await step(`settings-${String(i).padStart(2, '0')}`, async () => {
          await clickCenter((await page.$$('.nav-item'))[i])
          await page.waitForFunction((i) => document.querySelectorAll('.nav-item')[i]?.classList.contains('active'), { timeout: 10000 }, i)
          await sleep(800)
        })
        r.steps.at(-1).label = label
      }
    }
    // Marketplace: scan only the product chrome; card content comes from the live registry (tracked as Q-items).
    await step('plugin-market', async () => {
      await page.goto(BASE + '/#/pages/plugin-market/plugin-market', { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => document.body.innerText.length > 200, { timeout: 30000 })
      await sleep(2500)
    }, { scanSelector: '.market-hero, .page-plugin-market > view:first-child' })
    await step('login-page', async () => {
      await page.goto(BASE + '/#/pages/login/login', { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => document.querySelectorAll('input').length >= 2, { timeout: 30000 })
    })
    const question = 'What should I check first in a commercial lease?'
    await step('first-question-opens-sign-in', async () => {
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('.welcome-pane .welcome-hero', { timeout: 45000 })
      const input = await page.waitForSelector('.welcome-pane textarea', { timeout: 15000 })
      await clickCenter(input)
      await page.keyboard.type(question)
      await page.keyboard.press('Enter')
      // the sign-in sheet must appear, and the question must not be lost behind it
      await page.waitForFunction(() => [...document.querySelectorAll('input')].some((el) => el.type === 'password' && el.offsetParent), { timeout: 20000 })
      const kept = await page.evaluate((q) => [...document.querySelectorAll('textarea')].some((t) => t.value.includes(q)) || document.body.innerText.includes(q), question)
      if (!kept) throw new Error('the typed question disappeared after the sign-in sheet opened')
    })
    await ctx.close()
  }
} finally {
  await browser.close()
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
}

const stale = KNOWN.filter((k) => LOCALES.includes(k.locale) && !knownHit.has(k.id)).map((k) => k.id)
for (const id of new Set(stale)) failures.push(`KNOWN entry ${id} no longer reproduces: delete it from KNOWN (and close it in POLISH.md)`)
console.log(`\nfirst-run journeys: ${failures.length ? failures.length + ' failure(s)' : 'all passed'}; screenshots in ${OUT}`)
for (const f of failures) console.log('  - ' + f)
process.exit(failures.length ? 1 : 0)
