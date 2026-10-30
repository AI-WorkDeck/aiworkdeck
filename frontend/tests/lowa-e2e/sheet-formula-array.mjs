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
const source = fs.readFileSync(process.env.SHEET_ARRAY_WORKER || new URL('../../src/zetaoffice/public/office_thread.js', import.meta.url), 'utf8')
const server = await startServer({ patchServed: (url, bytes) => url.endsWith('/office_thread.js') ? Buffer.from(source) : bytes })
const browser = await launchBrowser(await loadPuppeteer())
const out = process.env.SHEET_ARRAY_EVIDENCE || '/tmp/excel-1576-arrays'
fs.mkdirSync(out, {recursive:true})
try {
  const page = await openEditor(browser, {clipboard:false})
  const exec = async (action, args={}) => { const r=await page.evaluate((a,p)=>window.__loExecutor.executeCommand(a,p),action,args); console.log(action,JSON.stringify(r)); assert.equal(r.success,true,JSON.stringify(r));return r }
  await exec('load_document',{bytes:await minimalXlsx('sort'),name:'sort.xlsx'})
  const inputs=['=INDEX({1,2;3,4},2,1)','=INDEX({1;2;3},2,1)','=INDEX({1,2,3},1,2)','=SUM({1,2;3,4},{5,6;7,8})','=INDEX({"a,b!;{}","say ""hi""";"c","d"},1,2)','=SUM(1,2)','=INDEX({"a,b!;{}|","x";"c","d"},1,1)']
  const expected=[3,2,2,36,'say "hi"',3,'a,b!;{}|']
  const written=await exec('sheet_write_cells',{startCell:'A1',inheritFormat:false,rows:inputs.map(f=>[f])})
  assert.equal(written.formulaErrors,undefined)
  const check=async()=>{const r=await exec('sheet_read_range',{range:'A1:A7'});assert.deepEqual(r.rows.map(row=>row[0]),expected);return r}
  let read=await check()
  for(let i=0;i<inputs.length;i++) {
    await exec('sheet_select_range',{range:'A'+(i+1)})
    const state=await exec('get_ui_state')
    await exec('sheet_write_cells',{startCell:'D'+(i+1),inheritFormat:false,rows:[[state.calc.formula]]})
  }
  assert.deepEqual((await exec('sheet_read_range',{range:'D1:D7'})).rows.map(row=>row[0]),expected)
  await exec('sheet_write_cells',{startCell:'B1',inheritFormat:false,rows:read.formulas.map(c=>[c.formula])})
  assert.deepEqual((await exec('sheet_read_range',{range:'B1:B7'})).rows.map(row=>row[0]),expected)
  const bytes=await page.evaluate(async()=>{const r=await window.__loExecutor.executeCommand('export_document',{name:'arrays.xlsx'});return Array.from(r.bytes||[])})
  fs.writeFileSync(out+'/arrays.xlsx',Buffer.from(bytes))
  await exec('load_document',{bytes,name:'arrays.xlsx'})
  read=await check()
  await exec('sheet_write_cells',{startCell:'C1',inheritFormat:false,rows:read.formulas.map(c=>[c.formula])})
  assert.deepEqual((await exec('sheet_read_range',{range:'C1:C7'})).rows.map(row=>row[0]),expected)
  fs.writeFileSync(out+'/result.json',JSON.stringify({passed:true,inputs,expected,read},null,2))
  console.log('PASS Excel arrays preserve shape, escaped strings, function separators, read/write and export/reopen roundtrip')
} finally { await browser.close();await new Promise(resolve=>server.close(resolve)) }
