#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// #1515: the interactive font popup must still receive real mouse input.
// Use the same LOWA_ENGINE_DIR / LOWA_DIST_DIR as calc-header-chrome.mjs.
// CALC_POPUP_OUT selects screenshots and state JSON; no backend/user files.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import {PNG} from 'pngjs'
import {preflight,loadPuppeteer,startServer,launchBrowser,openEditor} from './_boot.mjs'

const out=process.env.CALC_POPUP_OUT||fs.mkdtempSync(path.join(os.tmpdir(),'awd-font-popup-'))
fs.mkdirSync(out,{recursive:true})
const fixture=async()=>{
  const zip=new JSZip(), ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main', rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  zip.file('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`)
  zip.file('_rels/.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
  zip.file('xl/workbook.xml',`<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="Synthetic" sheetId="1" r:id="rId1"/></sheets></workbook>`)
  zip.file('xl/_rels/workbook.xml.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`)
  zip.file('xl/worksheets/sheet1.xml',`<worksheet xmlns="${ns}"><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>`)
  return Array.from(await zip.generateAsync({type:'uint8array'}))
}
// UITest supplies native geometry only; never call executeAction. Its getState
// disables double buffering on widgets that support it, so this separate input
// test is not used as evidence of header pixel appearance or rendering timing.
const probe=`
  debug_font_popup() {
    const ui=context.getServiceManager().createInstanceWithContext('com.sun.star.ui.test.UITest',context);
    const read=function(o){const result={};for(const p of o.getState())result[p.Name]=zetajs.fromAny(p.Value);return result;};
    const box=read(ui.getTopFocusWindow().getChild('FontNameBox'));
    let popup=null;try{popup=read(ui.getFloatWindow());}catch(e){}
    const c=ctrl.getActiveSheet().getCellRangeByName('A1');
    return {success:true,box:box,popup:popup,frame:ctrl.getFrame().getContainerWindow().getPosSize(),font:c.getPropertyValue('CharFontName'),value:c.getString()};
  },`
const pair=text=>text.split('x').map(Number)
preflight()
const server=await startServer({patchServed:(url,body)=>{
  if(url==='/office_thread.js') {
    const text=body.toString();assert.equal(text.split('const EXEC = {').length,2)
    return Buffer.from(text.replace('const EXEC = {','const EXEC = {\n'+probe))
  }
  if(/^\/assets\/editor-.*\.js$/.test(url)) {
    const text=body.toString();assert.ok(text.includes('"get_hyperlink_at_cursor"'))
    return Buffer.from(text.replace('"get_hyperlink_at_cursor"','"get_hyperlink_at_cursor","debug_font_popup"'))
  }
  return body
}})
try {
  for(const dpr of (process.env.LOWA_E2E_DPR?[Number(process.env.LOWA_E2E_DPR)]:[1,2])) {
    const browser=await launchBrowser(await loadPuppeteer(),{headed:true})
    const deadline=setTimeout(()=>browser.close(),300000)
    try {
      const page=await openEditor(browser,{clipboard:false,viewport:{width:1000,height:720,deviceScaleFactor:dpr}})
      await page.evaluate(()=>{for(const type of ['keydown','keyup','beforeinput','input'])window.addEventListener(type,e=>{e.preventDefault();e.stopImmediatePropagation()},true)})
      const exec=async(a,p={})=>{const r=await page.evaluate((a,p)=>window.__loExecutor.executeCommand(a,p),a,p);assert.equal(r?.success,true,a+': '+JSON.stringify(r));return r}
      const state=()=>exec('debug_font_popup')
      const capture=async(name)=>{
        await new Promise(r=>setTimeout(r,150));await page.screenshot()
        return PNG.sync.read(Buffer.from(await page.screenshot({path:path.join(out,`dpr${dpr}-${name}.png`)})))
      }
      await page.addStyleTag({content:'#verify,#vlog{display:none!important}'})
      await exec('load_document',{name:'synthetic-popup.xlsx',bytes:await fixture()})
      await exec('set_app_theme',{mode:'light'})
      await exec('sheet_format_cells',{range:'A1',fontName:'Arial',fontSize:18})
      await exec('set_chrome',{all:true})
      await page.setViewport({width:1000,height:719,deviceScaleFactor:dpr});await page.setViewport({width:1000,height:720,deviceScaleFactor:dpr})
      await capture('before')
      const before=await state();assert.equal(before.box.ReallyVisible,'true');assert.equal(before.font,'Arial')
      const [x,y]=pair(before.box.AbsPosition),[w,h]=pair(before.box.Size)
      const scale=1000/before.frame.Width, top=Math.max(0,720-before.frame.Height*scale)
      // Click the arrow inside the observed native font control, with menu offset.
      await page.mouse.click((x+w-h/2)*scale,top+(y+h/2)*scale,{delay:80})
      const png=await capture('open'), opened=await state()
      assert.equal(opened.popup?.ReallyVisible,'true','real font popup opened')
      assert.equal(opened.popup.Parent,'fontnamecombobox')
      fs.writeFileSync(path.join(out,`dpr${dpr}-open.json`),JSON.stringify(opened,null,2))
      // Native floating-window RelPosition is already a screen position. Its
      // UITest AbsPosition sums the parent again, so do not use that for input.
      const [px,py]=pair(opened.popup.RelPosition),[pw,ph]=pair(opened.popup.Size)
      const pixelScale=png.width/opened.frame.Width
      let first=-1,last=-1
      for(let yy=Math.ceil((py+4)*pixelScale);yy<Math.min(png.height,(py+Math.min(ph,100))*pixelScale);yy++) {
        let ink=0
        for(let xx=Math.ceil((px+6)*pixelScale);xx<Math.min(png.width,(px+Math.min(pw-6,150))*pixelScale);xx++) {
          const i=(yy*png.width+xx)*4
          if(png.data[i]<100&&png.data[i+1]<100&&png.data[i+2]<100)ink++
        }
        if(ink>=3*dpr){if(first<0)first=yy;last=yy}else if(first>=0)break
      }
      assert.ok(first>=0&&last-first>=6*dpr,'first visible popup text row found in real pixels')
      // Caladea is the first bundled font in the observed list. A real click must
      // close the popup and change the selected cell, not just its toolbar label.
      await page.mouse.click((px+20)*scale,(first+last)/2/dpr,{delay:80})
      let after
      for(let i=0;i<30;i++){after=await state();if(after.font==='Caladea')break;await new Promise(r=>setTimeout(r,50))}
      assert.equal(after.font,'Caladea','font chosen through real popup mouse input')
      assert.notEqual(after.popup?.ReallyVisible,'true','popup closes after selection')
      assert.equal(after.value,before.value,'font selection preserves cell value')
      await capture('selected')
      await exec('undo',{steps:1});assert.equal((await state()).font,'Arial','font selection is undoable')
      console.log(`PASS DPR${dpr}: native font popup visible, real mouse selection applies Caladea, closes, preserves value, and undo restores Arial`)
      await page.close()
    } finally {clearTimeout(deadline);await browser.close()}
  }
} finally {await new Promise(r=>server.close(r))}
console.log('Artifacts: '+out)
