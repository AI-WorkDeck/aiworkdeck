// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Built search iframe + actual host service bridge. Backend data is synthetic.
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const out = process.env.TAG_FILTER_UI_OUT || '/tmp/awd-1446-ui'
await mkdir(out, { recursive: true })
const host = `<!doctype html><meta charset="UTF-8"><body style="margin:0"><iframe id="plugin" sandbox="allow-scripts allow-forms" style="width:260px;height:720px;border:0"></iframe><script type="module">
import { createPluginBusinessServices } from '/business-services.js';
const frame=document.querySelector('iframe');window.frame=frame;window.calls=[];window.opened=[];window.failSearch=false;
window.tags=[{id:7,name:'待审阅',color:'#9a5f20'},{id:8,name:'证据',color:'#a12b37'}];
window.files=[{id:1,name:'合同.docx',fileType:'docx',tags:[tags[0],tags[1]]},{id:2,name:'照片.jpg',fileType:'jpg',tags:[tags[0]]},{id:3,name:'录音.mp3',fileType:'mp3',tags:[tags[1]]}];
const api={getProjectTags:async()=>tags,searchProjectContent:async(id,p)=>{calls.push(p);if(failSearch)throw Error('synthetic offline');const results=files.filter(f=>p.tagIds.every(id=>f.tags.some(t=>t.id===id))&&f.name.includes(p.query)&&(!p.fileTypes||p.fileTypes.includes(f.fileType))).map(f=>({...f,fileId:f.id,fileName:f.name,filePath:'projects/42/资料/'+f.name,matchCount:0,matches:[]}));return {totalMatches:0,totalFiles:results.length,results};}};
const services=createPluginBusinessServices({api,projectId:()=>42,permissions:()=>['file_read'],isCurrent:()=>true,listFiles:async()=>files,openFile:f=>opened.push(f.id)});
frame.onload=()=>frame.contentWindow.postMessage({awd:1,type:'init',context:{pluginId:'search',projectId:'42',language:'zh-CN',theme:'light',themeTokens:{'--awd-bg':'#f1efe7','--awd-surface':'#fcfbf7','--awd-text':'#2b2a26','--awd-text-2':'#6b675c','--awd-text-3':'#888','--awd-panel-text':'#2b2a26','--awd-panel-text-2':'#6b675c','--awd-panel-pad-x':'10px','--awd-panel-gap':'8px','--awd-space-1':'4px','--awd-panel-fs':'12px','--awd-panel-fs-meta':'11px','--awd-control-height':'32px','--awd-panel-radius':'6px','--awd-border':'#bbb','--awd-panel-border':'#bbb','--awd-accent-text':'#285d52','--awd-panel-accent-wash':'#e5efeb','--awd-panel-hover':'#e9e6dc','--awd-font-size-body':'13px','--awd-focus-width':'2px','--awd-focus-offset':'2px'}}},'*');
addEventListener('message',async e=>{if(e.source!==frame.contentWindow||e.data?.type!=='call')return;const m=e.data;try{let result={};if(m.method==='events.subscribe')result={subscribed:m.params.events};if(m.method==='services.request')result=await services.request(m.params.service,m.params.operation,m.params.params);frame.contentWindow.postMessage({awd:1,type:'result',seq:m.seq,ok:true,result},'*');}catch(err){frame.contentWindow.postMessage({awd:1,type:'result',seq:m.seq,ok:false,error:{code:'failed',message:err.message}},'*');}});
frame.src='/plugin/index.html';
</script>`
const server = createServer(async (req, res) => {
  if (req.url === '/favicon.ico') { res.statusCode = 204; return res.end() }
  if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); return res.end(host) }
  if (req.url === '/business-services.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(await readFile(resolve(root, 'src/utils/pluginBusinessServices.js'))) }
  const match = /^\/plugin\/([a-zA-Z0-9_.\/-]+)$/.exec(req.url || '')
  if (!match || match[1].includes('..')) { res.statusCode = 404; return res.end() }
  try {
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(match[1])] || 'application/octet-stream')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.end(await readFile(resolve(root, '../official-plugins/search/web', match[1])))
  } catch { res.statusCode = 404; res.end() }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
let browser
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.stack || e.message))
  await page.goto('http://127.0.0.1:' + server.address().port)
  const frame = await (await page.$('#plugin')).contentFrame()
  await frame.waitForSelector('.tag-option', { visible: true })
  await frame.click('.tag-option[title="待审阅"]')
  await frame.waitForFunction(() => document.querySelectorAll('.file-group').length === 2)
  assert.deepEqual(await frame.$$eval('.file-name', rows => rows.map(row => row.textContent)), ['合同.docx', '照片.jpg'])
  assert.equal(await page.evaluate(() => 'fileTypes' in calls.at(-1)), false)
  assert.doesNotMatch(await frame.$eval('.search-stats', el => el.textContent), /0.*匹配/)
  await frame.focus('.tag-option[title="证据"]')
  await page.keyboard.press('Space')
  await frame.waitForFunction(() => document.querySelectorAll('.file-group').length === 1)
  assert.equal(await frame.$eval('.file-name', el => el.textContent), '合同.docx')
  await frame.click('.selected-tag[title="证据"]')
  await frame.type('.search-input input', '照片', { delay: 120 })
  await frame.waitForFunction(() => document.querySelectorAll('.file-group').length === 1 && document.querySelector('.file-name')?.textContent === '照片.jpg')
  await frame.click('.file-header')
  await page.waitForFunction(() => opened.length === 1)
  assert.deepEqual(await page.evaluate(() => opened), [2])
  // Existing search reacts to host file-tag changes without reopening the plugin.
  await page.evaluate(() => { files[1].tags = []; frame.contentWindow.postMessage({awd:1,type:'event',event:'files.changed',data:{}},'*') })
  await frame.waitForFunction(() => document.querySelector('.search-stats')?.textContent.includes('未找到结果'))
  await frame.click('.clear-icon')
  await frame.waitForSelector('.file-group', { visible: true })
  await page.evaluate(() => { window.failSearch = true })
  await frame.click('.tag-option[title="证据"]')
  await frame.waitForSelector('.search-error', { visible: true })
  assert.equal(await frame.$('.file-group'), null, 'failed filters must hide stale results')
  await page.evaluate(() => { window.failSearch = false })
  await frame.click('.search-retry')
  await frame.waitForSelector('.file-group', { visible: true })
  await frame.click('.tag-filter-clear')
  await frame.click('.tag-option[title="证据"]')
  await frame.waitForFunction(() => document.querySelectorAll('.file-group').length === 2)
  assert.deepEqual(await frame.$$eval('.file-name', rows => rows.map(row => row.textContent)), ['合同.docx', '录音.mp3'])
  for (const width of [220, 260, 420]) {
    await page.$eval('#plugin', (el, width) => { el.style.width = width + 'px' }, width)
    assert.equal(await frame.$eval('.search-panel', el => el.scrollWidth <= el.clientWidth + 1), true)
  }
  await page.$eval('#plugin', el => { el.style.width = '260px' })
  await frame.waitForSelector('uni-toast', { hidden: true })
  await (await page.$('#plugin')).screenshot({ path: out + '/search-260-light.png' })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, checks: ['built iframe', 'real service bridge', 'tag-only media', 'AND', 'keyboard tags', 'keyword+tag', 'row open', 'live changes', 'durable error/retry', 'narrow widths'], screenshots: out }))
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(done => server.close(done)) }
