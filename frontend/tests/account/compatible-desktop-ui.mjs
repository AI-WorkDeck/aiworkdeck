// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import puppeteer from 'puppeteer-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const out=process.env.AUTH_UI_OUT||'/tmp/awd-compatible-auth-ui'
fs.mkdirSync(out,{recursive:true})
const fixture='data:image/png;base64,'+fs.readFileSync(process.env.CHALLENGE_TEST_IMAGE||out+'/challenge.png').toString('base64')
const browser=await puppeteer.launch({executablePath:process.env.PUPPETEER_EXECUTABLE_PATH||'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',headless:true})
const calls=[],errors=[]
try {
 const page=await browser.newPage(); await page.setViewport({width:1100,height:1100})
 page.on('pageerror',e=>errors.push(e.message))
 await page.evaluateOnNewDocument(()=>{localStorage.setItem('awd_app_language','zh-CN');localStorage.setItem('awd_site_preselected','1');window.checkbaDesktop={shell:{openExternal(){}}}})
 let challengeNumber=0,networkFailure=false
 await page.setRequestInterception(true)
 page.on('request',async req=>{
  const url=new URL(req.url())
  if(url.pathname.startsWith('/api/')) {
   const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'}
   if(req.method()==='OPTIONS')return req.respond({status:204,headers})
   let body={};try{body=JSON.parse(req.postData()||'{}')}catch{}
   calls.push({path:url.pathname,body})
   let data={},code=0,message='',envelope=true
   if(url.pathname==='/api/site'){envelope=false;data={current:'cn',pinned:true,multiSite:false,sites:[]}}
   else if(url.pathname==='/api/license/status'){envelope=false;data={unlocked:false,trialCodeEnabled:false,accountConnected:false}}
   else if(url.pathname.includes('captcha-config'))data={provider:'aliyun',sceneId:'test',prefix:'test'}
   else if(url.pathname==='/api/account/captcha-challenge'){
    if(networkFailure)return req.abort('failed')
    data={id:'fixture-'+(++challengeNumber),image:fixture,expiresAt:Date.now()+180000}
   } else if(url.pathname.endsWith('/send-code')){
    if(!body.captchaToken.endsWith(':222222')){code=1;message='安全验证未通过或已过期，请换一张图片或重新验证'}
    else data={sent:true}
   } else data={ok:true}
   return req.respond({status:200,headers,contentType:'application/json',body:JSON.stringify(envelope?{code,data,message}:data)})
  }
  if(url.hostname!=='127.0.0.1'&&url.protocol.startsWith('http'))return req.abort('blockedbyclient')
  return req.continue()
 })
 await page.goto((process.env.DESKTOP_AUTH_UI_BASE||'http://127.0.0.1:5207')+'/#/pages/unlock/unlock',{waitUntil:'networkidle0'})
 const click=async text=>{for(const e of await page.$$('.unlock-card button'))if((await e.evaluate(x=>x.textContent.trim()))===text){await e.click();return}throw Error('Missing '+text)}
 await click('首次使用 / 创建密码');await page.type('input[type="tel"]','13800138000')
 await page.click('.unlock-code-btn')
 await page.waitForFunction(()=>document.body.textContent.includes('安全验证组件加载失败'))
 assert.equal(calls.filter(c=>c.path.endsWith('/send-code')).length,0)
 await click('安全验证加载不出来？使用兼容验证')
 await page.waitForSelector('.unlock-compat-verification img')
 assert.equal(await page.$eval('.unlock-compat-verification img',e=>e.naturalWidth),210)
 await page.type('input[aria-label="图片中的 6 位字符"]','ABCDEF');await page.click('.unlock-code-btn')
 await page.waitForFunction(()=>document.body.textContent.includes('安全验证未通过或已过期'))
 assert.equal(await page.$('.unlock-compat-verification img'),null)
 await click('换一张验证图片');await page.waitForSelector('.unlock-compat-verification img')
 await page.type('input[aria-label="图片中的 6 位字符"]','222222')
 await page.screenshot({path:out+'/desktop-compatibility.png',fullPage:true})
 await page.click('.unlock-code-btn');await page.waitForFunction(()=>document.querySelector('.unlock-code-btn').textContent.includes('秒后'))
 assert.ok(calls.some(c=>c.path==='/api/account/login/send-code'&&c.body.captchaToken==='local:fixture-2:222222'))
 await click('返回密码登录');await click('忘记密码');await click('换一张验证图片');await page.waitForSelector('.unlock-compat-verification img')
 assert.equal(calls.filter(c=>c.path==='/api/account/captcha-challenge').at(-1).body.purpose,'reset')
 networkFailure=true;await click('换一张验证图片');await page.waitForFunction(()=>document.body.textContent.includes('无法连接账户服务'))
 assert.equal(errors.length,0,errors.join('\n'))
 console.log('PASS desktop: blocked third-party path, visible fallback, real PNG display, wrong-answer reset, successful token forwarding, reset purpose, account-network error.')
} finally {await browser.close()}
