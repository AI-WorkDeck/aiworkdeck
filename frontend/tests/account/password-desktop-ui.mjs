// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Actual desktop unlock route; isolated browser with synthetic API responses only.
import puppeteer from 'puppeteer-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const out = process.env.AUTH_UI_OUT || '/tmp/awd-auth-ui'
fs.mkdirSync(out,{recursive:true})
const browser = await puppeteer.launch({executablePath:process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',headless:true})
const calls=[], errors=[]
try {
  const page=await browser.newPage()
  await page.setViewport({width:1366,height:1000})
  page.on('pageerror',e=>errors.push(e.message))
  await page.evaluateOnNewDocument(()=>{
    localStorage.setItem('awd_app_language','zh-CN')
    localStorage.setItem('awd_site_preselected','1')
    window.checkbaDesktop={ocr:{},shell:{openExternal(){}}}
  })
  let site='cn', loginOk=false
  await page.setRequestInterception(true)
  page.on('request',async req=>{
    const url=new URL(req.url())
    if(url.pathname.startsWith('/api/')) {
      const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'}
      if(req.method()==='OPTIONS') return req.respond({status:204,headers})
      let body={}
      try{ body=req.postData()?JSON.parse(req.postData()):{} }catch{}
      calls.push({path:url.pathname,body})
      let data={}, envelope=true
      if(url.pathname==='/api/site') {
        envelope=false;data={current:site,pinned:false,multiSite:true,sites:[{id:'cn',displayName:'中国大陆',baseUrl:'https://www.aiworkdeck.com'},{id:'intl',displayName:'International',baseUrl:'https://www.workdeck.ai'}]}
      } else if(url.pathname==='/api/site/select') { site=body.site; envelope=false; data={site,changed:true} }
      else if(url.pathname==='/api/license/status') {envelope=false;data={mode:'none',unlocked:false,trialCodeEnabled:false,accountConnected:false}}
      else if(url.pathname.includes('captcha-config')) data={provider:null}
      else if(url.pathname==='/api/account/login' && body.code) data={passwordSetupRequired:true,setupToken:'desktop-restricted',account:body.phone||body.email,expiresAt:Date.now()+300000}
      else if(url.pathname==='/api/account/login') {loginOk=true;data={connected:true,isNewUser:false}}
      else if(url.pathname==='/api/local-identity/status') {envelope=false;data={selected:true,userId:7}}
      else if(url.pathname==='/api/account/status') data={connected:loginOk}
      else data={ok:true}
      return req.respond({status:200,contentType:'application/json',headers,body:JSON.stringify(envelope?{code:0,data}:data)})
    }
    if(url.hostname!=='127.0.0.1'&&url.protocol.startsWith('http')) return req.respond({status:200,body:''})
    return req.continue()
  })
  const base=process.env.DESKTOP_AUTH_UI_BASE||'http://127.0.0.1:5199'
  const open=async()=>{await page.goto(base+'/#/pages/unlock/unlock',{waitUntil:'networkidle0'});await page.waitForSelector('.unlock-card')}
  const click=async text=>{
    for(const el of await page.$$('.unlock-card button,.unlock-card [role="button"]')) if((await el.evaluate(e=>e.textContent.trim()))===text){await el.click();return}
    throw new Error('Missing desktop action: '+text)
  }
  const consent=async()=>{for(const el of await page.$$('.consent-row')) if(await el.evaluate(e=>e.getAttribute('aria-checked')!=='true')) await (await el.$('.consent-mark')).click()}
  const beginSetup=async()=>{
    await click('首次使用 / 创建密码')
    await page.type('input[type="tel"]','13800138000')
    await page.type('input[autocomplete="one-time-code"]','123456')
    await consent();await click('验证并继续')
    await page.waitForSelector('input[autocomplete="new-password"]',{timeout:10000}).catch(async e=>{await page.screenshot({path:out+'/desktop-failure.png',fullPage:true});console.log(await page.$eval('.unlock-card',el=>el.textContent));console.log(JSON.stringify(calls));throw e})
  }
  await open()
  assert.equal(await page.$('input[autocomplete="one-time-code"]'),null)
  await page.screenshot({path:out+'/desktop-password.png',fullPage:true})
  await beginSetup()
  const inputs=await page.$$('input[autocomplete="new-password"]')
  await inputs[0].type(' desktop-password ');await inputs[1].type('mismatch')
  const before=calls.filter(c=>c.path==='/api/account/password/setup').length
  await click('创建密码')
  await page.waitForFunction(()=>document.body.textContent.includes('两次输入的密码不一致'))
  assert.equal(calls.filter(c=>c.path==='/api/account/password/setup').length,before)
  await inputs[1].click({clickCount:3});await inputs[1].type(' desktop-password ')
  await page.screenshot({path:out+'/desktop-setup.png',fullPage:true})
  await click('创建密码')
  await page.waitForFunction(()=>!document.querySelector('.unlock-card'))
  const setup=calls.find(c=>c.path==='/api/account/password/setup')
  const login=calls.find(c=>c.path==='/api/account/login'&&c.body.password)
  assert.equal(setup.body.password,' desktop-password ')
  assert.equal(login.body.password,' desktop-password ')
  assert.ok(calls.indexOf(setup)<calls.indexOf(login))
  loginOk=false
  await open()
  await click('忘记密码');await page.type('input[type="tel"]','13800138000')
  await page.click('.unlock-code-btn')
  await page.waitForFunction(()=>document.querySelector('.unlock-code-btn').disabled)
  await page.type('input[autocomplete="one-time-code"]','654321')
  const reset=await page.$$('input[autocomplete="new-password"]')
  await reset[0].type('reset-password');await reset[1].type('reset-password')
  await consent();await click('重置密码')
  await page.waitForSelector('input[autocomplete="current-password"]')
  assert.ok(calls.some(c=>c.path==='/api/account/password/reset/send-code'))
  assert.ok(calls.some(c=>c.path==='/api/account/password/reset'&&c.body.code==='654321'))
  await page.screenshot({path:out+'/desktop-reset-done.png',fullPage:true})
  // A challenge cannot survive a site change or a return to password sign-in.
  await page.reload({waitUntil:'networkidle0'});await beginSetup()
  await page.type('input[autocomplete="new-password"]','discard-this-password')
  await page.click('.unlock-site-seg-item:not(.is-active)')
  await page.waitForSelector('input[type="email"]')
  await page.waitForSelector('input[autocomplete="current-password"]')
  assert.equal(await page.$eval('input[autocomplete="current-password"]',e=>e.value),'')
  assert.equal(await page.$('input[autocomplete="new-password"]'),null)
  await page.screenshot({path:out+'/desktop-site-cleared.png',fullPage:true})
  assert.equal(calls.filter(c=>c.path==='/api/account/password/setup').length,1,'site switch must not submit pending ticket')
  console.log(JSON.stringify({passed:true,screenshots:out,errors,requests:calls.map(c=>c.path)},null,2))
}finally{await browser.close()}
