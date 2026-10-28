// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import fs from 'node:fs'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { preflight, loadPuppeteer, startServer, launchBrowser, openEditor } from './_boot.mjs'
async function minimalXlsx(a1) {
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const zip = new JSZip()
  zip.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    + '</Types>')
  zip.file('_rels/.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="' + REL + '/officeDocument" Target="xl/workbook.xml"/></Relationships>')
  zip.file('xl/workbook.xml',
    '<workbook xmlns="' + NS + '" xmlns:r="' + REL + '">'
    + '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>')
  zip.file('xl/_rels/workbook.xml.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="' + REL + '/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
  zip.file('xl/worksheets/sheet1.xml',
    '<worksheet xmlns="' + NS + '"><sheetData><row r="1">'
    + '<c r="A1" t="inlineStr"><is><t>' + a1 + '</t></is></c>'
    + '</row></sheetData></worksheet>')
  return Array.from(await zip.generateAsync({ type: 'uint8array' }))
}

preflight()
const source = fs.readFileSync(process.env.SHEET_SORT_WORKER || new URL('../../src/zetaoffice/public/office_thread.js', import.meta.url), 'utf8')
const server = await startServer({ patchServed: (url, bytes) => url.endsWith('/office_thread.js') ? Buffer.from(source) : bytes })
const browser = await launchBrowser(await loadPuppeteer())
const out = process.env.SHEET_SORT_EVIDENCE || '/tmp/excel-1576-sort'
fs.mkdirSync(out, {recursive:true})
try {
  const page = await openEditor(browser, {clipboard:false})
  const exec = async (action, args={}) => { const r=await page.evaluate((a,p)=>window.__loExecutor.executeCommand(a,p),action,args); console.log(action,JSON.stringify(r)); assert.equal(r.success,true,JSON.stringify(r));return r }
  await exec('load_document',{bytes:await minimalXlsx('sort'),name:'sort.xlsx'})
  await exec('sheet_write_cells',{startCell:'C1',inheritFormat:false,rows:[['Key','Amount','Total'],[3,30,'=D2*10'],[1,10,'=D3*20'],[2,20,'=D4*30']]})
  await exec('sheet_write_cells',{startCell:'H1',rows:[['=D2']]})
  for(const [row,color] of [[2,'#FF0000'],[3,'#00FF00'],[4,'#0000FF']])await exec('sheet_format_cells',{range:'C'+row+':E'+row,background:color,bold:row===2})
  const exportBytes=async()=>{const r=await page.evaluate(async()=>{const r=await window.__loExecutor.executeCommand('export_document',{name:'sort.xlsx'});return {...r,bytes:Array.from(r.bytes||[])}});assert.equal(r.success,true);return r.bytes}
  const before=await exportBytes(); fs.writeFileSync(out+'/before.xlsx',Buffer.from(before))
  await exec('sheet_sort_range',{range:'C1:E4',byColumn:'C',ascending:true,hasHeader:true})
  const after=await exec('sheet_read_range',{range:'C1:H4'})
  fs.writeFileSync(out+'/after.json',JSON.stringify(after,null,2))
  const bytes=await exportBytes(); fs.writeFileSync(out+'/after.xlsx',Buffer.from(bytes))
  assert.deepEqual(after.rows.slice(1).map(r=>r.slice(0,3)),[[1,10,200],[2,20,600],[3,30,300]])
  assert.equal(after.rows[0][5],10,'native default keeps external references bound to cell coordinates')
  const formulas=Object.fromEntries(after.formulas.map(f=>[f.cell,f.formula]));assert.equal(formulas.H1,'=D2')
  for(const [cell,expected] of [['E2','=D2*20'],['E3','=D3*30'],['E4','=D4*10']])assert.equal(formulas[cell],expected)
  const beforeZip=await JSZip.loadAsync(Uint8Array.from(before)),zip=await JSZip.loadAsync(Uint8Array.from(bytes))
  const beforeXml=await beforeZip.file('xl/worksheets/sheet1.xml').async('string'),xml=await zip.file('xl/worksheets/sheet1.xml').async('string')
  const beforeStyles=await beforeZip.file('xl/styles.xml').async('string'),styles=await zip.file('xl/styles.xml').async('string')
  const style=(text,styles,cell)=>{
    const index=Number(text.match(new RegExp('<c\\b(?=[^>]*\\br="'+cell+'")[^>]*\\bs="([^"]+)"'))?.[1]||0)
    const xf=styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)[1].match(/<xf\b[\s\S]*?<\/xf>/g)[index]
    const fillId=Number(xf.match(/fillId="(\d+)"/)[1]),fontId=Number(xf.match(/fontId="(\d+)"/)[1])
    const fills=styles.match(/<fills[^>]*>([\s\S]*?)<\/fills>/)[1].match(/<fill>[\s\S]*?<\/fill>/g)
    const fonts=styles.match(/<fonts[^>]*>([\s\S]*?)<\/fonts>/)[1].match(/<font>[\s\S]*?<\/font>/g)
    const font=fonts[fontId]
    return {fill:fills[fillId],font:{name:font.match(/<name val="([^"]+)"/)?.[1],size:font.match(/<sz val="([^"]+)"/)?.[1],bold:/<b(?:\s|\/|>)/.test(font),italic:/<i(?:\s|\/|>)/.test(font),color:font.match(/<color[^>]*>/)?.[0]}}
  }
  for(const [to,from] of [[2,3],[3,4],[4,2]])for(const col of ['C','D','E'])assert.deepEqual(style(xml,styles,col+to),style(beforeXml,beforeStyles,col+from),'format moves with record '+col+to)
  await exec('load_document',{bytes,name:'sort-reopened.xlsx'})
  const reopened=await exec('sheet_read_range',{range:'C1:H4'})
  assert.deepEqual(reopened.rows,after.rows);assert.deepEqual(reopened.formulas,after.formulas)
  const reopenedBytes=await exportBytes();fs.writeFileSync(out+'/reopened.xlsx',Buffer.from(reopenedBytes))
  const reopenedZip=await JSZip.loadAsync(Uint8Array.from(reopenedBytes))
  const reopenedXml=await reopenedZip.file('xl/worksheets/sheet1.xml').async('string'),reopenedStyles=await reopenedZip.file('xl/styles.xml').async('string')
  for(const row of [2,3,4])for(const col of ['C','D','E'])assert.deepEqual(style(reopenedXml,reopenedStyles,col+row),style(xml,styles,col+row),'reopened format '+col+row)
  await exec('sheet_sort_range',{range:'C2',hasHeader:false})
  assert.deepEqual((await exec('sheet_read_range',{range:'C1:H4'})).rows,after.rows,'single-cell sort must not expand to adjacent table')
  await exec('sheet_sort_range',{range:'C2:E4',byColumn:'C',ascending:false,hasHeader:false})
  assert.deepEqual((await exec('sheet_read_range',{range:'C2:E4'})).rows,[[3,30,300],[2,20,600],[1,10,200]])
  fs.writeFileSync(out+'/result.json',JSON.stringify({passed:true,formulas,rows:after.rows},null,2))
  console.log('PASS native sort preserves formulas, references, styles and saved/reopened content')
} finally { await browser.close();await new Promise(resolve=>server.close(resolve)) }
