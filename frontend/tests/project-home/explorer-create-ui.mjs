// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real workbench + Uni renderer; synthetic HTTP only, no real account or files.
import puppeteer from 'puppeteer-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const base = process.env.EXPLORER_UI_BASE || 'http://127.0.0.1:5197'
const out = process.env.EXPLORER_UI_OUT || '/tmp/explorer-create-1444-ui'
fs.mkdirSync(out, { recursive: true })
const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage()
const errors = [], creations = [], results = []
const files = [{ id: 7, name: '合成目录', isFolder: true, parentId: null }]
const project = { id: 42, name: '新建菜单验收', projectName: '新建菜单验收', userId: 7, localRoot: '/synthetic/explorer', projectType: 'BLANK' }
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' }
page.on('pageerror', e => errors.push(e.message))
await page.setViewport({ width: 1280, height: 800 })
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('awd_app_language', 'zh-CN')
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
  let body = []
  if (url.pathname === '/api/projects/42/files' && req.method() === 'GET') body = files
  else if (/\/api\/projects\/42\/files\/(file|folder)$/.test(url.pathname)) {
    const input = JSON.parse(req.postData()); if (input.name !== '__staging_area__') creations.push(input)
    body = { ...input, id: 100 + files.length, isFolder: url.pathname.endsWith('/folder') }
    files.push(body)
  } else if (url.pathname === '/api/projects/42') body = project
  else if (url.pathname === '/api/projects/my') body = [project]
  else if (url.pathname === '/api/auth/me') body = { id: 7, username: 'synthetic' }
  else if (url.pathname === '/api/mobile-receive/status') body = { active: false, items: [] }
  else if (url.pathname.includes('/license/status')) body = { mode: 'none', accountConnected: false }
  else if (url.pathname === '/api/account/status') body = { connected: false }
  else if (url.pathname.includes('/version/status')) body = { enabled: false }
  else if (url.pathname.includes('/profile') || url.pathname.includes('/admin/config')) body = {}
  await req.respond({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) })
})
const root = '.explorer-create-menu:not(.explorer-create-submenu)'
const sub = '.explorer-create-submenu'
const waitClosed = () => page.waitForSelector('.explorer-create-layer', { hidden: true })
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function blankMenu(right = false) {
  const rect = await page.$eval('.tree-content', e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })
  await page.mouse.click(rect.x + (right ? rect.width - 20 : 35), rect.y + rect.height - 50, { button: 'right' })
  await page.waitForSelector(root)
  await sleep(50)
}
try {
  await page.goto(base + '/#/pages/project-overview/project-overview?id=42', { waitUntil: 'networkidle0', timeout: 90000 })
  await page.waitForSelector('[title="资源管理器"]', { visible: true })
  if (!(await page.$('[data-create-trigger]'))) await page.click('[title="资源管理器"]')
  await page.waitForSelector('[data-create-trigger]', { visible: true })
  await page.focus('[data-create-trigger]')
  await page.keyboard.press('Enter')
  await page.waitForSelector(root)
  await page.waitForFunction(() => document.activeElement.dataset.key === 'docx')
  assert.equal(await page.evaluate(() => document.activeElement.dataset.key), 'docx')
  await page.keyboard.press('Escape'); await waitClosed()
  results.push('keyboard: toolbar Enter opens and Escape restores focus')
  for (const type of ['docx', 'pptx', 'xlsx']) {
    await page.click('[data-create-trigger]')
    assert.deepEqual(await page.$$eval(root + ' [role=menuitem]', els => els.map(e => e.textContent.trim())), ['Word', 'PPT', 'Excel', '录音'])
    await page.click(root + ` [data-key=${type}]`)
    await page.waitForSelector('.awd-dlg__input', { visible: true })
    await page.focus('.awd-dlg__input')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => !document.querySelector('.awd-dlg__input'))
    await sleep(150)
    assert.equal(creations.at(-1).fileType, type)
  }
  results.push('toolbar: three Office formats reach creation API')
  for (const name of ['Untitled Folder', 'Untitled Folder 2']) {
    await page.click('[title="新建文件夹"]')
    await page.waitForFunction(name => document.querySelector('.tree-content').textContent.includes(name), {}, name)
    assert.equal(creations.at(-1).name, name)
    assert.equal(await page.$('.awd-dlg__input'), null)
  }
  results.push('folder: immediate creation and sibling numbering')
  await blankMenu()
  await page.hover(root + ' [data-key=file]')
  await page.waitForSelector(sub)
  const row = await page.$eval(root + ' [data-key=file]', e => { const r = e.getBoundingClientRect(); return { x: r.left + 25, y: r.top + 16 } })
  const target = await page.$eval(sub + ' [data-key=xlsx]', e => { const r = e.getBoundingClientRect(); return { x: r.left + 35, y: r.top + 16 } })
  await page.mouse.move(row.x, row.y)
  await page.mouse.move(target.x, target.y, { steps: 18 })
  assert.ok(await page.$(sub), 'diagonal traversal must keep submenu open')
  await page.screenshot({ path: out + '/submenu.png' })
  await page.mouse.click(target.x, target.y)
  await page.waitForSelector('.awd-dlg__input', { visible: true })
  await page.keyboard.press('Escape')
  results.push('context: diagonal aim survives sibling row and gap')
  await blankMenu()
  assert.equal(await page.evaluate(() => document.activeElement.dataset.key), 'file')
  await page.keyboard.press('ArrowRight')
  await page.waitForSelector(sub)
  await page.keyboard.press('ArrowDown')
  assert.equal(await page.evaluate(() => document.activeElement.dataset.key), 'pptx')
  await page.keyboard.press('Escape')
  assert.equal(await page.evaluate(() => document.activeElement.dataset.key), 'file')
  await page.keyboard.press('Escape'); await waitClosed()
  results.push('keyboard: arrows, submenu escape, focus return')
  await page.setViewport({ width: 480, height: 540 })
  // Let the resize event settle before opening a menu (resize intentionally dismisses it).
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await blankMenu(true); await page.hover(root + ' [data-key=file]'); await page.waitForSelector(sub)
  const geometry = await page.$$eval('.explorer-create-menu', els => els.map(e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom } }))
  assert.ok(geometry[1].left < geometry[0].left, 'right edge flips submenu to left')
  assert.ok(geometry.every(r => r.left >= 0 && r.right <= 480 && r.top >= 0 && r.bottom <= 540))
  await page.screenshot({ path: out + '/narrow.png' })
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark')
  await page.screenshot({ path: out + '/dark.png' })
  await page.keyboard.press('Escape'); await waitClosed()
  results.push('narrow viewport: both menus stay onscreen')
  await page.setViewport({ width: 1280, height: 800 })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.click('[data-create-trigger]')
  await page.click(root + ' [data-key=recording]')
  await sleep(500)
  assert.ok((await page.evaluate(() => document.body.textContent)).includes('请先在插件详情中安装或启用'))
  results.push('recording: unavailable plugin has visible install guidance')
  assert.deepEqual(errors, [])
  fs.writeFileSync(out + '/result.json', JSON.stringify({ results, creations, errors }, null, 2))
  console.log(results.join('\n'))
} catch (e) {
  await page.screenshot({ path: out + '/failure.png' })
  fs.writeFileSync(out + '/failure.json', JSON.stringify({ message: e.message, errors, creations, text: await page.evaluate(() => document.body.textContent) }, null, 2))
  throw e
} finally { await browser.close() }
