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
const server = await startServer()
const browser = await launchBrowser(await loadPuppeteer())
const out = process.env.LOWA_IME_CALC_SHOTS || '/tmp/ime-calc-1597'
fs.mkdirSync(out, { recursive: true })
try {
  const page = await openEditor(browser, { viewport: { width: 1280, height: 900 } })
  const exec = (action, params = {}) => page.evaluate((a,p) => window.__loExecutor.executeCommand(a,p), action, params)
  const ok = async (a,p) => { const r = await exec(a,p); assert.equal(r.success,true, a+': '+JSON.stringify(r)); return r }
  await ok('load_document', { bytes: await minimalXlsx('保留原值'), name: 'ime.xlsx' })
  await ok('sheet_select_range', { range: 'B2' })
  await page.focus('[data-lo-ime]')
  const cdp = await page.createCDPSession()
  const state = () => page.$eval('[data-lo-ime]', e => ({value:e.value,start:e.selectionStart,end:e.selectionEnd,opacity:getComputedStyle(e).opacity,caret:getComputedStyle(e).caretColor,focused:document.activeElement===e,scroll:e.scrollLeft}))
  const read = async () => (await ok('sheet_read_range', {range:'A1:B2'})).rows
  const before = await read()
  await cdp.send('Input.imeSetComposition', {text:"women'shi'pengyou",selectionStart:6,selectionEnd:6})
  let s = await state(); assert.equal(s.start,6);assert.equal(s.opacity,'1');assert.equal(s.focused,true);assert.notEqual(s.caret,'rgba(0, 0, 0, 0)')
  assert.deepEqual(await read(),before)
  await page.screenshot({path:out+'/middle.png'})
  await cdp.send('Input.imeSetComposition', {text:'',selectionStart:0,selectionEnd:0})
  assert.deepEqual(await read(),before);assert.equal((await state()).opacity,'0')
  await cdp.send('Input.imeSetComposition', {text:'pengyou',selectionStart:3,selectionEnd:3})
  await cdp.send('Input.insertText', {text:'朋友'})
  await new Promise(r=>setTimeout(r,500))
  assert.equal((await state()).focused, true, 'Enter must reach the focused IME input')
  await page.keyboard.press('Enter')
  await page.waitForFunction(async () => {const r=await window.__loExecutor.executeCommand('sheet_read_range',{range:'B2'});return r.rows?.[0]?.[0]==='朋友'}, {timeout:20000})
  assert.equal((await state()).opacity,'0')
  assert.equal((await read())[0][0],'保留原值')
  const exported = await page.evaluate(async()=>{const r=await window.__loExecutor.executeCommand('export_document',{name:'ime.xlsx'});return {...r,bytes:Array.from(r.bytes||[])}})
  assert.equal(exported.success,true);assert.ok(exported.bytes.length>0)
  fs.writeFileSync(out+'/ime.xlsx',Buffer.from(exported.bytes))
  await ok('load_document',{bytes:exported.bytes,name:'ime-reopened.xlsx'})
  assert.equal((await read())[1][1],'朋友');assert.equal((await read())[0][0],'保留原值')
  await page.screenshot({path:out+'/reopened.png'})
  console.log('PASS Calc real engine: middle caret, cancellation without writes, one Chinese commit, XLSX export/reopen, adjacent content preserved')
} finally { await browser.close(); await new Promise(r=>server.close(r)) }
