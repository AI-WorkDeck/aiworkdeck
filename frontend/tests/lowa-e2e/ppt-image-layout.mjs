// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {preflight,loadPuppeteer,startServer,launchBrowser,openEditor,here} from './_boot.mjs';
preflight();
const source=path.resolve(here,'../../src/zetaoffice/public/office_thread.js');
const server=await startServer({patchServed:(url,bytes)=>url.endsWith('/office_thread.js')?fs.readFileSync(source):bytes});
const browser=await launchBrowser(await loadPuppeteer());
try {
  const page=await openEditor(browser,{clipboard:false,viewport:{width:1280,height:900,deviceScaleFactor:Number(process.env.PPT_IMAGE_DPR||2)}});
  const result=await page.evaluate(async bytes=>{
    const ex=window.__loExecutor;
    await ex.executeCommand('load_document',{bytes,name:'images.pptx'});
    const canvas=document.createElement('canvas');canvas.width=1672;canvas.height=940;
    const ctx=canvas.getContext('2d');
    // Texture, fine lines and differently coloured halves expose inverted/overlarge crop bounds.
    for(let y=0;y<940;y+=20)for(let x=0;x<1672;x+=20){ctx.fillStyle=x<836?((x+y)%40?'#C15D42':'#E8A87C'):((x+y)%40?'#4D7E72':'#7EC8AD');ctx.fillRect(x,y,20,20);}
    ctx.strokeStyle='#14263D';ctx.lineWidth=8;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(1672,940);ctx.moveTo(0,940);ctx.lineTo(1672,0);ctx.stroke();
    ctx.font='bold 120px sans-serif';ctx.fillStyle='white';ctx.fillText('LEFT',100,520);ctx.fillText('RIGHT',1000,520);
    const base64=canvas.toDataURL().split(',')[1], out=[];
    for(const [fit,focalX] of [['cover',0],['cover',1],['cover',0.5],['contain',0.5]]) {
      const added=await ex.executeCommand('slide_add_page',{});
      out.push(await ex.executeCommand('slide_add_image',{slideNumber:added.slideNumber,base64,left:-20,top:-20,width:580,height:660,fit,focalX,sendToBack:true}));
    }
    out.push(await ex.executeCommand('slide_add_image',{slideNumber:3,base64:btoa('not an image'),left:0,top:0,width:20,height:20}));
    const exported=await ex.executeCommand('export_document',{name:'images.pptx'});
    if(!exported.success||!exported.bytes?.length)return {out,error:exported.message};
    const saved=Array.from(exported.bytes);
    await ex.executeCommand('load_document',{bytes:saved,name:'images.pptx'});
    const reopened=[];for(let i=3;i<=6;i++)reopened.push(await ex.executeCommand('slide_get_page',{slideNumber:i}));
    const pdf=await ex.executeCommand('export_pdf',{});
    return {out,reopened,bytes:saved,pdf:Array.from(pdf.bytes||[])};
  },Array.from(fs.readFileSync(here+'/fixtures/impress-smoke.pptx')));
  for(const item of result.out.slice(0,4))assert.equal(item.success,true,JSON.stringify(item));
  assert.equal(result.out[4].errorCode,'SLIDE_INVALID_IMAGE');
  assert.ok(result.bytes?.length>1000,JSON.stringify(result));assert.ok(result.pdf.length>1000);
  for(const item of result.reopened)assert.equal(item.shapes.filter(s=>s.shapeType==='com.sun.star.drawing.GraphicObjectShape'||s.type==='image'||s.kind==='image').length,1,JSON.stringify(item));
  const zip=await JSZip.loadAsync(Uint8Array.from(result.bytes));
  const crops=[];
  for(let slide=3;slide<=5;slide++) {
    const xml=await zip.file(`ppt/slides/slide${slide}.xml`).async('string');
    const rect=xml.match(/<a:srcRect\b[^>]*>/)?.[0];assert.ok(rect,xml);
    const values=Object.fromEntries([...rect.matchAll(/([ltrb])="(-?\d+)"/g)].map(m=>[m[1],Number(m[2])]));
    const expected=(1-(580/660)/(1672/940))*100000;
    assert.ok(Math.abs(values.l+values.r-expected)<100,JSON.stringify(values));
    assert.ok(values.l+values.r<100000 && values.t+values.b<100000,JSON.stringify(values));
    if(slide===3)assert.equal(values.l,0);
    if(slide===4)assert.equal(values.r,0);
    if(slide===5)assert.ok(Math.abs(values.l-values.r)<10);
    crops.push(values);
  }
  const out=process.env.PPT_IMAGE_EVIDENCE_DIR||'/tmp/ppt-image-layout-evidence';fs.mkdirSync(out,{recursive:true});
  for(const [name,data] of [['images.pptx',result.bytes],['images.pdf',result.pdf]])fs.writeFileSync(path.join(out,name),Buffer.from(data));
  fs.writeFileSync(path.join(out,'readback.json'),JSON.stringify({dpr:Number(process.env.PPT_IMAGE_DPR||2),crops,pages:result.reopened},null,2));
  console.log('PASS image layout saved and reopened; inspect PDF crops separately');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
