// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Actual opaque iframe and headless browser clipboard; no real CLI/account is used.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const require = createRequire(new URL('../../../frontend/package.json', import.meta.url))
const puppeteer = require('puppeteer-core')
const link = 'https://meeting.tencent.com/authorize?code=synthetic-browser-fixture'
const host = `<!doctype html><iframe sandbox="allow-scripts allow-forms" src="/plugin/index.html" style="width:820px;height:760px;border:0"></iframe><script>
window.connected=false;window.statusCalls=0;window.frame=document.querySelector('iframe');
const context={pluginId:'tencent-meeting',projectId:7,language:'zh-CN',theme:'light'};
frame.onload=()=>frame.contentWindow.postMessage({awd:1,type:'init',context},'*');
addEventListener('message',event=>{if(event.source!==frame.contentWindow||event.data?.type!=='call')return;
const m=event.data;let result={};if(m.method==='tools.invoke'){const action=m.params.args.action;let data={};if(action==='login')data={authorizeUrl:${JSON.stringify(link)}};if(action==='status'){statusCalls++;data={cliAvailable:true,loggedIn:connected,loginPending:!connected};}if(action==='config')data={lookbackDays:30,excludeKeywords:[]};if(action==='list')data={meetings:[]};result={output:JSON.stringify({success:true,data})};}if(m.method==='events.subscribe')result={subscribed:m.params.events};if(m.method==='context.get')result=context;frame.contentWindow.postMessage({awd:1,type:'result',seq:m.seq,ok:true,result},'*');});
</script>`
const server = createServer(async (req, res) => {
  const name = req.url?.replace('/plugin/', '')
  if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); return res.end(host) }
  if (!['index.html', 'panel.css', 'panel.js', 'panel-l10n.js', 'awd-plugin-sdk.js'].includes(name)) { res.statusCode = 404; return res.end() }
  res.setHeader('Content-Type', name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript')
  res.end(await readFile(new URL('../web/' + name, import.meta.url)))
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const origin = 'http://127.0.0.1:' + server.address().port
let browser
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
  const context = await browser.createBrowserContext()
  await context.overridePermissions(origin, ['clipboard-read', 'clipboard-write'])
  const page = await context.newPage()
  await page.goto(origin)
  const frame = await (await page.$('iframe')).contentFrame()
  await frame.waitForFunction(() => !document.querySelector('#login').disabled)
  await frame.click('#login')
  await frame.waitForFunction(() => !document.querySelector('#authorization').hidden)
  await frame.click('#copy-url')
  await frame.waitForFunction(() => document.querySelector('#feedback').textContent.length > 0)
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), link, 'real clipboard must contain the exact authorization link')
  assert.match(await frame.$eval('#feedback', el => el.textContent), /已复制/)
  assert.equal(await frame.evaluate(() => location.origin), origin, 'URL origin is not sandbox privileges')
  assert.equal(await frame.evaluate(() => { try { localStorage.getItem('x'); return false } catch { return true } }), true, 'sandbox stays opaque')
  await page.evaluate(() => { window.connected = true })
  await frame.evaluate(() => window.dispatchEvent(new Event('focus')))
  await frame.waitForFunction(() => document.querySelector('#authorization').hidden && !document.querySelector('#sync').disabled)
  assert.match(await frame.$eval('#connection-status', el => el.textContent), /已连接/)
  console.log(JSON.stringify({ passed: true, checks: ['opaque iframe', 'actual isolated clipboard readback', 'authorization focus refresh', 'sync enabled after connection'] }))
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(done => server.close(done)) }
