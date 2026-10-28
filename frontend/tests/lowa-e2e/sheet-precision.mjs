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
const server = await startServer(), browser = await launchBrowser(await loadPuppeteer())
try {
 const page = await openEditor(browser, {clipboard:false});await page.setViewport({width:1440,height:1000})
 await page.addStyleTag({content:'#vlog,#verify {display:none !important}'})
 const results=[]
 const exec = async(a,p={})=>{const r=await page.evaluate((a,p)=>window.__loExecutor.executeCommand(a,p),a,p); console.log(a,JSON.stringify(r)); results.push({action:a,args:p,result:r});return r}
 const ok = async(a,p={})=>{const r=await exec(a,p);assert.equal(r.success,true,JSON.stringify(r));return r}
 await ok('load_document',{bytes:await minimalXlsx('precision'),name:'precision.xlsx'})
 const data=[['Category','Amount'],['A',100],['B',200],['A',300]]
 await ok('sheet_write_cells',{startCell:'A1',rows:data})
 await ok('sheet_manage_sheets',{op:'add',name:'Cost, net!'})
 await ok('sheet_write_cells',{sheet:'Cost, net!',startCell:'A1',rows:[[17]]})
 await ok('sheet_define_name',{sheet:'Cost, net!',op:'add',name:'QuotedRevenue',range:'A1'})
 await ok('sheet_write_cells',{sheet:'Sheet1',startCell:'C1',rows:[["='Cost, net!'!A1"]]})
 assert.equal((await ok('sheet_read_range',{range:'C1'})).rows[0][0],17)
 await ok('sheet_set_data_validation',{range:'D2:D4',type:'list',value1:'Yes,No'})
 await ok('sheet_set_data_validation',{range:'E2:E4',type:'wholeNumber',operator:'between',value1:'1',value2:'10'})
 await ok('sheet_conditional_format',{range:'B2:B4',rule:'greater',value1:'150',background:'#FF0000'})
 await ok('sheet_add_comment',{cell:'A2',text:'Evidence'})
 await ok('sheet_define_name',{op:'add',name:'Revenue',range:'B2:B4'})
 await ok('sheet_group_rows_cols',{range:'A2:B4',op:'group',orient:'rows'})
 await ok('sheet_group_rows_cols',{range:'A2:B4',op:'hide',orient:'rows'})
 await ok('sheet_group_rows_cols',{range:'A2:B4',op:'show',orient:'rows'})
 await ok('sheet_add_pivot_table',{sourceRange:'A1:B4',rowFields:['Category'],dataField:'Amount',outputCell:'M1',name:'Summary'})
 await ok('sheet_freeze_panes',{rows:1,cols:1})
 await ok('sheet_set_autofilter',{range:'A1:B4',enabled:true})
 for(const [i,type] of ['column','bar','line','pie'].entries()) {
   const row=1+i*22; if(i)await ok('sheet_write_cells',{startCell:'A'+row,rows:data})
   const chart=await ok('sheet_add_chart',{range:`A${row}:B${row+3}`,chartType:type,name:type+'Chart',title:type+' Revenue'})
   assert.equal(chart.note,undefined)
 }
 await ok('sheet_manage_sheets',{op:'add',name:'Structure'})
 await ok('sheet_write_cells',{sheet:'Structure',startCell:'A1',rows:[['Item','Value'],['B',20],['A',10]]})
 await ok('sheet_edit_rows_cols',{start:'2',count:1,op:'insert_rows'})
 await ok('sheet_edit_rows_cols',{start:'2',count:1,op:'delete_rows'})
 await ok('sheet_edit_rows_cols',{start:'B',count:1,op:'insert_cols'})
 await ok('sheet_edit_rows_cols',{start:'B',count:1,op:'delete_cols'})
 await ok('sheet_sort_range',{range:'A1:B3',byColumn:'B'})
 assert.equal((await ok('sheet_read_range',{range:'A2:B2'})).rows[0][0],'A')
 await ok('sheet_merge_cells',{range:'D1:E1',merge:true})
 await ok('sheet_merge_cells',{range:'D1:E1',merge:false})
 await ok('sheet_format_cells',{range:'A1:B1',bold:true,background:'#183247',color:'#FFFFFF'})
 await ok('sheet_set_borders',{range:'A1:B3',preset:'all'})
 await ok('sheet_set_row_col',{range:'A1:B3',rowHeightPt:24,colWidthPt:100})
 await ok('sheet_write_cells',{startCell:'F1',rows:Array.from({length:150},(_,i)=>['=1+'+i])})
 assert.equal((await ok('sheet_read_range',{range:'F1:F150'})).formulas.length,150)
 assert.equal((await exec('sheet_write_cells',{startCell:'XFD1048576',rows:[[1,2]]})).success,false)
 await ok('sheet_protect_sheet',{action:'protect'})
 const protectedWrite=await exec('sheet_write_cells',{startCell:'A1',rows:[['SHOULD_NOT_WRITE']]});assert.equal(protectedWrite.success,false);assert.equal(protectedWrite.error,'SHEET_PROTECTED_CELL');assert.equal((await ok('sheet_read_range',{range:'A1'})).rows[0][0],'Item')
 for(const action of ['sheet_sort_range','sheet_format_cells','sheet_add_chart','sheet_find_replace'])assert.equal((await exec(action,{range:'A1:B3',find:'A',replace:'Z',bold:true})).error,'SHEET_PROTECTED_CELL')
 await ok('sheet_protect_sheet',{action:'unprotect'})
 await ok('sheet_protect_sheet',{action:'protect'})
 await ok('sheet_read_range',{sheet:'Sheet1',range:'A1:B4'})
 const exportBytes=async()=>{const r=await page.evaluate(async()=>{const r=await window.__loExecutor.executeCommand('export_document',{name:'precision.xlsx'});return {...r,bytes:Array.from(r.bytes||[])}});assert.equal(r.success,true);return r.bytes}
 const bytes=await exportBytes(), zip=await JSZip.loadAsync(Uint8Array.from(bytes))
 fs.mkdirSync('/tmp/excel-1576-evidence',{recursive:true});fs.writeFileSync('/tmp/excel-1576-evidence/latest-debug.xlsx',Buffer.from(bytes))
 const xml=await zip.file('xl/worksheets/sheet1.xml').async('string')
 assert.match(xml,/<formula1>&quot;Yes,No&quot;<\/formula1>|<formula1>"Yes,No"<\/formula1>/)
 assert.match(xml,/<formula1>1<\/formula1>/);assert.match(xml,/<formula2>10<\/formula2>/)
 assert.match(xml,/outlineLevel="1"/);assert.match(xml,/<conditionalFormatting/);assert.ok(xml.includes('<autoFilter') || (await Promise.all(Object.keys(zip.files).filter(n=>/^xl\/tables\//.test(n)&&n.endsWith('.xml')).map(n=>zip.file(n).async('string')))).some(s=>s.includes('<autoFilter')));assert.match(xml,/state="frozen"/)
 assert.match(await zip.file('xl/worksheets/sheet3.xml').async('string'),/<sheetProtection/)
 const charts=await Promise.all(Object.keys(zip.files).filter(n=>/^xl\/charts\/chart\d+\.xml$/.test(n)).map(n=>zip.file(n).async('string')))
 assert.equal(charts.length,4)
 for(const type of ['column','bar','line','pie']) {
   const chart=charts.find(s=>s.includes(type+' Revenue'));assert.ok(chart,type)
   if(type==='column'||type==='bar')assert.match(chart,new RegExp('<c:barDir val="'+(type==='column'?'col':'bar')+'"'))
   else assert.ok(chart.includes('<c:'+type+'Chart>'))
   assert.ok(chart.includes('<c:v>300</c:v>'))
 }
 assert.ok(Object.keys(zip.files).some(n=>/^xl\/pivotTables\/pivotTable/.test(n)))
 const out=process.env.SHEET_EVIDENCE_DIR||'/tmp/excel-1576-evidence';fs.mkdirSync(out,{recursive:true});fs.writeFileSync(out+'/precision.xlsx',Buffer.from(bytes))
 await ok('load_document',{bytes,name:'precision.xlsx'})
 const reopened=await ok('sheet_read_range',{sheet:'Sheet1',range:'A1:N6'})
 assert.equal(reopened.rows[0][2],17);assert.equal(reopened.rows[3][13],400);assert.equal(reopened.rows[4][13],200);assert.equal(reopened.rows[5][13],600)
 assert.equal((await ok('sheet_get_comments',{})).comments[0].text,'Evidence')
 assert.equal((await ok('sheet_define_name',{op:'list'})).names.length,2)
 for(const [i,type] of ['column','bar','line','pie'].entries()){const target='A'+(1+i*22);const selected=await ok('sheet_select_range',{range:target});assert.equal(selected.visibleRange.split(':')[0],target);await page.screenshot({path:out+'/'+type+'-reopened.png'})}
 await ok('sheet_select_range',{range:'A1'});await page.screenshot({path:out+'/reopened.png'})
 const pdf=await page.evaluate(async()=>{const r=await window.__loExecutor.executeCommand('export_pdf',{});return {...r,bytes:Array.from(r.bytes||[])}})
 assert.equal(pdf.success,true);fs.writeFileSync(out+'/precision.pdf',Buffer.from(pdf.bytes))
 const reopenedBytes=await exportBytes();fs.writeFileSync(out+'/reopened.xlsx',Buffer.from(reopenedBytes));fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2))
 console.log('PASS real Calc formula, 4 charts, pivot, validation, comments, names, protection, grouping, filter, freeze, structure and persisted XLSX')
} finally {await browser.close(); await new Promise(r=>server.close(r))}
