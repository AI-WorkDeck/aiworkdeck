// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Full-host PPT interaction benchmark. Build this tree's H5/zetaoffice/backend first.
// JAVA_HOME must be JDK 21. AWD_ELECTRON_BINARY optionally selects a fixed runtime.
// PPT_LATENCY_FIXTURE optionally adds a synthetic PPTX alongside impress-smoke.pptx.
// PPT_LATENCY_ROUNDS defaults to 1; each round is baseline/candidate/candidate/baseline.
// Baseline only restores the old full get_ui_state read in this same build. It is
// a defect-restoration control, not a claim to have run a full historical release.
// Timings match recorded compositor frames to settled results; arrival is an upper bound.
// No account, business documents, force-save hooks or periodic UNO polling are used.
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
import { PNG } from 'pngjs'

const root = process.env.PPT_LATENCY_SOURCE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const run = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-ppt-latency-'))
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
const files = { pptx: path.join(home, 'Interaction.pptx') }
const fixtures = [{ name: 'ordinary', path: path.join(root, 'frontend/tests/lowa-e2e/fixtures/impress-smoke.pptx') }]
if (process.env.PPT_LATENCY_FIXTURE) fixtures.push({ name: 'litigation', path: path.resolve(process.env.PPT_LATENCY_FIXTURE) })
for (const fixture of fixtures) assert.ok(fs.existsSync(fixture.path), `Missing fixture: ${fixture.path}`)
const fixtureHashes = Object.fromEntries(fixtures.map(f => [f.name, hash(f.path)]))
const rounds = Number(process.env.PPT_LATENCY_ROUNDS || 1)
const modes = process.env.PPT_LATENCY_MODES?.split(',') || ['baseline', 'candidate', 'candidate', 'baseline']
assert.ok(modes.every(mode => ['baseline', 'candidate'].includes(mode)))
assert.ok(Number.isInteger(rounds) && rounds > 0 && rounds <= 10)
fs.copyFileSync(fixtures[0].path, files.pptx)
function productionSnapshot() {
  const processes = execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n')
    .filter(line => line.includes('/Applications/AI WorkDeck.app/Contents/MacOS/AI WorkDeck')).map(line => Number(line.trim().split(/\s+/)[0])).sort()
  const listeners = [5269, 5369, 5169].map(port => {
    try { return [port, execFileSync('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim().split(/\s+/).sort()] } catch { return [port, []] }
  })
  return { processes, listeners }
}
const productionBefore = productionSnapshot()
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
assert.ok(env.JAVA_HOME, 'JAVA_HOME must select JDK 21')
const jar = path.join(run, 'backend.jar')
fs.copyFileSync(path.join(root, 'backend/target/backend-0.0.1-SNAPSHOT.jar'), jar)
const log = fs.openSync(path.join(run, 'runtime.log'), 'w')
const java = spawn(path.join(env.JAVA_HOME, 'bin/java'), ['-jar', jar, `--server.port=${backendPort}`, '--network.proxy.auto-refresh=false'], { cwd: run, env, stdio: ['ignore', log, log] })
let child, browser, page
let forced = false
const evidence = { run, comparison: process.env.PPT_LATENCY_SOURCE_ROOT ? 'separate source build: ' + execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() : 'same-build defect restoration: selection-scope get_ui_state rewritten to full state only in baseline', backendPort, cdpPort, backendPid: java.pid, productionBefore, originalHashes, fixtureHashes, rounds: [], forcedSaveUsed: false, measurement: 'Input dispatch to first compositor frame matching the settled visual result outside calibrated blink pixels; arrival upper bound, not exact display latency' }
console.log(JSON.stringify({ run, backendPid: java.pid, backendPort, cdpPort }))
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
  browser?.disconnect(); browser = null
  fs.writeFileSync(commandFile, JSON.stringify({ quit: true, nonce: Date.now() }))
  try { await until(() => child.exitCode !== null || child.signalCode !== null, 70000) }
  catch (error) { forced = true; child.kill('SIGTERM'); throw error }
  assert.equal(child.exitCode, 0)
  child = null
  await sleep(1000)
}
async function open(ext) {
  fs.writeFileSync(commandFile, JSON.stringify({ path: files[ext], nonce: Date.now() }))
  await page.waitForFunction(name => window.__checkbaActiveOverviewVm?.activeFileLeft?.name === name, { timeout: 60000 }, path.basename(files[ext]))
  if (ext === 'pdf') { await page.waitForSelector('.preview-pdf iframe', { timeout: 30000 }); return null }
  await page.waitForFunction(name => Object.values(window.__checkbaActiveOverviewVm?._libreRefs || {}).some(e => e.file?.name === name && e.ready && e.statusKey === 'ready' && !e.docLoadFailed), { timeout: 180000 }, path.basename(files[ext]))
  await page.evaluate(async name => {
    const editor = Object.values(window.__checkbaActiveOverviewVm._libreRefs || {}).find(e => e.file?.name === name)
    await editor.webviewEl.executeJavaScript('window.__electronCompatTarget=' + JSON.stringify(name))
  }, path.basename(files[ext]))
  const guest = await until(async () => {
    for (const target of browser.targets().filter(t => t.type() === 'webview')) {
      const candidate = await target.page()
      try { if (await candidate.evaluate(name => window.__electronCompatTarget === name, path.basename(files[ext]))) return candidate } catch { /* Navigating guest. */ }
    }
  })
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
async function close(ext) {
  await page.evaluate(async name => {
    const vm = window.__checkbaActiveOverviewVm
    const file = vm.leftFiles.find(f => f.name === name)
    await vm.closeFile(file.id, 'left')
  }, path.basename(files[ext]))
  await page.waitForFunction(name => !window.__checkbaActiveOverviewVm.leftFiles.some(f => f.name === name), {}, path.basename(files[ext]))
}
async function canvasReader(guest) {
  const cdp = await guest.createCDPSession()
  let latest
  const frames = []
  cdp.on('Page.screencastFrame', event => {
    const received = performance.now()
    void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {})
    const bytes = Buffer.from(event.data, 'base64')
    latest = { started: received, received, bytes, png: PNG.sync.read(bytes), frameTimestamp: event.metadata.timestamp }
    frames.push(latest)
    if (frames.length > 250) frames.shift()
  })
  // Observe compositor frames instead of repeatedly forcing expensive PNG captures.
  // The guest contains the canvas and the hidden IME input, not host toolbars.
  await cdp.send('Page.startScreencast', { format: 'png', maxWidth: 1280, maxHeight: 1200, everyNthFrame: 1 })
  await until(() => latest, 10000)
  assert.ok(latest.png.width > 300 && latest.png.height > 200, 'Real canvas must be visible')
  const read = async () => latest
  read.frames = frames
  read.stop = () => cdp.send('Page.stopScreencast').then(() => cdp.detach())
  return read
}
function difference(base, next, mask) {
  assert.equal(base.width, next.width, 'Canvas size changed during measurement')
  assert.equal(base.height, next.height)
  let count = 0
  for (let p = 0; p < base.width * base.height; p++) {
    if (mask?.[p]) continue
    const i = p * 4
    if (Math.abs(base.data[i] - next.data[i]) + Math.abs(base.data[i + 1] - next.data[i + 1]) + Math.abs(base.data[i + 2] - next.data[i + 2]) > 45) count++
  }
  return count
}
async function measureCanvas(read, action, name) {
  // Observe a full ordinary caret-blink cycle with no input. Ignore only pixels
  // that actually changed during calibration, never a guessed text rectangle.
  const initial = await read(), mask = new Uint8Array(initial.png.width * initial.png.height)
  let baseline = initial
  const calibrationEnd = performance.now() + 1300
  while (performance.now() < calibrationEnd) {
    await sleep(90)
    baseline = await read()
    assert.equal(initial.png.data.length, baseline.png.data.length)
    for (let p = 0; p < mask.length; p++) {
      const i = p * 4
      if (Math.abs(initial.png.data[i] - baseline.png.data[i]) + Math.abs(initial.png.data[i + 1] - baseline.png.data[i + 1]) + Math.abs(initial.png.data[i + 2] - baseline.png.data[i + 2]) > 45) mask[p] = 1
    }
  }
  const maskedPixels = mask.reduce((a, b) => a + b, 0)
  assert.ok(maskedPixels / mask.length < 0.005, 'Canvas did not settle before input; cannot measure honestly')
  fs.writeFileSync(path.join(run, `${name}-before.png`), baseline.bytes)
  const threshold = name.endsWith('-new-slide') ? 2000 : Math.max(16, Math.ceil(mask.length * 0.00002))
  const started = performance.now(), wallStarted = Date.now()
  await action()
  // First paint can be only a moving shape border. Match the settled result
  // backwards through recorded frames, rather than timing that intermediate frame.
  await sleep(name.endsWith('-new-slide') ? 8000 : 3000)
  const target = await read()
  for (const frame of read.frames.filter(f => f.received >= performance.now() - 1000)) {
    for (let p = 0; p < mask.length; p++) {
      const i = p * 4
      if (Math.abs(target.png.data[i] - frame.png.data[i]) + Math.abs(target.png.data[i + 1] - frame.png.data[i + 1]) + Math.abs(target.png.data[i + 2] - frame.png.data[i + 2]) > 45) mask[p] = 1
    }
  }
  const finalMaskedPixels = mask.reduce((a, b) => a + b, 0)
  assert.ok(finalMaskedPixels <= Math.max(64, maskedPixels * 4), `${name}: final frames did not settle within a caret-sized area`)
  const changed = difference(baseline.png, target.png, mask)
  assert.ok(changed >= threshold, `${name}: settled canvas has no verifiable change`)
  const actionFrames = read.frames.filter(frame => frame.received >= started)
  // The fixture's canvas has an empty top band. Detect native menu/toolbar
  // flashes throughout the measured interaction, not only in the final frame.
  for (const frame of actionFrames) {
    if (name.endsWith('-new-slide')) continue // New slide layout may legitimately move paper into the top band.
    let headerChanges = 0
    for (let y = 2; y < 32; y++) for (let x = 2; x < baseline.png.width - 24; x++) {
      const i = (y * baseline.png.width + x) * 4
      if (Math.abs(baseline.png.data[i] - frame.png.data[i]) + Math.abs(baseline.png.data[i + 1] - frame.png.data[i + 1]) + Math.abs(baseline.png.data[i + 2] - frame.png.data[i + 2]) > 45) headerChanges++
    }
    assert.ok(headerChanges < 200, `${name}: canvas top band changed; inspect possible native chrome flash`)
  }
  if (name.endsWith('-new-slide')) {
    const folder = path.join(run, `${name}-frames`); fs.mkdirSync(folder)
    actionFrames.forEach((frame, index) => fs.writeFileSync(path.join(folder, `${index}-${Math.round(frame.received - started)}ms.png`), frame.bytes))
  }
  const samples = actionFrames.map(frame => ({
    frame, receivedMs: frame.received - started, remainingPixels: difference(target.png, frame.png, mask),
  }))
  // A caret may stop blinking during selection; allow its measured footprint
  // at the new endpoint without mistaking a border-only frame for the result.
  const matchTolerance = Math.max(8, changed * 0.02, maskedPixels * 2)
  assert.ok(matchTolerance < changed, `${name}: matching tolerance could accept the unchanged frame`)
  const match = samples.find(sample => sample.remainingPixels <= matchTolerance)
  assert.ok(match, `${name}: no frame matches the settled result`)
  fs.writeFileSync(path.join(run, `${name}-after.png`), match.frame.bytes)
  fs.writeFileSync(path.join(run, `${name}-settled.png`), target.bytes)
  const result = { action: name, wallStarted, observedMs: match.receivedMs, maskedPixels, threshold, changedPixels: changed,
    matchTolerance, finalMaskedPixels, samples: samples.map(({ frame, ...sample }) => sample) }
  write(`${name}-measurement.json`, result)
  console.log(JSON.stringify({ action: name, wallStarted, observedMs: result.observedMs, maskedPixels, changedPixels: changed }))
  return result
}

async function assertNativeChromeHidden(stage) {
  const visible = (await exec('pptx', 'set_chrome')).visible
  for (const key of ['all', 'menubar', 'statusbar']) assert.equal(visible[key], false, `${stage}: native ${key}`)
  assert.ok(Object.keys(visible.toolbars).length > 0)
  for (const [name, state] of Object.entries(visible.toolbars)) assert.equal(state, false, `${stage}: native toolbar ${name}`)
  return visible
}
async function shapeText(shapeName) {
  const info = await exec('pptx', 'slide_get_page', { slideNumber: 1 })
  const shape = info.shapes.find(s => s.name === shapeName)
  assert.ok(shape, `Missing original text shape ${shapeName}`)
  return String(shape.text || '')
}
async function waitSaved(marker, pageCount) {
  await until(async () => {
    const zip = await JSZip.loadAsync(fs.readFileSync(files.pptx))
    const names = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    const text = (await Promise.all(names.map(n => zip.file(n).async('string')))).join('').replace(/<[^>]*>/g, '')
    return text.includes(marker) && names.length === pageCount
  }, 90000)
  // Read lifecycle state only after the disk predicate; never reset the save clock.
  await page.waitForFunction(name => {
    const editor = Object.values(window.__checkbaActiveOverviewVm._libreRefs).find(e => e.file?.name === name)
    return editor && !editor.dirty && !editor.saving
  }, { timeout: 30000 }, path.basename(files.pptx))
}
try {
  await until(async () => (await fetch(base + '/api/admin/wizard')).ok, 120000)
  const startupLog = fs.readFileSync(path.join(run, 'runtime.log'), 'utf8')
  for (const isolatedPath of [`-Duser.home=${home}`, `jdbc:h2:file:${home}/db`, `${home}/storage`]) assert.ok(startupLog.includes(isolatedPath), `Backend did not confirm isolated path: ${isolatedPath}`)
  evidence.backendPaths = { home, database: `${home}/db`, storage: `${home}/storage`, verifiedFromStartupLog: true }
  const executable = process.env.AWD_ELECTRON_BINARY || path.join(root, 'desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  evidence.runtime = (await start(executable, 'candidate')).versions
  for (let round = 1; round <= rounds; round++) for (const fixture of fixtures) for (const [pairIndex, mode] of modes.entries()) {
    const tag = `${fixture.name}-${round}-${pairIndex + 1}-${mode}`
    files.pptx = path.join(home, `${tag}.pptx`)
    fs.copyFileSync(fixture.path, files.pptx)
    const openStart = performance.now()
    const guest = await open('pptx')
    const modelReadyMs = performance.now() - openStart
    await page.evaluate((name, mode) => {
      const editor = Object.values(window.__checkbaActiveOverviewVm._libreRefs).find(e => e.file?.name === name)
      const original = editor.executor.executeCommand.bind(editor.executor)
      editor.__latencyOriginalExecute = original
      editor.__latencyReads = []
      editor.executor.executeCommand = async (action, params, options) => {
        const fullRead = mode === 'baseline' && action === 'get_ui_state' && params?.scope === 'selection'
        const sent = fullRead ? Object.fromEntries(Object.entries(params).filter(([key]) => key !== 'scope')) : params
        const started = performance.now()
        try { return await original(action, sent, options) }
        finally {
          editor.__latencyReads.push({ action, started: performance.timeOrigin + started, requestedScope: params?.scope || 'full', effectiveScope: sent?.scope || 'full', ms: performance.now() - started })
        }
      }
    }, path.basename(files.pptx), mode)
    const chromeBefore = await assertNativeChromeHidden('before editing')
    const info = await exec('pptx', 'slide_get_page', { slideNumber: 1 })
    const originalPages = (await exec('pptx', 'slide_get_overview')).slides.length
    const shape = info.shapes.find(s => (s.text || '').includes('普通文本框内容'))
      || info.shapes.find(s => typeof s.text === 'string' && s.text.trim().length > 3 && !s.isTable)
    assert.ok(shape, 'Fixture needs a visible ordinary text shape')
    await exec('pptx', 'slide_goto', { slideNumber: 1, shapeName: shape.name })
    await sleep(2000)
    // Selecting through UNO does not focus Impress's native drawing window in
    // a fresh process. Enter text editing through the real visible canvas.
    const shot = PNG.sync.read(Buffer.from(await guest.screenshot()))
    let left = shot.width, right = 0, top = shot.height, bottom = 0
    for (let y = 0; y < shot.height; y++) {
      let count = 0, first = shot.width, last = 0
      for (let x = 0; x < shot.width - 24; x++) {
        const i = (y * shot.width + x) * 4
        if (shot.data[i] > 250 && shot.data[i + 1] > 250 && shot.data[i + 2] > 250) { count++; first = Math.min(first, x); last = x }
      }
      if (count > shot.width * 0.5) { left = Math.min(left, first); right = Math.max(right, last); top = Math.min(top, y); bottom = y }
    }
    assert.ok(right > left && bottom > top, 'Calibrate the actual white slide before clicking')
    const viewport = await guest.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    const x = (left + (shape.left + shape.width * 0.5) / info.width * (right - left)) * viewport.width / shot.width
    const y = (top + (shape.top + shape.height * 0.5) / info.height * (bottom - top)) * viewport.height / shot.height
    await guest.mouse.click(x, y, { clickCount: 2 })
    await sleep(800)
    await page.evaluate(name => Object.values(window.__checkbaActiveOverviewVm._libreRefs).find(e => e.file?.name === name).webviewEl.focus(), path.basename(files.pptx))
    await guest.focus('[data-lo-ime]')
    await guest.keyboard.press('End')
    await sleep(500)
    // Commit through the normal IME overlay after the native mouse gesture.
    assert.equal(await guest.$eval('[data-lo-ime]', el => document.activeElement === el), true)
    await guest.__compatFocus.send('Input.imeSetComposition', { text: 'LATENCY_READY', selectionStart: 13, selectionEnd: 13 })
    await guest.__compatFocus.send('Input.insertText', { text: 'LATENCY_READY' })
    await sleep(2000)
    await guest.screenshot({ path: path.join(run, tag + '-input-calibration.png') })
    await guest.keyboard.press('End')
    await sleep(500)
    const read = await canvasReader(guest), measures = []
    measures.push(await measureCanvas(read, () => guest.keyboard.press('W'), `${tag}-character`))
    measures.push(await measureCanvas(read, () => guest.keyboard.press('Backspace'), `${tag}-backspace`))
    await guest.keyboard.press('Z')
    await sleep(2000)
    measures.push(await measureCanvas(read, async () => { await guest.keyboard.down('Shift'); try { await guest.keyboard.press('ArrowLeft') } finally { await guest.keyboard.up('Shift') } }, `${tag}-selection`))
    await guest.keyboard.press('ArrowRight')
    await guest.keyboard.type('FAST0123456789', { delay: 25 })
    for (let i = 0; i < 4; i++) await guest.keyboard.press('Backspace')
    await sleep(1000)
    const marker = `PPT_LATENCY_${fixture.name}_${round}_${pairIndex}`
    await guest.__compatFocus.send('Input.imeSetComposition', { text: marker, selectionStart: marker.length, selectionEnd: marker.length })
    await guest.__compatFocus.send('Input.insertText', { text: marker })
    await sleep(500)
    await guest.keyboard.press('Escape')
    await waitSaved(marker, originalPages)
    // Exercise the guest IME shortcut path, which bypasses the host executor.
    const structureBefore = await page.evaluate(name => Object.values(window.__checkbaActiveOverviewVm._libreRefs).find(e => e.file?.name === name).navigationStructureKey, path.basename(files.pptx))
    await guest.keyboard.down('Meta'); await guest.keyboard.press('z'); await guest.keyboard.up('Meta')
    await sleep(500)
    await guest.keyboard.down('Meta'); await guest.keyboard.down('Shift'); await guest.keyboard.press('z'); await guest.keyboard.up('Shift'); await guest.keyboard.up('Meta')
    if (!process.env.PPT_LATENCY_SOURCE_ROOT) await page.waitForFunction((name, before) => Object.values(window.__checkbaActiveOverviewVm._libreRefs).find(e => e.file?.name === name).navigationStructureKey >= before + 2, { timeout: 10000 }, path.basename(files.pptx), structureBefore)
    await sleep(500)
    await waitSaved(marker, originalPages)
    const oldShapeText = await shapeText(shape.name)
    assert.equal(oldShapeText, shape.text + 'LATENCY_READYZFAST012345' + marker, 'Saved text must preserve the source and exact result of isolated input, selection, rapid typing, repeated Backspace and IME commit')
    const addPoint = await page.evaluate(name => {
      const editor = Object.values(window.__checkbaActiveOverviewVm._libreRefs).find(e => e.file?.name === name)
      const toolbar = editor.$refs.toolbar
      const label = toolbar.$t('editor.toolbar.impressNewSlide')
      const button = Array.from(toolbar.$el.querySelectorAll('.etb-btn.wide')).find(el => el.getAttribute('title') === label)
      if (!button) throw Error('Visible add-slide toolbar button not found')
      const r = button.getBoundingClientRect()
      if (!r.width || !r.height) throw Error('Add-slide button is hidden')
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }, path.basename(files.pptx))
    measures.push(await measureCanvas(read, () => page.mouse.click(addPoint.x, addPoint.y), `${tag}-new-slide`))
    await waitSaved(marker, originalPages + 1)
    if (mode === 'candidate') for (const measurement of measures) assert.ok(measurement.observedMs < 750, `${measurement.action}: exceeds this local 750 ms interaction budget`)
    const chromeAfter = await assertNativeChromeHidden('after editing and adding a slide')
    const readTimings = await page.evaluate(name => {
      const editor = Object.values(window.__checkbaActiveOverviewVm._libreRefs).find(e => e.file?.name === name)
      editor.executor.executeCommand = editor.__latencyOriginalExecute
      delete editor.__latencyOriginalExecute
      return editor.__latencyReads
    }, path.basename(files.pptx))
    await read.stop()
    await close('pptx')
    await open('pptx')
    const reopened = await exec('pptx', 'slide_get_page', { slideNumber: 1 })
    const reopenedShape = reopened.shapes.find(s => s.name === shape.name)
    assert.equal(reopenedShape?.text, oldShapeText, 'Autosave/reopen must retain the exact edited text')
    assert.equal((await exec('pptx', 'slide_get_overview')).slides.length, originalPages + 1)
    await sleep(1500)
    const chromeReopened = await assertNativeChromeHidden('after reopening')
    await page.screenshot({ path: path.join(run, `${tag}-reopened.png`) })
    evidence.rounds.push({ fixture: fixture.name, fixtureSha256: fixtureHashes[fixture.name], round, mode, pairIndex, readTimings, startup: evidence.rounds.length ? 'warm-process/new-model' : 'fresh-process/first-model', modelReadyMs, shapeCount: info.shapes.length, originalPages, measures, normalAutosave: true, reopened: true, chromeBefore, chromeAfter, chromeReopened, savedSha256: hash(files.pptx) })
    write('progress.json', evidence)
    await close('pptx')
  }
  for (const fixture of fixtures) assert.equal(hash(fixture.path), fixtureHashes[fixture.name], 'Original fixture must remain unchanged')
  await quit()
  evidence.passed = true
} catch (error) {
  evidence.error = error.stack
  if (page && browser) evidence.diagnostic = await page.evaluate(() => Object.values(window.__checkbaActiveOverviewVm?._libreRefs || {}).filter(e => e.__latencyReads).map(e => ({file: e.file?.name, dirty: e.dirty, saving: e.saving, inputError: e.inputError, reads: e.__latencyReads}))).catch(() => null)
  if (page && browser) await page.screenshot({ path: path.join(run, 'failure.png') }).catch(() => {})
  throw error
} finally {
  if (child) await quit().catch(error => { evidence.quitError = error.message })
  java.kill('SIGTERM')
  await until(() => java.exitCode !== null || java.signalCode !== null, 15000).catch(() => { forced = true; java.kill('SIGKILL') })
  fs.closeSync(log)
  evidence.productionAfter = productionSnapshot()
  evidence.productionUnchanged = JSON.stringify(evidence.productionAfter) === JSON.stringify(productionBefore)
  evidence.forced = forced
  if (forced || evidence.quitError || !evidence.productionUnchanged) evidence.passed = false
  if (!evidence.passed) process.exitCode = 1
  write('result.json', evidence)
  console.log(JSON.stringify({ run, passed: evidence.passed, forced, error: evidence.error }))
}
