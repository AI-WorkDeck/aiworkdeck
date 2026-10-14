// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../../package.json', import.meta.url))
const puppeteer = require('puppeteer-core')
const executablePath = process.env.IM_BROWSER_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const helper = readFileSync(new URL('../../src/utils/pluginImDrag.js', import.meta.url), 'utf8')
const child = `<!doctype html><style>body{margin:0}button{width:150px;height:36px;margin:20px}</style><button id="drag" draggable="true">拖到 AI</button><script>
let payload; const drag=document.querySelector('button');
const prepare=()=>{const r=drag.getBoundingClientRect();parent.postMessage({prepare:true,rect:{left:r.left,top:r.top,width:r.width,height:r.height}},'*')};
drag.addEventListener('pointerenter',prepare);
addEventListener('message',e=>{if(e.source===parent&&e.data.ticket)payload=e.data.ticket});
drag.addEventListener('dragstart',e=>{parent.postMessage({event:'child-dragstart'},'*');if(!payload){e.preventDefault();return}e.dataTransfer.effectAllowed='copy';e.dataTransfer.setData(payload.dragType,payload.dragToken);e.dataTransfer.setData('application/x-checkba-file',JSON.stringify(payload))});
drag.addEventListener('dragend',()=>parent.postMessage({event:'child-dragend'},'*'));
</script>`
const html = `<!doctype html><style>body{margin:0}iframe{position:absolute;left:20px;top:80px;width:220px;height:120px;border:0}#drop{position:absolute;left:400px;top:80px;width:220px;height:150px;background:#eee}</style>
<input id="focus"><iframe id="plugin" sandbox="allow-scripts allow-forms" src="/child"></iframe><div id="drop">AI drop target</div><script type="module">
import {preparePluginImDrag,endPluginImDrag,consumePluginImDrag} from '/helper';
const frame=document.querySelector('iframe'),owner={sessionGeneration:1};window.events=[];window.result=null;window.second=null;window.useHostHandle=false;window.acceptPrepare=true;window.owner=owner;
window.prepareAt=rect=>preparePluginImDrag(owner,{id:42,name:'synthetic.pdf',fileType:'pdf'},5,window,{frame,rect});
addEventListener('message',e=>{if(e.source!==frame.contentWindow)return;if(e.data.event)events.push(e.data.event);if(e.data.prepare&&window.acceptPrepare){const ticket=preparePluginImDrag(owner,{id:42,name:'synthetic.pdf',fileType:'pdf'},5,window,window.useHostHandle?{frame,rect:e.data.rect}:null);e.source.postMessage({ticket},'*')}});
const drop=document.querySelector('#drop');drop.addEventListener('dragover',e=>{events.push('host-dragover');e.preventDefault();e.dataTransfer.dropEffect='copy'});drop.addEventListener('drop',e=>{e.preventDefault();window.result=consumePluginImDrag(e.dataTransfer,5);events.push('host-drop');window.second=consumePluginImDrag(e.dataTransfer,5)});
window.addEventListener('dragstart',e=>events.push(e.target.hasAttribute('data-awd-plugin-drag-handle')?'host-dragstart':'other-dragstart'));
window.reset=()=>{endPluginImDrag();events=[];result=null;second=null};
</script>`
test('bounded host handle produces a real one-use native drop while opaque iframe drag is diagnostic', { skip: !existsSync(executablePath), timeout: 30000 }, async (t) => {
  const server = createServer((req, res) => { res.setHeader('Content-Type', (req.url === '/helper' ? 'text/javascript' : 'text/html') + '; charset=utf-8'); res.end(req.url === '/helper' ? helper : req.url === '/child' ? child : html) })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const browser = await puppeteer.launch({ executablePath, headless: true, defaultViewport: { width: 900, height: 500 } })
  t.after(async () => { await browser.close(); await new Promise((r) => server.close(r)) })
  const page = await browser.newPage(); page.setDefaultTimeout(5000)
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.waitForFunction(() => typeof window.reset === 'function')
  const drag = async () => {
    await page.mouse.down(); await page.mouse.move(115, 118, { steps: 6 }); await page.mouse.move(470, 130, { steps: 30 }); await page.mouse.up()
  }
  await page.click('#focus'); await page.mouse.move(100, 118)
  const frame = await (await page.$('iframe')).contentFrame()
  await frame.waitForFunction(() => !!payload)
  await drag(); await page.waitForFunction(() => events.includes('child-dragend'))
  t.diagnostic('Opaque iframe baseline: ' + JSON.stringify(await page.evaluate(() => ({ hostDragover: events.includes('host-dragover'), dropReceived: !!result }))))
  await page.mouse.move(300, 300); await page.evaluate(() => { reset(); useHostHandle = true })
  await page.mouse.move(100, 118); await page.waitForSelector('[data-awd-plugin-drag-handle]')
  const bounded = await page.evaluate(() => { const h=document.querySelector('[data-awd-plugin-drag-handle]').getBoundingClientRect(),f=document.querySelector('iframe').getBoundingClientRect();return h.left>=f.left&&h.right<=f.right&&h.top>=f.top&&h.bottom<=f.bottom })
  assert.equal(bounded, true)
  await drag(); await page.waitForFunction(() => events.includes('host-drop'))
  const result = await page.evaluate(() => ({ result, second, events, handles: document.querySelectorAll('[data-awd-plugin-drag-handle]').length }))
  assert.deepEqual(result.result.file, { id: 42, name: 'synthetic.pdf', fileType: 'pdf', isDir: false })
  assert.equal(result.result.handled, true); assert.equal(result.second.file, null); assert.equal(result.handles, 0)
  assert.ok(result.events.includes('host-dragstart')); assert.ok(result.events.includes('host-dragover'))
  assert.equal(result.events.includes('child-dragstart'), false)
  assert.equal(await page.$eval('iframe', (el) => el.getAttribute('sandbox')), 'allow-scripts allow-forms')
  // Stop asynchronous iframe preparation before testing rectangle validation in isolation.
  await page.evaluate(() => { acceptPrepare = false; reset() })
  // Malformed, oversized and entirely out-of-frame rectangles never create a hit target.
  for (const rect of [{ left: 0, top: 0, width: 10000, height: 40 }, { left: 500, top: 0, width: 60, height: 32 }, { left: -500, top: 0, width: 60, height: 32 }, { left: 0, top: 0, width: 60, height: -1 }]) {
    await page.evaluate((r) => prepareAt(r), rect)
    assert.equal(await page.$$eval('[data-awd-plugin-drag-handle]', (els) => els.length), 0)
  }
  await page.evaluate(() => prepareAt({ left: -10, top: -4, width: 80, height: 36 }))
  assert.equal(await page.$$eval('[data-awd-plugin-drag-handle]', (els) => els.length), 1)
  await page.keyboard.press('Escape')
  assert.equal(await page.$$eval('[data-awd-plugin-drag-handle]', (els) => els.length), 0)
})
