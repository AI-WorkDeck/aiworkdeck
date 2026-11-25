#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// D24 follow-up: load the bundled Monaco the way DocDiffViewer does (new URL('static/monaco/vs',
// document.baseURI)) in a real headless browser, create a diff editor and wait for the worker's
// diff. Run against the dev server or a built H5 dist:
//   node tests/build/monaco-load.mjs http://127.0.0.1:5174/           (uni dev server)
//   node tests/build/monaco-load.mjs dist/build/h5                     (built app; served here)
//   node tests/build/monaco-load.mjs dist/build/h5/index.html          (packaged layout: the desktop loads file://)
// Env: PUPPETEER_EXECUTABLE_PATH (Chrome for Testing). Fails on any request outside the origin.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const target = process.argv[2] || 'http://127.0.0.1:5174/'
let server
let base = target
if (target.endsWith('index.html')) {
  base = 'file://' + path.resolve(target)
} else if (!/^https?:/.test(target)) {
  const root = path.resolve(target)
  const types = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json' }
  server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0])
    let file = path.join(root, rel === '/' ? 'index.html' : rel)
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end() }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream')
    fs.createReadStream(file).pipe(res)
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}/`
}

const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH, headless: 'new', args: ['--no-sandbox'] })
let failed = false
try {
  const page = await browser.newPage()
  const origin = base.startsWith('file:') ? 'file://' : new URL(base).origin
  const foreign = []
  const missing = []
  page.on('request', r => { if (!r.url().startsWith(origin) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) foreign.push(r.url()) })
  page.on('response', r => { if (r.url().includes('/monaco/') && r.status() >= 400) missing.push(r.status() + ' ' + r.url()) })
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  const result = await page.evaluate(() => new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, why: 'timeout' }), 30000)
    const vs = new URL('static/monaco/vs', document.baseURI).href
    const s = document.createElement('script')
    s.src = vs + '/loader.js'
    s.onerror = () => resolve({ ok: false, why: 'loader.js failed to load' })
    s.onload = () => {
      window.require.config({ paths: { vs } })
      window.require(['vs/editor/editor.main'], (monaco) => {
        const host = document.createElement('div')
        host.style.cssText = 'width:800px;height:400px'
        document.body.appendChild(host)
        const editor = monaco.editor.createDiffEditor(host, { readOnly: true })
        editor.onDidUpdateDiff(() => {
          clearTimeout(timer)
          resolve({ ok: true, changes: (editor.getLineChanges() || []).length })
        })
        editor.setModel({
          original: monaco.editor.createModel('甲方应于五日内付款。\nsame line', 'plaintext'),
          modified: monaco.editor.createModel('甲方应于十日内付款。\nsame line', 'plaintext'),
        })
      }, (err) => resolve({ ok: false, why: String(err && err.message || err) }))
    }
    document.head.appendChild(s)
  }))
  console.log(JSON.stringify({ base, ...result, missing, foreign }))
  if (!result.ok || result.changes !== 1 || missing.length || foreign.length) failed = true
} finally {
  await browser.close()
  if (server) server.close()
}
console.log(failed ? 'FAIL monaco-load' : 'PASS monaco-load')
process.exit(failed ? 1 : 0)
