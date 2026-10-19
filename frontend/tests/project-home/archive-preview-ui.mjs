// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Run only against an explicitly supplied, isolated backend with a synthetic archive project.
import puppeteer from 'puppeteer-core'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const base = process.env.ARCHIVE_UI_BASE
const backend = process.env.ARCHIVE_UI_BACKEND
const projectId = process.env.ARCHIVE_UI_PROJECT
const archiveId = process.env.ARCHIVE_UI_FILE
const targetId = process.env.ARCHIVE_UI_TARGET
if (![base, backend, projectId, archiveId, targetId].every(Boolean)) throw Error('Supply isolated ARCHIVE_UI_BASE/BACKEND/PROJECT/FILE/TARGET')
if (!['127.0.0.1', 'localhost'].includes(new URL(backend).hostname)) throw Error('Synthetic local backend required')
const out = process.env.ARCHIVE_UI_OUT || '/tmp/awd-archive-preview-ui'
fs.mkdirSync(out, {recursive:true})
const browser = await puppeteer.launch({executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true, args:['--no-sandbox']})
const page = await browser.newPage()
await page.setViewport({width:1440,height:1000})
await page.evaluateOnNewDocument(() => localStorage.setItem('awd_app_language','zh-CN'))
const errors=[]
page.on('pageerror',e=>errors.push(e.message))
try {
  const targetUrl = `${backend}/api/projects/${projectId}/files?parentId=${targetId}`
  assert.equal((await (await fetch(targetUrl)).json()).filter(f=>f.name==='蓝色.png').length,0,'Use a fresh synthetic target folder')
  await page.goto(`${base}/#/pages/project-overview/project-overview?id=${projectId}`,{waitUntil:'networkidle0'})
  await page.waitForSelector(`.file-tree .tree-item[data-file-id="${archiveId}"]`,{visible:true})
  await page.click(`.file-tree .tree-item[data-file-id="${archiveId}"]`)
  await page.waitForSelector('.archive-entry-row',{visible:true})
  const rowFor = async text => { const handles=await page.$$('.archive-entry-row'); for(const h of handles) if(await h.evaluate((e,t)=>e.textContent.includes(t),text))return h; throw Error('Missing archive entry '+text) }
  await (await rowFor('红色.png')).click()
  await page.waitForFunction(()=>document.querySelector('.archive-entry-preview .preview-img')?.naturalWidth>0)
  await page.keyboard.press('ArrowDown')
  await page.waitForFunction(()=>document.querySelector('.archive-entry-preview .preview-title')?.textContent==='蓝色.png')
  await page.waitForFunction(()=>document.querySelector('.archive-entry-preview .preview-img')?.naturalWidth>0)
  await page.screenshot({path:out+'/archive-image.png'})
  await page.keyboard.press('ArrowDown')
  await page.waitForFunction(()=>document.querySelector('.archive-entry-preview .text-content')?.textContent.includes('真实 HTTP 中文预览'))
  await page.setDragInterception(true)
  const target=await page.$(`.file-tree .tree-item[data-file-id="${targetId}"]`)
  const imported = page.waitForResponse(r=>r.url().includes(`/files/${archiveId}/archive/import-entry`)&&r.request().method()==='POST')
  await (await rowFor('蓝色.png')).dragAndDrop(target)
  assert.equal((await imported).status(),200)
  await page.waitForFunction(async (url,parent)=>{
    const files=await(await fetch(url)).json()
    return files.some(f=>f.name==='蓝色.png'&&String(f.parentId)===parent)
  },{},targetUrl,targetId)
  await page.mouse.move(1200,800)
  await page.keyboard.press('Escape')
  await page.waitForFunction(()=>!document.__checkbaDraggedArchiveEntry)
  assert.equal(await page.$('.evidence-drop-overlay'),null)
  const files=await(await fetch(targetUrl)).json()
  assert.equal(files.filter(f=>f.name==='蓝色.png'&&String(f.parentId)===targetId).length,1)
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({passed:true,checks:['real archive listing','image decode','arrow selection','Chinese text','real drag to project folder','single import','drag identity cleanup'],out}))
} catch(e) {await page.screenshot({path:out+'/failure.png'});throw e} finally {await browser.close()}
