// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real uni workbench, isolated browser storage and synthetic API only. Run against dev:h5.
import puppeteer from 'puppeteer-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const base = process.env.WELCOME_SIDEBAR_UI_BASE || 'http://127.0.0.1:5194'
const out = process.env.WELCOME_SIDEBAR_UI_OUT || '/tmp/awd-welcome-sidebar-ui'
fs.mkdirSync(out, { recursive: true })
const project = { id: 42, name: '侧栏合成测试项目', userId: 7, projectType: 'BLANK', localRoot: '/synthetic/sidebar' }
const plugins = Array.from({ length: 24 }, (_, i) => ({ id: `synthetic-plugin-${i}`, name: `合同审查与文书整理插件 ${i + 1}`, description: '用于验证窄侧栏中文名称、描述与操作按钮的布局', version: '1.0.0', enabled: true }))
const skills = Array.from({ length: 24 }, (_, i) => ({ id: `synthetic-skill-${i}`, name: `法律资料整理技能 ${i + 1}`, description: '合成数据：整理资料和核对文书', version: '1.0.0', category: 'contract', priceCents: 0, downloads: 12 }))
const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage()
const errors = []
const apiRequests = []
const checks = []
const screenshots = []
page.on('pageerror', error => errors.push(error.message))
await page.setViewport({ width: 1440, height: 900 })
await page.evaluateOnNewDocument(() => {
  if (location.protocol !== 'about:' && !sessionStorage.getItem('welcome-sidebar-seeded')) {
    localStorage.clear()
    localStorage.setItem('awd_app_language', 'zh-CN')
    localStorage.setItem('awd_theme', 'light')
    sessionStorage.setItem('welcome-sidebar-seeded', '1')
  }
})
await page.setRequestInterception(true)
page.on('request', async request => {
  const url = new URL(request.url())
  if (!url.pathname.startsWith('/api/')) {
    // Only this test's frontend server may receive requests. No real local backend or external service.
    if (url.origin !== new URL(base).origin && !['data:', 'blob:'].includes(url.protocol)) return request.abort()
    return request.continue()
  }
  apiRequests.push(url.pathname)
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' }
  if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers })
  let body = []
  if (url.pathname === '/api/projects/42') body = project
  else if (url.pathname === '/api/projects/my') body = [project]
  else if (url.pathname === '/api/auth/me') body = { id: 7, username: 'synthetic' }
  else if (url.pathname === '/api/plugins/list') body = plugins
  else if (url.pathname === '/api/skills/list') body = []
  else if (url.pathname === '/api/skills/market/list') body = { skills, accountConnected: false }
  else if (url.pathname === '/api/plugins/market/list') body = { plugins: [], accountConnected: false }
  else if (url.pathname === '/api/plugins/bundled') body = { plugins: [] }
  else if (url.pathname.includes('/license/status')) body = { mode: 'none', accountConnected: false }
  else if (url.pathname === '/api/account/status') body = { connected: false }
  else if (url.pathname.includes('/version/status')) body = { enabled: false }
  else if (url.pathname.includes('/profile') || url.pathname.includes('/admin/config')) body = {}
  else if (url.pathname.includes('/telemetry/settings')) body = { enabled: false }
  return request.respond({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(body) })
})

const route = '/#/pages/project-overview/project-overview'
const rail = title => `.left-rail .rail-btn[title="${title}"]`
async function collapsed(expected) {
  await page.waitForFunction(value => {
    const panel = document.querySelector('.sidebar-left')
    return panel && panel.classList.contains('collapsed') === value && (value ? panel.getBoundingClientRect().width < 2 : panel.getBoundingClientRect().width > 150)
  }, {}, expected)
}
async function welcome() {
  await page.waitForSelector('.welcome-pane', { visible: true })
  assert.equal(await page.$$eval('.tab-item', items => items.filter(item => item.textContent.includes('欢迎')).length), 1)
}
async function shot(name) {
  const path = `${out}/${name}.png`
  await page.screenshot({ path })
  screenshots.push(path)
}
async function waitMarket() {
  await page.waitForFunction(() => document.querySelectorAll('.msb-section:first-child .msb-row').length === 24 && document.querySelectorAll('.msb-section:nth-child(2) .msb-row').length === 24)
}
async function dragWidth(width) {
  const handle = await page.$('.sidebar-left .resize-handle')
  const box = await handle.boundingBox()
  const current = await page.$eval('.sidebar-left', el => el.getBoundingClientRect().width)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + width - current, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  await page.waitForFunction(target => Math.abs(document.querySelector('.sidebar-left').getBoundingClientRect().width - target) < 2, {}, width)
}
async function geometry() {
  return page.evaluate(() => {
    const sections = [...document.querySelectorAll('.msb-section')]
    const panel = document.querySelector('.sidebar-left').getBoundingClientRect()
    return sections.map(section => {
      const head = section.querySelector('.msb-sec-head').getBoundingClientRect()
      const list = section.querySelector('.msb-list > .uni-scroll-view > .uni-scroll-view')
      return { headVisible: head.top >= panel.top && head.bottom <= panel.bottom, height: section.getBoundingClientRect().height, clientHeight: list?.clientHeight, scrollHeight: list?.scrollHeight, scrollTop: list?.scrollTop }
    })
  })
}
async function scrollSection(index) {
  const list = await page.$(`.msb-section:nth-child(${index + 1}) .msb-list`)
  const box = await list.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel({ deltaY: 360 })
  await page.waitForFunction(i => document.querySelectorAll('.msb-list > .uni-scroll-view > .uni-scroll-view')[i].scrollTop > 0, {}, index)
}

try {
  await page.goto(base + route, { waitUntil: 'networkidle0' })
  await collapsed(true)
  await welcome()
  checks.push('fresh no-project welcome starts collapsed')
  await shot('01-welcome-collapsed')

  await page.click(rail('插件中心'))
  await collapsed(false)
  await waitMarket()
  await welcome()
  await page.reload({ waitUntil: 'networkidle0' })
  await collapsed(false)
  await waitMarket()
  await welcome()
  checks.push('different-key click opens market, preserves welcome and persists expanded across reload')
  await page.click(rail('插件中心'))
  await collapsed(true)
  await welcome()
  await page.reload({ waitUntil: 'networkidle0' })
  await collapsed(true)
  await welcome()
  await page.click(rail('插件中心'))
  await collapsed(false)
  await waitMarket()
  checks.push('same-key click collapses and reopens, collapsed state survives reload')
  await page.click(rail('项目'))
  await collapsed(false)
  await page.waitForSelector('.project-list-pane', { visible: true })
  await welcome()
  await page.click(rail('插件中心'))
  await waitMarket()
  checks.push('switching between projects and market preserves welcome')

  for (const width of [260, 220]) {
    await dragWidth(width)
    const metrics = await geometry()
    assert.ok(metrics.every(item => item.headVisible && item.clientHeight > 0 && item.scrollHeight > item.clientHeight), JSON.stringify(metrics))
    const overflows = await page.$$eval('.msb-row', rows => rows.map(row => ({ width: row.clientWidth, scroll: row.scrollWidth })).filter(row => row.scroll > row.width + 1))
    assert.deepEqual(overflows, [], `rows must fit ${width}px panel`)
    await shot(`02-market-light-${width}`)
  }
  const beforeScroll = await geometry()
  await scrollSection(0)
  const afterFirst = await geometry()
  assert.equal(afterFirst[1].scrollTop, beforeScroll[1].scrollTop)
  await scrollSection(1)
  const afterSecond = await geometry()
  assert.equal(afterSecond[0].scrollTop, afterFirst[0].scrollTop)
  assert.ok(afterSecond.every(item => item.headVisible))
  checks.push('220/260px long lists fit, both headers stay visible and mouse wheel scrolls sections independently')

  await page.click('.msb-section:first-child .msb-sec-head')
  await page.waitForFunction(previous => document.querySelector('.msb-section:nth-child(2)').getBoundingClientRect().height > previous + 100, {}, afterSecond[1].height)
  await shot('03-market-installed-collapsed')
  await page.click('.msb-section:first-child .msb-sec-head')
  await waitMarket()
  checks.push('collapsing installed section gives marketplace the freed height')

  await page.type('.msb-search-input input', 'no-match-synthetic-999')
  await page.waitForFunction(() => document.querySelectorAll('.msb-row').length === 0 && document.querySelectorAll('.msb-empty').length === 2)
  const emptyText = await page.$$eval('.msb-empty', items => items.map(item => item.textContent))
  assert.ok(emptyText[0].includes('插件') && emptyText[1].includes('Skill'), JSON.stringify(emptyText))
  await shot('04-market-search-empty')
  await page.click('.msb-search-clear')
  await page.waitForFunction(() => document.querySelector('.msb-search-input input').value === '')
  await waitMarket()
  checks.push('search filters both sections and shows type-specific empty states')

  await page.click('.theme-btn')
  const themeItems = await page.$$('.theme-menu-item')
  assert.equal(themeItems.length, 3)
  await themeItems[1].click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  await shot('05-market-dark-220')
  assert.ok((await geometry()).every(item => item.headVisible))
  checks.push('real theme menu switches dark mode with both sections visible')

  await page.click(rail('插件中心'))
  await collapsed(true)
  await page.goto('about:blank')
  await page.goto(base + route + '?pane=projects', { waitUntil: 'networkidle0' })
  await collapsed(false)
  await page.waitForSelector('.project-list-pane', { visible: true })
  checks.push('explicit projects deep link overrides saved collapsed state')
  await page.click(rail('项目'))
  await collapsed(true)
  await page.goto('about:blank')
  await page.goto(base + route + '?id=42&pane=files', { waitUntil: 'networkidle0' })
  await collapsed(false)
  await page.waitForSelector('.file-tree', { visible: true })
  checks.push('explicit named-project files deep link opens explorer')
  assert.deepEqual(apiRequests.filter(path => /\/projects\/(null|undefined)\//.test(path)), [])
  assert.deepEqual(errors, [])
  const report = { passed: true, checks, screenshots, apiRequestCount: apiRequests.length, limitations: ['Synthetic API, no real account or backend', 'H5 Chrome UI, not signed Electron release or native OS file picker'] }
  fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} catch (error) {
  await shot('failure')
  console.error(JSON.stringify({ checks, errors, url: page.url(), apiRequests: [...new Set(apiRequests)] }))
  throw error
} finally {
  await browser.close()
}
