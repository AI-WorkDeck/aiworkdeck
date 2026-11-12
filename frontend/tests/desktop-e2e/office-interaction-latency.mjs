// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Cross-format (docx/pptx/xlsx) end-to-end interaction latency in the real desktop
// host: Electron shell + webview LOWA editor + warm spare pool + normal autosave.
// Generalises ppt-interaction-latency.mjs. Measurement only; no product hooks.
//
// Build this tree's H5, zetaoffice (with LOWA assets and cjk* fonts in
// frontend/dist/zetaoffice, exactly as packaged) and backend JAR first.
// JAVA_HOME must be JDK 21.
//   OFFICE_LATENCY_FILES   comma-separated document paths (copied, never modified)
//   OFFICE_LATENCY_ROUNDS  sessions per file (default 3). Each session = fresh
//                          Electron process: cold open (before the spare is warm),
//                          close, wait for the spare, warm open.
//   OFFICE_LATENCY_TRACE   comma-separated basenames that get one extra traced warm
//                          run in round 1 (CDP Tracing + V8 CPU samples; excluded
//                          from the latency statistics).
//   AWD_ELECTRON_BINARY    optional Electron executable.
//   OFFICE_LATENCY_REOPEN  basenames whose round-1 warm run also checks that normal
//                          autosave put the typed text on disk and that a close/reopen
//                          shows it (default tpl-5mb.pptx,ledger-5000.xlsx).
//   OFFICE_LATENCY_COLD_BURST settled|eager: cold-open-only mode — one natural-typing
//                          burst ~10 s after the click or right after ready, with the
//                          warm-spare create/ready timeline and a next-open warm check.
//   OFFICE_LATENCY_ANALYZE path of a saved *.trace.json: print its summary and exit.
// Timings come from compositor frames (Page.screencastFrame metadata.timestamp)
// relative to the input event's own timestamp inside the page; "settled" is the
// first frame matching the final settled picture outside calibrated caret pixels.
// Worker commands are counted from the guest's office-worker MessagePort traffic.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { PNG } from 'pngjs'
import JSZip from 'jszip'
import jpeg from 'jpeg-js'

// Re-summarise a saved trace without launching anything.
if (process.env.OFFICE_LATENCY_ANALYZE) {
  console.log(JSON.stringify(analyzeTrace(process.env.OFFICE_LATENCY_ANALYZE), null, 1))
  process.exit(0)
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const run = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-office-latency-'))
const home = path.join(run, 'home')
fs.mkdirSync(home)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const write = (name, value) => fs.writeFileSync(path.join(run, name), JSON.stringify(value, null, 2))
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a)
async function until(fn, timeout = 60000, interval = 100) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    try { const result = await fn(); if (result) return result } catch (error) { last = error }
    await sleep(interval)
  }
  throw last || new Error(`Condition timed out after ${timeout} ms`)
}
const freePort = () => new Promise(resolve => {
  const server = net.createServer()
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)) })
})
const pct = (values, p) => {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!v.length) return null
  return Math.round(v[Math.min(v.length - 1, Math.max(0, Math.ceil(p / 100 * v.length) - 1))])
}

const defaultFiles = ['/tmp/fx/real/article.docx', path.join(root, 'scripts/eval/fixtures/contract.docx'),
  '/tmp/fx/real/tpl-5mb.pptx', '/tmp/fx/real/intro-14mb.pptx', path.join(root, 'scripts/eval/fixtures/case-report.pptx'),
  '/tmp/fx/real/ledger-5000.xlsx', path.join(root, 'scripts/eval/fixtures/case-ledger.xlsx')]
const sources = (process.env.OFFICE_LATENCY_FILES?.split(',').filter(Boolean) || defaultFiles).map(p => path.resolve(p))
for (const s of sources) assert.ok(fs.existsSync(s), `Missing document: ${s}`)
const sourceHashes = Object.fromEntries(sources.map(s => [s, hash(s)]))
const rounds = Number(process.env.OFFICE_LATENCY_ROUNDS || 3)
assert.ok(Number.isInteger(rounds) && rounds > 0 && rounds <= 10)
const reopenFor = new Set((process.env.OFFICE_LATENCY_REOPEN ?? 'tpl-5mb.pptx,ledger-5000.xlsx').split(',').filter(Boolean))
const traced = new Set((process.env.OFFICE_LATENCY_TRACE ?? 'tpl-5mb.pptx,ledger-5000.xlsx').split(',').filter(Boolean))

const [backendPort, cdpPort, ...ports] = await Promise.all(Array.from({ length: 6 }, freePort))
const base = `http://127.0.0.1:${backendPort}`
function productionSnapshot() {
  const processes = execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n')
    .filter(line => line.includes('/Applications/AI WorkDeck.app/Contents/MacOS/AI WorkDeck')).map(line => Number(line.trim().split(/\s+/)[0])).sort()
  const listeners = [5269, 5369, 5169].map(port => {
    try { return [port, execFileSync('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim().split(/\s+/).sort()] } catch { return [port, []] }
  })
  return { processes, listeners }
}
const productionBefore = productionSnapshot()
const commandFile = path.join(run, 'command.json')
const wrapper = path.join(run, 'main.cjs')
fs.writeFileSync(commandFile, '{}')
fs.writeFileSync(wrapper, `const {app}=require('electron'),fs=require('fs'),path=require('path');
const root=${JSON.stringify(root)},home=${JSON.stringify(home)},run=${JSON.stringify(run)};
for(const key of ['home','appData','userData','sessionData','documents','downloads','desktop','music','pictures','videos','logs','crashDumps','temp']){const p=key==='home'?home:path.join(run,key);fs.mkdirSync(p,{recursive:true});app.setPath(key,p)}
fs.writeFileSync(path.join(run,'paths.json'),JSON.stringify({versions:process.versions,pid:process.pid,paths:Object.fromEntries(['home','appData','userData','sessionData','documents','logs','temp'].map(k=>[k,app.getPath(k)]))}));
app.on('browser-window-created',(_,window)=>window.setContentSize(1440,1000));
require(path.join(root,'desktop/main/main.js'));
const cmdFile=path.join(run,'command.json');let last='';fs.watchFile(cmdFile,{interval:100},()=>{const s=fs.readFileSync(cmdFile,'utf8');if(s===last)return;last=s;const c=JSON.parse(s);if(c.quit){fs.unwatchFile(cmdFile);app.quit()}else if(c.path)app.emit('open-file',{preventDefault(){}},c.path)});
`)
const env = Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'JAVA_HOME', 'TMPDIR'].filter(k => process.env[k]).map(k => [k, process.env[k]]))
Object.assign(env, { HOME: home, JAVA_TOOL_OPTIONS: `-Duser.home=${home}`, SPRING_PROFILES_ACTIVE: 'desktop', STORAGE_LOCAL_ROOT_PATH: path.join(home, 'storage'), SPRING_DATASOURCE_URL: `jdbc:h2:file:${home}/db;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH;NON_KEYWORDS=VALUE`, CHECKBA_BACKEND_PORT: String(backendPort), CHECKBA_PPTX_PORT: String(ports[0]), CHECKBA_MINERU_PORT: String(ports[1]), CHECKBA_KOKORO_PORT: String(ports[2]), CHECKBA_ASR_PORT: String(ports[3]), CHECKBA_UPDATE_MANIFEST_URL: `http://127.0.0.1:${cdpPort}/updates-disabled`, AIWORKDECK_DESKTOP_DEV: '0' })
assert.ok(env.JAVA_HOME, 'JAVA_HOME must select JDK 21')
// Production serves cjk* fonts next to editor.html; without them CJK text takes
// the fallback path and every timing inflates (seen 5x on xlsx).
const dist = path.join(root, 'frontend/dist/zetaoffice')
for (const font of ['cjk.ttc', 'cjk-serif.otf', 'cjk-kai.ttf', 'cjk-fangsong.ttf']) assert.ok(fs.existsSync(path.join(dist, font)), `dist/zetaoffice/${font} missing; copy LOWA assets + fonts first`)
assert.ok(fs.existsSync(path.join(dist, 'lowa/soffice.wasm')), 'dist/zetaoffice/lowa missing')
const jar = path.join(run, 'backend.jar')
fs.copyFileSync(path.join(root, 'backend/target/backend-0.0.1-SNAPSHOT.jar'), jar)
const logFd = fs.openSync(path.join(run, 'runtime.log'), 'w')
const java = spawn(path.join(env.JAVA_HOME, 'bin/java'), ['-jar', jar, `--server.port=${backendPort}`, '--network.proxy.auto-refresh=false'], { cwd: run, env, stdio: ['ignore', logFd, logFd], detached: true })
let child, browser, page
const killGroups = () => { for (const p of [child, java]) { try { if (p?.pid && p.exitCode === null) process.kill(-p.pid, 'SIGKILL') } catch { /* gone */ } } }
process.on('exit', killGroups)
process.on('SIGINT', () => { killGroups(); process.exit(130) })
const evidence = { run, sources: sourceHashes, rounds, backendPort, cdpPort, productionBefore, sessions: [], method: {
  paint: 'Page.screencastFrame metadata.timestamp (compositor swap) minus the input event timestamp recorded inside the page',
  settled: 'first frame from which the region matches the final settled picture outside calibrated caret pixels',
  worker: 'office-worker MessagePort exec/result pairs in the guest (sent->result, includes queueing behind earlier commands)',
} }
console.log(JSON.stringify({ run, backendPid: java.pid, backendPort, cdpPort }))

// ---- in-page instrumentation ------------------------------------------------
// Guest (webview editor.html): office-worker command log, worker events, input
// timestamps and main-thread long tasks. Idempotent; installed on every webview.
const GUEST_INSTRUMENT = `(() => {
  if (window.__olb) return 'present'
  const now = () => performance.timeOrigin + performance.now()
  const cmds = window.__olbCmds = [], events = window.__olbEvents = [], inputs = window.__olbInputs = [], longs = window.__olbLong = []
  const pending = new Map(), seen = new WeakSet()
  const hook = proto => {
    const orig = proto.postMessage
    proto.postMessage = function (msg, ...rest) {
      try {
        if (msg && msg.cmd === 'exec' && msg.reqId) {
          const p = msg.params || {}
          const e = { action: msg.action, sent: now(), scope: p.scope, text: typeof p.text === 'string' ? p.text.length : undefined }
          cmds.push(e); pending.set(msg.reqId, e)
          if (cmds.length > 20000) cmds.splice(0, 5000)
          if (!seen.has(this) && this.addEventListener) {
            seen.add(this)
            this.addEventListener('message', ev => {
              const d = ev.data || {}
              if (d.cmd === 'result') { const q = pending.get(d.reqId); if (q) { q.done = now(); q.ok = !!(d.result && d.result.success); pending.delete(d.reqId) } }
              else if (d.cmd && d.cmd !== 'progress') { events.push({ type: String(d.cmd), t: now() }); if (events.length > 20000) events.splice(0, 5000) }
            })
          }
        }
      } catch (err) { /* never disturb the product */ }
      return orig.call(this, msg, ...rest)
    }
  }
  hook(MessagePort.prototype)
  if (typeof Worker !== 'undefined') hook(Worker.prototype)
  for (const type of ['keydown', 'wheel', 'mousedown']) addEventListener(type, e => { inputs.push({ type, key: e.key, t: performance.timeOrigin + e.timeStamp }); if (inputs.length > 5000) inputs.splice(0, 1000) }, true)
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) longs.push({ start: performance.timeOrigin + e.startTime, dur: e.duration }) }).observe({ entryTypes: ['longtask'] }) } catch (err) {}
  window.__olb = now()
  return 'installed'
})()`
const HOST_INSTRUMENT = `(() => {
  if (window.__olbHost) return
  const inputs = window.__olbInputs = [], longs = window.__olbLong = []
  for (const type of ['mousedown', 'keydown']) addEventListener(type, e => { inputs.push({ type, t: performance.timeOrigin + e.timeStamp }); if (inputs.length > 5000) inputs.splice(0, 1000) }, true)
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) longs.push({ start: performance.timeOrigin + e.startTime, dur: e.duration }) }).observe({ entryTypes: ['longtask'] }) } catch (err) {}
  window.__olbHost = true
})()`

async function instrumentTarget(target) {
  if (target.type() !== 'webview') return
  for (let i = 0; i < 100; i++) {
    try {
      const p = await target.page()
      if (!p) return
      await p.evaluateOnNewDocument(GUEST_INSTRUMENT)
      if (/editor\.html/.test(p.url())) { await p.evaluate(GUEST_INSTRUMENT); return }
    } catch { /* navigating */ }
    await sleep(50)
  }
}

// ---- process lifecycle -------------------------------------------------------
const profileDirs = ['appData', 'userData', 'sessionData']
async function start(phase) {
  fs.writeFileSync(commandFile, '{}')
  if (phase !== 'warmup') for (const key of profileDirs) {
    fs.rmSync(path.join(run, key), { recursive: true, force: true })
    fs.cpSync(path.join(run, 'seed-' + key), path.join(run, key), { recursive: true })
  }
  const executable = process.env.AWD_ELECTRON_BINARY || path.join(root, 'desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  child = spawn(executable, [wrapper, `--remote-debugging-port=${cdpPort}`, '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'], { cwd: root, env, stdio: ['ignore', logFd, logFd], detached: true })
  const version = await until(async () => {
    if (child.exitCode !== null) throw new Error(`Electron exited ${child.exitCode}`)
    return (await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json())
  }, 120000, 250)
  browser = await puppeteer.connect({ browserWSEndpoint: version.webSocketDebuggerUrl, defaultViewport: null, protocolTimeout: 300000 })
  browser.on('targetcreated', t => { void instrumentTarget(t) })
  for (const t of browser.targets()) void instrumentTarget(t)
  page = await until(async () => (await browser.pages()).find(p => p.url().includes('/h5/index.html')), 60000)
  await page.evaluate(HOST_INSTRUMENT)
  await page.evaluateOnNewDocument(HOST_INSTRUMENT)
  const paths = JSON.parse(fs.readFileSync(path.join(run, 'paths.json')))
  assert.ok(Object.values(paths.paths).every(p => p.startsWith(run + path.sep)), 'Electron paths must stay inside the run directory')
  write(`${phase}-paths.json`, paths)
  return paths
}
async function quit() {
  browser?.disconnect(); browser = null
  fs.writeFileSync(commandFile, JSON.stringify({ quit: true, nonce: Date.now() }))
  try { await until(() => child.exitCode !== null || child.signalCode !== null, 70000) }
  catch (error) { try { process.kill(-child.pid, 'SIGKILL') } catch { /* gone */ } throw error }
  child = null
  await sleep(1000)
}

// ---- host helpers --------------------------------------------------------------
const editorExpr = `(name => Object.values(window.__checkbaActiveOverviewVm?._libreRefs || {}).find(e => e.file?.name === name))`
async function exec(name, action, params = {}) {
  const result = await page.evaluate(async (expr, name, action, params) => (0, eval)(expr)(name).executor.executeCommand(action, params), editorExpr, name, action, params)
  assert.equal(result?.success, true, `${action}: ${JSON.stringify(result)?.slice(0, 300)}`)
  return result
}
async function openFolder(dir) {
  fs.writeFileSync(commandFile, JSON.stringify({ path: dir, nonce: Date.now() }))
  await page.waitForFunction(() => !!window.__checkbaActiveOverviewVm && !location.hash.includes('pages/login/'), { timeout: 60000 })
}
async function treePoint(name) {
  return until(() => page.evaluate(name => {
    const el = [...document.querySelectorAll('.file-tree .tree-item')].find(e => e.textContent.includes(name))
    if (!el) return null
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    return r.width && r.height ? { x: r.x + Math.min(r.width / 2, 140), y: r.y + r.height / 2 } : null
  }, name), 60000, 200)
}
async function findGuest(name) {
  await page.evaluate(async (expr, name) => { await (0, eval)(expr)(name).webviewEl.executeJavaScript('window.__olbTarget=' + JSON.stringify(name)) }, editorExpr, name)
  const guest = await until(async () => {
    for (const target of browser.targets().filter(t => t.type() === 'webview')) {
      const candidate = await target.page()
      try { if (await candidate.evaluate(name => window.__olbTarget === name, name)) return candidate } catch { /* navigating */ }
    }
  })
  const installed = await guest.evaluate(GUEST_INSTRUMENT)
  const cdp = await guest.createCDPSession()
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  guest.__cdp = cdp
  return { guest, instrumentedLate: installed === 'installed' }
}
async function focusOverlay(name, guest) {
  await page.evaluate((expr, name) => (0, eval)(expr)(name).webviewEl.focus(), editorExpr, name)
  await guest.focus('[data-lo-ime]')
}
async function close(name) {
  await page.evaluate(async name => {
    const vm = window.__checkbaActiveOverviewVm
    const file = vm.leftFiles.find(f => f.name === name)
    if (file) await vm.closeFile(file.id, 'left')
  }, name)
  await page.waitForFunction(name => !window.__checkbaActiveOverviewVm.leftFiles.some(f => f.name === name), { timeout: 120000 }, name)
}
// The first click into a freshly shown window can be swallowed (it only focuses
// the tree); prime focus on the tree's blank header, then retry once if needed.
async function clickOpen(name) {
  const pt = await treePoint(name)
  const clicks = []
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.mouse.click(pt.x, pt.y)
    clicks.push(await page.evaluate(() => { const a = window.__olbInputs.filter(i => i.type === 'mousedown'); return a[a.length - 1]?.t }))
    const opened = await page.waitForFunction(name => window.__checkbaActiveOverviewVm?.activeFileLeft?.name === name, { timeout: 2500, polling: 20 }, name).then(() => true).catch(() => false)
    if (opened) return { clickAt: clicks[clicks.length - 1], attempts: clicks.length }
  }
  throw new Error('File tree click did not open ' + name)
}
// A login prompt can appear over the workbench (AI features without an account);
// dismiss it the way a user would before clicking the file tree.
async function dismissLogin() {
  const pt = await page.evaluate(() => {
    const el = [...document.querySelectorAll('uni-text, text, span, uni-view, view, button')].find(e => e.children.length === 0 && e.textContent.trim() === '暂不登录' && e.getBoundingClientRect().width)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  if (pt) { await page.mouse.click(pt.x, pt.y); await sleep(500); return true }
  return false
}
async function primeTree(name) {
  await treePoint(name)
  const dismissed = await dismissLogin()
  const pt = await page.evaluate(() => { const r = document.querySelector('.file-tree').getBoundingClientRect(); return { x: r.x + r.width - 20, y: r.y + r.height - 20 } })
  await page.mouse.click(pt.x, pt.y)
  await sleep(300)
  return dismissed
}
const spareState = () => page.evaluate(() => (window.__checkbaActiveOverviewVm?.libreSpares || []).map(sp => ({ file: sp.file?.name || null, hidden: !!sp.hidden, ready: !!sp.executor })))

// ---- frame capture ---------------------------------------------------------------
function decode(frame) {
  if (!frame.img) frame.img = frame.format === 'png' ? PNG.sync.read(frame.bytes) : jpeg.decode(frame.bytes, { useTArray: true, formatAsRGBA: true })
  return frame.img
}
async function screencast(cdp, { format, quality, maxWidth = 1440, maxHeight = 1100, keep = 2500 }) {
  const frames = []
  let decodedOrder = []
  const handler = ev => {
    const recv = Date.now()
    void cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {})
    const ts = ev.metadata?.timestamp ? ev.metadata.timestamp * 1000 : recv
    frames.push({ ts: Math.abs(ts - recv) < 2000 ? ts : recv, recv, bytes: Buffer.from(ev.data, 'base64'), format, deviceWidth: ev.metadata?.deviceWidth })
    if (frames.length > keep) frames.shift()
  }
  cdp.on('Page.screencastFrame', handler)
  await cdp.send('Page.startScreencast', { format, quality, maxWidth, maxHeight, everyNthFrame: 1 })
  await until(() => frames.length, 15000, 50)
  const sc = {
    frames,
    latest: () => frames[frames.length - 1],
    img(frame) {
      const img = decode(frame)
      decodedOrder.push(frame)
      if (decodedOrder.length > 40) { const old = decodedOrder.shift(); if (!decodedOrder.includes(old)) old.img = null }
      return img
    },
    stop: async () => { cdp.off('Page.screencastFrame', handler); await cdp.send('Page.stopScreencast').catch(() => {}); await cdp.detach().catch(() => {}) },
  }
  return sc
}
// rect is in CSS px of the captured page; frames are scaled by width/deviceWidth.
function frameRect(sc, frame, rect) {
  const img = sc.img(frame)
  if (!rect) return { x0: 0, y0: 0, x1: img.width - 16, y1: img.height }
  const s = img.width / (frame.deviceWidth || img.width)
  return { x0: Math.max(0, Math.floor(rect.x * s)), y0: Math.max(0, Math.floor(rect.y * s)), x1: Math.min(img.width, Math.ceil((rect.x + rect.width) * s)), y1: Math.min(img.height, Math.ceil((rect.y + rect.height) * s)) }
}
function diff(sc, a, b, r, mask) {
  const A = sc.img(a), B = sc.img(b)
  if (A.width !== B.width || A.height !== B.height) return Infinity
  let count = 0
  for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) {
    const p = y * A.width + x
    if (mask && mask[p]) continue
    const i = p * 4
    if (Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]) > 60) count++
  }
  return count
}
function markMask(sc, a, b, r, mask) {
  const A = sc.img(a), B = sc.img(b)
  if (A.width !== B.width || A.height !== B.height) return
  for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) {
    const p = y * A.width + x, i = p * 4
    if (Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]) > 60) {
      // Dilate by one pixel: JPEG/scaling smears a blinking caret's edges.
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const q = p + dy * A.width + dx; if (q >= 0 && q < mask.length) mask[q] = 1 }
    }
  }
}
// Observe the idle region (caret blinking) and mask only pixels that changed.
async function calibrate(sc, rect, ms = 1100) {
  const start = Date.now()
  await sleep(ms)
  const base = sc.latest()
  const img = sc.img(base), r = frameRect(sc, base, rect)
  const mask = new Uint8Array(img.width * img.height)
  for (const f of sc.frames.filter(f => f.recv >= start - 30 && f !== base)) markMask(sc, base, f, r, mask)
  let masked = 0
  for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) masked += mask[y * img.width + x]
  return { base, mask, r, masked, area: (r.x1 - r.x0) * (r.y1 - r.y0) }
}
// Wait until a response arrived and the region has been quiet (only caret-sized
// frame-to-frame changes) for quietMs; then score first change and settled match.
async function measure(sc, rect, action, { quietMs = 800, maxMs = 15000, minChange = 12, cal = null, label } = {}) {
  cal ||= await calibrate(sc, rect)
  const { base, mask, r, masked } = cal
  const caretTol = Math.max(40, masked * 1.5)
  const issued = Date.now()
  const marks = (await action()) || {}
  const t0 = marks.inputAt || issued
  let lastBig = Date.now(), responded = false, lastSeen = null
  const deadline = issued + maxMs
  while (Date.now() < deadline) {
    const f = sc.latest()
    if (f !== lastSeen) {
      if (f.ts >= t0 - 5 && !responded && diff(sc, base, f, r, mask) >= minChange) { responded = true; lastBig = Date.now() }
      if (lastSeen && diff(sc, lastSeen, f, r, mask) > caretTol) lastBig = Date.now()
      lastSeen = f
    }
    if (responded && Date.now() - lastBig >= quietMs) break
    await sleep(30)
  }
  const target = sc.latest()
  if (!responded) log('no response', label, JSON.stringify({ t0, issued, now: Date.now(), latestTs: target.ts, latestRecv: target.recv, frames: sc.frames.length, marks: Object.keys(marks) }))
  const changed = diff(sc, base, target, r, mask)
  const after = sc.frames.filter(f => f.ts >= t0 - 5)
  let firstChange = null
  for (const f of after) { if (diff(sc, base, f, r, mask) >= minChange) { firstChange = f; break } }
  const tol = Math.max(8, changed * 0.03, masked * 2)
  // Settled = first frame from which every later frame matches the target.
  let settled = null
  for (let i = after.length - 1; i >= 0; i--) { if (diff(sc, target, after[i], r, mask) <= tol) settled = after[i]; else break }
  const out = { label, firstChangeMs: firstChange ? Math.round(firstChange.ts - t0) : null, settledMs: settled ? Math.round(settled.ts - t0) : null,
    changedPixels: changed, maskedPixels: masked, tol: Math.round(tol), responded, timedOut: !responded, t0, frames: after.length, ...marks.extra }
  if (changed < minChange) out.noVisibleChange = true
  return out
}

// ---- per-format interactions -----------------------------------------------------
const kindOf = name => name.endsWith('.docx') ? 'docx' : name.endsWith('.pptx') ? 'pptx' : 'xlsx'
const lastInput = (guest, type) => guest.evaluate(type => { const a = window.__olbInputs.filter(i => i.type === type); return a.length ? a[a.length - 1].t : null }, type)
async function press(guest, key) {
  const before = await guest.evaluate(() => window.__olbInputs.length)
  await guest.keyboard.press(key)
  const inputAt = await until(() => guest.evaluate(n => window.__olbInputs.slice(n).find(i => i.type === 'keydown')?.t, before), 3000, 10).catch(() => null)
  return { inputAt: inputAt ?? Date.now(), extra: inputAt ? {} : { keydownNotSeen: true } }
}

async function enterPptText(name, guest, sc) {
  // First slide with an ordinary text shape (image-only title slides are common).
  const count = (await exec(name, 'office_get_navigation')).items.length
  let info, shape, slideNumber
  for (slideNumber = 1; slideNumber <= count; slideNumber++) {
    info = await exec(name, 'slide_get_page', { slideNumber })
    shape = info.shapes.find(s => typeof s.text === 'string' && s.text.trim().length > 1 && !s.isTable)
    if (shape) break
  }
  if (!shape) return { skipped: 'no text shape in deck' }
  // Typing runs first after open (slide 1 visible); go elsewhere via the slide panel.
  if (slideNumber > 1) { await clickNavItem('pptx', slideNumber - 1); await sleep(2000) }
  // Calibrate the white slide on the real canvas before double-clicking the shape.
  // Use the latest screencast frame: Page.captureScreenshot stalls a webview's screencast.
  await sleep(300)
  const shot = sc.img(sc.latest())
  fs.writeFileSync(path.join(run, `${name}-typing-target.png`), sc.latest().bytes)
  // The slide is whatever differs from the workspace background (sampled at a
  // corner), so coloured/image templates calibrate as well as white slides.
  const bg = [shot.data[(10 * shot.width + 10) * 4], shot.data[(10 * shot.width + 10) * 4 + 1], shot.data[(10 * shot.width + 10) * 4 + 2]]
  let left = shot.width, right = 0, top = shot.height, bottom = 0
  for (let y = 0; y < shot.height - 24; y++) {
    let count = 0, first = shot.width, last = 0
    for (let x = 0; x < shot.width - 24; x++) {
      const i = (y * shot.width + x) * 4
      if (Math.abs(shot.data[i] - bg[0]) + Math.abs(shot.data[i + 1] - bg[1]) + Math.abs(shot.data[i + 2] - bg[2]) > 24) { count++; first = Math.min(first, x); last = x }
    }
    if (count > shot.width * 0.4) { left = Math.min(left, first); right = Math.max(right, last); top = Math.min(top, y); bottom = y }
  }
  const viewport = await guest.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  let x, y
  if (right > left && bottom > top) {
    // Click on actual glyph pixels inside the shape box: a click on the empty part
    // of a placeholder only selects the frame, and a later End jumps to the last slide.
    const bx0 = Math.round(left + shape.left / info.width * (right - left)), bx1 = Math.round(left + (shape.left + shape.width) / info.width * (right - left))
    const by0 = Math.round(top + shape.top / info.height * (bottom - top)), by1 = Math.round(top + (shape.top + shape.height) / info.height * (bottom - top))
    // Glyphs = pixels far from the box's mean colour (dark-on-light or light-on-dark).
    const mean = [0, 0, 0]; let n = 0
    for (let yy = by0; yy < by1; yy++) for (let xx = bx0; xx < bx1; xx++) { const i = (yy * shot.width + xx) * 4; mean[0] += shot.data[i]; mean[1] += shot.data[i + 1]; mean[2] += shot.data[i + 2]; n++ }
    for (let k = 0; k < 3; k++) mean[k] /= Math.max(1, n)
    const glyph = i => Math.abs(shot.data[i] - mean[0]) + Math.abs(shot.data[i + 1] - mean[1]) + Math.abs(shot.data[i + 2] - mean[2]) > 180
    let bestRow = -1, bestCount = 0
    for (let yy = by0; yy < by1; yy++) {
      let c = 0
      for (let xx = bx0; xx < bx1; xx++) if (glyph((yy * shot.width + xx) * 4)) c++
      if (c > bestCount) { bestCount = c; bestRow = yy }
    }
    let lastDark = bx0
    for (let xx = bx0; xx < bx1; xx++) if (glyph((bestRow * shot.width + xx) * 4)) lastDark = xx
    const px = bestCount ? lastDark - 2 : (bx0 + bx1) / 2, py = bestCount ? bestRow : (by0 + by1) / 2
    x = px * viewport.width / shot.width
    y = py * viewport.height / shot.height
  } else { x = viewport.width / 2; y = viewport.height / 2 }
  // A single click on placeholder text enters text editing with the caret there;
  // a synthetic double click is not recognised by this engine build.
  await guest.mouse.click(x, y)
  await sleep(800)
  await focusOverlay(name, guest)
  await sleep(600)
  return { slide: slideNumber, shape: shape.name, slideCalibrated: right > left, click: [Math.round(x), Math.round(y)] }
}
async function clickNavItem(kind, index) {
  const pt = await page.evaluate((kind, index) => {
    const el = document.querySelectorAll(`.office-nav.${kind === 'pptx' ? 'impress' : 'calc'} .office-nav-item`)[index]
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }, kind, index)
  await page.mouse.click(pt.x, pt.y)
  return page.evaluate(() => { const a = window.__olbInputs.filter(i => i.type === 'mousedown'); return a[a.length - 1]?.t })
}
async function prepareTyping(name, guest, sc) {
  const kind = kindOf(name)
  if (kind === 'pptx') return enterPptText(name, guest, sc)
  const viewport = await guest.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  let cell = null
  if (kind === 'xlsx') {
    await guest.mouse.click(viewport.width * 0.32, viewport.height * 0.45)
    await sleep(600)
    cell = await exec(name, 'sheet_get_active_cell').then(r => ({ sheet: r.sheet, address: r.address })).catch(() => null)
  }
  await focusOverlay(name, guest)
  return { target: kind === 'xlsx' ? 'clicked grid cell' : 'document cursor (start of body)', cell }
}
async function navigate(name, guest, sc, kind) {
  const results = []
  if (kind === 'pptx' || kind === 'xlsx') {
    const items = await page.evaluate(kind => document.querySelectorAll(`.office-nav.${kind === 'pptx' ? 'impress' : 'calc'} .office-nav-item`).length, kind)
    const steps = kind === 'pptx' ? Math.min(5, items - 1) : (items >= 2 ? 5 : 0)
    for (let i = 1; i <= steps; i++) {
      const index = kind === 'pptx' ? i : i % 2
      results.push(await measure(sc, null, async () => ({ inputAt: await clickNavItem(kind, index) }), { label: `${kind === 'pptx' ? 'slide' : 'sheet'}-${index + 1}`, quietMs: 900 }))
    }
  }
  if (kind !== 'pptx') {
    await focusOverlay(name, guest)
    for (let i = 1; i <= 5; i++) results.push(await measure(sc, null, () => press(guest, 'PageDown'), { label: `pagedown-${i}`, maxMs: 5000 }))
  }
  return results
}
async function scroll(guest, sc) {
  const viewport = await guest.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  await guest.mouse.move(viewport.width * 0.45, viewport.height * 0.5)
  const before = await guest.evaluate(() => window.__olbLong.length)
  const cal = await calibrate(sc, null)
  const m = await measure(sc, null, async () => {
    for (let i = 0; i < 10; i++) { await guest.mouse.wheel({ deltaY: 100 }); await sleep(40) }
    const ticks = await guest.evaluate(() => window.__olbInputs.filter(i => i.type === 'wheel').slice(-10).map(i => i.t))
    return { inputAt: ticks[0], extra: { ticks } }
  }, { label: 'wheel-x10', cal, quietMs: 1000 })
  const lastTick = m.ticks[m.ticks.length - 1]
  const frames = sc.frames.filter(f => f.ts >= m.t0 && f.ts <= m.t0 + (m.settledMs ?? 0))
  const gaps = frames.slice(1).map((f, i) => f.ts - frames[i].ts)
  const longs = (await guest.evaluate(n => window.__olbLong.slice(n), before)).filter(l => l.start >= m.t0 - 50)
  return { ...m, afterLastTickMs: m.settledMs != null ? Math.round(m.t0 + m.settledMs - lastTick) : null, frameCount: frames.length,
    maxFrameGapMs: gaps.length ? Math.round(Math.max(...gaps)) : null, p50FrameGapMs: pct(gaps, 50),
    guestLongTasks: longs.length, guestLongTaskMs: Math.round(longs.reduce((a, l) => a + l.dur, 0)), ticks: undefined }
}
// Natural typing: 10 keys ~130 ms apart. Per key, latency = first frame after its
// keydown that differs from the last frame before it (outside the start caret);
// backlog = last keydown to the settled final picture.
async function burst(sc, guest, text) {
  const cal = await calibrate(sc, null)
  const { mask, r, masked } = cal
  const before = await guest.evaluate(() => window.__olbInputs.length)
  for (const ch of text) { await guest.keyboard.press(ch); await sleep(110) }
  await sleep(300)
  const kd = await guest.evaluate(n => window.__olbInputs.slice(n).filter(i => i.type === 'keydown').map(i => i.t), before)
  if (kd.length < text.length) return { error: `only ${kd.length}/${text.length} keydowns reached the editor` }
  const caretTol = Math.max(40, masked * 1.5)
  // Wait until the worker has executed every typed key (insert_at_cursor results)
  // and then the picture has been quiet for 1.2 s.
  let lastBig = Date.now(), lastSeen = null, responded = false
  const deadline = Date.now() + 90000
  while (Date.now() < deadline && !(responded && Date.now() - lastBig >= 1200)) {
    const f = sc.latest()
    if (!responded) responded = await guest.evaluate((t0, n) => window.__olbCmds.filter(c => c.action === 'insert_at_cursor' && c.sent >= t0 - 5 && c.done).reduce((a, c) => a + (c.text || 0), 0) >= n, kd[0], text.length)
    if (f !== lastSeen) {
      if (lastSeen && diff(sc, lastSeen, f, r, mask) > caretTol) lastBig = Date.now()
      lastSeen = f
    }
    await sleep(30)
  }
  const target = sc.latest()
  const after = sc.frames.filter(f => f.ts >= kd[0] - 5)
  const perKey = kd.map(t => {
    const base = [...sc.frames].reverse().find(f => f.ts < t) || cal.base
    const hit = after.find(f => f.ts >= t && diff(sc, base, f, r, mask) >= 12)
    return hit ? Math.round(hit.ts - t) : null
  })
  const changed = diff(sc, cal.base, target, r, mask)
  const tol = Math.max(8, changed * 0.03, masked * 2)
  let settled = null
  for (let i = after.length - 1; i >= 0; i--) { if (diff(sc, target, after[i], r, mask) <= tol) settled = after[i]; else break }
  return { firstKeyAt: kd[0], lastKeyAt: kd[kd.length - 1], perKeyMs: perKey, typedOverMs: Math.round(kd[kd.length - 1] - kd[0]), lastKeyToSettledMs: settled ? Math.round(settled.ts - kd[kd.length - 1]) : null, changedPixels: changed }
}
function summarizeCmds(cmds, from, to) {
  const inWindow = cmds.filter(c => c.sent >= from && c.sent < to)
  const by = {}
  for (const c of inWindow) {
    const k = c.action + (c.scope ? `(${c.scope})` : '')
    const e = by[k] ||= { count: 0, totalMs: 0, maxMs: 0, pending: 0 }
    e.count++
    if (c.done) { const d = c.done - c.sent; e.totalMs += d; e.maxMs = Math.max(e.maxMs, d) } else e.pending++
  }
  // Busy time of the office thread approximated by the union of in-flight intervals.
  const iv = inWindow.filter(c => c.done).map(c => [c.sent, c.done]).sort((a, b) => a[0] - b[0])
  let busy = 0, cur = null
  for (const [s, e] of iv) { if (!cur || s > cur[1]) { if (cur) busy += cur[1] - cur[0]; cur = [s, e] } else cur[1] = Math.max(cur[1], e) }
  if (cur) busy += cur[1] - cur[0]
  for (const e of Object.values(by)) { e.totalMs = Math.round(e.totalMs); e.maxMs = Math.round(e.maxMs) }
  return { count: inWindow.length, inFlightUnionMs: Math.round(busy), byAction: Object.fromEntries(Object.entries(by).sort((a, b) => b[1].totalMs - a[1].totalMs)) }
}

// ---- CDP trace -------------------------------------------------------------------
async function startTrace(categories) {
  const cdp = await browser.target().createCDPSession()
  await cdp.send('Tracing.start', { transferMode: 'ReturnAsStream', traceConfig: { recordMode: 'recordContinuously', includedCategories: categories || ['toplevel', 'devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8.execute', 'disabled-by-default-v8.cpu_profiler', 'blink.user_timing', 'v8', 'v8.wasm'] } })
  return cdp
}
async function stopTrace(cdp, file) {
  const done = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve))
  await cdp.send('Tracing.end')
  const { stream } = await done
  const out = fs.openSync(file, 'w')
  for (;;) {
    const chunk = await cdp.send('IO.read', { handle: stream, size: 8 << 20 })
    fs.writeSync(out, chunk.base64Encoded ? Buffer.from(chunk.data, 'base64') : chunk.data)
    if (chunk.eof) break
  }
  fs.closeSync(out)
  await cdp.send('IO.close', { handle: stream })
  await cdp.detach()
}
// Top long tasks per thread and V8 sampled self time per function (incl. wasm).
function analyzeTrace(file, windows) {
  const text = fs.readFileSync(file, 'utf8')
  let events
  try { events = JSON.parse(text); events = events.traceEvents || events } catch {
    events = []
    for (const line of text.split('\n')) { const l = line.trim().replace(/,$/, ''); if (l.startsWith('{"')) { try { events.push(JSON.parse(l)) } catch { /* partial */ } } }
  }
  const threadName = {}, procName = {}, procLabels = {}
  for (const e of events) {
    if (e.ph !== 'M') continue
    if (e.name === 'thread_name') threadName[e.pid + ':' + e.tid] = e.args?.name
    if (e.name === 'process_name') procName[e.pid] = e.args?.name
    if (e.name === 'process_labels') procLabels[e.pid] = e.args?.labels
  }
  // Map trace clock (us) to wall clock through the TimeStamp markers we emit.
  const markers = events.filter(e => e.name === 'TimeStamp' && /^olb:/.test(e.args?.data?.message || ''))
  const offset = markers.length ? markers[0].ts / 1000 - Number(markers[0].args.data.message.split(':')[2]) : null
  const label = (pid, tid) => `${procName[pid] || 'pid' + pid}${procLabels[pid] ? ' [' + procLabels[pid] + ']' : ''} / ${threadName[pid + ':' + tid] || 'tid' + tid}`
  const toWall = ts => offset == null ? null : ts / 1000 - offset
  const inWin = wall => !windows || windows.some(([a, b]) => wall >= a && wall <= b)
  // Count each task once: nested RunTask/ThreadControllerImpl::RunTask share a start.
  const seenTask = new Set()
  const tasks = events.filter(e => e.ph === 'X' && (e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask') && e.dur >= 50000)
    .sort((a, b) => a.ts - b.ts || b.dur - a.dur)
    .filter(e => { const k = `${e.pid}:${e.tid}:${Math.round(e.ts / 1000)}`; if (seenTask.has(k)) return false; seenTask.add(k); return true })
  const longByThread = {}
  for (const t of tasks) {
    const k = label(t.pid, t.tid) + ` #${t.tid}`
    const w = toWall(t.ts)
    ;(longByThread[k] ||= []).push({ wall: w == null ? null : Math.round(w), ms: Math.round(t.dur / 1000), inWindow: w == null ? null : inWin(w) })
  }
  for (const k of Object.keys(longByThread)) longByThread[k] = { count: longByThread[k].length, totalMs: longByThread[k].reduce((a, t) => a + t.ms, 0), top: longByThread[k].sort((a, b) => b.ms - a.ms).slice(0, 8) }
  // CPU profiles: one Profile + ProfileChunks per (pid, id).
  const profiles = {}
  for (const e of events) {
    if (e.name === 'Profile') profiles[e.pid + ':' + e.id] = { pid: e.pid, tid: e.tid, start: e.args?.data?.startTime, nodes: {}, samples: [], deltas: [] }
    else if (e.name === 'ProfileChunk') {
      const p = profiles[e.pid + ':' + e.id] ||= { pid: e.pid, tid: e.tid, nodes: {}, samples: [], deltas: [] }
      const d = e.args?.data || {}
      for (const n of d.cpuProfile?.nodes || []) p.nodes[n.id] = n
      p.samples.push(...(d.cpuProfile?.samples || []))
      p.deltas.push(...(d.timeDeltas || []))
    }
  }
  const cpu = {}
  for (const p of Object.values(profiles)) {
    const self = {}
    let t = p.start || 0, total = 0
    for (let i = 0; i < p.samples.length; i++) {
      t += p.deltas[i] || 0
      const dt = p.deltas[i + 1] || 0
      const w = toWall(t)
      if (w != null && !inWin(w)) continue
      const n = p.nodes[p.samples[i]]
      if (!n) continue
      const cf = n.callFrame || {}
      const fn = cf.functionName || '(anonymous)'
      if (fn === '(idle)') continue
      const key = `${fn} ${cf.url ? path.basename(cf.url) : ''}${cf.lineNumber >= 0 && cf.url ? ':' + (cf.lineNumber + 1) : ''}`
      self[key] = (self[key] || 0) + dt / 1000
      total += dt / 1000
    }
    if (total < 50) continue
    const k = label(p.pid, p.tid) + ` #${p.tid}`
    cpu[k] = { sampledMs: Math.round(total), topSelf: Object.entries(self).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([f, ms]) => ({ f, ms: Math.round(ms) })) }
  }
  // soffice.wasm ships without a name section, so wasm frames are indices only.
  return { file, wallOffsetKnown: offset != null, longTasksByThread: longByThread, cpuByThread: cpu }
}

// ---- one measured open ---------------------------------------------------------------
// The typed marker as it lands in the saved package (text runs may be split by
// markup, so compare against the XML with tags removed).
const TYPED = 'quickbrownolbtypingx'
function stripTags(xml) {
  // Loop until stable so nested fragments such as `<<b>script>` cannot survive one pass (CodeQL).
  let prev
  do { prev = xml; xml = xml.replace(/<[^>]*>/g, '') } while (xml !== prev)
  return xml
}
async function packageText(file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file))
  let out = ''
  for (const n of Object.keys(zip.files).filter(n => n.endsWith('.xml'))) out += stripTags(await zip.file(n).async('string'))
  return out
}
async function measureDocument(name, filePath, mode, { trace = false, reopen = false } = {}) {
  const kind = kindOf(name)
  const result = { name, kind, mode, spareAtClick: await spareState() }
  const hostCdp = await page.createCDPSession()
  const hostSc = await screencast(hostCdp, { format: 'jpeg', quality: 70 })
  let traceCdp = null
  if (trace) { traceCdp = await startTrace(); await sleep(300) }
  result.loginPromptDismissed = await primeTree(name)
  const mtimeBefore = fs.statSync(filePath).mtimeMs
  await page.evaluate((expr, name) => {
    const m = window.__olbMilestones = {}
    const iv = setInterval(() => {
      const t = performance.timeOrigin + performance.now(), ed = (0, eval)(expr)(name)
      if (!ed) return
      m.editor ??= t
      if (ed.previewReady) m.preview ??= t
      if (ed.ready && ed.statusKey === 'ready') m.ready ??= t
      if (m.ready && !ed.loadingOverlayVisible) { m.overlayGone ??= t; clearInterval(iv) }
    }, 10)
    console.timeStamp('olb:click:' + Date.now())
  }, editorExpr, name)
  const { clickAt, attempts } = await clickOpen(name)
  result.clickAttempts = attempts
  await page.waitForFunction((expr, name) => { const e = (0, eval)(expr)(name); return e && e.ready && e.statusKey === 'ready' && !e.docLoadFailed }, { timeout: 240000, polling: 50 }, editorExpr, name)
  const { guest, instrumentedLate } = await findGuest(name)
  result.instrumentedLate = instrumentedLate
  // Let the open settle (thumbnails, toolbar reads, spare scheduling) and keep the
  // full first 10 s of worker traffic.
  const readyAt = (await page.evaluate(() => window.__olbMilestones.ready))
  await until(async () => Date.now() >= Math.max(clickAt + 10500, readyAt + 3000), 60000, 200)
  const rect = await page.evaluate((expr, name) => { const r = (0, eval)(expr)(name).webviewEl.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }, editorExpr, name)
  const cal = await calibrate(hostSc, rect, 1300)
  const target = cal.base
  const frames = hostSc.frames.filter(f => f.ts >= clickAt - 5 && f.ts <= target.ts)
  const tol = Math.max(16, cal.masked * 2, cal.area * 0.002)
  let painted = null
  for (let i = frames.length - 1; i >= 0; i--) { if (diff(hostSc, target, frames[i], cal.r, cal.mask) <= tol) painted = frames[i]; else break }
  const initial = diff(hostSc, target, frames[0], cal.r, cal.mask)
  let near = null
  for (const f of frames) { if (diff(hostSc, target, f, cal.r, cal.mask) <= Math.max(tol, initial * 0.25)) { near = f; break } }
  const ms = await page.evaluate(() => window.__olbMilestones)
  const rel = t => t == null ? null : Math.round(t - clickAt)
  fs.writeFileSync(path.join(run, `${name}-${mode}-painted.jpg`), (painted || target).bytes)
  result.open = { paintedMs: painted ? Math.round(painted.ts - clickAt) : null, nearContentMs: near ? Math.round(near.ts - clickAt) : null,
    editorMountedMs: rel(ms.editor), previewMs: rel(ms.preview), readyMs: rel(ms.ready), overlayGoneMs: rel(ms.overlayGone),
    regionPixels: cal.area, initialDiff: initial, tol: Math.round(tol), frames: frames.length }
  await hostSc.stop()
  const cmds = () => guest.evaluate(() => window.__olbCmds)
  const all = await cmds()
  result.first10s = summarizeCmds(all, clickAt, clickAt + 10000)
  result.first10s.hostLongTasks = (await page.evaluate(() => window.__olbLong)).filter(l => l.start >= clickAt && l.start < clickAt + 10000).reduce((a, l) => ({ count: a.count + 1, ms: Math.round(a.ms + l.dur) }), { count: 0, ms: 0 })
  result.first10s.guestLongTasks = (await guest.evaluate(() => window.__olbLong)).filter(l => l.start >= clickAt && l.start < clickAt + 10000).reduce((a, l) => ({ count: a.count + 1, ms: Math.round(a.ms + l.dur) }), { count: 0, ms: 0 })
  result.first10s.loadDocument = all.find(c => c.action === 'load_document' && c.sent >= clickAt - 1000) ? 'captured' : 'not captured'
  log(name, mode, 'open', JSON.stringify(result.open))

  // Interactions on the guest canvas (PNG frames: exact pixels for small glyphs).
  let sc = await screencast(await guest.createCDPSession(), { format: 'png', maxWidth: 1280, maxHeight: 1100, keep: 600 })
  const phase = async (label, fn) => {
    const from = Date.now()
    // A login prompt (AI features without an account) can pop over the editor
    // after open; dismiss it and give the canvas focus back, as a user would.
    if (await dismissLogin()) { (result.loginPromptDuring ||= []).push(label); if (label !== 'nav') await focusOverlay(name, guest) }
    let value
    try { value = await fn() } catch (error) { value = { error: error.message }; log(name, mode, label, 'failed', error.message) }
    const list = await cmds()
    return { value, cmds: summarizeCmds(list, from, Date.now()) }
  }
  try {
    if (await dismissLogin()) (result.loginPromptDuring ||= []).push('before-typing')
    result.typingTarget = await prepareTyping(name, guest, sc)
    if (!result.typingTarget.skipped) {
      const typedBurst = await phase('burst', () => burst(sc, guest, 'quickbrown'))
      result.burst = typedBurst.value; result.burstCmds = typedBurst.cmds
      log(name, mode, 'burst', JSON.stringify(typedBurst.value))
      const typed = await phase('typing', async () => {
        const keys = []
        for (const ch of 'olbtypingx') keys.push(await measure(sc, null, () => press(guest, ch), { label: `key-${ch}`, quietMs: 700 }))
        return keys
      })
      result.typing = typed.value; result.typingCmds = typed.cmds
      log(name, mode, 'keys', JSON.stringify(Array.isArray(typed.value) ? typed.value.map(k => [k.firstChangeMs, k.settledMs]) : typed.value))
      // Commit like a user: Enter in a Calc cell, Escape out of an Impress text box.
      if (kind === 'xlsx') await guest.keyboard.press('Enter')
      if (kind === 'pptx') await guest.keyboard.press('Escape')
      // Autosave probe: calibrate while idle, then type the instant saving starts.
      await sleep(300)
      const cal2 = await calibrate(sc, null)
      const saveStart = await page.waitForFunction((expr, name) => { const e = (0, eval)(expr)(name); return e?.saving ? performance.timeOrigin + performance.now() : false }, { timeout: 90000, polling: 5 }, editorExpr, name).then(h => h.jsonValue()).catch(() => null)
      // PPT: the text box was left with Escape, so the probe key nudges the still
      // selected shape (a visible document edit) instead of typing a character.
      const probe = saveStart ? await measure(sc, null, () => press(guest, kind === 'pptx' ? 'ArrowRight' : 'z'), { label: 'key-during-autosave', cal: cal2, maxMs: 60000 }) : null
      if (probe) probe.issuedAfterSaveStartMs = Math.round(probe.t0 - saveStart)
      const saveEnd = saveStart ? await page.waitForFunction((expr, name) => { const e = (0, eval)(expr)(name); return e && !e.saving ? performance.timeOrigin + performance.now() : false }, { timeout: 120000, polling: 20 }, editorExpr, name).then(h => h.jsonValue()) : null
      const landed = await until(() => fs.statSync(filePath).mtimeMs > mtimeBefore, 60000, 200).then(() => true).catch(() => false)
      const lastExportMs = await page.evaluate((expr, name) => (0, eval)(expr)(name)._lastExportMs ?? null, editorExpr, name)
      result.autosave = { savingMs: saveStart && saveEnd ? Math.round(saveEnd - saveStart) : null, lastExportMs, landedOnDisk: landed, probe }
      log(name, mode, 'autosave', JSON.stringify({ ...result.autosave, probe: probe && [probe.firstChangeMs, probe.settledMs] }))
    }
    // Acceptance chain: the product's normal autosave (no forced save, no extra
    // command that could reset its timer) must put the typed text on disk.
    if (reopen && !result.typingTarget.skipped) {
      const t = Date.now()
      result.diskHasEdit = await until(async () => (await packageText(filePath)).includes(TYPED), 60000, 500).then(() => Date.now() - t).catch(() => false)
      log(name, mode, 'disk has typed text after normal autosave', result.diskHasEdit)
    }
    // Scroll and navigate after typing/autosave: typing is measured on the freshly
    // opened view (slide 1 / top of document / first sheet).
    const sc2 = await phase('scroll', () => scroll(guest, sc))
    result.scroll = sc2.value; result.scrollCmds = sc2.cmds
    log(name, mode, 'scroll', JSON.stringify(sc2.value))
    const nav = await phase('nav', () => navigate(name, guest, sc, kind))
    result.navigation = nav.value; result.navigationCmds = nav.cmds
    log(name, mode, 'nav', JSON.stringify(Array.isArray(nav.value) ? nav.value.map(m => m.settledMs) : nav.value))
  } finally {
    await sc.stop()
  }
  if (traceCdp) {
    const file = path.join(run, `${name}-${mode}.trace.json`)
    await stopTrace(traceCdp, file)
    result.trace = { file, size: fs.statSync(file).size }
  }
  await close(name)
  if (reopen && !result.typingTarget?.skipped) {
    await clickOpen(name)
    await page.waitForFunction((expr, name) => { const e = (0, eval)(expr)(name); return e && e.ready && e.statusKey === 'ready' && !e.docLoadFailed }, { timeout: 240000, polling: 100 }, editorExpr, name)
    await sleep(1500)
    if (kind === 'pptx') {
      const info = await exec(name, 'slide_get_page', { slideNumber: result.typingTarget.slide })
      // Runtime shape names are not stable across loads; check every shape's text.
      const hit = info.shapes.find(s => String(s.text || '').includes(TYPED))
      result.reopen = { slide: result.typingTarget.slide, shape: hit?.name || null, text: String(hit?.text || '').slice(-80), hasEdit: !!hit }
    } else if (kind === 'xlsx' && result.typingTarget.cell) {
      const r = await exec(name, 'sheet_read_range', { sheet: result.typingTarget.cell.sheet, range: result.typingTarget.cell.address })
      const value = JSON.stringify(r.values ?? r.data ?? r).slice(0, 200)
      result.reopen = { cell: result.typingTarget.cell, value, hasEdit: value.includes(TYPED) }
    }
    log(name, mode, 'reopen', JSON.stringify(result.reopen))
    await close(name)
  }
  return result
}

// ---- cold-burst mode -------------------------------------------------------------
// OFFICE_LATENCY_COLD_BURST=settled|eager: cold open, then one natural-typing burst
// either ~10 s after the click (reader then typist) or as soon as the editor is
// ready (eager typist). Records when the warm spare is created/ready relative to
// the burst, then checks that the next open adopts a warm spare.
const coldBurstVariant = process.env.OFFICE_LATENCY_COLD_BURST || null
const TRACE_COMPOSITOR = ['toplevel', 'benchmark', 'input', 'cc', 'viz', 'gpu', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'devtools.timeline', 'blink.user_timing', 'v8.execute', 'disabled-by-default-v8.cpu_profiler']
async function measureColdBurst(name, variant, { trace = false } = {}) {
  const result = { name, kind: kindOf(name), mode: 'cold', variant, spareAtClick: await spareState() }
  result.loginPromptDismissed = await primeTree(name)
  await page.evaluate(() => {
    const t = window.__olbSpare = {}
    const iv = setInterval(() => {
      const now = performance.timeOrigin + performance.now()
      const sp = (window.__checkbaActiveOverviewVm?.libreSpares || []).filter(s => !s.file && !s.hidden)
      if (sp.length) t.created ??= now
      if (sp.some(s => s.executor)) { t.ready ??= now; clearInterval(iv) }
    }, 50)
  })
  const traceCdp = trace ? await startTrace(TRACE_COMPOSITOR) : null
  const { clickAt } = await clickOpen(name)
  await page.waitForFunction((expr, name) => { const e = (0, eval)(expr)(name); return e && e.ready && e.statusKey === 'ready' && !e.docLoadFailed }, { timeout: 240000, polling: 50 }, editorExpr, name)
  const readyAt = Date.now()
  const { guest } = await findGuest(name)
  const sc = await screencast(await guest.createCDPSession(), { format: 'png', maxWidth: 1280, maxHeight: 1100, keep: 600 })
  try {
    if (variant === 'settled') await until(async () => Date.now() >= clickAt + 10500, 60000, 100)
    else await sleep(300)
    if (await dismissLogin()) result.loginPromptDuring = true
    result.typingTarget = await prepareTyping(name, guest, sc)
    if (result.typingTarget.skipped) return result
    const b = await burst(sc, guest, 'quickbrown')
    result.burst = b
    // What else ran on the office worker around the burst (3 s before to settle).
    const cmds = await guest.evaluate(() => window.__olbCmds)
    result.burstWindowCmds = summarizeCmds(cmds, b.firstKeyAt - 3000, b.lastKeyAt + Math.max(0, b.lastKeyToSettledMs || 0) + 300)
    result.guestLongTasksInBurst = (await guest.evaluate(() => window.__olbLong)).filter(l => l.start >= b.firstKeyAt - 3000 && l.start <= b.lastKeyAt + 2000).map(l => ({ at: Math.round(l.start - b.firstKeyAt), ms: Math.round(l.dur) }))
    result.hostLongTasksInBurst = (await page.evaluate(() => window.__olbLong)).filter(l => l.start >= b.firstKeyAt - 3000 && l.start <= b.lastKeyAt + 2000).map(l => ({ at: Math.round(l.start - b.firstKeyAt), ms: Math.round(l.dur) }))
    log(name, 'cold', variant, 'burst-window', JSON.stringify({ cmds: result.burstWindowCmds, guestLong: result.guestLongTasksInBurst, hostLong: result.hostLongTasksInBurst }))
    log(name, 'cold', variant, 'burst', JSON.stringify(b))
  } finally { await sc.stop() }
  if (traceCdp) {
    const file = path.join(run, `${name}-cold-${variant}.trace.json`)
    await stopTrace(traceCdp, file)
    result.trace = { file, size: fs.statSync(file).size }
  }
  // The spare must still boot once typing stops.
  await page.waitForFunction(() => window.__olbSpare.ready, { timeout: 180000, polling: 200 }).catch(() => {})
  const sp = await page.evaluate(() => window.__olbSpare)
  const rel = t => t == null ? null : Math.round(t - clickAt)
  const b = result.burst || {}
  result.timeline = { readyMs: Math.round(readyAt - clickAt), burstStartMs: rel(b.firstKeyAt), burstEndMs: rel(b.lastKeyAt), spareCreatedMs: rel(sp.created), spareReadyMs: rel(sp.ready) }
  result.timeline.spareBootOverlapsBurst = sp.created != null && b.firstKeyAt != null && sp.created < b.lastKeyAt + (b.lastKeyToSettledMs || 0) && (sp.ready == null || sp.ready > b.firstKeyAt)
  log(name, 'cold', variant, 'timeline', JSON.stringify(result.timeline))
  await close(name)
  return result
}
async function checkWarmNext(name) {
  await page.waitForFunction(() => (window.__checkbaActiveOverviewVm?.libreSpares || []).some(sp => !sp.file && !sp.hidden && sp.executor), { timeout: 180000, polling: 200 }).catch(() => {})
  await sleep(4000)
  const spareAtClick = await spareState()
  await primeTree(name)
  const { clickAt } = await clickOpen(name)
  await page.waitForFunction((expr, name) => { const e = (0, eval)(expr)(name); return e && e.ready && e.statusKey === 'ready' }, { timeout: 240000, polling: 50 }, editorExpr, name)
  const out = { name, spareAtClick, warm: spareAtClick.some(s => !s.file && !s.hidden && s.ready), readyMs: Math.round(Date.now() - clickAt) }
  log(name, 'next open', JSON.stringify(out))
  await close(name)
  return out
}

// ---- main ------------------------------------------------------------------------------
try {
  await until(async () => (await fetch(base + '/api/admin/wizard')).ok, 120000, 500)
  const startupLog = fs.readFileSync(path.join(run, 'runtime.log'), 'utf8')
  for (const isolatedPath of [`-Duser.home=${home}`, `jdbc:h2:file:${home}/db`]) assert.ok(startupLog.includes(isolatedPath), `Backend did not confirm isolated path: ${isolatedPath}`)
  // Warm-up session: first-ever launch fills disk/code caches; a real user's
  // "cold" open is after the app has run before. Not measured.
  {
    const dir = path.join(home, 'warmup'); fs.mkdirSync(dir)
    const src = sources.find(s => s.endsWith('.docx')) || sources[0]
    const name = 'warmup' + path.extname(src)
    fs.copyFileSync(src, path.join(dir, name))
    evidence.runtime = (await start('warmup')).versions
    await openFolder(dir)
    await primeTree(name)
    await clickOpen(name)
    await page.waitForFunction((expr, name) => (0, eval)(expr)(name)?.ready, { timeout: 240000 }, editorExpr, name)
    await sleep(5000)
    await close(name)
    await quit()
    // Every measured session starts from this same post-warm-up profile, so one
    // session's state (e.g. an account prompt that ends the local session)
    // cannot leak into the next and all sessions share identical caches.
    for (const key of profileDirs) fs.cpSync(path.join(run, key), path.join(run, 'seed-' + key), { recursive: true })
    log('warm-up done')
  }
  for (let round = 1; round <= rounds; round++) for (const src of sources) {
    const stem = path.basename(src).replace(/\.[^.]+$/, ''), ext = path.extname(src)
    const dir = path.join(home, `r${round}-${stem}`)
    fs.mkdirSync(dir)
    const names = { cold: `${stem}-r${round}-cold${ext}`, warm: `${stem}-r${round}-warm${ext}`, trace: `${stem}-r${round}-trace${ext}` }
    const doTrace = round === 1 && traced.has(path.basename(src))
    for (const [mode, name] of Object.entries(names)) if (mode !== 'trace' || doTrace) fs.copyFileSync(src, path.join(dir, name))
    const session = { source: path.basename(src), round, runs: [] }
    evidence.sessions.push(session)
    try {
      // The app occasionally boots into the web login page (or reloads while the
      // folder opens); that launch is not measurable, so relaunch it (max 3 tries).
      for (let attempt = 1; ; attempt++) {
        try {
          await start(`r${round}-${stem}`)
          await openFolder(dir)
          await treePoint(names.cold)
          break
        } catch (error) {
          const url = page ? await page.evaluate(() => location.hash).catch(() => '?') : '?'
          ;(session.relaunches ||= []).push({ attempt, url, error: error.message })
          log('relaunch', path.basename(src), round, attempt, url, error.message)
          if (child) await quit().catch(() => { try { process.kill(-child.pid, 'SIGKILL') } catch { /* gone */ } child = null })
          if (attempt >= 3) throw error
        }
      }
      if (coldBurstVariant) {
        session.runs.push(await measureColdBurst(names.cold, coldBurstVariant, { trace: doTrace }))
        session.nextOpen = await checkWarmNext(names.warm)
        write('progress.json', evidence)
        continue
      }
      session.runs.push(await measureDocument(names.cold, path.join(dir, names.cold), 'cold'))
      write('progress.json', evidence)
      const waitSpare = async () => {
        const t = Date.now()
        await page.waitForFunction(() => (window.__checkbaActiveOverviewVm?.libreSpares || []).some(sp => !sp.file && !sp.hidden && sp.executor), { timeout: 240000, polling: 200 })
        await sleep(4000) // warm_engine runs right after the spare's handshake
        return Date.now() - t
      }
      session.spareWaitMs = await waitSpare()
      session.runs.push(await measureDocument(names.warm, path.join(dir, names.warm), 'warm', { reopen: round === 1 && reopenFor.has(path.basename(src)) }))
      write('progress.json', evidence)
      if (doTrace) {
        await waitSpare()
        const r = await measureDocument(names.trace, path.join(dir, names.trace), 'warm-trace', { trace: true })
        session.runs.push(r)
        write('progress.json', evidence)
      }
    } catch (error) {
      session.error = error.stack
      log('session failed', path.basename(src), round, error.message)
      if (page) await page.screenshot({ path: path.join(run, `failure-r${round}-${stem}.png`) }).catch(() => {})
    } finally {
      if (child) await quit().catch(error => { session.quitError = error.message; try { process.kill(-child.pid, 'SIGKILL') } catch { /* gone */ } child = null })
    }
  }
  for (const s of sources) assert.equal(hash(s), sourceHashes[s], 'Source documents must remain unchanged')
  // Trace summaries (one warm PPT, one warm Excel by default).
  evidence.traces = []
  for (const session of evidence.sessions) for (const r of session.runs) if (r.trace) {
    try { evidence.traces.push({ name: r.name, ...analyzeTrace(r.trace.file) }) } catch (error) { evidence.traces.push({ name: r.name, error: error.message }) }
  }
  // Aggregate per source x mode.
  const summary = {}
  for (const session of evidence.sessions) for (const r of session.runs) {
    if (r.mode === 'warm-trace') continue
    const s = summary[`${session.source} ${r.mode}`] ||= { rounds: 0, open: [], near: [], ready: [], keysFirst: [], keysSettled: [], burstKey: [], burstBacklog: [], nav: [], scrollSettle: [], scrollMaxGap: [], saveMs: [], probe: [], cmds10s: [], busy10s: [] }
    s.rounds++
    s.open.push(r.open?.paintedMs); s.near.push(r.open?.nearContentMs); s.ready.push(r.open?.readyMs)
    for (const k of Array.isArray(r.typing) ? r.typing : []) { s.keysFirst.push(k.firstChangeMs); s.keysSettled.push(k.settledMs) }
    for (const k of r.burst?.perKeyMs || []) s.burstKey.push(k)
    s.burstBacklog.push(r.burst?.lastKeyToSettledMs)
    for (const n of Array.isArray(r.navigation) ? r.navigation : []) if (!n.noVisibleChange && !n.timedOut) s.nav.push(n.settledMs)
    s.scrollSettle.push(r.scroll?.settledMs); s.scrollMaxGap.push(r.scroll?.maxFrameGapMs)
    s.saveMs.push(r.autosave?.savingMs); s.probe.push(r.autosave?.probe?.settledMs)
    s.cmds10s.push(r.first10s?.count); s.busy10s.push(r.first10s?.inFlightUnionMs)
  }
  evidence.summary = Object.fromEntries(Object.entries(summary).map(([k, s]) => [k, Object.fromEntries(Object.entries(s).map(([m, v]) => [m, Array.isArray(v) ? { p50: pct(v, 50), p95: pct(v, 95), n: v.filter(Number.isFinite).length } : v]))]))
  evidence.passed = evidence.sessions.every(s => !s.error)
} catch (error) {
  evidence.error = error.stack
  if (page && browser) await page.screenshot({ path: path.join(run, 'failure.png') }).catch(() => {})
  throw error
} finally {
  if (child) await quit().catch(error => { evidence.quitError = error.message })
  try { process.kill(-java.pid, 'SIGTERM') } catch { /* gone */ }
  await until(() => java.exitCode !== null || java.signalCode !== null, 15000).catch(() => { try { process.kill(-java.pid, 'SIGKILL') } catch { /* gone */ } })
  fs.closeSync(logFd)
  evidence.productionAfter = productionSnapshot()
  evidence.productionUnchanged = JSON.stringify(evidence.productionAfter) === JSON.stringify(productionBefore)
  if (!evidence.passed || !evidence.productionUnchanged) process.exitCode = 1
  write('result.json', evidence)
  console.log(JSON.stringify({ run, passed: evidence.passed, summary: evidence.summary, error: evidence.error }, null, 1))
}
