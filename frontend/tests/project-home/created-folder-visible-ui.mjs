// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real Uni workbench rendering with synthetic API data; no user account or disk writes.
import puppeteer from 'puppeteer-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const base = process.env.EXPLORER_UI_BASE || 'http://127.0.0.1:5198'
const out = process.env.EXPLORER_UI_OUT || '/tmp/created-folder-visible-1469-ui'
fs.mkdirSync(out, { recursive: true })
const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage()
const errors = [], creations = [], documents = [], results = []
const folders = (count, parentId = null, first = 1) => Array.from({ length: count }, (_, index) => ({
  id: first + index, name: `合成目录${String(index + 1).padStart(3, '0')}`, isFolder: true, parentId,
}))
const files = [...folders(148), ...folders(148, 148, 1000)]
const project = { id: 42, name: '新建目录可见性验收', userId: 7, localRoot: '/synthetic/explorer', projectType: 'BLANK' }
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' }
page.on('pageerror', error => errors.push(error.message))
await page.setViewport({ width: 1280, height: 800 })
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('awd_app_language', 'zh-CN')
  window.checkbaDesktop = { ocr: {}, shell: { openExternal() {} } }
})
await page.setRequestInterception(true)
page.on('request', async request => {
  const url = new URL(request.url())
  if (!url.pathname.startsWith('/api/')) {
    if (url.origin !== new URL(base).origin && !['data:', 'blob:', 'about:'].includes(url.protocol)) return request.abort()
    return request.continue()
  }
  if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers })
  let body = []
  if (url.pathname === '/api/projects/42/files' && request.method() === 'GET') {
    body = url.searchParams.get('tree') === 'true' ? files : files.filter(file => String(file.parentId ?? '') === (url.searchParams.get('parentId') || ''))
  }
  else if (url.pathname === '/api/projects/42/files/folder') {
    const input = JSON.parse(request.postData())
    body = { ...input, id: 10000 + files.length, isFolder: true }
    files.push(body)
    if (input.name !== '__staging_area__') creations.push(body)
  } else if (url.pathname === '/api/projects/42/files/file') {
    const input = JSON.parse(request.postData())
    body = { ...input, id: 10000 + files.length, isFolder: false }
    files.push(body)
    documents.push(body)
  } else if (url.pathname === '/api/projects/42') body = project
  else if (url.pathname === '/api/projects/my') body = [project]
  else if (url.pathname === '/api/auth/me') body = { id: 7, username: 'synthetic' }
  else if (url.pathname === '/api/mobile-receive/status') body = { active: false, items: [] }
  else if (url.pathname.includes('/license/status')) body = { mode: 'none', accountConnected: false }
  else if (url.pathname === '/api/account/status') body = { connected: false }
  else if (url.pathname.includes('/version/status')) body = { enabled: false }
  else if (url.pathname.includes('/profile') || url.pathname.includes('/admin/config')) body = {}
  await request.respond({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) })
})
async function createVisible(label, parentId) {
  const response = page.waitForResponse(response => response.url().endsWith('/api/projects/42/files/folder') && response.request().method() === 'POST')
  await page.click('[title="新建文件夹"]')
  await response
  const created = creations.at(-1)
  assert.ok(created)
  assert.equal(created.parentId ?? null, parentId)
  await page.waitForFunction(id => {
    const row = document.querySelector(`.tree-content .tree-item[data-file-id="${id}"]`)
    if (!row) return false
    const r = row.getBoundingClientRect(), pane = document.querySelector('.tree-content').getBoundingClientRect()
    return row.classList.contains('tree-item-selected') && r.top >= pane.top && r.bottom <= pane.bottom
  }, { timeout: 10000 }, created.id)
  results.push(label)
  await page.screenshot({ path: `${out}/${label}.png` })
  return created
}
try {
  await page.goto(base + '/#/pages/project-overview/project-overview?id=42', { waitUntil: 'networkidle0', timeout: 90000 })
  await page.waitForSelector('[title="资源管理器"]', { visible: true })
  if (!(await page.$('[title="新建文件夹"]'))) await page.click('[title="资源管理器"]')
  await page.waitForSelector('.tree-item-load-more', { visible: true })
  assert.equal(await page.$('.tree-content [data-file-id="148"]'), null)
  const createdRoot = await createVisible('root-after-148-folders', null)
  await page.click('[data-create-trigger]')
  await page.click('.explorer-create-menu [data-key="docx"]')
  await page.waitForSelector('.awd-dlg__input', { visible: true })
  const documentResponse = page.waitForResponse(response => response.url().endsWith('/api/projects/42/files/file') && response.request().method() === 'POST')
  await page.focus('.awd-dlg__input')
  await page.keyboard.press('Enter')
  await documentResponse
  await page.waitForSelector('.awd-dlg__input', { hidden: true })
  assert.equal(documents.at(-1).parentId, createdRoot.id)
  results.push('next-document-inside-selected-new-folder')
  await page.click('.tree-content [data-file-id="148"]')
  await createVisible('nested-after-148-folders', 148)
  const tagTab = await page.$$('.file-browse-tab')
  await tagTab[1].click()
  await page.waitForSelector('.tree-empty', { visible: true })
  await createVisible('folder-created-from-tag-view', null)
  assert.equal(await page.$eval('.file-browse-tab', button => button.getAttribute('aria-pressed')), 'true')
  assert.deepEqual(errors, [])
  fs.writeFileSync(out + '/result.json', JSON.stringify({ results, creations, documents, errors }, null, 2))
  console.log(JSON.stringify({ results, errors }))
} catch (error) {
  await page.screenshot({ path: out + '/failure.png' })
  const rows = await page.$$eval('.tree-item[data-file-id]', elements => elements.filter(element => element.textContent.includes('Untitled')).map(element => ({ className: element.className, id: element.dataset.fileId, rect: element.getBoundingClientRect().toJSON(), parentRect: element.closest('.tree-content').getBoundingClientRect().toJSON() })))
  fs.writeFileSync(out + '/failure.json', JSON.stringify({ message: error.message, creations, errors, rows }, null, 2))
  throw error
} finally {
  await browser.close()
}
