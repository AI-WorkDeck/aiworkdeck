// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real compiled Uni UI in an opaque-origin iframe. The protocol host is a
// controlled fixture; installation/server ACL coverage belongs to integration QA.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }
const host = `<!doctype html><body style="margin:0"><iframe id="plugin" sandbox="allow-scripts allow-forms" style="width:320px;height:720px;border:0" src="/api/plugin-web/search/index.html"></iframe><script>
window.calls=[];window.frame=document.querySelector('iframe');
localStorage.setItem('checkba_session_id','host-test-secret');
frame.onload=()=>frame.contentWindow.postMessage({awd:1,type:'init',context:{pluginId:'search',projectId:'7',language:'zh-CN',theme:'light',themeTokens:{'--awd-surface':'#fff','--awd-text':'#222','--awd-text-2':'#666','--awd-panel-pad-x':'12px','--awd-panel-fs':'13px'}}},'*');
addEventListener('message',e=>{if(e.source!==frame.contentWindow||e.data?.type!=='call')return;const m=e.data;calls.push(m);let result={};
if(m.method==='events.subscribe')result={subscribed:m.params.events};
if(m.method==='services.request'&&m.params.operation==='tags')result=[];
if(m.method==='services.request'&&m.params.operation==='query')result={totalMatches:1,totalFiles:1,results:[{fileId:3,fileName:'alpha.txt',fileType:'txt',filePath:'alpha.txt',matchCount:1,matches:[{lineNumber:1,line:'alpha',content:'alpha',startIndex:0,endIndex:5}],tags:[]}]};
frame.contentWindow.postMessage({awd:1,type:'result',seq:m.seq,ok:true,result},'*');});</script>`
const server = createServer(async (req, res) => {
  if (req.url === '/favicon.ico') { res.statusCode = 204; return res.end() }
  if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); return res.end(host) }
  const match = /^\/api\/plugin-web\/(search|desensitize)\/([a-zA-Z0-9_.\/-]+)$/.exec(req.url || '')
  if (!match || match[2].includes('..')) { res.statusCode = 404; return res.end() }
  try {
    const body = await readFile(resolve(root, '../official-plugins', match[1], 'web', match[2]))
    res.setHeader('Content-Type', mime[extname(match[2])] || 'application/octet-stream')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'")
    res.end(body)
  } catch { res.statusCode = 404; res.end() }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
let browser
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', async m => { if (m.type() === 'error') errors.push((await Promise.all(m.args().map(arg => arg.evaluate(value => value?.stack || value?.message || String(value)).catch(() => m.text())))).join(' ')) })
  await page.goto('http://127.0.0.1:' + server.address().port)
  const element = await page.$('#plugin')
  const frame = await element.contentFrame()
  await frame.waitForSelector('.search-input input', { timeout: 20000 }).catch(error => { throw new Error(error.message + '\n' + errors.join('\n')) })
  await frame.type('.search-input input', 'alpha')
  await page.waitForFunction(() => window.calls.some(c => c.method === 'services.request' && c.params.operation === 'query' && c.params.params.query === 'alpha'), { timeout: 10000 }).catch(async error => {
    throw new Error(error.message + '\n' + JSON.stringify(await page.evaluate(() => window.calls)) + '\n' + errors.join('\n'))
  })
  await frame.waitForSelector('.file-name')
  await frame.click('.file-name')
  await page.waitForFunction(() => window.calls.some(c => c.method === 'services.request' && c.params.operation === 'open' && c.params.params.fileId === 3))
  const opaque = await frame.evaluate(() => { try { parent.localStorage.getItem('checkba_session_id'); return false } catch { return localStorage.getItem('checkba_session_id') === null } })
  assert.equal(opaque, true, 'plugin must not read host storage')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, nativeUniInput: true, searchAndOpen: true, opaqueOrigin: true }))
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(done => server.close(done)) }
