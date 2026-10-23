// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real compiled workbench tag browsing; synthetic API only. Run against dev:h5.
import puppeteer from 'puppeteer-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const base = process.env.TAG_FILTER_UI_BASE || 'http://127.0.0.1:5196'
const out = process.env.TAG_FILTER_UI_OUT || '/tmp/awd-1446-ui'
fs.mkdirSync(out, { recursive: true })
const project = { id: 42, name: '标签筛选隔离测试', userId: 7, projectType: 'BLANK' }
const tags = [{ id: 7, name: '待审阅', color: '#B45309' }, { id: 8, name: '证据', color: '#B91C1C' }, { id: 9, name: '没有文件的标签', type: 'PARTY' }, ...Array.from({ length: 20 }, (_, i) => ({ id: 20 + i, name: '长标签名称与当事人名称测试' + i, type: 'ISSUE' }))]
const files = [
  { id: 1, name: '证据目录', parentId: null, isFolder: true, fileType: 'folder' },
  { id: 2, name: '子目录', parentId: 1, isFolder: true, fileType: 'folder' },
  { id: 3, name: '合同.docx', parentId: 2, fileType: 'docx', tags: [tags[0], tags[1]] },
  { id: 4, name: '照片.jpg', parentId: 1, fileType: 'jpg', tags: [tags[0]] },
  { id: 5, name: '录音.mp3', parentId: null, fileType: 'mp3', tags: [tags[1]] },
  { id: 6, name: '未标记.txt', parentId: null, fileType: 'txt', tags: [] }
].map(file => ({ projectId: 42, filePath: '/synthetic/' + file.name, ...file }))
const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.stack || e.message))
await page.setViewport({ width: 1440, height: 1000 })
await page.evaluateOnNewDocument(() => {
  if (location.protocol !== 'about:') {
    localStorage.setItem('awd_app_language', 'zh-CN')
    localStorage.setItem('project_42_leftPaneKey', 'files')
  }
})
await page.setRequestInterception(true)
page.on('request', async req => {
  const url = new URL(req.url())
  if (!url.pathname.startsWith('/api/')) {
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) && !['data:', 'blob:'].includes(url.protocol)) return req.abort()
    return req.continue()
  }
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' }
  if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers })
  let body = []
  if (url.pathname.includes('/download')) return req.respond({ status: 200, headers, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="seagreen"/><text x="100" y="200" font-size="60" fill="white">Synthetic Quick Look</text></svg>' })
  if (url.pathname === '/api/projects/42') body = project
  else if (url.pathname === '/api/projects/my') body = [project]
  else if (url.pathname === '/api/projects/42/files') body = files
  else if (url.pathname === '/api/projects/42/tags') body = tags
  else if (url.pathname === '/api/projects/42/files/6/tags' && req.method() === 'POST') {
    const tagId = JSON.parse(req.postData()).tagId
    files[5].tags = [...files[5].tags.filter(tag => tag.id !== tagId), tags.find(tag => tag.id === tagId)]
    body = { code: 0 }
  } else if (url.pathname === '/api/projects/42/files/6/tags/7' && req.method() === 'DELETE') {
    files[5].tags = []
    body = { code: 0 }
  }
  else if (url.pathname === '/api/auth/me') body = { id: 7, username: 'synthetic' }
  else if (url.pathname.includes('/license/status')) body = { mode: 'none', accountConnected: false }
  else if (url.pathname === '/api/account/status') body = { connected: false }
  else if (url.pathname.includes('/version/status')) body = { enabled: false }
  else if (url.pathname.includes('/profile') || url.pathname.includes('/admin/config')) body = {}
  await req.respond({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(body) })
})
const visibleIds = async () => (await page.$$eval('.file-tree .tree-item[data-file-id]', rows => rows.map(row => Number(row.dataset.fileId)))).sort((a, b) => a - b)
async function pickTag(name) {
  await page.$eval('.file-tree .tag-filter-input', (input, value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })) }, name)
  await page.waitForFunction(value => Array.from(document.querySelectorAll('.file-tree .tag-option')).some(button => button.textContent.includes(value)), {}, name)
  const handle = await page.evaluateHandle(value => Array.from(document.querySelectorAll('.file-tree .tag-option')).find(button => button.textContent.includes(value)), name)
  await handle.click()
}
try {
  await page.goto(base + '/#/pages/project-overview/project-overview?id=42', { waitUntil: 'networkidle0' })
  await page.waitForSelector('.file-tree .tree-item[data-file-id="1"]', { visible: true })
  assert.deepEqual(await visibleIds(), [1, 5, 6])
  await page.click('.file-browse-tab:nth-child(2)')
  await page.waitForSelector('.file-tree .tag-option', { visible: true })
  assert.deepEqual(await visibleIds(), [3, 4, 5])
  assert.match(await page.$eval('.tree-item[data-file-id="3"] .tag-file-location', el => el.textContent), /证据目录.*子目录/)
  await pickTag('待审阅')
  await page.waitForFunction(() => document.querySelectorAll('.file-tree .tree-item[data-file-id]').length === 2)
  assert.deepEqual(await visibleIds(), [3, 4])
  await pickTag('证据')
  await page.waitForFunction(() => document.querySelectorAll('.file-tree .tree-item[data-file-id]').length === 1)
  assert.deepEqual(await visibleIds(), [3])
  assert.match(await page.$eval('.tag-filter-hint', el => el.textContent), /同时包含/)
  await page.click('.tag-filter-toggle')
  assert.equal(await page.$$eval('.selected-tag', rows => rows.length), 2)
  await page.click('.tag-filter-clear')
  assert.deepEqual(await visibleIds(), [3, 4, 5])
  await page.click('.tag-filter-toggle')
  await pickTag('没有文件的标签')
  await page.waitForSelector('.file-tree .tree-empty', { visible: true })
  assert.match(await page.$eval('.file-tree .tree-empty', el => el.textContent), /标签条件/)
  await page.click('.tag-filter-clear')
  await page.click('.file-browse-tab:first-child')
  assert.deepEqual(await visibleIds(), [1, 5, 6])
  await page.focus('.file-browse-tab:nth-child(2)')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.file-tree .tag-option', { visible: true })
  await page.click('.file-browse-tab:first-child')
  await page.click('.tree-item[data-file-id="6"]', { button: 'right' })
  const manage = await page.evaluateHandle(() => Array.from(document.querySelectorAll('.context-menu-item')).find(el => el.textContent.includes('管理标签')))
  await manage.click()
  await page.waitForSelector('.tag-selector .tag-input input', { visible: true })
  await page.type('.tag-selector .tag-input input', '待审阅', { delay: 120 })
  await page.waitForFunction(() => document.querySelector('.tag-selector .tag-option')?.textContent.includes('待审阅'))
  await page.click('.tag-selector .tag-option')
  await page.waitForSelector('.awd-dialog .tag-chip', { visible: true })
  assert.deepEqual(files[5].tags.map(tag => tag.id), [7])
  await page.keyboard.press('Escape')
  await page.click('.file-browse-tab:nth-child(2)')
  await page.waitForSelector('.tree-item[data-file-id="6"]', { visible: true })
  await pickTag('待审阅')
  assert.deepEqual(await visibleIds(), [3, 4, 6])
  await page.click('.tree-item[data-file-id="6"]', { button: 'right' })
  await (await page.evaluateHandle(() => Array.from(document.querySelectorAll('.context-menu-item')).find(el => el.textContent.includes('管理标签')))).click()
  await page.waitForSelector('.awd-dialog .tag-close', { visible: true })
  await page.click('.awd-dialog .tag-close')
  await page.waitForSelector('.tree-item[data-file-id="6"]', { hidden: true })
  await page.keyboard.press('Escape')
  await page.click('.tag-filter-clear')
  for (const width of [220, 260, 420]) {
    for (const theme of ['light', 'dark']) {
      await page.evaluate(({ width, theme }) => {
        document.querySelector('.sidebar-left').style.setProperty('width', width + 'px', 'important')
        document.documentElement.setAttribute('data-theme', theme)
        document.documentElement.classList.toggle('dark', theme === 'dark')
      }, { width, theme })
      await page.$eval('.tag-filter-input', input => { input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })) })
      await new Promise(resolve => setTimeout(resolve, 200))
      const bounds = await page.$eval('.file-tree', element => ({ width: element.clientWidth, scroll: element.scrollWidth, optionHeight: element.querySelector('.tag-filter-options').clientHeight, optionScroll: element.querySelector('.tag-filter-options').scrollHeight }))
      assert.ok(bounds.scroll <= bounds.width + 1, JSON.stringify({ width, theme, bounds }))
      assert.ok(bounds.optionHeight <= 146 && bounds.optionScroll > bounds.optionHeight, JSON.stringify(bounds))
      await (await page.$('.sidebar-left')).screenshot({ path: out + '/explorer-' + width + '-' + theme + '.png' })
    }
  }
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, checks: ['collapsed-folder media', 'AND filters', 'selected chips', 'clear', 'empty state', 'folder restoration', 'keyboard switch', 'right-click add/remove updates tag results', '220/260/420 widths', 'light/dark'], screenshots: out }))
} catch (error) { await page.screenshot({ path: out + '/failure.png' }); console.error(errors); throw error } finally { await browser.close() }
