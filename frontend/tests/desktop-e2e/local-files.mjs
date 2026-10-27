// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Source Electron smoke; build H5/editor/backend first and supply local LOWA assets.
// Uses a fresh HOME, profile, H2/storage and ports. No account or paid model calls.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import JSZip from 'jszip'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const run = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-local-files-'))
const home = path.join(run, 'home')
fs.mkdirSync(home)
const freePort = () => new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })
const [backendPort, cdpPort, ...servicePorts] = await Promise.all(Array.from({ length: 6 }, freePort))
const base = `http://127.0.0.1:${backendPort}`
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn, timeout = 60000) {
  const end = Date.now() + timeout
  let last
  while (Date.now() < end) { try { const result = await fn(); if (result) return result } catch (e) { last = e }; await sleep(200) }
  throw last || new Error('condition timed out')
}
for (const dir of ['A', 'B']) fs.mkdirSync(path.join(home, dir))
const first = path.join(home, 'A/相同 名称.txt')
const second = path.join(home, 'B/相同 名称.txt')
const sibling = path.join(home, 'A/不要导入.txt')
fs.writeFileSync(first, 'first original')
fs.writeFileSync(second, 'second original')
fs.writeFileSync(sibling, 'PRIVATE SIBLING CANARY')
const docx = path.join(home, 'A/合同.docx')
const zip = new JSZip()
zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Original contract</w:t></w:r></w:p><w:sectPr/></w:body></w:document>')
fs.writeFileSync(docx, await zip.generateAsync({ type: 'nodebuffer' }))
const pdf = path.join(home, 'B/预览.pdf')
const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R >>', '<< /Length 0 >>\nstream\n\nendstream']
let pdfData = '%PDF-1.4\n'; const offsets = [0]
objects.forEach((obj, i) => { offsets.push(Buffer.byteLength(pdfData)); pdfData += `${i + 1} 0 obj\n${obj}\nendobj\n` })
const xref = Buffer.byteLength(pdfData)
pdfData += `xref\n0 5\n0000000000 65535 f \n` + offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
fs.writeFileSync(pdf, pdfData)
const commandFile = path.join(run, 'command.json')
fs.writeFileSync(commandFile, '{}')
const wrapper = path.join(run, 'main.cjs')
fs.writeFileSync(wrapper, `const {app}=require('electron');const fs=require('fs');const path=require('path');
const root=${JSON.stringify(root)}, home=${JSON.stringify(home)}, run=${JSON.stringify(run)};
for(const key of ['home','appData','userData','sessionData','documents','downloads','desktop','music','pictures','videos','logs','crashDumps','temp']){const p=key==='home'?home:path.join(run,key);fs.mkdirSync(p,{recursive:true});app.setPath(key,p)}
fs.writeFileSync(path.join(run,'paths.json'),JSON.stringify(Object.fromEntries(['home','appData','userData','sessionData'].map(k=>[k,app.getPath(k)]))));
require(path.join(root,'desktop/main/main.js'));
app.emit('open-file',{preventDefault(){}},${JSON.stringify(first)});
app.emit('open-file',{preventDefault(){}},${JSON.stringify(second)});
let last='';fs.watchFile(${JSON.stringify(commandFile)},{interval:100},()=>{const s=fs.readFileSync(${JSON.stringify(commandFile)},'utf8');if(s===last)return;last=s;const c=JSON.parse(s);if(c.quit){fs.unwatchFile(${JSON.stringify(commandFile)});app.quit()}else if(c.path)app.emit('open-file',{preventDefault(){}},c.path)});
`)
const log = fs.openSync(path.join(run, 'electron.log'), 'w')
const electron = path.join(root, 'desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
const isolatedEnv = { ...process.env, HOME: home, JAVA_TOOL_OPTIONS: `-Duser.home=${home}`, SPRING_PROFILES_ACTIVE: 'desktop',
  STORAGE_LOCAL_ROOT_PATH: path.join(home, 'storage'),
  SPRING_DATASOURCE_URL: `jdbc:h2:file:${home}/db;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;NON_KEYWORDS=VALUE`,
  CHECKBA_BACKEND_PORT: String(backendPort), CHECKBA_PPTX_PORT: String(servicePorts[0]), CHECKBA_MINERU_PORT: String(servicePorts[1]), CHECKBA_KOKORO_PORT: String(servicePorts[2]), CHECKBA_ASR_PORT: String(servicePorts[3]),
  AIWORKDECK_DESKTOP_DEV: '0', JAVA_HOME: process.env.JAVA_HOME,
}
// Snapshot the jar so another build cannot replace a file loaded lazily by this JVM.
const jar = path.join(run, 'backend.jar')
fs.copyFileSync(path.join(root, 'backend/target/backend-0.0.1-SNAPSHOT.jar'), jar)
const java = spawn(path.join(process.env.JAVA_HOME, 'bin/java'), ['-jar', jar, `--server.port=${backendPort}`], {
  cwd: run, env: isolatedEnv, stdio: ['ignore', log, log],
})
let child
console.log(JSON.stringify({ run, backendPid: java.pid, backendPort, cdpPort }))
let browser
const api = async url => (await fetch(base + url)).json()
const sendOpen = filePath => fs.writeFileSync(commandFile, JSON.stringify({ path: filePath, nonce: Date.now() }))
try {
  await until(async () => {
    if (java.exitCode !== null) throw new Error('isolated backend exited')
    return (await fetch(base + '/api/admin/wizard')).ok
  }, 120000)
  child = spawn(electron, [wrapper, `--remote-debugging-port=${cdpPort}`, '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'], {
    cwd: root, stdio: ['ignore', log, log], env: isolatedEnv,
  })
  const paths = await until(() => fs.existsSync(path.join(run, 'paths.json')) && JSON.parse(fs.readFileSync(path.join(run, 'paths.json'))))
  assert.equal(paths.home, home)
  assert.ok(Object.values(paths).every(p => p.startsWith(run)))
  const ws = await until(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json()).webSocketDebuggerUrl, 120000)
  browser = await puppeteer.connect({ browserWSEndpoint: ws })
  const page = await until(async () => (await browser.pages()).find(p => p.url().includes('/h5/index.html')))
  await page.waitForFunction(() => window.__checkbaActiveOverviewVm?.leftFiles?.filter(f => f.name === '相同 名称.txt').length === 2, { timeout: 120000 })
  const state = await page.evaluate(() => { const v = window.__checkbaActiveOverviewVm; return { pid: v.projectId, loose: v.isLooseWorkspace, files: v.leftFiles.map(f => ({ id: f.id, name: f.name })), recent: localStorage.getItem('checkba_recent_projects') } })
  assert.equal(state.loose, true)
  assert.equal(state.recent, null)
  const projects = await api('/api/projects/my')
  assert.equal((Array.isArray(projects) ? projects : projects.data).length, 0)
  const filesResult = await api(`/api/projects/${state.pid}/files?tree=true`)
  const files = Array.isArray(filesResult) ? filesResult : filesResult.data
  assert.equal(files.length, 2)
  assert.ok(files.every(f => !f.externalPath && f.name !== '不要导入.txt'))
  // Real CodeMirror UI and save-to-original path.
  await page.waitForSelector('.cm-content', { timeout: 30000 })
  await page.click('.cm-content')
  await page.keyboard.press('End')
  await page.keyboard.type(' SAVED_FROM_UI')
  await until(() => fs.readFileSync(second, 'utf8').includes('SAVED_FROM_UI'))
  assert.equal(fs.readFileSync(first, 'utf8'), 'first original')
  assert.equal(fs.readFileSync(sibling, 'utf8'), 'PRIVATE SIBLING CANARY')
  sendOpen(first)
  await page.waitForFunction(id => String(window.__checkbaActiveOverviewVm.activeFileIdLeft) === String(id), {}, state.files[0].id)
  assert.equal(await page.evaluate(() => window.__checkbaActiveOverviewVm.leftFiles.filter(f => f.name === '相同 名称.txt').length), 2)
  sendOpen(pdf)
  await page.waitForFunction(() => window.__checkbaActiveOverviewVm?.activeFileLeft?.name === '预览.pdf')
  await page.waitForSelector('.preview-pdf iframe[src^="blob:"]', { timeout: 30000 })
  await sleep(1500) // Allow Chromium's PDF viewer to paint before capturing visual evidence.
  await page.screenshot({ path: path.join(run, 'pdf.png') })
  sendOpen(docx)
  await page.waitForFunction(() => window.__checkbaActiveOverviewVm?.activeFileLeft?.name === '合同.docx')
  await page.waitForFunction(() => Object.values(window.__checkbaActiveOverviewVm._libreRefs || {}).some(e => e.file?.name === '合同.docx' && e.ready && e.statusKey === 'ready' && !e.docLoadFailed), { timeout: 180000 })
  const edited = await page.evaluate(async () => {
    const vm = window.__checkbaActiveOverviewVm
    const editor = Object.values(vm._libreRefs).find(e => e.file?.name === '合同.docx')
    const inserted = await editor.executor.executeCommand('insert_at_cursor', { text: ' APPENDED' })
    await new Promise(resolve => setTimeout(resolve, 500))
    // Direct executor edits do not take the host's AI-completion notification path.
    // Exercise the real export/upload operation explicitly, then inspect original bytes.
    const saved = await editor.saveDocument()
    return { inserted, saved, dirty: editor.dirty, statusKey: editor.statusKey }
  })
  fs.writeFileSync(path.join(run, 'word-save.json'), JSON.stringify(edited, null, 2))
  assert.equal(edited.inserted?.success, true, JSON.stringify(edited))
  assert.equal(edited.saved, true, JSON.stringify(edited))
  await until(async () => {
    const savedDocx = await JSZip.loadAsync(fs.readFileSync(docx))
    return (await savedDocx.file('word/document.xml').async('string')).includes('APPENDED')
  }, 30000)
  await page.screenshot({ path: path.join(run, 'word.png') })
  fs.writeFileSync(path.join(run, 'result.json'), JSON.stringify({ passed: true, state }, null, 2))
  console.log('PASS: cold queue, multi-file tabs, no parent import/project pollution, text save, duplicate focus, PDF and Word')
} catch (error) {
  fs.writeFileSync(path.join(run, 'failure.txt'), error.stack)
  throw error
} finally {
  browser?.disconnect()
  fs.writeFileSync(commandFile, JSON.stringify({ quit: true }))
  if (child) await until(() => child.exitCode !== null || child.signalCode !== null, 30000).catch(() => child.kill('SIGTERM'))
  java.kill('SIGTERM')
  await until(() => java.exitCode !== null || java.signalCode !== null, 10000)
  fs.closeSync(log)
}
