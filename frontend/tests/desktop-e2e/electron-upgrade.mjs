// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Source mode: build H5, zetaoffice and backend. AWD_TEST_INSTALLED=1 uses a signed
// installed bundle on disposable hosted runners; no source app or external JAR is substituted.
// JAVA_HOME must be JDK 21. Optional AWD_BASELINE_ELECTRON seeds a profile with the old runtime.
// Uses only generated fixtures, isolated paths/ports and normal UI-triggered autosave.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import JSZip from 'jszip'

const installedMode = process.env.AWD_TEST_INSTALLED === '1'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
if (installedMode) assert(process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted' && process.env.RUNNER_TEMP, 'Installed tests require a disposable hosted runner')
const run = fs.mkdtempSync(path.join(installedMode ? process.env.RUNNER_TEMP : os.tmpdir(), 'awd-electron-upgrade-'))
const home = path.join(run, 'home')
fs.mkdirSync(home)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const write = (name, value) => fs.writeFileSync(path.join(run, name), JSON.stringify(value, null, 2))
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
async function until(fn, timeout = 60000) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    try { const result = await fn(); if (result) return result } catch (error) { last = error }
    await sleep(250)
  }
  throw last || new Error(`Condition timed out after ${timeout} ms`)
}
const freePort = () => new Promise(resolve => {
  const server = net.createServer()
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)) })
})
const [backendPort, cdpPort, ...ports] = await Promise.all(Array.from({ length: 6 }, freePort))
const base = `http://127.0.0.1:${backendPort}`
const files = Object.fromEntries(['docx', 'xlsx', 'pptx', 'pdf'].map(ext => [ext, path.join(home, `兼容验证 Compatibility.${ext}`)]))
const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const packageRel = 'http://schemas.openxmlformats.org/package/2006/relationships'
function packageZip(part, contentType, content) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/${part}" ContentType="${contentType}"/></Types>`)
  zip.file('_rels/.rels', `<Relationships xmlns="${packageRel}"><Relationship Id="r1" Type="${rel}/officeDocument" Target="${part}"/></Relationships>`)
  zip.file(part, content)
  return zip
}
const doc = packageZip('word/document.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>ORIGINAL WORD CONTENT</w:t></w:r></w:p><w:p><w:r><w:t>Preserved second paragraph.</w:t></w:r></w:p><w:sectPr/></w:body></w:document>')
fs.writeFileSync(files.docx, await doc.generateAsync({ type: 'nodebuffer' }))
const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const xlsx = packageZip('xl/workbook.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml', `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="Sheet1" sheetId="1" r:id="r1"/></sheets></workbook>`)
xlsx.file('[Content_Types].xml', (await xlsx.file('[Content_Types].xml').async('string')).replace('</Types>', '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'))
xlsx.file('xl/_rels/workbook.xml.rels', `<Relationships xmlns="${packageRel}"><Relationship Id="r1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`)
xlsx.file('xl/worksheets/sheet1.xml', `<worksheet xmlns="${ns}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>ORIGINAL CELL</t></is></c><c r="B1"><v>21</v></c><c r="C1"><f>B1*2</f><v>42</v></c></row></sheetData></worksheet>`)
fs.writeFileSync(files.xlsx, await xlsx.generateAsync({ type: 'nodebuffer' }))
fs.copyFileSync(path.join(root, 'frontend/tests/lowa-e2e/fixtures/impress-smoke.pptx'), files.pptx)
const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>', ...[5, 6].map(n => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Resources << /Font << /F1 7 0 R >> >> /Contents ${n} 0 R >>`), ...[1, 2].map(n => {
  const stream = `BT /F1 14 Tf 40 520 Td (PDF PAGE ${n} - ELECTRON COMPATIBILITY) Tj ET`
  return `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
}), '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
let pdf = '%PDF-1.4\n'; const offsets = [0]
objects.forEach((obj, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n` })
const xref = Buffer.byteLength(pdf)
pdf += `xref\n0 8\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
fs.writeFileSync(files.pdf, pdf)
function productionSnapshot() {
  const processes = execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n')
    .filter(line => line.includes('/Applications/AI WorkDeck.app/Contents/MacOS/AI WorkDeck')).map(line => Number(line.trim().split(/\s+/)[0])).sort()
  const listeners = [5269, 5369, 5169].map(port => {
    try { return [port, execFileSync('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim().split(/\s+/).sort()] } catch { return [port, []] }
  })
  return { processes, listeners }
}
if (!installedMode) assert.equal(process.platform, 'darwin', 'Source harness is macOS only')
const productionBefore = installedMode ? null : productionSnapshot()
const originalHashes = Object.fromEntries(Object.entries(files).map(([ext, file]) => [ext, hash(file)]))
const commandFile = path.join(run, 'command.json')
const wrapper = path.join(run, 'main.cjs')
fs.writeFileSync(commandFile, '{}')
fs.writeFileSync(wrapper, `const {app}=require('electron'),fs=require('fs'),path=require('path');
const root=${JSON.stringify(root)},home=${JSON.stringify(home)},run=${JSON.stringify(run)};
for(const key of ['home','appData','userData','sessionData','documents','downloads','desktop','music','pictures','videos','logs','crashDumps','temp']){const p=key==='home'?home:path.join(run,key);fs.mkdirSync(p,{recursive:true});app.setPath(key,p)}
fs.writeFileSync(path.join(run,'paths.json'),JSON.stringify({versions:process.versions,pid:process.pid,ready:app.isReady(),paths:Object.fromEntries(['home','appData','userData','sessionData','documents','logs','temp'].map(k=>[k,app.getPath(k)]))}));
app.on('browser-window-created',(_,window)=>window.setContentSize(1440,1000));
require(path.join(root,'desktop/main/main.js'));
let last='';fs.watchFile(${JSON.stringify(commandFile)},{interval:100},()=>{const s=fs.readFileSync(${JSON.stringify(commandFile)},'utf8');if(s===last)return;last=s;const c=JSON.parse(s);if(c.quit){fs.unwatchFile(${JSON.stringify(commandFile)});app.quit()}else if(c.path)app.emit('open-file',{preventDefault(){}},c.path)});
`)
const env = Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'JAVA_HOME', 'TMPDIR'].filter(k => process.env[k]).map(k => [k, process.env[k]]))
Object.assign(env, { HOME: home, JAVA_TOOL_OPTIONS: `-Duser.home=${home}`, SPRING_PROFILES_ACTIVE: 'desktop', STORAGE_LOCAL_ROOT_PATH: path.join(home, 'storage'), SPRING_DATASOURCE_URL: `jdbc:h2:file:${home}/db;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;NON_KEYWORDS=VALUE`, CHECKBA_BACKEND_PORT: String(backendPort), CHECKBA_PPTX_PORT: String(ports[0]), CHECKBA_MINERU_PORT: String(ports[1]), CHECKBA_KOKORO_PORT: String(ports[2]), CHECKBA_ASR_PORT: String(ports[3]), CHECKBA_UPDATE_MANIFEST_URL: `http://127.0.0.1:${cdpPort}/updates-disabled`, AIWORKDECK_DESKTOP_DEV: '0' })
if (!installedMode) assert.ok(env.JAVA_HOME, 'JAVA_HOME must select JDK 21')
const jar = path.join(run, 'backend.jar')
if (!installedMode) fs.copyFileSync(path.join(root, 'backend/target/backend-0.0.1-SNAPSHOT.jar'), jar)
const log = fs.openSync(path.join(run, 'runtime.log'), 'w')
const java = installedMode ? null : spawn(path.join(env.JAVA_HOME, 'bin/java'), ['-jar', jar, `--server.port=${backendPort}`, '--network.proxy.auto-refresh=false'], { cwd: run, env, stdio: ['ignore', log, log] })
let child, browser, page, installed
let forced = false
const evidence = { passed: false, run, backendPort, cdpPort, backendPid: java?.pid, productionBefore, originalHashes, formats: {}, forcedSaveUsed: false }
console.log(JSON.stringify({ run, backendPid: java?.pid, backendPort, cdpPort }))
async function start(executable, phase) {
  fs.writeFileSync(commandFile, '{}')
  child = spawn(executable, [wrapper, `--remote-debugging-port=${cdpPort}`, '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'], { cwd: root, env, stdio: ['ignore', log, log] })
  const version = await until(async () => {
    if (child.exitCode !== null) throw new Error(`Electron exited ${child.exitCode}`)
    return (await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json())
  }, 120000)
  assert.equal(execFileSync('/usr/sbin/lsof', ['-nP', `-iTCP:${cdpPort}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim(), String(child.pid), 'CDP belongs to this Electron process')
  browser = await puppeteer.connect({ browserWSEndpoint: version.webSocketDebuggerUrl, defaultViewport: null })
  page = await until(async () => (await browser.pages()).find(p => p.url().includes('/h5/index.html')), 60000)
  await page.waitForFunction(() => !!window.__checkbaActiveOverviewVm, { timeout: 120000 })
  const paths = JSON.parse(fs.readFileSync(path.join(run, 'paths.json')))
  assert.equal(paths.ready, false)
  assert.ok(Object.values(paths.paths).every(p => p.startsWith(run + path.sep)))
  assert.equal(paths.paths.home, home)
  write(`${phase}-paths.json`, paths)
  return paths
}
async function quit() {
  if (installedMode) { browser?.disconnect(); browser = null; await installed.quit(); child = null; return }
  browser?.disconnect(); browser = null
  fs.writeFileSync(commandFile, JSON.stringify({ quit: true, nonce: Date.now() }))
  try { await until(() => child.exitCode !== null || child.signalCode !== null, 70000) }
  catch (error) { forced = true; child.kill('SIGTERM'); throw error }
  assert.equal(child.exitCode, 0)
  child = null
  await sleep(1000)
}
async function open(ext) {
  if (installedMode) {
    const file = JSON.stringify(files[ext])
    await installed.mainRpc(process.platform === 'darwin'
      ? `process.mainModule.require('electron').app.emit('open-file',{preventDefault(){}},${file})`
      : `process.mainModule.require('electron').app.emit('second-instance',{},[process.execPath,${file}],process.cwd())`)
  } else fs.writeFileSync(commandFile, JSON.stringify({ path: files[ext], nonce: Date.now() }))
  await page.waitForFunction(name => window.__checkbaActiveOverviewVm?.activeFileLeft?.name === name, { timeout: 60000 }, path.basename(files[ext]))
  if (ext === 'pdf') {
    await page.waitForSelector('.preview-pdf iframe', { timeout: 30000 })
    await assertLocalWorkspaceUnobstructed()
    return null
  }
  await page.waitForFunction(name => Object.values(window.__checkbaActiveOverviewVm?._libreRefs || {}).some(e => e.file?.name === name && e.ready && e.statusKey === 'ready' && !e.docLoadFailed), { timeout: 180000 }, path.basename(files[ext]))
  await assertLocalWorkspaceUnobstructed()
  const openToken = crypto.randomUUID()
  await page.evaluate(async (name, token) => {
    const editor = Object.values(window.__checkbaActiveOverviewVm._libreRefs || {}).find(e => e.file?.name === name)
    await editor.webviewEl.executeJavaScript('window.__electronCompatTarget=' + JSON.stringify(token))
  }, path.basename(files[ext]), openToken)
  let guest
  if (installedMode) {
    const webContentsId = await page.evaluate(name => Object.values(window.__checkbaActiveOverviewVm._libreRefs).find(e => e.file?.name === name).webviewEl.getWebContentsId(), path.basename(files[ext]))
    const targetId = await installed.mainRpc(`process.mainModule.require('electron').webContents.fromId(${webContentsId}).getOrCreateDevToolsTargetId()`)
    assert.equal(typeof targetId, 'string')
    // Puppeteer 22 exposes this CDP ID on CdpTarget. Do not initialize stale or
    // spare webviews while looking for the actual editor being tested.
    const target = await until(() => {
      const targets = browser.targets().filter(t => t.type() === 'webview')
      assert(targets.every(t => typeof t._targetId === 'string'), 'Pinned Puppeteer must expose CDP target IDs')
      return targets.find(t => t._targetId === targetId)
    })
    evidence.guestTargets ||= []
    evidence.guestTargets.push({ ext, openToken, webContentsId, targetId, puppeteerVersion: JSON.parse(fs.readFileSync(path.join(root, 'frontend/node_modules/puppeteer-core/package.json'))).version, targets: browser.targets().map(t => ({ id: t._targetId, type: t.type(), url: t.url() })) })
    write('guest-targets.json', evidence.guestTargets)
    guest = await target.page()
    assert.equal(await guest.evaluate(name => window.__electronCompatTarget === name, openToken), true, 'Attached guest must be the current editor')
  } else {
    guest = await until(async () => {
      for (const target of browser.targets().filter(t => t.type() === 'webview')) {
        const candidate = await target.page()
        try { if (await candidate.evaluate(name => window.__electronCompatTarget === name, openToken)) return candidate } catch { /* Navigating guest. */ }
      }
    })
  }
  const cdp = await guest.createCDPSession()
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  guest.__compatFocus = cdp

  return guest
}
async function exec(ext, action, params = {}) {
  const result = await page.evaluate(async (name, action, params) => {
    const editor = Object.values(window.__checkbaActiveOverviewVm._libreRefs || {}).find(e => e.file?.name === name)
    return editor.executor.executeCommand(action, params)
  }, path.basename(files[ext]), action, params)
  assert.equal(result.success, true, `${action}: ${JSON.stringify(result)}`)
  return result
}
async function assertLocalWorkspaceUnobstructed() {
  assert.equal(await page.evaluate(() => !!document.querySelector('.awd-login-mask')), false,
    'Local document interaction must not be obscured by an unsolicited account dialog')
}
async function savedXml(ext) {
  const zip = await JSZip.loadAsync(fs.readFileSync(files[ext]))
  const names = Object.keys(zip.files).filter(n => ext === 'docx' ? n === 'word/document.xml' : ext === 'xlsx' ? /^xl\/(worksheets\/sheet\d+|sharedStrings)\.xml$/.test(n) : /^ppt\/slides\/slide\d+\.xml$/.test(n))
  return (await Promise.all(names.map(n => zip.file(n).async('string')))).join('\n')
}
async function close(ext) {
  await page.evaluate(async name => {
    const vm = window.__checkbaActiveOverviewVm
    const file = vm.leftFiles.find(f => f.name === name)
    await vm.closeFile(file.id, 'left')
  }, path.basename(files[ext]))
  await page.waitForFunction(name => !window.__checkbaActiveOverviewVm.leftFiles.some(f => f.name === name), {}, path.basename(files[ext]))
}
try {
  if (installedMode) {
    assert(!process.env.AWD_BASELINE_ELECTRON, 'Installed tests pin their own build')
    const { launchInstalledElectron } = await import('./installed-electron-helper.mjs')
    installed = await launchInstalledElectron({ outDir: run, backendPort, cdpPort })
    child = installed.child
  } else {
    await until(async () => (await fetch(base + '/api/admin/wizard')).ok, 120000)
    const startupLog = fs.readFileSync(path.join(run, 'runtime.log'), 'utf8')
    for (const isolatedPath of [`-Duser.home=${home}`, `jdbc:h2:file:${home}/db`, `${home}/storage`]) assert.ok(startupLog.includes(isolatedPath), `Backend did not confirm isolated path: ${isolatedPath}`)
    evidence.backendPaths = { home, database: `${home}/db`, storage: `${home}/storage`, verifiedFromStartupLog: true }
  }
  if (process.env.AWD_BASELINE_ELECTRON) {
    await start(process.env.AWD_BASELINE_ELECTRON, 'baseline')
    await open('pdf')
    await page.evaluate(() => localStorage.setItem('electron-upgrade-persistence', 'baseline-profile-retained'))
    await page.screenshot({ path: path.join(run, 'baseline-pdf.png') })
    evidence.baseline = JSON.parse(fs.readFileSync(path.join(run, 'baseline-paths.json'))).versions.electron
    await quit()
  }
  const executable = process.env.AWD_ELECTRON_BINARY || path.join(root, 'desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  async function connectInstalled() {
    const version = await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json()
    browser = await puppeteer.connect({ browserWSEndpoint: version.webSocketDebuggerUrl, defaultViewport: null })
    page = await until(async () => (await browser.pages()).find(p => p.url().includes('/h5/index.html')), 60000)
    await page.waitForFunction(() => !!window.__checkbaActiveOverviewVm, { timeout: 120000 })
    await installed.mainRpc(`(()=>{const w=process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>w.isVisible());w.setContentSize(1440,1000);w.focus();return true})()`)
    page.on('pageerror', error => { evidence.pageErrors ||= []; evidence.pageErrors.push(error.message) })
    // Dismiss the actual optional-pack dialog via its close button, not a hidden VM flag.
    const dismiss = await page.$('.ocd-mask .ocd-actions .ocd-btn:not(.primary)')
    if (dismiss) await dismiss.click()
  }
  if (installedMode) {
    await connectInstalled()
    evidence.runtime = installed.identity.versions
    evidence.installed = installed.provenance
  } else evidence.runtime = (await start(executable, 'candidate')).versions
  if (process.env.AWD_BASELINE_ELECTRON) assert.equal(await page.evaluate(() => localStorage.getItem('electron-upgrade-persistence')), 'baseline-profile-retained')
  for (const ext of ['docx', 'xlsx', 'pptx']) {
    const frame = await open(ext)
    frame.on('pageerror', error => { evidence.guestErrors ||= []; evidence.guestErrors.push({ ext, message: error.message }) })
    frame.on('console', message => { if (message.type() === 'error') { evidence.guestErrors ||= []; evidence.guestErrors.push({ ext, message: message.text() }) } })
    const marker = `兼容验证_ELECTRON_COMPAT_${ext.toUpperCase()}`
    if (ext === 'docx') await exec(ext, 'goto', { type: 'end' })
    if (ext === 'xlsx') {
      // Enter the native Calc canvas as a user does before typing. DOM focus on
      // the IME overlay alone does not establish the engine's internal focus.
      const before = (await exec(ext, 'get_ui_state')).calc.cellName
      await frame.click('#qtcanvas')
      let after
      await until(async () => { after = (await exec(ext, 'get_ui_state')).calc.cellName; return after && after !== before }, 10000)
      write('xlsx-pointer-focus.json', { before, after, changedByCanvasClick: true })
      await exec(ext, 'sheet_select_range', { range: 'B2' })
      assert.equal((await exec(ext, 'get_ui_state')).calc.cellName, 'B2')
    }
    if (ext === 'pptx') {
      await frame.click('#qtcanvas')
      const info = await exec(ext, 'slide_get_page', { slideNumber: 1 })
      const shape = info.shapes.find(s => (s.text || '').includes('普通文本框内容'))
      assert.ok(shape, 'fixture text shape')
      await exec(ext, 'slide_goto', { slideNumber: 1, shapeName: shape.name })
    }
    await sleep(2000) // Ready precedes the first composited canvas frame.
    await assertLocalWorkspaceUnobstructed()
    await page.screenshot({ path: path.join(run, `${ext}-opened.png`) })
    await page.evaluate(name => Object.values(window.__checkbaActiveOverviewVm._libreRefs).find(e => e.file?.name === name).webviewEl.focus(), path.basename(files[ext]))
    await frame.focus('[data-lo-ime]')
    assert.equal(await frame.$eval('[data-lo-ime]', el => document.activeElement === el), true)
    await frame.evaluate(() => {
      window.__compatInputEvents = []
      for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input', 'keydown', 'keyup', 'focus', 'blur']) {
        document.querySelector('[data-lo-ime]').addEventListener(type, event => window.__compatInputEvents.push({ type, data: event.data, key: event.key, inputType: event.inputType, composing: event.isComposing, trusted: event.isTrusted }), { passive: true })
      }
    })
    const inputState = () => frame.$eval('[data-lo-ime]', el => ({ value: el.value, focused: document.activeElement === el, active: document.activeElement?.tagName, events: window.__compatInputEvents }))
    await frame.__compatFocus.send('Input.imeSetComposition', { text: marker, selectionStart: marker.length, selectionEnd: marker.length })
    await frame.__compatFocus.send('Input.insertText', { text: marker })
    await sleep(1500) // Let the worker commit IME text before Enter/Escape ends editing.
    write(`${ext}-input-before-confirm.json`, await inputState())
    assert.equal(await frame.$eval('[data-lo-ime]', el => document.activeElement === el), true, `${ext} input must retain focus before confirmation`)
    if (ext === 'xlsx') await frame.keyboard.press('Enter')
    if (ext === 'pptx') await frame.keyboard.press('Escape')
    write(`${ext}-input-after-confirm.json`, await inputState())
    if (ext !== 'docx') {
      let content = null
      try { await until(async () => { content = ext === 'xlsx' ? await exec(ext, 'sheet_read_range', { range: 'B2' }) : await exec(ext, 'slide_get_page', { slideNumber: 1 }); return JSON.stringify(content).includes(marker) }, 30000) }
      finally { write(`${ext}-model-after-input.json`, content) }
    }
    console.log(JSON.stringify({ stage: 'input', ext }))
    const started = Date.now()
    // The synthetic marker contains no XML entities; CJK/Latin text may use separate OOXML runs.
    await until(async () => (await savedXml(ext)).replace(/<[^>]*>/g, '').includes(marker), 90000)
    const xml = await savedXml(ext)
    assert.notEqual(hash(files[ext]), originalHashes[ext])
    if (ext === 'docx') { assert.ok(xml.includes('ORIGINAL WORD CONTENT')); assert.ok(xml.includes('Preserved second paragraph.')); assert.ok(/<w:b\b/.test(xml)) }
    if (ext === 'xlsx') { assert.ok(xml.includes('ORIGINAL CELL')); assert.ok(xml.includes('B1*2')) }
    if (ext === 'pptx') {
      const text = xml.replace(/<[^>]*>/g, '')
      for (const original of ['冒烟测试标题一', '占位符正文内容', '第二页标题', '第二页文本框']) assert.ok(text.includes(original), `PPT preserves ${original}`)
    }
    evidence.formats[ext] = { route: 'LOWA WASM Electron webview', guestURL: frame.url(), marker, autosaveMs: Date.now() - started, sha256: hash(files[ext]), normalAutosave: true }
    await page.screenshot({ path: path.join(run, `${ext}-edited.png`) })
    await close(ext)
    await open(ext)
    const result = ext === 'docx' ? await exec(ext, 'get_document_text') : ext === 'xlsx' ? await exec(ext, 'sheet_read_range', { range: 'A1:C2' }) : await exec(ext, 'slide_get_page', { slideNumber: 1 })
    assert.ok(JSON.stringify(result).includes(marker), `Reopened ${ext} must contain marker`)
    if (ext === 'xlsx') {
      assert.deepEqual(result.rows[0], ['ORIGINAL CELL', 21, 42])
      assert.ok(result.formulas.some(f => f.cell === 'C1' && f.formula === '=B1*2'))
    }
    write(`${ext}-reopened.json`, result)
    await sleep(2000) // Model reload can finish before the compositor paints.
    await page.screenshot({ path: path.join(run, `${ext}-reopened.png`) })
    await close(ext)
  }
  await open('pdf')
  await sleep(2000)
  await assertLocalWorkspaceUnobstructed()
  await page.screenshot({ path: path.join(run, 'pdf-opened.png') })
  const bounds = await page.$eval('.preview-pdf iframe', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })
  await page.mouse.click(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.5)
  await page.mouse.wheel({ deltaY: 850 })
  await sleep(1000)
  await page.screenshot({ path: path.join(run, 'pdf-scrolled.png') })
  await close('pdf'); await open('pdf'); await sleep(1500)
  await page.screenshot({ path: path.join(run, 'pdf-reopened.png') })
  assert.equal(hash(files.pdf), originalHashes.pdf)
  evidence.formats.pdf = { sha256: hash(files.pdf), sourceUnchanged: true, route: 'Chromium PDF iframe', editSave: 'not applicable to read-only FilePreview route', visualReviewRequired: true }
  if (installedMode) {
    await page.evaluate(() => localStorage.setItem('electron-cloud-restart', 'retained'))
    await close('pdf')
    await assertLocalWorkspaceUnobstructed()
    const { checkDesktopInteractions } = await import('./installed-desktop-interactions.mjs')
    evidence.desktop = await checkDesktopInteractions({ page, browser, mainRpc: installed.mainRpc, run })
    await quit()
    await installed.start(); child = installed.child
    await connectInstalled()
    assert.equal(await page.evaluate(() => localStorage.getItem('electron-cloud-restart')), 'retained')
    for (const ext of ['docx', 'xlsx', 'pptx']) {
      await open(ext)
      const content = ext === 'docx' ? await exec(ext, 'get_document_text') : ext === 'xlsx' ? await exec(ext, 'sheet_read_range', { range: 'A1:C2' }) : await exec(ext, 'slide_get_page', { slideNumber: 1 })
      assert.ok(JSON.stringify(content).includes(evidence.formats[ext].marker), `App restart preserves ${ext}`)
      evidence.formats[ext].appRestartRetained = true
      await sleep(1500)
      await page.screenshot({ path: path.join(run, `${ext}-app-restarted.png`) })
      await close(ext)
    }
    evidence.restartPreferenceRetained = true
  }
  await quit()
  evidence.passed = true
} catch (error) {
  evidence.error = error.stack
  write('result.json', evidence) // Preserve the original failure before screenshot/cleanup work.
  if (page && browser) await page.screenshot({ path: path.join(run, 'failure.png') }).catch(() => {})
  throw error
} finally {
  write('result.json', evidence)
  // A failed cleanup or residual socket must not consume the entire hosted job.
  // Leave this unref'ed timer armed: a clean event loop exits without firing it.
  const cleanupWatchdog = setTimeout(() => {
    evidence.passed = false
    evidence.cleanupTimeout = true
    evidence.activeResources = process.getActiveResourcesInfo()
    write('result.json', evidence)
    process.exit(1)
  }, 300000)
  cleanupWatchdog.unref()
  if (child) await quit().catch(error => { evidence.quitError = error.message })
  if (java) {
    java.kill('SIGTERM')
    await until(() => java.exitCode !== null || java.signalCode !== null, 15000).catch(() => { forced = true; java.kill('SIGKILL') })
  }
  if (installed) {
    await installed.collectDiagnostics()
    await installed.close().catch(error => { evidence.quitError = error.message })
    evidence.installed = installed.provenance
    forced ||= installed.provenance.forced === true
  }
  fs.closeSync(log)
  evidence.productionAfter = installedMode ? null : productionSnapshot()
  evidence.productionUnchanged = JSON.stringify(evidence.productionAfter) === JSON.stringify(productionBefore)
  evidence.forced = forced
  if (forced || evidence.quitError || !evidence.productionUnchanged) evidence.passed = false
  if (!evidence.passed) process.exitCode = 1
  write('result.json', evidence)
  console.log(JSON.stringify({ run, passed: evidence.passed, forced, error: evidence.error }))
}
