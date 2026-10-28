// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { here, preflight, loadPuppeteer, startServer, launchBrowser, openEditor } from './_boot.mjs'
preflight()
const server = await startServer({patchServed:(url,bytes)=>url.endsWith("/office_thread.js") && process.env.PPT_WORKER_SOURCE ? fs.readFileSync(process.env.PPT_WORKER_SOURCE) : bytes}), browser = await launchBrowser(await loadPuppeteer())
try {
 const page = await openEditor(browser, {clipboard:false})
 const exec = async (a,p={}) => {
   const r=await page.evaluate((a,p)=>window.__loExecutor.executeCommand(a,p),a,p)
   console.log(a,JSON.stringify(r).slice(0,1200)); return r
 }
 assert.equal((await exec('load_document',{bytes:Array.from(fs.readFileSync(path.join(here,'fixtures/impress-smoke.pptx'))),name:'precision.pptx'})).success,true)
 for(let i=0;i<12;i++) {
   const result=await exec('slide_add_page',{title:'Evidence '+i,body:'Claim and evidence '+i})
   assert.equal(result.success,true,JSON.stringify(result))
   assert.equal(result.slideNumber,i+3)
   const overview=await exec('slide_get_overview'); assert.equal(overview.slideCount,i+3)
   assert.equal(overview.slides.at(-1).titleText,'Evidence '+i)
 }
 const middle=await exec('slide_add_page',{position:1,title:'Comparison',body:'Grouped evidence'})
 assert.equal(middle.success,true,JSON.stringify(middle)); assert.equal(middle.slideNumber,2)
 assert.equal((await exec('slide_set_layout',{slideNumber:2,backgroundColor:'#183247'})).success,true)
 const added=await exec('slide_add_text_box',{slideNumber:2,text:'Cost 100; other 100',left:50,top:160,width:500,height:60,fontSize:22})
 assert.equal(added.success,true)
 let details=await exec('slide_get_page',{slideNumber:2})
 const shape=details.shapes.find(s=>s.text==='Cost 100; other 100'); assert.ok(shape)
 const name=shape.name||shape.shapeName
 assert.equal((await exec('slide_format_text',{slideNumber:2,shapeName:name,anchorText:'other',bold:true,color:'#00AA88'})).success,true)
 const replaced=await exec('slide_replace_text',{slideNumber:2,shapeName:name,searchText:'100',replaceText:'200',expectedText:'Cost 100; other 100'})
 assert.equal(replaced.success,true,JSON.stringify(replaced)); assert.equal(replaced.replaced,1)
 const stale=await exec('slide_replace_text',{slideNumber:2,shapeName:name,searchText:'100',replaceText:'999',expectedText:'Cost 100; other 100'})
 assert.equal(stale.success,false)
 details=await exec('slide_get_page',{slideNumber:2}); assert.equal(details.shapes.find(s=>(s.name||s.shapeName)===name).text,'Cost 200; other 100')
 const unsupported=await exec('slide_format_text',{slideNumber:2,shapeName:name,bold:false,rightIndentPt:4})
 assert.equal(unsupported.success,false);assert.equal(unsupported.errorCode,'SLIDE_RIGHT_INDENT_UNSUPPORTED')
 assert.equal((await exec('slide_format_text',{slideNumber:2,shapeName:name,anchorText:'other',spaceBeforePt:6,spaceAfterPt:12,lineSpacingMode:'exactly',lineSpacingValue:24,firstLineIndentPt:-10,leftIndentPt:10,rightIndentPt:0})).success,true)
 const table=await exec('slide_add_table',{slideNumber:3,rowsJson:[['Metric','Before','After'],['Speed','6 days','4.5 days'],['Quality','94%','97%'],['Volume','120','156'],['Rating','4.6','4.8']],left:50,top:100,width:600,height:220})
 assert.equal(table.success,true,JSON.stringify(table))
 assert.ok(table.rowHeightsPt.every(h=>Math.abs(h-44)<0.1),JSON.stringify(table))
 assert.ok(Math.abs(table.height-220)<1,JSON.stringify(table))
 assert.equal((await exec('slide_table_set_style',{slideNumber:3,shapeName:table.shapeName,fontSize:16,color:'#243747',fillColor:'#ffffff'})).success,true)
 assert.equal((await exec('slide_table_set_style',{slideNumber:3,shapeName:table.shapeName,row:0,bold:true,color:'#ffffff',fillColor:'#183247'})).success,true)
 assert.equal((await exec('slide_table_set_style',{slideNumber:3,shapeName:table.shapeName,rowHeightsPt:[36,38,38,38,38]})).success,true)
 const output=process.env.PPT_EVIDENCE_DIR||'/tmp/ppt-precision-evidence';fs.mkdirSync(output,{recursive:true})
 fs.writeFileSync(path.join(output,'details.json'),JSON.stringify(details,null,2))
 const exported=await page.evaluate(async()=>{const r=await window.__loExecutor.executeCommand('export_document',{name:'precision.pptx'});return {...r,bytes:Array.from(r.bytes||[])}})
 assert.equal(exported.success,true); assert.ok(exported.bytes.length)
 fs.writeFileSync(path.join(output,'precision.pptx'),Buffer.from(exported.bytes))
 assert.equal((await exec('load_document',{bytes:exported.bytes,name:'precision.pptx'})).success,true)
 const reopened=await exec('slide_get_page',{slideNumber:2});
 assert.equal(reopened.background.format.FillColor.toLowerCase(),'#183247'); assert.equal(reopened.background.format.FillStyle,'solid')
 const textShape=reopened.shapes.find(s=>s.text==='Cost 200; other 100'); assert.ok(textShape)
 const other=textShape.textDetails.paragraphs.flatMap(p=>p.runs).find(r=>r.text==='other'); assert.ok(other); assert.ok(other.format.weight>100); assert.equal(other.format.color.toLowerCase(),'#00aa88')
 const paragraph=textShape.textDetails.paragraphs[0].format
 for(const [key,value] of Object.entries({spaceBeforePt:6,spaceAfterPt:12,firstLineIndentPt:-10,leftIndentPt:10,rightIndentPt:0})) assert.ok(Math.abs(paragraph[key]-value)<0.1,key+': '+JSON.stringify(paragraph))
 assert.equal(paragraph.lineSpacing.mode,3); assert.ok(Math.abs(paragraph.lineSpacing.height*72/2540-24)<0.1)
 const reopenedTable=await exec('slide_table_read',{slideNumber:3})
 assert.deepEqual(reopenedTable.cells[0],['Metric','Before','After'])
 for(let i=0;i<5;i++)assert.ok(Math.abs(reopenedTable.rowHeightsPt[i]-[36,38,38,38,38][i])<0.2,JSON.stringify(reopenedTable))
 const pdf=await page.evaluate(async()=>{const r=await window.__loExecutor.executeCommand('export_pdf',{});return {...r,bytes:Array.from(r.bytes||[])}})
 assert.equal(pdf.success,true);assert.ok(pdf.bytes.length);fs.writeFileSync(path.join(output,'precision.pdf'),Buffer.from(pdf.bytes))
 await exec('slide_goto',{slideNumber:2}); await page.screenshot({path:path.join(output,'editor.png')})
 console.log('PASS insert 12 + middle, single replacement, stale rejection, background, export/reopen, PDF render input')
} finally {await browser.close(); await new Promise(r=>server.close(r))}
