// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real sandboxed plugin frame; all account and meeting responses are synthetic.
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const require = createRequire(new URL('../../../frontend/package.json', import.meta.url))
const puppeteer = require('puppeteer-core')
const meetings = Array.from({ length: 35 }, (_, i) => ({ key: 'meeting-' + i, subject: `项目讨论 ${i + 1}：交付安排与会议记录`, meetingCode: '1000' + i, startTime: 1791000000 + i * 3600 }))
const host = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden}iframe{width:100%;height:100%;border:0}</style><iframe sandbox="allow-scripts allow-forms" src="/plugin/index.html"></iframe><script>
window.calls=[];window.frame=document.querySelector('iframe');window.context={pluginId:'tencent-meeting',projectId:7,language:'zh-CN',theme:'light',surface:new URL(location.href).searchParams.get('surface')||'workspace'};
frame.onload=()=>frame.contentWindow.postMessage({awd:1,type:'init',context},'*');
addEventListener('message',event=>{if(event.source!==frame.contentWindow||event.data?.type!=='call')return;
const m=event.data;let result={};if(m.method==='tools.invoke'){const action=m.params.args.action;calls.push(action);let data={};if(action==='status')data={cliAvailable:true,loggedIn:true,userName:'合成测试账号'};if(action==='config')data={lookbackDays:30,excludeKeywords:[]};if(action==='list')data={meetings:${JSON.stringify(meetings)}};if(action==='detail')data={key:'meeting-0',subject:'交付安排讨论',complete:true,paragraphs:Array.from({length:80},(_,i)=>({speaker:'发言人 '+i,text:'合成会议内容，用于检验独立滚动和窄窗口阅读。'.repeat(8),startTime:'00:03'})),smartMinutes:'会议纪要：明确下一步工作。'};result={output:JSON.stringify({success:true,data})};}if(m.method==='events.subscribe')result={subscribed:m.params.events};if(m.method==='context.get')result=context;frame.contentWindow.postMessage({awd:1,type:'result',seq:m.seq,ok:true,result},'*');});
</script>`
const server = createServer(async (req, res) => {
  if (req.url?.startsWith('/?')) { res.setHeader('Content-Type', 'text/html'); return res.end(host) }
  const name = req.url?.replace('/plugin/', '')
  if (!['index.html', 'panel.css', 'panel.js', 'awd-plugin-sdk.js'].includes(name)) { res.statusCode = 404; return res.end() }
  res.setHeader('Content-Type', name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript')
  res.end(await readFile(new URL('../web/' + name, import.meta.url)))
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const origin = 'http://127.0.0.1:' + server.address().port
let browser
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewport({ width: 1120, height: 760 })
  await page.goto(origin + '/?surface=workspace')
  let frame = await (await page.$('iframe')).contentFrame()
  await frame.waitForFunction(() => document.querySelector('.meeting') && !document.querySelector('.meeting').disabled)
  assert.equal(await frame.$eval('#account-panel', e => getComputedStyle(e).display), 'none')
  await frame.click('.meeting')
  await frame.waitForFunction(() => !document.querySelector('#detail').hidden)
  const layout = await frame.evaluate(() => {
    const list = document.querySelector('#meeting-browser').getBoundingClientRect()
    const detail = document.querySelector('#detail').getBoundingClientRect()
    const actions = document.querySelector('.detail-actions').getBoundingClientRect()
    const content = document.querySelector('.detail-content')
    return { sideBySide: detail.left >= list.right - 1, actionsVisible: actions.bottom <= innerHeight, contentScrollable: content.scrollHeight > content.clientHeight, overflow: document.documentElement.scrollWidth > innerWidth }
  })
  assert.deepEqual(layout, { sideBySide: true, actionsVisible: true, contentScrollable: true, overflow: false })
  await frame.$eval('.detail-content', e => { e.scrollTop = 200 })
  assert.equal(await frame.$eval('.meeting-scroll', e => e.scrollTop), 0, 'reading must not move the meeting list')
  await frame.click('#minutes-tab')
  assert.equal(await frame.$eval('#minutes', e => e.hidden), false)
  await frame.focus('#minutes-tab'); await page.keyboard.press('ArrowLeft')
  assert.equal(await frame.$eval('#transcript-tab', e => e.getAttribute('aria-selected')), 'true')
  if (process.env.TMEET_SCREENSHOT_DIR) {
    await mkdir(process.env.TMEET_SCREENSHOT_DIR, { recursive: true })
    await page.screenshot({ path: process.env.TMEET_SCREENSHOT_DIR + '/meeting-workspace.png' })
  }
  await page.setViewport({ width: 360, height: 680 })
  assert.equal(await frame.$eval('#meeting-browser', e => getComputedStyle(e).display), 'none')
  assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await frame.click('#back-to-list')
  assert.notEqual(await frame.$eval('#meeting-browser', e => getComputedStyle(e).display), 'none')
  await frame.type('#search', '100034')
  await frame.waitForFunction(() => document.querySelectorAll('.meeting').length === 1)
  await frame.click('.meeting')
  await frame.waitForFunction(() => !document.querySelector('#detail').hidden)
  await page.evaluate(() => frame.contentWindow.postMessage({ awd:1, type:'theme',theme:'dark',tokens:{'--awd-bg':'#191713','--awd-surface':'#221f1a','--awd-text':'#ede9df'} },'*'))
  await frame.waitForFunction(() => getComputedStyle(document.querySelector('#workspace')).backgroundColor === 'rgb(34, 31, 26)')
  assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  if (process.env.TMEET_SCREENSHOT_DIR) await page.screenshot({ path: process.env.TMEET_SCREENSHOT_DIR + '/meeting-narrow-dark.png' })
  assert.equal(await page.evaluate(() => calls.some(action => ['login','sync'].includes(action))), false)
  await page.setViewport({ width: 280, height: 680 })
  await page.goto(origin + '/?surface=sidebar')
  frame = await (await page.$('iframe')).contentFrame()
  await frame.waitForFunction(() => document.querySelector('#connection-status').textContent.includes('合成测试账号'))
  assert.equal(await frame.$eval('#workspace', e => getComputedStyle(e).display), 'none')
  assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await frame.click('#settings summary')
  assert.equal(await frame.$eval('#settings', e => e.open), true)
  assert.equal(await page.evaluate(() => calls.some(action => ['list','detail','login','sync'].includes(action))), false)
  if (process.env.TMEET_SCREENSHOT_DIR) await page.screenshot({ path: process.env.TMEET_SCREENSHOT_DIR + '/meeting-account-sidebar.png' })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, checks: ['wide split layout', 'independent scrolling', 'visible action bar', 'narrow list/detail navigation', 'search', 'keyboard tabs', 'dark theme', '280px account sidebar', 'no implicit login or sync', 'no page errors'] }))
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(done => server.close(done)) }
