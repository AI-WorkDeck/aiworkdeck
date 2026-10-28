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
const source = fs.readFileSync(process.env.SHEET_BOUNDARY_WORKER || new URL('../../src/zetaoffice/public/office_thread.js', import.meta.url), 'utf8')
const server = await startServer({ patchServed: (url, bytes) => url.endsWith('/office_thread.js') ? Buffer.from(source) : bytes })
const browser = await launchBrowser(await loadPuppeteer())
const out = process.env.SHEET_BOUNDARY_EVIDENCE || '/tmp/excel-1576-sort-boundaries'
fs.mkdirSync(out, {recursive:true})
try {
  const page = await openEditor(browser, {clipboard:false})
  const exec = async (action, args={}) => { const r=await page.evaluate((a,p)=>window.__loExecutor.executeCommand(a,p),action,args); console.log(action,JSON.stringify(r)); assert.equal(r.success,true,JSON.stringify(r));return r }
  await exec('load_document',{bytes:await minimalXlsx('sort'),name:'sort.xlsx'})
  const records=[]
  const save=async(name)=>{const r=await page.evaluate(async()=>{const x=await window.__loExecutor.executeCommand('export_document',{name:'review.xlsx'});return {success:x.success,bytes:Array.from(x.bytes||[])}});assert.equal(r.success,true);fs.writeFileSync(out+'/'+name,Buffer.from(r.bytes));return r.bytes}
  await exec('sheet_write_cells',{startCell:'A1',inheritFormat:false,rows:[['Key','Value','Extra'],[3,30,'c'],[1,10,'a'],[2,20,'b']]})
  await exec('sheet_add_comment',{cell:'B2',text:'record-3'})
  await exec('sheet_add_comment',{cell:'B3',text:'record-1'})
  const seed=await save('seed.xlsx')
  for(const mode of ['merged','outside','overlap','anchor-outside']) {
    const bytes=seed
    await exec('load_document',{bytes,name:mode+'.xlsx'})
    if(mode==='merged') await exec('sheet_merge_cells',{range:'B2:C3',merge:true})
    if(mode==='outside') await exec('sheet_merge_cells',{range:'F2:G3',merge:true})
    if(mode==='anchor-outside') await exec('sheet_merge_cells',{range:'B2:C3',merge:true})
    if(mode==='overlap') await exec('sheet_merge_cells',{range:'C2:D3',merge:true})
    const before=await exec('sheet_read_range',{range:'A1:C4'})
    await save(mode+'-before.xlsx')
    const sorted=await Promise.race([page.evaluate(mode=>window.__loExecutor.executeCommand('sheet_sort_range',{range:mode==='anchor-outside'?'C1:C4':'A1:C4',byColumn:mode==='anchor-outside'?'C':'A',hasHeader:true}),mode),new Promise((_,reject)=>setTimeout(()=>reject(new Error('sort did not settle in 15sec: '+mode)),15000))])
    if(mode==='outside') assert.equal(sorted.success,true)
    else {assert.equal(sorted.success,false);assert.equal(sorted.error,'SHEET_SORT_MERGED_RANGE')}
    const after=await exec('sheet_read_range',{range:'A1:C4'}),comments=await exec('sheet_get_comments')
    if(mode!=='outside') assert.deepEqual(after.rows,before.rows)
    else assert.deepEqual(after.rows.map(r=>r[0]),['Key',1,2,3])
    console.log('COMBINATION',JSON.stringify({mode,before,sorted,after,comments}))
    records.push({mode,before,sorted,after,comments});fs.writeFileSync(out+'/combinations.json',JSON.stringify(records,null,2))
    const persisted=await save(mode+'-after.xlsx');await exec('load_document',{bytes:persisted,name:mode+'.xlsx'})
    records.at(-1).reopened=await exec('sheet_read_range',{range:'A1:C4'});records.at(-1).reopenedComments=await exec('sheet_get_comments')
    fs.writeFileSync(out+'/combinations.json',JSON.stringify(records,null,2))
  }
  const perf=await JSZip.loadAsync(Uint8Array.from(await minimalXlsx('performance')))
  const rows=Array.from({length:500},(_,i)=>'<row r="'+(i+1)+'">'+Array.from({length:10},(_,j)=>'<c r="'+String.fromCharCode(65+j)+(i+1)+'"><v>'+(500-i+j)+'</v></c>').join('')+'</row>').join('')
  const sheetXml=await perf.file('xl/worksheets/sheet1.xml').async('string')
  perf.file('xl/worksheets/sheet1.xml',sheetXml.replace(/<sheetData>[\s\S]*?<\/sheetData>/,'<sheetData>'+rows+'</sheetData>'))
  await exec('load_document',{bytes:Array.from(await perf.generateAsync({type:'uint8array'})),name:'performance.xlsx'})
  const began=Date.now();await exec('sheet_sort_range',{range:'A1:J500',byColumn:'A',hasHeader:false});const ms=Date.now()-began
  assert.deepEqual((await exec('sheet_read_range',{range:'A1:A2'})).rows,[[1],[2]])
  fs.writeFileSync(out+'/performance.json',JSON.stringify({cells:5000,sortIncludingMergePreflightMs:ms},null,2))
  console.log('PASS merged rejection, unrelated merged acceptance, overlap rejection and bounded 5000-cell performance',ms)
} finally { await browser.close();await new Promise(resolve=>server.close(resolve)) }
