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
    if (url.pathname === '/api/ai/memory/spaces') body = [
      { id: 'project:42', scope: 'project', label: 'Synthetic Project', available: true, writable: true },
      { id: 'user:7', scope: 'user', available: true, writable: true },
      { id: 'team:3', scope: 'team', available: true, writable: true },
      { id: null, scope: 'firm', available: false, writable: false },
    ]
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
    // Poll rendered geometry rather than RAF-based selector visibility: the canvas starts display:none.
    await page.waitForFunction(() => {
      const el = document.querySelector('.memory-inline .memory-textarea')
      const box = el?.getBoundingClientRect()
      return box?.width > 0 && box?.height > 0 && getComputedStyle(el).visibility === 'visible'
    }, { polling: 100 })
    await settle()
    const memoryGeometry = await page.evaluate(() => {
      const root = document.querySelector('.memory-inline')
      const rect = selector => { const r = root.querySelector(selector).getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, bottom:r.bottom } }
      const save = root.querySelector('.memory-button.primary')
      const range = document.createRange(); range.selectNodeContents(save)
      return {
        inlineWidth: root.getBoundingClientRect().width, editor: rect('.memory-editor'), textarea: rect('.memory-textarea'), files: rect('.memory-files'),
        saveTextLines: new Set([...range.getClientRects()].map(r => Math.round(r.top))).size,
        scopes: root.querySelectorAll('.memory-space').length,
        unavailable: root.querySelectorAll('.memory-space.unavailable').length,
        overflow: [...root.querySelectorAll('.memory-panel-inline,.memory-body,.memory-editor,.memory-actions')].some(el => el.scrollWidth > el.clientWidth + 1),
        activeScope: root.querySelector('.memory-space.active')?.textContent,
      }
    })
    assert.equal(memoryGeometry.scopes, 4, 'all four scope tabs rendered')
    assert.equal(memoryGeometry.unavailable, 1, 'unavailable firm remains visible')
    assert.ok(memoryGeometry.activeScope.includes('Synthetic Project'), 'project scope stays selected')
    assert.ok(memoryGeometry.inlineWidth <= 620, 'canvas fixture exercises narrow container in a wide viewport')
    assert.ok(memoryGeometry.textarea.width >= memoryGeometry.inlineWidth - 50, 'editor uses available narrow canvas width')
    assert.ok(memoryGeometry.files.bottom <= memoryGeometry.editor.y + 1, 'file list stacks above editor')
    assert.equal(memoryGeometry.saveTextLines, 1, 'save label does not wrap')
    assert.equal(memoryGeometry.overflow, false, 'memory content has no horizontal overflow')
    await page.screenshot({path: `${out}/canvas-${history}.png`})
    assert.equal(await page.$eval('.chat-input-rich', el => el.textContent), draft, 'chat draft retained')
    if (history) assert.ok(await page.$eval('.message-list', el => el.textContent.includes('Synthetic preserved answer')), 'messages retained')
    for (let repeat = 0; repeat < 2; repeat++) {
      await page.click('.skill-selector'); await page.waitForSelector('.skill-manage', { visible: true }); await page.click('.skill-manage')
      await page.waitForSelector('.msb-search-input', { visible: true })
      assert.equal(await page.evaluate(() => window.qaWorkbench.isChatMode), false, 'skill management opens IDE market')
    }
    assert.equal(await page.$eval('.chat-input-rich', el => el.textContent), draft, 'skill navigation retains draft')
    results.push({ history, memoryGeometry, passed: true })
    await page.screenshot({ path: `${out}/${history ? 'history' : 'empty'}.png` })
  }
  assert.deepEqual(errors, [], 'no render errors')
  await writeFile(`${out}/report.json`, JSON.stringify({results, requests, errors}, null, 2))
  console.log(JSON.stringify({results, errors}))
} catch (error) {
  const pages = await browser.pages()
  const failedPage = pages.at(-1)
  await writeFile(`${out}/failure.json`, JSON.stringify({ error: error.message, state: await failedPage.evaluate(() => ({ mode: window.qaWorkbench?.viewMode, canvas: window.qaWorkbench?.chatCanvasVisible, left: window.qaWorkbench?.activeFileIdLeft, admin: document.querySelector('.page-admin')?.innerText, memories: [...document.querySelectorAll('.memory-inline')].map(e => ({box:e.getBoundingClientRect().toJSON(),visibility:getComputedStyle(e).visibility,textarea:[...e.querySelectorAll('.memory-textarea')].map(t=>({box:t.getBoundingClientRect().toJSON(),visibility:getComputedStyle(t).visibility,display:getComputedStyle(t).display,html:t.outerHTML.slice(0,500)}))})) })) }, null, 2))
  await failedPage.screenshot({path: `${out}/failure.png`})
  throw error
} finally { await browser.close() }
