// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real ChatInterface, isolated Chromium, synthetic file APIs/SSE only.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import puppeteer from 'puppeteer-core'
const root = fileURLToPath(new URL('../../', import.meta.url))
const fixture = fileURLToPath(new URL('./', import.meta.url))
const server = await createServer({ configFile: false, root: fixture, plugins: [{ name: 'h5-conditional', enforce: 'pre', transform(code, id) { if (id.endsWith('.vue')) return code.replace(/\/\/ #ifndef H5[\s\S]*?\/\/ #endif/g, '') } }, vue()], resolve: { alias: { '@': `${root}src` }, dedupe: ['vue'] }, server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } } })
await server.listen()
const port = server.httpServer.address().port
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage()
const errors = []
page.on('pageerror', error => { errors.push(error.message); console.error('PAGE', error.message) })
try {
  await page.setViewport({ width: 420, height: 860 })
  await page.goto(`http://127.0.0.1:${port}/?provider=local`)
  await page.waitForFunction(() => window.ready)
  const source = readFileSync(`${root}src/App.vue`, 'utf8')
  const tokens = source.slice(source.indexOf("html,\nhtml[data-theme='light']"), source.indexOf('</style>', source.indexOf("html,\nhtml[data-theme='light']")))
  await page.addStyleTag({ content: `${tokens}\nhtml,body,#app{margin:0;height:100%;font-family:system-ui}view,scroll-view{display:block}text{display:inline}*{box-sizing:border-box}` })
  assert.equal(await page.evaluate(async () => {
    for (let id = 100; id < 600; id++) window.chatState.addFile({ id, name: `file-${id}.txt` })
    window.chatState.addFile({ id: 900, name: 'large-folder', isDir: true })
    await new Promise(resolve => requestAnimationFrame(resolve))
    return window.chatState.contextFiles.length
  }), 501)
  assert.match(await page.$eval('.attachment-status', el => el.textContent), /数量不限/)
  await page.evaluate(async () => {
    document.querySelector('.chat-input-rich').append(' 请检查优先材料')
    await window.chatState.handleSubmit()
  })
  assert.equal(await page.evaluate(() => window.chatPosts.at(-1).contextItems.length), 501)
  assert.equal(await page.evaluate(() => window.chatPosts.at(-1).contextItems.at(-1).isDir), true)
  await page.waitForFunction(() => window.sseController)
  await page.evaluate(() => window.sseController.enqueue(new TextEncoder().encode('event: context_progress\ndata: {"completed":3,"total":501,"name":"file-102.txt","done":false}\n\n')))
  await page.waitForFunction(() => [...document.querySelectorAll('.attachment-status')].some(el => el.textContent.includes('3/501')))
  await page.screenshot({ path: '/tmp/multifile-preparing.png' })
  await page.evaluate(() => window.sseController.enqueue(new TextEncoder().encode('event: context_notice\ndata: {"kind":"deferred","detail":"498"}\n\nevent: error\ndata: {"code":"CONTEXT_PREPARATION_TIMEOUT","messageKey":"chat.contextPreparationTimeout","message":"fallback"}\n\n')))
  await page.waitForFunction(() => document.body.textContent.includes('附件准备超时'))
  assert.equal(await page.evaluate(() => window.chatState.contextFiles.length), 501)
  // Reset into an independent synthetic turn, then import nested browser files.
  await page.evaluate(async () => {
    window.chatState.startNewChat()
    window.importCalls = []
    const request = window.uni.request
    let id = 1000
    window.uni.request = args => {
      if (args.method === 'POST' && /\/files\/(?:file|folder)$/.test(args.url)) {
        const record = { id: ++id, name: args.data.name, isFolder: args.url.endsWith('/folder'), fileType: args.data.fileType, parentId: args.data.parentId }
        window.importCalls.push(record)
        args.success({ statusCode: 200, data: record })
        return
      }
      return request(args)
    }
    window.XMLHttpRequest = class {
      open(method, url) { this.url = url }
      setRequestHeader() {}
      send() {
        if (window.hangUploads) { window.hangingUpload = this; return }
        this.status = window.failUpload ? 500 : 200
        window.failUpload = false
        setTimeout(() => { this.onload?.(); this.onloadend?.() }, 10)
      }
      abort() { this.onabort?.(); this.onloadend?.() }
    }
    window.chatState.uploadSelectedFiles = [
      { name: 'a.txt', relativePath: 'bundle/a.txt', size: 1, fileObject: new File(['a'], 'a.txt') },
      { name: 'b.txt', relativePath: 'bundle/nested/b.txt', size: 1, fileObject: new File(['b'], 'b.txt') },
    ]
    window.failUpload = true
    await window.chatState.confirmUploadAndAddContext()
  })
  assert.deepEqual(await page.evaluate(() => ({ done: window.chatState.importBatch.completed, retry: window.chatState.importRemaining })), { done: 1, retry: 1 })
  await page.evaluate(() => window.chatState.runPendingImports())
  assert.deepEqual(await page.evaluate(() => window.importCalls.map(item => [item.name, item.parentId])), [['bundle', null], ['a.txt', 1001], ['nested', 1001], ['b.txt', 1003]])
  assert.equal(await page.evaluate(() => window.chatState.importBatch.completed), 2)
  // Cancellation releases a stalled transport; retry skips unknown outcomes.
  await page.evaluate(() => {
    window.hangUploads = true
    window.chat.uploadLocalFilesAndAddContext([new File(['x'], 'slow.txt'), new File(['y'], 'next.txt')])
  })
  await page.waitForFunction(() => window.hangingUpload)
  await page.click('.attachment-status button')
  await page.waitForFunction(() => !window.chatState.importBatch.running)
  assert.deepEqual(await page.evaluate(() => window.chatState.importBatch.items.map(item => item.state)), ['uncertain', 'pending'])
  await page.evaluate(async () => { window.hangUploads = false; await window.chatState.runPendingImports() })
  assert.equal(await page.evaluate(() => window.importCalls.filter(item => item.name === 'slow.txt').length), 1)
  assert.equal(await page.evaluate(() => window.chatState.importBatch.completed), 1)
  // Browser OS folder drop traverses native-style entry handles and keeps the root.
  await page.evaluate(async () => {
    const leaf = { name: 'dropped.txt', isFile: true, file: resolve => resolve(new File(['drop'], 'dropped.txt')) }
    const folder = { name: 'drop-folder', isDirectory: true, createReader() { let read = false; return { readEntries(resolve) { resolve(read ? [] : [leaf]); read = true } } } }
    await window.chat.uploadLocalFilesAndAddContext([], { items: [{ webkitGetAsEntry: () => folder }] })
  })
  assert.equal(await page.evaluate(() => window.chatState.importBatch.completed), 1)
  assert.equal(await page.evaluate(() => {
    const folder = window.importCalls.find(item => item.name === 'drop-folder')
    return window.importCalls.find(item => item.name === 'dropped.txt').parentId === folder.id
  }), true)
  await page.screenshot({ path: '/tmp/multifile-import.png' })
  const beforeScan = await page.evaluate(() => window.importCalls.length)
  await page.evaluate(async () => {
    const leaf = { name: 'partial.txt', isFile: true, file: resolve => resolve(new File(['partial'], 'partial.txt')) }
    const folder = { name: 'incomplete-folder', isDirectory: true, createReader() { let read = false; return { readEntries(resolve, reject) { if (read) reject(new Error('unreadable next page')); else { read = true; resolve([leaf]) } } } } }
    await window.chat.uploadLocalFilesAndAddContext([], { items: [{ webkitGetAsEntry: () => folder }] })
    await window.chatState.runPendingImports()
  })
  assert.equal(await page.evaluate(() => window.chatState.importBatch.scanIncomplete), true)
  assert.equal(await page.evaluate(() => window.chatState.importRemaining), 0)
  assert.equal(await page.evaluate(() => window.importCalls.length), beforeScan)
  assert.match(await page.$eval('.attachment-status', el => el.textContent), /扫描未完成/)
  await page.screenshot({ path: '/tmp/multifile-scan-incomplete.png' })
  assert.deepEqual(errors, [])
  console.log('PASS: 501 references, directory reference, SSE progress/timeout, nested folder import, failed-upload retry without duplicate rows, hung import cancellation, unknown outcome skipped')
} finally { await browser.close(); await server.close() }
