// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real uni FileTree/Modal, synthetic API failure; never contacts an installed backend.
import puppeteer from 'puppeteer-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const base = process.env.PDF_RECOVERY_UI_BASE || 'http://127.0.0.1:5208'
const out = process.env.PDF_RECOVERY_UI_OUT || '/tmp/awd-pdf-recovery-ui'
fs.mkdirSync(out, { recursive: true })
const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage(), requests = [], errors = []
const file = { id: 1385, projectId: 42, name: '合成合同.docx', fileType: 'docx', isFolder: false, isDeleted: false, filePath: '/synthetic/contract.docx', wpsFileId: 'local-1385' }
page.on('pageerror', e => errors.push(e.message))
await page.setViewport({ width: 1440, height: 900 })
await page.evaluateOnNewDocument(() => {
  if (!sessionStorage.getItem('pdf-recovery-seeded')) {
    localStorage.clear(); localStorage.setItem('awd_app_language', 'zh-CN'); sessionStorage.setItem('pdf-recovery-seeded', '1')
  }
})
await page.setRequestInterception(true)
page.on('request', async request => {
  const url = new URL(request.url())
  if (!url.pathname.startsWith('/api/')) {
    if (url.origin !== new URL(base).origin && !['blob:', 'data:'].includes(url.protocol)) return request.abort()
    return request.continue()
  }
  requests.push({ path: url.pathname, method: request.method() })
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }
  if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers })
  let body = []
  if (url.pathname === '/api/projects/42') body = { id: 42, name: 'PDF 合成验收', userId: 7, projectType: 'BLANK' }
  else if (url.pathname === '/api/projects/42/files') body = [file]
  else if (url.pathname.endsWith('/convert-pdf')) body = { code: 400, message: '未找到可用的 LibreOffice。请在内置编辑器中打开文档，从「文件 → 导出为」导出 PDF；未生成有损替代文件。' }
  else if (url.pathname === '/api/auth/me') body = { id: 7, username: 'synthetic' }
  else if (url.pathname.includes('/status')) body = { enabled: false, connected: false, mode: 'none' }
  else if (url.pathname.includes('/profile') || url.pathname.includes('/admin/config')) body = {}
  return request.respond({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(body) })
})
try {
  await page.goto(base + '/#/pages/project-overview/project-overview?id=42&pane=files', { waitUntil: 'networkidle0' })
  await page.waitForSelector('.tree-item', { visible: true })
  await page.click('.tree-item', { button: 'right' })
  await page.waitForSelector('.context-menu', { visible: true })
  const menu = await page.$$('.context-menu-item')
  let clicked = false
  for (const item of menu) if ((await item.evaluate(el => el.textContent)).trim() === '转为 PDF') { await item.click(); clicked = true; break }
  assert.ok(clicked, 'real context menu exposes conversion')
  await page.waitForSelector('.awd-dlg', { visible: true })
  const content = await page.$eval('.awd-dlg', el => el.textContent)
  assert.match(content, /未找到可用的 LibreOffice/)
  assert.match(content, /在内置编辑器中打开/)
  await new Promise(resolve => setTimeout(resolve, 3500))
  assert.ok(await page.$('.awd-dlg'), 'error remains visible after the old toast timeout')
  await page.screenshot({ path: out + '/01-missing-libreoffice.png' })
  await page.click('.awd-dlg__confirm')
  await page.waitForFunction(() => [...document.querySelectorAll('.tab-item')].some(el => el.textContent.includes('合成合同.docx')))
  await page.screenshot({ path: out + '/02-opened-in-editor.png' })
  assert.equal(requests.filter(r => r.path.endsWith('/convert-pdf') && r.method === 'POST').length, 1)
  assert.equal(requests.filter(r => r.path.includes('/upload')).length, 0)
  fs.writeFileSync(out + '/report.json', JSON.stringify({ checks: ['real context menu conversion', 'persistent actionable error', 'normal file-open route', 'no save/overwrite'], errors, requests }, null, 2))
} catch (e) {
  await page.screenshot({ path: out + '/failure.png' }); fs.writeFileSync(out + '/failure.html', await page.content()); fs.writeFileSync(out + '/failure.json', JSON.stringify({ requests, errors }, null, 2)); throw e
} finally { await browser.close() }
