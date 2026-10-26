// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Actual uni-app H5 workbench; synthetic API/receipt, no user's account or files.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, extname } from 'node:path'
import puppeteer from 'puppeteer-core'
const root = resolve('dist/build/h5')
const server = createServer((req,res) => {
  const path = resolve(root, '.' + new URL(req.url,'http://localhost').pathname)
  if (!path.startsWith(root + '/') && path !== root) { res.statusCode=403; return res.end() }
  const file = existsSync(path) && extname(path) ? path : root + '/index.html'
  res.setHeader('Content-Type', ({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[extname(file)] || 'application/octet-stream')
  res.end(readFileSync(file))
})
await new Promise(r => server.listen(0,'127.0.0.1',r))
let browser
try {
  browser = await puppeteer.launch({executablePath:process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,defaultViewport:{width:1000,height:760}})
  const page = await browser.newPage()
  const requests=[]; let failTarget=false
  const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.message)})
  await page.setRequestInterception(true)
  page.on('request',req=>{
    const url=new URL(req.url())
    if(req.method()==='PATCH' && url.pathname.includes('/evidence-links/targets/')) {
      requests.push(JSON.parse(req.postData()))
      return req.respond({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,PATCH,PUT,DELETE,OPTIONS'},body:JSON.stringify(failTarget ? {code:1,message:'合成保存失败'} : {code:0,data:{id:7,...requests.at(-1)}})})
    }
    if(url.pathname.startsWith('/api/') || url.origin !== `http://127.0.0.1:${server.address().port}`) return req.respond({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,PATCH,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'*'},body:JSON.stringify({code:0,data:[]})})
    req.continue()
  })
  await page.evaluateOnNewDocument(()=>{localStorage.setItem('awd_app_language','zh-CN')})
  await page.goto(`http://127.0.0.1:${server.address().port}/#/pages/project-overview/project-overview`)
  await page.waitForSelector('.page-project-overview')
  async function receipt() {
    await page.waitForSelector('.page-project-overview')
    await page.evaluate(()=>{
      let node=document.querySelector('.page-project-overview').__vueParentComponent
      while(node && !node.proxy?.showEvidenceMethodBar) node=node.parent
      if(!node) throw Error('workbench instance unavailable')
      window.workbench=node.proxy
      window.workbench.isEvidenceBarOnActiveDoc=()=>true
      window.workbench.showEvidenceMethodBar({side:'left',fileName:'合成证据材料.pdf',targetId:7,linkKey:'EVID_TEST',docFileId:10})
    })
    await page.waitForSelector('.evidence-bar')
  }
  await receipt()
  await page.waitForSelector('.evidence-bar')
  mkdirSync('/tmp/evidence-1501-ui',{recursive:true})
  assert.equal(await page.$eval('.evidence-bar',el=>el.textContent.includes('方法：')),false)
  assert.equal(await page.$eval('.tag-options .tag-manage',el=>el.tagName),'UNI-BUTTON','must exercise the actual uni control')
  await page.focus('.tag-options .tag-manage'); await page.keyboard.press('Enter')
  await page.waitForSelector('.tag-editor')
  await page.click('.tag-presets .tag-chip:nth-of-type(2)')
  await page.waitForFunction(()=>document.querySelector('.tag-row input')?.value==='原件核对')
  async function input(index,value) {
    const el=(await page.$$('.tag-row input'))[index]
    await el.click({clickCount:3}); await page.keyboard.press('Backspace'); await el.type(value)
  }
  await input(0,'客户确认')
  await page.click('.tag-row:nth-child(2) .tag-manage')
  await page.waitForFunction(()=>document.querySelectorAll('.tag-row input').length===4 && document.querySelectorAll('.tag-row input')[1].value==='关联性分析')
  await page.click('.tag-editor > .tag-manage')
  await page.waitForFunction(()=>document.querySelectorAll('.tag-row input').length===5)
  await input(4,'补充凭证')
  await page.focus('.tag-actions .tag-chip'); await page.keyboard.press('Space')
  await page.waitForFunction(()=>!document.querySelector('.tag-editor'))
  assert.deepEqual(await page.$$eval('.tag-options .tag-chip',els=>els.map(e=>e.textContent)),['书面审查','客户确认','关联性分析','证明目的','待补充','补充凭证'])
  await page.reload(); await receipt()
  assert.equal(await page.$$eval('.tag-options .tag-chip',els=>els.some(e=>e.textContent==='客户确认')),true,'saved favorites survive remount/reload')
  await page.click('.tag-options .tag-chip:nth-child(2)')
  await page.waitForFunction(()=>document.querySelector('.tag-chip.on')?.textContent==='客户确认')
  assert.deepEqual(requests.at(-1),{method:'客户确认'})
  failTarget=true
  await page.click('.tag-options .tag-chip:nth-child(2)')
  await page.waitForSelector('.evidence-bar [role=alert]')
  assert.equal(await page.$eval('.tag-chip.on',el=>el.textContent),'客户确认')
  failTarget=false
  await page.click('.tag-options .tag-chip:nth-child(2)')
  await page.waitForFunction(()=>document.querySelector('.tag-chip.on')?.textContent==='关联性分析')
  await page.click('.tag-options .tag-manage')
  await input(1,'客户确认')
  await page.click('.tag-actions .tag-chip')
  assert.match(await page.$eval('.tag-error',el=>el.textContent),/重复/)
  await page.click('.tag-actions .tag-manage')
  await page.click('.tag-options .tag-manage')
  await page.evaluate(()=>{window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.includes('awd_evidence_tags'))throw Error('synthetic quota');return window.originalSetItem.call(this,key,value)}})
  await page.click('.tag-actions .tag-chip')
  assert.match(await page.$eval('.tag-error',el=>el.textContent),/未保存/)
  await page.evaluate(()=>Storage.prototype.setItem=window.originalSetItem)
  await page.click('.tag-actions .tag-manage')
  await page.screenshot({path:'/tmp/evidence-1501-ui/workbench.png'})
  await page.click('.tag-options .tag-manage')
  await page.screenshot({path:'/tmp/evidence-1501-ui/settings.png'})
  await page.setViewport({width:420,height:760})
  await page.evaluate(()=>{document.documentElement.dataset.theme='dark'; document.querySelector('.evidence-bar').parentElement.style.width='320px'})
  const bounds=await page.$eval('.evidence-bar',el=>{const b=el.getBoundingClientRect(),p=el.parentElement.getBoundingClientRect(),e=el.querySelector('.tag-editor').getBoundingClientRect();return {bar:b.right<=p.right+1,editor:e.right<=p.right+1,top:e.top>=0}})
  assert.deepEqual(bounds,{bar:true,editor:true,top:true})
  await page.screenshot({path:'/tmp/evidence-1501-ui/narrow-dark.png'})
  assert.deepEqual(errors,[])
  console.log('PASS actual uni workbench: edit/add/remove/preset/reload/target PATCH/failure/retry/keyboard/narrow layout')
} finally {
  await browser?.close()
  await new Promise(r=>server.close(r))
}
