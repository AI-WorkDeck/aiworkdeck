// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {preflight,loadPuppeteer,startServer,launchBrowser,openEditor,here} from './_boot.mjs';
preflight();const root=path.resolve(here,'../..');
const server=await startServer({patchServed:(u,b)=>u.endsWith('/office_thread.js')?Buffer.from(fs.readFileSync(root+'/src/zetaoffice/public/office_thread.js','utf8')):b});
const browser=await launchBrowser(await loadPuppeteer());
try {const page=await openEditor(browser,{clipboard:false});const result=await page.evaluate(async bytes=>{
const ex=window.__loExecutor;await ex.executeCommand('load_document',{bytes,name:'advanced.pptx'});
const out=[];
for(const type of ['column','bar','line','area','pie','doughnut','scatter']){
const added=await ex.executeCommand('slide_add_page',{});const slideNumber=added.slideNumber;
out.push(await ex.executeCommand('slide_add_chart',{slideNumber,chartType:type,categories:type==='scatter'?['1','4','9']:['1','2','3'],series:type==='scatter'?[{name:'Actual',values:[12,20,16]},{name:'Target',values:[14,18,22]}]:[{name:'Actual',values:[12,20,16]}],left:40,top:80,width:560,height:300,title:type}));
out.push(await ex.executeCommand('slide_format_chart',{slideNumber,shapeName:out.at(-1).shapeName,backgroundColor:'#FFF8F0',textColor:'#243B35',fontSize:16,seriesColors:['#D65A40','#3C7A68','#E5B65C'],showGrid:false}));
out.push(await ex.executeCommand('slide_set_transition',{slideNumber,effect:'fade',durationSeconds:0.6}));}
const exported=await ex.executeCommand('export_document',{name:'advanced.pptx'});if(!exported.success || !exported.bytes?.length) return {out,exportError:{...exported,bytes:undefined},bytes:[]};const savedBytes=Array.from(exported.bytes||[]);await ex.executeCommand('load_document',{bytes:savedBytes,name:'advanced.pptx'});
const reopened=[];for(let n=3;n<=9;n++)reopened.push(await ex.executeCommand('slide_get_page',{slideNumber:n}));
const pdf=await ex.executeCommand('export_pdf',{});return {out,reopened,pdf:Array.from(pdf.bytes||[]),bytes:savedBytes};
},Array.from(fs.readFileSync(here+'/fixtures/impress-smoke.pptx')));console.log(JSON.stringify({out:result.out,exportError:result.exportError}));assert.ok(result.bytes.length>1000);assert.equal(result.bytes[0],80);assert.equal(result.bytes[1],75);console.log(JSON.stringify(result.out));
for(const r of result.out) assert.equal(r.success,true,JSON.stringify(r));
for(const page of result.reopened){assert.equal(page.transition.type,37);assert.equal(page.transition.subtype,101);assert.ok(page.shapes.some(s=>s.isChart),JSON.stringify(page));}
const scatter=result.reopened.at(-1).shapes.find(s=>s.isChart).chart.plots;assert.equal(scatter.length,2);
for(const [i,series] of scatter.entries()){assert.deepEqual(series.sequences.find(s=>s.role==='values-x').values,[1,4,9]);assert.deepEqual(series.sequences.find(s=>s.role==='values-y').values,[[12,20,16],[14,18,22]][i]);}
const output=process.env.PPT_ADVANCED_EVIDENCE_DIR||'/tmp/ppt-advanced-design-evidence';fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(path.join(output,'advanced.pptx'),Buffer.from(result.bytes));fs.writeFileSync(path.join(output,'advanced.pdf'),Buffer.from(result.pdf));fs.writeFileSync(path.join(output,'reopened.json'),JSON.stringify(result.reopened,null,2));console.log('PASS seven native chart types and saved/reopened fade transitions; playback not verified');
} finally {await browser.close();await new Promise(r=>server.close(r));}
