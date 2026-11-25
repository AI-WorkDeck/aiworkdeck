#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Warm a cold `npx uni` dev server before the journey suites. On a cold checkout vite re-optimizes
// dependencies on first browser load and reloads the page mid-test (eng-infra.md: app-e2e red line 2),
// which makes random steps fail. Load the main routes until the dev-server log stays quiet.
// usage: node tests/journeys/warm-dev-server.mjs <base> <backend> <uni-log-file>
import fs from 'node:fs'
import puppeteer from 'puppeteer-core'

const [BASE, BACKEND, LOG] = process.argv.slice(2)
const ROUTES = ['/', '/#/pages/admin/admin', '/#/pages/plugin-market/plugin-market', '/#/pages/login/login', '/#/pages/calendar/calendar']
const reloads = () => (fs.readFileSync(LOG, 'utf8').match(/optimized dependencies changed|new dependencies optimized|reloading/g) || []).length
const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH, headless: 'new', args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  await page.evaluateOnNewDocument((api) => { window.checkbaDesktop = { apiBaseUrl: api, shell: { openExternal: () => Promise.resolve() } } }, BACKEND)
  for (let round = 1; round <= 5; round++) {
    const before = reloads()
    for (const r of ROUTES) {
      await page.goto(BASE + r, { waitUntil: 'networkidle2', timeout: 120000 }).catch(() => {})
      await new Promise((res) => setTimeout(res, 3000))
    }
    const after = reloads()
    console.log(`warm-up round ${round}: dev-server reload events ${before} -> ${after}`)
    if (after === before) process.exit(0)
  }
  console.log('dev server still re-optimizing after 5 rounds; continuing anyway')
} finally {
  await browser.close()
}
