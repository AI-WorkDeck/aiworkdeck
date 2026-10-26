#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real Calc header chrome (#1509). No backend, account, or user documents.
// Build the wrapper first. LOWA_ENGINE_DIR selects baseline/candidate runtime;
// CALC_HEADER_OUT selects screenshots + JSON (default: a new temp directory).
// Runs DPR 1 and 2; old r6 must fail the palette/font assertions. This is an
// engine test, not a claim about the packaged Electron or automatic-save path.
// CALC_HEADER_RESIZE=1 opts into resize/double-click with native chrome visible.
// Bare-canvas tooltip interception is an existing r6/r7 limitation; skips are
// explicitly recorded and never counted as PASS.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { PNG } from 'pngjs'
import { preflight, loadPuppeteer, startServer, launchBrowser, openEditor } from './_boot.mjs'

const out = process.env.CALC_HEADER_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'awd-calc-header-'))
fs.mkdirSync(out, { recursive: true })
const palette = JSON.parse(fs.readFileSync(new URL('../../../design/tokens/awd-palette.json', import.meta.url), 'utf8')).roles
const results = []
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`) }

async function fixture() {
  const zip = new JSZip(), ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const rels = 'http://schemas.openxmlformats.org/package/2006/relationships'
  zip.file('[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`)
  zip.file('_rels/.rels', `<Relationships xmlns="${rels}"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
  zip.file('xl/workbook.xml', `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="Synthetic" sheetId="1" r:id="rId1"/></sheets></workbook>`)
  zip.file('xl/_rels/workbook.xml.rels', `<Relationships xmlns="${rels}"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`)
  const rows=Array.from({length:200},(_,r)=>`<row r="${r+1}">`+Array.from({length:12},(_,c)=>`<c r="${String.fromCharCode(65+c)}${r+1}"><v>${r+c+1}</v></c>`).join('')+'</row>').join('')
  zip.file('xl/worksheets/sheet1.xml', `<worksheet xmlns="${ns}"><sheetData>${rows}</sheetData></worksheet>`)
  return Array.from(await zip.generateAsync({ type: 'uint8array' }))
}

// Inspection only: no rendering/color/font mutation. Geometry is identified by
// adjacent native windows, never by their ordering in getWindows().
const probe = `
  debug_calc_header_state() {
    const sheet = ctrl.getActiveSheet(), frame = ctrl.getFrame(), component = frame.getComponentWindow();
    const windows = [], queue = [{w: component, x: 0, y: 0, depth: 0}];
    for (let n = 0; queue.length && n < 120; n++) {
      const item = queue.shift(), r = item.w.getPosSize();
      let visible = true; try { visible = item.w.isVisible(); } catch (e) {}
      if (!visible) continue;
      const x = item.x + r.X, y = item.y + r.Y;
      windows.push({x:x, y:y, width:r.Width, height:r.Height, depth:item.depth});
      if (item.depth < 6) try { const children = item.w.getWindows();
        for (let i = 0; i < children.length; i++) queue.push({w:children[i], x:x, y:y, depth:item.depth+1});
      } catch (e) {}
    }
    const cells = ['A1','B2','C3','D4','L200'].map(function(name) {
      const c = sheet.getCellRangeByName(name), g = function(k) {return c.getPropertyValue(k);};
      return {name:name, text:c.getString(), formula:c.getFormula(), font:g('CharFontName'), size:g('CharHeight'),
        weight:g('CharWeight'), color:g('CharColor'), background:g('CellBackColor'), format:xModel.getNumberFormats().getByKey(g('NumberFormat')).getPropertyValue('FormatString')};
    });
    const columns = [], rows = [];
    for (let i=0;i<3;i++) {columns.push(sheet.getColumns().getByIndex(i).getPropertyValue('Width')); rows.push(sheet.getRows().getByIndex(i).getPropertyValue('Height'));}
    const inch = component.convertPointToPixel({X:2540,Y:2540}, css.util.MeasureUnit.MM_100TH);
    return {success:true, windows:windows, frame:frame.getContainerWindow().getPosSize(), dpi:inch.X,
      visible:ctrl.getVisibleRange(), selection:ctrl.getSelection().getRangeAddress(), columns:columns, rows:rows, cells:cells};
  },
`
function patchServed(url, body) {
  if (url === '/office_thread.js') {
    const s = body.toString('utf8')
    assert.equal(s.split('const EXEC = {').length, 2)
    return Buffer.from(s.replace('const EXEC = {', 'const EXEC = {\n' + probe))
  }
  if (/^\/assets\/editor-.*\.js$/.test(url)) {
    const s = body.toString('utf8')
    assert.ok(s.includes('"get_hyperlink_at_cursor"'))
    return Buffer.from(s.replace('"get_hyperlink_at_cursor"', '"get_hyperlink_at_cursor","debug_calc_header_state"'))
  }
  return body
}
function geometry(s) {
  const near = (a,b) => Math.abs(a-b) <= 2
  const candidates = []
  for (const h of s.windows.filter(r => r.width > s.frame.Width / 3 && r.height >= 8 && r.height < s.dpi * .7)) {
    for (const v of s.windows.filter(r => r.height > s.frame.Height / 3 && r.width >= 12 && r.width < s.dpi)) {
      if (!near(h.x,v.x+v.width) || !near(h.y+h.height,v.y)) continue
      const grid = s.windows.find(r => near(r.x,h.x) && near(r.y,v.y) && near(r.width,h.width) && near(r.height,v.height))
      if (grid) candidates.push({ horizontal:h, vertical:v, grid })
    }
  }
  const unique = [...new Map(candidates.map(g=>[JSON.stringify(g),g])).values()]
  assert.equal(unique.length, 1, 'native header/grid geometry must be unambiguous: ' + JSON.stringify(s.windows))
  return unique[0]
}
const rgb = hex => [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16))
const close = (a,b,t=4) => a.every((v,i)=>Math.abs(v-b[i])<=t)
function pixels(png, rect, scale) {
  const values=[]
  for(let y=Math.max(0,Math.ceil(rect.y*scale));y<Math.min(png.height,Math.floor((rect.y+rect.height)*scale));y++)
    for(let x=Math.max(0,Math.ceil(rect.x*scale));x<Math.min(png.width,Math.floor((rect.x+rect.width)*scale));x++) {
      const i=(y*png.width+x)*4; values.push({x,y,c:[png.data[i],png.data[i+1],png.data[i+2]]})
    }
  assert.ok(values.length, 'pixel sample must not be empty')
  return values
}
// Find actual painted cell boundaries, avoiding mm-to-pixel guesses: Calc
// rounds column widths in its own viewport map. A boundary spans the gutter;
// a letter occupies only part of it. Adjacent pixels form one boundary.
function boundaries(png, rect, scale, horizontal) {
  const start=Math.ceil((horizontal?rect.x:rect.y)*scale), end=Math.floor((horizontal?rect.x+rect.width:rect.y+rect.height)*scale)
  const crossStart=Math.ceil((horizontal?rect.y:rect.x)*scale)+2, crossEnd=Math.floor((horizontal?rect.y+rect.height:rect.x+rect.width)*scale)-2
  const color=(axis,cross)=>{const x=horizontal?axis:cross,y=horizontal?cross:axis,i=(y*png.width+x)*4;return [png.data[i],png.data[i+1],png.data[i+2]]}
  const hits=[]
  for(let a=start+3;a<end-3;a++) {
    let count=0
    for(let b=crossStart;b<crossEnd;b++) if(!close(color(a,b),color(a-1,b),20)||!close(color(a,b),color(a+1,b),20))count++
    if(count/(crossEnd-crossStart)>.95)hits.push(a)
  }
  const groups=[]
  for(const a of hits){const last=groups.at(-1);if(last&&a-last.at(-1)<=2)last.push(a);else groups.push([a])}
  const values=[start/scale,...groups.map(v=>(v[0]+v.at(-1))/2/scale)]
  assert.ok(values.length>=4,'at least three actual painted cell boundaries required')
  return values
}
function inkHeight(values) {
  const counts=new Map();for(const p of values){const k=p.c.join(',');counts.set(k,(counts.get(k)||0)+1)}
  const background=[...counts].sort((a,b)=>b[1]-a[1])[0][0].split(',').map(Number)
  const ink=values.filter(p=>!close(p.c,background,60))
  assert.ok(ink.length>2,'nonempty label glyph required')
  return Math.max(...ink.map(p=>p.y))-Math.min(...ink.map(p=>p.y))+1
}

preflight()
const server=await startServer({patchServed})
const browser=await launchBrowser(await loadPuppeteer(), { headed: true })
browser.on('targetcreated',async target=>{const page=await target.page();page?.on('pageerror',e=>console.error('PAGE ERROR:',e.message))})
const deadline=setTimeout(()=>{console.error('FAIL total runtime exceeded 5 minutes');browser.close()},300000)
try {
  for(const dpr of (process.env.LOWA_E2E_DPR ? [Number(process.env.LOWA_E2E_DPR)] : [1,2])) {
    const page=await openEditor(browser,{clipboard:false,viewport:{width:1000,height:720,deviceScaleFactor:dpr}})
    await page.evaluate(()=>{for(const type of ['keydown','keyup','beforeinput','input']) window.addEventListener(type,e=>{e.preventDefault();e.stopImmediatePropagation()},true)})
    await page.evaluate(()=>{
      window.__headerPointerLog=[]
      for(const type of ['pointerdown','pointermove','pointerup','mousedown','mousemove','mouseup']) document.addEventListener(type,e=>{
        const rect=e.target.getBoundingClientRect()
        window.__headerPointerLog.push({type,x:e.clientX,y:e.clientY,buttons:e.buttons,time:e.timeStamp,target:e.target.tagName+'#'+e.target.id+'.'+e.target.className,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}})
        if(window.__headerPointerLog.length>100)window.__headerPointerLog.shift()
      },true)
    })
    const exec=async(action,params={})=>{
      const r=await page.evaluate((a,p)=>window.__loExecutor.executeCommand(a,p),action,params)
      assert.equal(r?.success,true,action+': '+JSON.stringify(r));return r
    }
    const state=()=>exec('debug_calc_header_state')
    // editor.html declares these two fixed overlays; neither is production UI.
    await page.addStyleTag({content:'#verify,#vlog{display:none!important}'})
    await page.evaluate(()=>window.dispatchEvent(new Event('resize')))
    await exec('load_document',{name:'synthetic-header.xlsx',bytes:await fixture()})
    await exec('set_chrome',{all:false,rulers:false})
    // XLSX maps Liberation Sans to Arial on export; use a round-trip stable
    // document font so this test checks preservation, not alias normalization.
    await exec('sheet_format_cells',{range:'A1:L200',fontName:'Arial',fontSize:18,color:'#000000'})
    await exec('sheet_set_row_col',{range:'A1:L200',rowHeightPt:28,colWidthPt:84})
    await exec('sheet_write_cells',{startCell:'B2',rows:[[888]]})
    await exec('sheet_write_cells',{startCell:'C3',rows:[['=SUM(A1:B1)']]})
    await exec('sheet_format_cells',{range:'D4',bold:true,background:'#FFF2CC',numberFormat:'0.00'})
    await exec('sheet_select_range',{range:'A1'})
    // Complete the Qt layout after removing the verification overlay/chrome.
    await page.setViewport({width:1000,height:719,deviceScaleFactor:dpr})
    await page.setViewport({width:1000,height:720,deviceScaleFactor:dpr})
    const before=await state(), initialCells=before.cells
    fs.writeFileSync(path.join(out,`dpr${dpr}-initial.json`),JSON.stringify(before,null,2))
    const capture=async(name)=>{
      // First screenshot flushes a potentially stale headless Qt frame.
      await new Promise(r=>setTimeout(r,150))
      await page.screenshot();const bytes=await page.screenshot({path:path.join(out,`${name}.png`)})
      return PNG.sync.read(Buffer.from(bytes))
    }
    const heights=[], rowHeights=[]
    for(const theme of ['light','dark']) {
      await exec('set_app_theme',{mode:theme})
      for(const zoom of [50,100,150]) {
        await exec('set_zoom',{value:zoom});await exec('sheet_select_range',{range:'A1'})
        const s=await state(), g=geometry(s), png=await capture(`dpr${dpr}-${theme}-${zoom}`)
        const scale=png.width/s.frame.Width, unit=s.dpi/96
        const header=pixels(png,g.horizontal,scale), row=pixels(png,g.vertical,scale), all=header.concat(row)
        const colors=palette[theme]
        for(const [role,min] of [['bg',all.length*.15],['accent',50*dpr*dpr],['text-2',4*dpr],['text-on-accent',3*dpr],['border',10*dpr]]) {
          const count=all.filter(p=>close(p.c,rgb(colors[role]))).length
          check(`DPR${dpr} ${theme} ${zoom}% ${role}`,count>=min,{count,min})
        }
        const col=boundaries(png,g.horizontal,scale,true), rows=boundaries(png,g.vertical,scale,false)
        const label={x:col[1]+3*unit,y:g.horizontal.y+2*unit,width:col[2]-col[1]-6*unit,height:g.horizontal.height-4*unit}
        const h=inkHeight(pixels(png,label,scale))/dpr;heights.push(h)
        check(`DPR${dpr} ${theme} ${zoom}% compact column label`,h>=6&&h<=10.5,{cssInkHeight:h})
        const rowLabel={x:g.vertical.x+3*unit,y:rows[1]+2*unit,width:g.vertical.width-6*unit,height:rows[2]-rows[1]-4*unit}
        const rh=inkHeight(pixels(png,rowLabel,scale))/dpr;rowHeights.push(rh)
        check(`DPR${dpr} ${theme} ${zoom}% compact row label`,rh>=6&&rh<=10.5,{cssInkHeight:rh})
        if(zoom===100) {
          const body={x:col[1]+3*unit,y:rows[1]+3*unit,width:col[2]-col[1]-6*unit,height:rows[2]-rows[1]-6*unit}
          const bodyHeight=inkHeight(pixels(png,body,scale))/dpr
          check(`DPR${dpr} ${theme} header smaller than 18pt body`,h<bodyHeight-3,{header:h,body:bodyHeight})
        }
      }
    }
    check(`DPR${dpr} header size independent of document zoom`,[heights,rowHeights].every(v=>Math.max(...v)-Math.min(...v)<=1),{columns:heights,rows:rowHeights})
    await exec('set_zoom',{value:100});await exec('set_app_theme',{mode:'light'})
    await exec('sheet_select_range',{range:'A1'})
    let s=await state(),g=geometry(s)
    const cssPoint=async(x,y)=>{
      const rect=await page.$eval('#qtcanvas',e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})
      return {x:rect.x+x*rect.width/s.frame.Width,y:rect.y+y*rect.width/s.frame.Width}
    }
    const pause=()=>new Promise(r=>setTimeout(r,80))
    const click=async(x,y,clickCount=1)=>{
      const p=await cssPoint(x,y)
      // Qt counts native presses; Puppeteer's clickCount alone only sets the
      // DOM count on one press. Send two actual down/up pairs for a double-click.
      for(let i=0;i<clickCount;i++){await page.mouse.click(p.x,p.y,{delay:80});await pause()}
    }
    const waitState=async(predicate)=>{for(let i=0;i<30;i++){const v=await state();if(predicate(v))return v;await new Promise(r=>setTimeout(r,50))}throw Error('native interaction state did not converge')}
    let shot=await capture(`dpr${dpr}-before-interaction`)
    let colEdge=boundaries(shot,g.horizontal,shot.width/s.frame.Width,true)[1]
    let rowEdge=boundaries(shot,g.vertical,shot.width/s.frame.Width,false)[1]
    const colWidth=colEdge-g.horizontal.x,rowHeight=rowEdge-g.vertical.y
    await click(g.horizontal.x+colWidth/2,g.horizontal.y+g.horizontal.height/2)
    s=await waitState(v=>v.selection.StartColumn===0&&v.selection.EndColumn===0&&v.selection.EndRow>=199)
    check(`DPR${dpr} click selects whole column`,s.selection.StartRow===0,s.selection)
    await click(g.vertical.x+g.vertical.width/2,g.vertical.y+rowHeight/2)
    s=await waitState(v=>v.selection.StartRow===0&&v.selection.EndRow===0&&v.selection.EndColumn>=11)
    check(`DPR${dpr} click selects whole row`,s.selection.StartColumn===0,s.selection)
    await exec('sheet_select_range',{range:'A1'});s=await state();g=geometry(s)
    if(process.env.CALC_HEADER_RESIZE==='1') {
      // Native chrome gives Calc's above-header size tooltip room. With a bare
      // canvas at y=0, both r6 and r7 place the tooltip beside the pointer and
      // Qt WASM's 5px windowAt padding intercepts subsequent move/up events.
      // Keep that known limitation separate; do not hide or disable the tip.
      await exec('set_chrome',{all:true})
      await page.setViewport({width:1000,height:719,deviceScaleFactor:dpr})
      await page.setViewport({width:1000,height:720,deviceScaleFactor:dpr})
      shot=await capture(`dpr${dpr}-native-chrome-before-resize`)
      s=await state();g=geometry(s)
      // The UNO container excludes the native menubar. Like drag-wheel.mjs,
      // align its bottom with the canvas using one width-derived scale.
      const nativeTop=Math.max(0,shot.height*s.frame.Width/shot.width-s.frame.Height)
      g=Object.fromEntries(Object.entries(g).map(([key,rect])=>[key,{...rect,y:rect.y+nativeTop}]))
      fs.writeFileSync(path.join(out,`dpr${dpr}-native-chrome-state.json`),JSON.stringify({state:s,geometry:g},null,2))
      colEdge=boundaries(shot,g.horizontal,shot.width/s.frame.Width,true)[1]
      rowEdge=boundaries(shot,g.vertical,shot.width/s.frame.Width,false)[1]
      const drag=async(x,y,dx,dy)=>{
        const a=await cssPoint(x,y),b=await cssPoint(x+dx,y+dy)
        await page.mouse.move(a.x,a.y);await pause();await page.mouse.down();await pause()
        for(let i=1;i<=8;i++){await page.mouse.move(a.x+(b.x-a.x)*i/8,a.y+(b.y-a.y)*i/8);await pause()}
        await page.mouse.up();await pause()
      }
      const oldWidth=s.columns[0],oldHeight=s.rows[0]
      await drag(colEdge,g.horizontal.y+g.horizontal.height/2,40*s.dpi/96,0)
      s=await waitState(v=>v.columns[0]>oldWidth+200)
      check(`DPR${dpr} drag column width (native chrome)`,s.columns[0]>oldWidth,{before:oldWidth,after:s.columns[0]})
      shot=await capture(`dpr${dpr}-column-dragged`);colEdge=boundaries(shot,g.horizontal,shot.width/s.frame.Width,true)[1]
      await click(colEdge,g.horizontal.y+g.horizontal.height/2,2)
      s=await waitState(v=>v.columns[0]<oldWidth)
      check(`DPR${dpr} double click auto width (native chrome)`,s.columns[0]<oldWidth,s.columns)
      await drag(g.vertical.x+g.vertical.width/2,rowEdge,0,16*s.dpi/96)
      s=await waitState(v=>v.rows[0]>oldHeight+150)
      check(`DPR${dpr} drag row height (native chrome)`,s.rows[0]>oldHeight,{before:oldHeight,after:s.rows[0]})
      shot=await capture(`dpr${dpr}-row-dragged`);rowEdge=boundaries(shot,g.vertical,shot.width/s.frame.Width,false)[1]
      await click(g.vertical.x+g.vertical.width/2,rowEdge,2)
      s=await waitState(v=>v.rows[0]<oldHeight+150)
      check(`DPR${dpr} double click auto height (native chrome)`,s.rows[0]<oldHeight+150,s.rows)
    } else {
      results.push({name:`DPR${dpr} resize and double-click`,status:'skipped',reason:'Enable CALC_HEADER_RESIZE=1 for native chrome; bare-canvas tooltip interception remains a known r6/r7 limitation.'})
      console.log(`SKIP DPR${dpr} resize and double-click (CALC_HEADER_RESIZE=1 to enable)`)
    }
    const p=await cssPoint(g.grid.x+g.grid.width/2,g.grid.y+g.grid.height/2)
    await page.mouse.move(p.x,p.y);await page.mouse.wheel({deltaY:500})
    s=await waitState(v=>v.visible.StartRow>0)
    check(`DPR${dpr} wheel scroll advances visible rows`,s.visible.StartRow>0,s.visible)
    await capture(`dpr${dpr}-scrolled`)
    assert.deepEqual(s.cells,initialCells,'view interactions must not alter cell content or formats')
    const saved=await exec('export_document',{name:'synthetic-header.xlsx'})
    const bytes=Object.values(saved.bytes)
    assert.ok(bytes.length>1000,'nonempty exported XLSX')
    await exec('load_document',{name:'reopened-header.xlsx',bytes})
    const reopened=await state()
    // NumberFormat is an internal index and may change after import; compare
    // its concrete format string instead of this index in the probe.
    assert.deepEqual(reopened.cells,s.cells,'export/reopen preserves content and cell formats')
    for(const key of ['columns','rows']) assert.ok(reopened[key].every((value,i)=>Math.abs(value-s[key][i])<=5),key+' persists within 0.05mm import rounding')
    check(`DPR${dpr} export/reopen retains values, formulas, formats and dimensions`,true)
    await exec('set_chrome',{all:false,rulers:false})
    await capture(`dpr${dpr}-reopened`)
    await page.close()
  }
} catch(error) {
  check('test execution',false,error.stack)
  for(const page of await browser.pages().catch(()=>[])) if(page.url().includes('editor.html')) {
    await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{})
    fs.writeFileSync(path.join(out,'pointer-log.json'),JSON.stringify(await page.evaluate(()=>({events:window.__headerPointerLog,canvases:[...document.querySelectorAll('canvas')].map(e=>({id:e.id,className:e.className,html:e.parentElement.outerHTML.slice(0,1000)}))})).catch(()=>null),null,2))
    console.error(await page.evaluate(()=>document.querySelector('#vlog')?.textContent).catch(()=>''))
  }
}
finally {
  clearTimeout(deadline);await browser.close();await new Promise(r=>server.close(r))
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2))
}
console.log('Artifacts: '+out)
if(results.some(r=>r.ok===false))process.exitCode=1
