// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Run the isolated website dev server with synthetic CAPTCHA/SMS configuration only.
import puppeteer from 'puppeteer-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const out=process.env.AUTH_UI_OUT||'/tmp/awd-compatible-auth-ui'
const fixture='data:image/png;base64,'+fs.readFileSync(process.env.CHALLENGE_TEST_IMAGE||out+'/challenge.png').toString('base64')
const browser=await puppeteer.launch({executablePath:process.env.PUPPETEER_EXECUTABLE_PATH||'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',headless:true})
const calls=[],errors=[]
try {
 const page=await browser.newPage();await page.setViewport({width:1100,height:1100});page.on('pageerror',e=>errors.push(e.message))
 let challengeNumber=0,networkFailure=false
 await page.setRequestInterception(true)
 page.on('request',async req=>{
  const url=new URL(req.url())
  if(url.pathname.startsWith('/api/')) {
   let body={};try{body=JSON.parse(req.postData()||'{}')}catch{}
   calls.push({path:url.pathname,body})
   let data={ok:true},status=200
   if(url.pathname==='/api/auth/captcha-challenge'){
    if(networkFailure)return req.abort('failed')
    data={id:'fixture-'+(++challengeNumber),image:fixture,expiresAt:Date.now()+180000}
   } else if(url.pathname.endsWith('/send-code')&&!body.captchaToken.endsWith(':222222')){status=403;data={error:'captcha_failed'}}
   return req.respond({status,contentType:'application/json',body:JSON.stringify(data)})
  }
  if(url.hostname!=='127.0.0.1'&&url.protocol.startsWith('http'))return req.abort('blockedbyclient')
  return req.continue()
 })
 const base=process.env.WEBSITE_AUTH_UI_BASE||'http://127.0.0.1:3107'
 await page.goto(base+'/zh/account?flow=register',{waitUntil:'networkidle0'})
 await page.waitForSelector('#auth-code-id')
 const click=async text=>{for(const e of await page.$$('button'))if((await e.evaluate(x=>x.textContent.trim()))===text){await e.click();return}throw Error('Missing '+text)}
 await page.type('#auth-code-id','13800138000');await click('获取验证码')
 await page.waitForFunction(()=>document.body.textContent.includes('安全验证未通过或已过期'))
 assert.equal(calls.filter(c=>c.path.endsWith('/send-code')).length,0)
 await click('安全验证加载不出来？使用兼容验证');await page.waitForSelector('input[aria-label="图片中的 6 位字符"]')
 assert.equal(await page.$eval('img[alt="安全验证图片"]',e=>e.naturalWidth),210)
 await page.type('input[aria-label="图片中的 6 位字符"]','ABCDEF');await click('获取验证码')
 await page.waitForFunction(()=>!document.querySelector('img[alt="安全验证图片"]'))
 await click('换一张验证图片');await page.waitForSelector('input[aria-label="图片中的 6 位字符"]')
 await page.type('input[aria-label="图片中的 6 位字符"]','222222');await page.screenshot({path:out+'/website-compatibility.png',fullPage:true});await click('获取验证码')
 await page.waitForFunction(()=>document.body.textContent.includes('验证码已发送'))
 assert.ok(calls.some(c=>c.path==='/api/auth/sms-login/send-code'&&c.body.captchaToken==='local:fixture-2:222222'))
 await page.goto(base+'/zh/account?flow=reset',{waitUntil:'networkidle0'});await page.waitForSelector('#auth-code-id');await page.type('#auth-code-id','13800138000')
 await click('安全验证加载不出来？使用兼容验证');await page.waitForSelector('input[aria-label="图片中的 6 位字符"]')
 assert.equal(calls.filter(c=>c.path==='/api/auth/captcha-challenge').at(-1).body.purpose,'reset')
 networkFailure=true;await click('换一张验证图片');await page.waitForFunction(()=>document.body.textContent.includes('无法连接账户服务'))
 assert.equal(errors.length,0,errors.join('\n'))
 console.log('PASS website: blocked SDK, no blind send, visible compatibility image, wrong-answer reset, successful token, reset purpose, network error.')
} finally {await browser.close()}
