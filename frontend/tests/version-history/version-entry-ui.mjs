// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Actual uni UI, synthetic API only; no real backend, account or files.
import puppeteer from 'puppeteer-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const base = process.env.VERSION_UI_BASE || 'http://127.0.0.1:5199'
const out = process.env.VERSION_UI_OUT || '/tmp/awd-version-entry-ui'
fs.mkdirSync(out, { recursive: true })
const project = { id: 42, name: '合同修改示例', userId: 7, projectType: 'BLANK', localRoot: '/synthetic/versions' }
const file = { id: 101, name: '修改说明.txt', projectId: 42, isFolder: false, fileType: 'txt', fileSize: 20, filePath: 'projects/42/note.txt' }
let status = { enabled: true, working: true, changedCount: 2, onDraft: null }
const nextProject = { ...project, id: 43, name: '另一个项目' }
let cloud = { linked: false }, commits = 0, uploads = 0
let delayCommit = false, finishCommit = null, failCommit = false
const checks = [], errors = []
const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage()
page.on('pageerror', e => errors.push(e.message))
await page.setViewport({ width: 1440, height: 900 })
await page.evaluateOnNewDocument(() => { localStorage.setItem('awd_app_language', 'zh-CN'); localStorage.setItem('awd_theme', 'light') })
await page.setRequestInterception(true)
page.on('request', async request => {
  const url = new URL(request.url())
  if (!url.pathname.startsWith('/api/')) return url.origin === new URL(base).origin || ['data:', 'blob:'].includes(url.protocol) ? request.continue() : request.abort()
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' }
  if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers })
  let body = []
  const p = url.pathname
  if (p === '/api/projects/42') body = project
  else if (p === '/api/projects/43') body = nextProject
  else if (p === '/api/projects/43/files') body = []
  else if (p === '/api/projects/my') body = [project, nextProject]
  else if (p === '/api/projects/42/files') body = [file]
  else if (p === '/api/auth/me') body = { id: 7, username: 'synthetic' }
  else if (p === '/api/files/101/download') return request.respond({ status: 200, headers, contentType: 'text/plain', body: '本次合同修改说明。' })
  else if (p === '/api/files/101/upload') { uploads++; status = { ...status, changedCount: 3 }; body = { code: 0, data: file } }
  else if (p.endsWith('/version/status')) body = { code: 0, data: p.includes('/43/') ? { enabled: false } : status }
  else if (p.endsWith('/version/session/end')) {
    commits++
    if (delayCommit) await new Promise(resolve => { finishCommit = resolve })
    if (failCommit) return request.respond({ status: 500, headers, contentType: 'application/json', body: JSON.stringify({ code: 1, message: 'Synthetic commit failure' }) })
    status = { ...status, working: false, changedCount: 0 }
    cloud = { linked: true, pendingUpload: true }
    body = { code: 0, data: { sha: 'synthetic-commit' } }
  }
  else if (p.endsWith('/version/timeline')) body = { code: 0, data: { versions: [] } }
  else if (p.endsWith('/version/drafts')) body = { code: 0, data: { drafts: [] } }
  else if (p.includes('/cloud/projects/42/')) body = { code: 0, data: cloud }
  else if (p === '/api/cloud/connections') body = { code: 0, data: { connections: [] } }
  else if (p === '/api/cloud/official') body = { code: 0, data: { available: true } }
  else if (p.includes('/license/status')) body = { mode: 'none', accountConnected: false }
  else if (p === '/api/account/status') body = { connected: false }
  else if (p.includes('/profile') || p.includes('/admin/config')) body = {}
  else if (p.includes('/telemetry/settings')) body = { enabled: false }
  return request.respond({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(body) })
})
const badge = value => page.waitForFunction(v => document.querySelector('.version-entry .rail-badge')?.textContent === v, {}, value)
const shot = async name => {
  await page.evaluate(() => Promise.all(document.getAnimations().filter(a => Number.isFinite(a.effect.getTiming().iterations)).map(a => a.finished.catch(() => {}))))
  return page.screenshot({ path: `${out}/${name}.png` })
}
try {
  await page.goto(`${base}/#/pages/project-overview/project-overview?id=43`, { waitUntil: 'networkidle0' })
  await page.goto(`${base}/?scenario=${Date.now()}#/pages/project-overview/project-overview?id=42&pane=files`, { waitUntil: 'networkidle0' })
  await badge('2')
  assert.match(await page.$eval('.version-entry', n => n.getAttribute('aria-label')), /2 个文件待提交/)
  status = { ...status, changedCount: 3 }
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await badge('3')
  checks.push('global badge refreshes confirmed file status while panel is closed')
  await page.click('.version-entry')
  await page.waitForSelector('.version-panel .session-bar', { visible: true })
  await page.waitForFunction(() => document.querySelector('.session-text')?.textContent.includes('3 个文件待提交'))
  await shot('01-project-changes')
  await page.click('.version-entry')
  assert.equal(await page.$eval('.sidebar-left', n => n.classList.contains('collapsed')), false)
  await page.click('.session-bar > .awd-btn-primary')
  await page.waitForSelector('.session-bar .awd-mask', { visible: true })
  await page.type('.session-bar .awd-input input', '补充付款条款')
  await page.click('.session-bar .awd-footer .awd-btn-primary')
  await badge('↑')
  assert.equal(commits, 1)
  await page.waitForFunction(() => document.querySelector('.cloud-bar')?.textContent.includes('待上传'))
  checks.push('entry opens whole project; confirmed commit clears file count and exposes upload state')
  await shot('02-upload-pending')
  await page.click('.cloud-open-link')
  await page.waitForSelector('.collab-dialog', { visible: true })
  checks.push('cloud action reaches collaboration dialog')
  await page.keyboard.press('Escape')
  cloud = { linked: true, remoteAhead: true, remoteAheadCount: 4 }
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await badge('↓')
  checks.push('remote history count remains separate from file count')
  await page.setViewport({ width: 1000, height: 700 })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await shot('03-narrow-dark')
  assert.equal(await page.$eval('.version-entry .rail-badge', n => { const b = n.getBoundingClientRect(), p = n.closest('.left-rail').getBoundingClientRect(); return b.left >= p.left && b.right <= p.right && b.top >= p.top && b.bottom <= p.bottom }), true)
  await page.setViewport({ width: 1440, height: 900 })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  const reopen = async () => {
    status = { enabled: true, working: true, changedCount: 2, onDraft: null }
    cloud = { linked: false }
    await page.goto(`${base}/?scenario=${Date.now()}#/pages/project-overview/project-overview?id=42&pane=files`, { waitUntil: 'networkidle0' })
    await badge('2')
  }
  const leave = async () => {
    await page.click('.project-switcher')
    await page.waitForSelector('.switcher-item-name')
    await page.click('.switcher-item-name')
    await page.waitForSelector('.awd-dlg--sheet', { visible: true })
    assert.deepEqual(await page.$$eval('.awd-dlg button', nodes => nodes.map(n => n.textContent)), ['提交并退出', '直接退出', '取消'])
  }
  await reopen()
  await leave()
  await shot('04-exit-options')
  await page.click('.awd-dlg__cancel')
  await page.waitForSelector('.awd-dlg', { hidden: true })
  assert.match(page.url(), /id=42/)
  assert.equal(commits, 1)
  checks.push('cancel keeps current project and does not commit')
  await leave()
  await page.click('.awd-dlg__item:nth-child(2)')
  await page.waitForFunction(() => location.hash.includes('id=43'))
  assert.equal(commits, 1)
  checks.push('direct exit navigates without commit')
  await reopen()
  failCommit = true
  await leave()
  await page.click('.awd-dlg__item')
  await page.waitForFunction(() => document.body.innerText.includes('已取消离开'))
  assert.match(page.url(), /id=42/)
  assert.equal(commits, 2)
  checks.push('failed commit keeps project and shows retry guidance')
  failCommit = false
  delayCommit = true
  await leave()
  await page.click('.awd-dlg__item')
  await page.waitForFunction(() => document.body.innerText.includes('正在提交改动（2/3）'))
  assert.match(page.url(), /id=42/)
  assert.equal(commits, 3)
  assert.equal(typeof finishCommit, 'function')
  await page.evaluate(() => {
    const input = document.createElement('input')
    input.id = 'synthetic-underlying-editor'
    document.body.appendChild(input)
    input.focus()
  })
  await page.keyboard.type('must not edit during commit')
  assert.equal(await page.$eval('#synthetic-underlying-editor', n => n.value), '')
  await page.$eval('#synthetic-underlying-editor', n => n.remove())
  await shot('05-exit-commit-progress')
  finishCommit()
  await page.waitForFunction(() => location.hash.includes('id=43'))
  checks.push('commit waits for server receipt, displays real progress, then leaves automatically')
  assert.deepEqual(errors, [])
  fs.writeFileSync(`${out}/result.json`, JSON.stringify({ passed: true, checks, commits, uploads, out }, null, 2))
  console.log(fs.readFileSync(`${out}/result.json`, 'utf8'))
} catch (e) { await shot('failure'); fs.writeFileSync(`${out}/failure.json`, JSON.stringify({ error: e.stack, errors, text: await page.$eval('body', n => n.innerText) }, null, 2)); throw e } finally { await browser.close() }
