// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real uni-app workbench with synthetic HTTP only; no real account/backend/provider.
// Memory and skill entries use mouse clicks. Hidden-header chat-mode coverage explicitly invokes the host entry.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import puppeteer from 'puppeteer-core'
const base = process.env.MEMORY_NAV_BASE || 'http://127.0.0.1:5379'
const out = process.env.MEMORY_NAV_OUT || '/tmp/memory-settings-navigation'
await mkdir(out, { recursive: true })
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const results = []
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const requests = []
  let language = 'zh-CN'
  await page.setRequestInterception(true)
  page.on('request', async req => {
    const url = new URL(req.url())
    if (!url.pathname.startsWith('/api/')) {
      if (url.origin !== new URL(base).origin && !['data:', 'blob:'].includes(url.protocol)) return req.abort()
      return req.continue()
    }
    requests.push(req.method() + ' ' + url.pathname + url.search)
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' }
    if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers })
    const project = { id: 42, name: language === 'zh-CN' ? '15-合成诉讼项目' : '15-Synthetic Litigation Project', userId: 7, myRole: 'OWNER', projectType: 'BLANK', createdAt: '2026-10-27T12:00:00', manager: 'Synthetic Owner' }
    let body = []
    if (url.pathname === '/api/ai/memory/spaces') body = [{ id: 'project:42', scope: 'project', label: 'Synthetic Project', available: true, writable: true }]
    else if (url.pathname === '/api/ai/memory/files') body = [{ path: 'remember.md', writable: true }]
    else if (url.pathname === '/api/ai/memory/file') body = { path: 'remember.md', content: 'Synthetic memory', revision: 'r1', writable: true }
    else if (url.pathname === '/api/projects/42') body = project
    else if (url.pathname === '/api/projects/my') body = [project]
    else if (url.pathname === '/api/auth/me') body = { id: 7, username: 'synthetic', role: 'USER' }
    else if (url.pathname === '/api/plugins/market/list') body = { plugins: [], accountConnected: false }
    else if (url.pathname === '/api/plugins/bundled') body = { plugins: [] }
    else if (url.pathname.includes('/license/status')) body = { mode: 'none', accountConnected: false }
    else if (url.pathname === '/api/account/status') body = { connected: false }
    else if (url.pathname.includes('/version/status')) body = { enabled: false }
    else if (url.pathname.includes('/profile') || url.pathname.includes('/admin/config')) body = {}
    else if (url.pathname.includes('/telemetry/settings')) body = { enabled: false }
    return req.respond({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.setViewport({ width: 1600, height: 1000 })
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('checkba_user', JSON.stringify({ type: 'object', data: { id: 7, username: 'synthetic', role: 'USER' } }))
    localStorage.setItem('app_language', 'zh-CN')
    localStorage.setItem('awd_app_language', 'zh-CN')
  })
  console.log('Loading synthetic workbench')
  await page.goto(base + '/#/pages/project-overview/project-overview?id=42', { waitUntil: 'networkidle0', timeout: 90000 })
  await page.waitForSelector('.memory-header-btn', { visible: true })
  // Actual component instances seed history and inspect state; the hidden-header host check below is explicit.
  await page.evaluate(() => {
    let instance = document.querySelector('.page-project-overview').__vueParentComponent
    while (instance && !instance.proxy.openSettingsTab) instance = instance.parent
    window.qaWorkbench = instance.proxy
    window.qaChat = instance.proxy.$refs.chatInterface
  })
  const settle = () => new Promise(resolve => setTimeout(resolve, 350))
  for (const history of [false, true]) {
    await page.evaluate(history => {
      window.qaChat.loadMessages('synthetic-navigation', history ? [{id:'u',role:'USER',content:'Synthetic preserved question'}, {id:'a',role:'ASSISTANT',content:'Synthetic preserved answer'}] : [])
    }, history)
    await settle()
    const composer = await page.waitForSelector('.chat-input-rich', { visible: true })
    await composer.click(); await composer.type(history ? 'History draft retained' : 'Empty draft retained')
    const draft = await composer.evaluate(el => el.textContent)
    console.log('Memory entry', history)
    await page.click('.memory-header-btn')
    await page.waitForSelector('.memory-inline textarea', { visible: true })
    assert.equal(await page.$('.memory-mask'), null, 'no modal memory browser')
    assert.ok(requests.some(r => r.includes('/api/ai/memory/spaces?projectId=42')), 'memory request carries current project')
    await page.type('.memory-inline textarea', ' unsaved edit')
    const memoryDraft = await page.$eval('.memory-inline textarea', el => el.value)
    await page.click('.memory-header-btn'); await settle()
    assert.equal(await page.$eval('.memory-inline textarea', el => el.value), memoryDraft, 'reopening same memory preserves its draft')
    assert.equal(await page.evaluate(() => [...window.qaWorkbench.leftFiles, ...window.qaWorkbench.rightFiles].filter(t => t.tabType === 'admin-settings').length), 1, 'settings is singleton')
    // A user selecting another settings section must be returned to memory by the next entry click.
    const navs = await page.$$('.page-admin .nav-item')
    if (!navs.length) throw new Error('settings navigation fixture selector missing')
    await navs[0].click(); await settle()
    await page.click('.memory-header-btn')
    await page.waitForSelector('.memory-inline', { visible: true })
    await page.click('.mode-switch-item:first-child'); await settle()
    await page.click('.chat-canvas-close-btn'); await settle()
    assert.equal(await page.evaluate(() => window.qaWorkbench.chatCanvasVisible), false)
    // Chat mode intentionally hides the header; exercise the shared host entry directly here.
    await page.evaluate(() => window.qaWorkbench.openSettingsTab({ nav: 'memory' }))
    await page.waitForFunction(() => window.qaWorkbench.chatCanvasVisible)
    await page.evaluate(() => window.qaWorkbench.$nextTick())
    await page.screenshot({path: `${out}/canvas-${history}.png`})
    await page.waitForSelector('.memory-inline', { visible: true })
    assert.equal(await page.$eval('.chat-input-rich', el => el.textContent), draft, 'chat draft retained')
    if (history) assert.ok(await page.$eval('.message-list', el => el.textContent.includes('Synthetic preserved answer')), 'messages retained')
    for (let repeat = 0; repeat < 2; repeat++) {
      await page.click('.skill-selector'); await page.waitForSelector('.skill-manage', { visible: true }); await page.click('.skill-manage')
      await page.waitForSelector('.msb-search-input', { visible: true })
      assert.equal(await page.evaluate(() => window.qaWorkbench.isChatMode), false, 'skill management opens IDE market')
    }
    assert.equal(await page.$eval('.chat-input-rich', el => el.textContent), draft, 'skill navigation retains draft')
    results.push({ history, passed: true })
    await page.screenshot({ path: `${out}/${history ? 'history' : 'empty'}.png` })
  }
  assert.deepEqual(errors, [], 'no render errors')
  await writeFile(`${out}/report.json`, JSON.stringify({results, requests, errors}, null, 2))
  console.log(JSON.stringify({results, errors}))
} finally { await browser.close() }
