// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { preflight, startServer, launchBrowser, loadPuppeteer, openEditor, here } from './_boot.mjs'
preflight()
const server=await startServer(), browser=await launchBrowser(await loadPuppeteer())
const pause=ms=>new Promise(r=>setTimeout(r,ms))
try {
 const page=await openEditor(browser,{viewport:{width:1280,height:900}})
 const exec=async(a,p={})=>{const r=await page.evaluate((a,p)=>window.__loExecutor.executeCommand(a,p),a,p);assert.equal(r.success,true,JSON.stringify(r));return r}
 await exec('load_document',{bytes:Array.from(fs.readFileSync(here+'/fixtures/impress-smoke.pptx')),name:'ime.pptx'})
 await exec('set_chrome',{all:false})
 const info=await exec('slide_get_page',{slideNumber:1}), shape=info.shapes.find(s=>(s.text||'').includes('普通文本框内容'))
 assert.ok(shape)
 await exec('slide_goto',{slideNumber:1,shapeName:shape.name})
 await page.focus('[data-lo-ime]')
 const cdp=await page.createCDPSession()
 const text='women'.repeat(20)
 await cdp.send('Input.imeSetComposition',{text,selectionStart:7,selectionEnd:7})
 assert.equal(await page.$eval('[data-lo-ime]',e=>e.selectionStart),7)
 assert.equal(await page.$eval('[data-lo-ime]',e=>getComputedStyle(e).opacity),'1')
 await cdp.send('Input.imeSetComposition',{text:'womenpengyou',selectionStart:5,selectionEnd:5})
 assert.equal(await page.$eval('[data-lo-ime]',e=>e.value),'womenpengyou')
 await cdp.send('Input.insertText',{text:'朋友确认'})
 await pause(1500)
 let after=await exec('slide_get_page',{slideNumber:1})
 console.log(JSON.stringify(after.shapes.map(s=>({name:s.name,text:s.text}))))
 assert.ok(after.shapes.find(s=>s.name===shape.name).text.includes('朋友确认'))
 await cdp.send('Input.imeSetComposition',{text:'quxiao',selectionStart:2,selectionEnd:2})
 await cdp.send('Input.imeSetComposition',{text:'',selectionStart:0,selectionEnd:0})
 await pause(300)
 assert.equal((await exec('slide_get_page',{slideNumber:1})).shapes.find(s=>s.name===shape.name).text,after.shapes.find(s=>s.name===shape.name).text)
 await page.keyboard.press('Escape');await pause(300)
 const bytes=await page.evaluate(async()=>{const r=await window.__loExecutor.executeCommand('export_document',{name:'ime.pptx'});if(!r.success)throw Error(JSON.stringify(r));return Array.from(r.bytes)})
 await exec('load_document',{bytes,name:'ime-reopen.pptx'})
 assert.ok((await exec('slide_get_page',{slideNumber:1})).shapes.some(s=>s.text?.includes('朋友确认')))
 console.log('PASS real Impress preedit middle caret/edit/commit/cancel and PPTX export reopen')
}finally{await browser.close();await new Promise(r=>server.close(r))}
