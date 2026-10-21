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
  assert.match(content, /使用内置引擎导出 PDF/)
  await new Promise(resolve => setTimeout(resolve, 3500))
  assert.ok(await page.$('.awd-dlg'), 'error remains visible after the old toast timeout')
  await page.screenshot({ path: out + '/01-missing-libreoffice.png' })
  await page.click('.awd-dlg__confirm')
  await page.waitForFunction(() => [...document.querySelectorAll('.tab-item')].some(el => el.textContent.includes('合成合同.docx')))
  await page.waitForFunction(() => {
    let instance = document.querySelector('.page-project-overview')?.__vueParentComponent
    while (instance) {
      if (instance.proxy?._libreRefs?.['left:1385']) { window.__pdfVm = instance.proxy; return true }
      instance = instance.parent
    }
    return false
  })
  // Real mounted editor + actual exportPdf method, synthetic engine bytes/desktop download events.
  await page.evaluate(() => {
    const vm = window.__pdfVm, ed = vm._libreRefs['left:1385']
    window.__pdfNeedsRetry = vm.pdfRecovery?.phase === 'failed'
    window.__pdfDownloads = []; window.__pdfCommands = []; window.__pdfDone = []
    window.checkbaDesktop = { fs: {
      onDownloadDone(fn) { window.__pdfDone.push(fn); return () => { window.__pdfDone = window.__pdfDone.filter(x => x !== fn) } },
    } }
    const click = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function () {
      if (this.download.endsWith('.pdf')) window.__pdfDownloads.push(this.download)
      else click.call(this)
    }
    ed.executor = { executeCommand: async action => { window.__pdfCommands.push(action); return { success: true, bytes: new Uint8Array([37,80,68,70]) } } }
    ed.docLoadFailed = false; ed.statusKey = 'ready'; ed.ready = true
  })
  if (await page.evaluate(() => window.__pdfNeedsRetry)) await page.click('.pdf-export-recovery .restart-recovery-action')
  await page.waitForFunction(() => window.__pdfDownloads.length === 1)
  assert.deepEqual(await page.evaluate(() => window.__pdfCommands.filter(x => x === 'export_pdf')), ['export_pdf'])
  assert.equal(await page.evaluate(() => window.__pdfDone.length), 1, 'download completion is still pending')
  assert.equal(await page.evaluate(() => document.body.textContent.includes('已导出')), false)
  await page.screenshot({ path: out + '/02-export-awaiting-save.png' })
  await page.evaluate(() => window.__pdfDone.forEach(fn => fn({ filename: '合成合同.pdf', state: 'completed', savePath: '/synthetic/合成合同.pdf' })))
  await page.waitForFunction(() => document.body.textContent.includes('已导出'))
  await page.screenshot({ path: out + '/03-download-complete.png' })
  await page.evaluate(() => {
    const vm = window.__pdfVm, ed = vm._libreRefs['left:1385']
    ed.ready = false; ed.statusKey = 'openingDoc'
    vm.handleFileTreePdfExport(vm.leftFiles.find(f => f.id === 1385))
  })
  await page.waitForSelector('.pdf-export-recovery', { visible: true })
  const cancel = await page.$$('.pdf-export-recovery .restart-recovery-action')
  await cancel[cancel.length - 1].click()
  await page.evaluate(() => { const ed = window.__pdfVm._libreRefs['left:1385']; ed.statusKey = 'ready'; ed.ready = true })
  await new Promise(resolve => setTimeout(resolve, 200))
  assert.equal(await page.evaluate(() => window.__pdfDownloads.length), 1, 'cancelled readiness must not export later')
  assert.equal(await page.evaluate(() => window.__pdfVm.leftFiles.filter(f => f.id === 1385).length), 1, 'reuse tab without duplicates')
  assert.equal(requests.filter(r => r.path.endsWith('/convert-pdf') && r.method === 'POST').length, 1)
  assert.equal(requests.filter(r => r.path.includes('/upload')).length, 0)
  fs.writeFileSync(out + '/report.json', JSON.stringify({ checks: ['real context menu conversion', 'persistent actionable error', 'normal file-open route', 'mounted editor auto export with synthetic engine bytes', 'success only on download-done', 'cancel blocks late export and keeps tab', 'no save/overwrite'], errors, requests }, null, 2))
} catch (e) {
  await page.screenshot({ path: out + '/failure.png' }); fs.writeFileSync(out + '/failure.html', await page.content()); fs.writeFileSync(out + '/failure.json', JSON.stringify({ requests, errors }, null, 2)); throw e
} finally { await browser.close() }
