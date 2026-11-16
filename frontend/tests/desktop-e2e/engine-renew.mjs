// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 真机（R-086 浸泡）：引擎换新与引擎意外停止后的恢复。
// 1. 换新：堆过阈值（测试里用可调设置 awd.engineHeap 把阈值压到最低）→ 在安静、已全部保存的时刻
//    换一台新引擎重装刚保存的内容。Word/Excel/PPT 各一：改动在新引擎里、阅读位置保住、出平静提示、
//    换新本身不写盘、旧引擎被换掉。
// 2. 意外停止：存过一笔、再改一笔（未保存）时让引擎中止 → 自动换引擎恢复；存过的在、没存的不在，
//    提示写明恢复到哪一刻、之后的改动没保存上；全程不出现「保存失败」。
// 不碰用户的生产实例：Electron/后端的 home、userData、端口全部在临时目录（同 resize-recenter.mjs）。
// 先构建本树的 H5、zetaoffice（含 LOWA 资源与 cjk* 字体）与后端 JAR；JAVA_HOME 指向 JDK 21。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const run = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-engine-renew-'))
const home = path.join(run, 'home')
fs.mkdirSync(home)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const write = (name, value) => fs.writeFileSync(path.join(run, name), JSON.stringify(value, null, 2))
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
app.on('browser-window-created',(_,window)=>window.setContentSize(1400,900));
require(path.join(root,'desktop/main/main.js'));
const cmdFile=path.join(run,'command.json');let last='';fs.watchFile(cmdFile,{interval:100},()=>{const s=fs.readFileSync(cmdFile,'utf8');if(s===last)return;last=s;const c=JSON.parse(s);if(c.quit){fs.unwatchFile(cmdFile);app.quit()}else if(c.anim){const {BrowserWindow}=require('electron');const [a,b]=c.anim;let i=0;const n=20;const t=setInterval(()=>{i++;const w=Math.round(a[0]+(b[0]-a[0])*i/n),h=Math.round(a[1]+(b[1]-a[1])*i/n);for(const x of BrowserWindow.getAllWindows())x.setContentSize(w,h);if(i>=n)clearInterval(t)},15)}else if(c.size){const {BrowserWindow}=require('electron');for(const w of BrowserWindow.getAllWindows())w.setContentSize(c.size[0],c.size[1])}else if(c.path)app.emit('open-file',{preventDefault(){}},c.path)});
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
const evidence = { run, backendPort, cdpPort, productionBefore, files: [] }
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

// ---- R-086 flow ------------------------------------------------------------------
const editorState = name => page.evaluate((expr, name) => {
  const e = (0, eval)(expr)(name)
  return e ? { ready: !!e.ready, dirty: !!e.dirty, saving: !!e.saving, status: e.statusKey, failed: !!e.docLoadFailed, notice: e.engineNotice || '', webview: e.webviewEl ? (e.webviewEl.__e2eId || (e.webviewEl.__e2eId = Math.random().toString(36).slice(2))) : null } : null
}, editorExpr, name)
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const setPolicy = policy => page.evaluate(p => { if (p) localStorage.setItem('awd.engineHeap', JSON.stringify(p)); else localStorage.removeItem('awd.engineHeap') }, policy)
// Watch the host for the calm notice and any 「保存失败」 flash while the engine is swapped or recovered.
const WATCH = `(() => { window.__r086 = { toasts: [], saveFailed: 0, seen: new Set() }
  const seen = window.__r086.seen
  const tick = () => { for (const el of document.querySelectorAll('.awd-toast__text, .uni-toast, .uni-sample-toast, uni-toast')) { const t = el.textContent.trim(); if (t && !seen.has(t)) { seen.add(t); window.__r086.toasts.push(t) } }
    if ([...document.querySelectorAll('.libre-save-state.error')].some(e => e.getBoundingClientRect().width)) window.__r086.saveFailed++ }
  setInterval(tick, 50) })()`
async function waitReady(name, timeout = 240000) {
  await page.waitForFunction((expr, name) => { const e = (0, eval)(expr)(name); return e && e.ready && e.statusKey === 'ready' && !e.docLoadFailed }, { timeout, polling: 100 }, editorExpr, name)
}
async function waitSaved(name, file, before) {
  await until(async () => { const s = await editorState(name); return s && !s.dirty && !s.saving && fs.statSync(file).mtimeMs > before }, 60000, 200)
}
const FORMATS = {
  docx: {
    edit: (name, marker) => exec(name, 'insert_at_cursor', { text: marker }),
    // 光标先被放到第 1500 段，标记就落在那一带
    read: async name => JSON.stringify(await exec(name, 'get_document_text', { startParagraph: 1490, maxParagraphs: 20 })),
    // 读到文末附近再换新：恢复后视图应仍在那一带（Writer 视图数据含可见区域）
    position: name => exec(name, 'select_paragraph', { index: 1500 }),
  },
  xlsx: {
    edit: (name, marker) => exec(name, 'sheet_write_cells', { startCell: 'H2', rows: [[marker]], __agent: true }),
    read: async name => JSON.stringify(await exec(name, 'sheet_read_range', { range: 'H2' })),
    position: async () => null, // 视图数据照样比对（活动表/格），只是不先滚动
  },
  pptx: {
    edit: async (name, marker) => {
      const pg = await exec(name, 'slide_get_page', { slideNumber: 2 })
      const shape = (pg.shapes || []).find(s => typeof s.text === 'string')
      return exec(name, 'slide_set_shape_text', { slideNumber: 2, shapeName: shape.name, text: marker })
    },
    read: async name => JSON.stringify(await exec(name, 'slide_get_page', { slideNumber: 2 })),
    position: async name => { const nav = await exec(name, 'office_get_navigation', {}); return exec(name, 'office_activate_item', { id: 3, documentSeq: nav.documentSeq }) },
  },
}
const results = { renew: [], crash: null }
try {
  await until(async () => (await fetch(base + '/api/admin/wizard')).ok, 120000, 500)
  const dir = path.join(home, 'docs'); fs.mkdirSync(dir)
  const docx = 'long-contract.docx'
  execFileSync('python3', [path.join(root, 'frontend/tests/lowa-e2e/fixtures/gen-long-contract.py'), path.join(dir, docx)])
  fs.copyFileSync(path.join(root, 'scripts/eval/fixtures/case-ledger.xlsx'), path.join(dir, 'case-ledger.xlsx'))
  fs.copyFileSync(path.join(root, 'scripts/eval/fixtures/case-report.pptx'), path.join(dir, 'case-report.pptx'))
  fs.copyFileSync(path.join(dir, docx), path.join(dir, 'crash-contract.docx'))
  for (let attempt = 1; ; attempt++) {
    try { evidence.runtime = (await start('warmup')).versions; await openFolder(dir); break }
    catch (error) { if (child) await quit().catch(() => {}); if (attempt >= 3) throw error }
  }
  await primeTree(docx)
  await page.evaluate(WATCH)

  // 1. 换新（三种格式）
  for (const [name, kind] of [[docx, 'docx'], ['case-ledger.xlsx', 'xlsx'], ['case-report.pptx', 'pptx']]) {
    const F = FORMATS[kind], file = path.join(dir, name)
    await setPolicy(null)
    await clickOpen(name)
    await waitReady(name)
    await sleep(2000)
    await F.position(name)
    const marker = 'R086-' + kind + '-' + Date.now().toString(36)
    const before = fs.statSync(file).mtimeMs
    await F.edit(name, marker)
    await waitSaved(name, file, before)
    const savedSha = sha(file), savedMtime = fs.statSync(file).mtimeMs
    const posBefore = await exec(name, 'get_view_position')
    const oldEngine = (await editorState(name)).webview
    const heapBefore = await exec(name, 'get_engine_heap')
    await page.evaluate(() => { window.__r086.toasts.length = 0; window.__r086.saveFailed = 0; window.__r086.seen.clear() })
    // 阈值压到最低、不节流；下一次保存成功后量堆 → 过阈值 → 等安静 → 换新
    await setPolicy({ recycleAt: 0.0001, checkEveryMs: 0 })
    const t0 = Date.now()
    await page.evaluate((expr, name) => (0, eval)(expr)(name).checkEngineHeap(), editorExpr, name)
    await until(async () => { const s = await editorState(name); return s && s.webview && s.webview !== oldEngine }, 60000, 200)
    await waitReady(name)
    await setPolicy(null)
    await sleep(1500)
    const renewedMs = Date.now() - t0
    const text = await F.read(name)
    const posAfter = await exec(name, 'get_view_position')
    const watch = await page.evaluate(() => window.__r086)
    await page.screenshot({ path: path.join(run, `renewed-${kind}.png`) })
    const editorLog = await page.evaluate((expr, name) => String((0, eval)(expr)(name).log || '').split('\n').filter(l => /renew|restored|heap|engine/.test(l)).slice(-12), editorExpr, name)
    const r = { name, kind, renewedMs, editorLog, markerPresent: text.includes(marker), fileUnchanged: sha(file) === savedSha && fs.statSync(file).mtimeMs === savedMtime,
      heapBeforeMB: Math.round(heapBefore.usedBytes / 1048576), positionBefore: posBefore, positionAfter: posAfter,
      toasts: watch.toasts, saveFailedFrames: watch.saveFailed }
    results.renew.push(r)
    log('renew', JSON.stringify(r))
    assert.ok(r.markerPresent, `${kind}: saved edit missing after the engine was renewed`)
    assert.ok(r.fileUnchanged, `${kind}: renewing the engine rewrote the file`)
    assert.equal(r.saveFailedFrames, 0, `${kind}: 「保存失败」 flashed during the renewal`)
    assert.ok(r.toasts.some(t => /document engine was refreshed|已刷新文档引擎/.test(t)), `${kind}: calm notice missing: ${JSON.stringify(r.toasts)}`)
    const keys = { docx: ['paragraph', 'offset'], xlsx: ['sheet', 'cell'], pptx: ['slide'] }[kind]
    for (const k of keys) assert.equal(posAfter[k], posBefore[k], `${kind}: reading position (${k}) restored`)
    if (kind === 'docx') assert.ok(posBefore.paragraph >= 1490, 'test setup: cursor was moved deep into the contract')
    await close(name)
  }

  // 2. 意外停止（Word）：存过一笔 + 未保存一笔时引擎中止
  {
    const name = 'crash-contract.docx', file = path.join(dir, name)
    await setPolicy(null)
    await clickOpen(name)
    await waitReady(name)
    await sleep(2000)
    const saved = 'R086-saved-' + Date.now().toString(36)
    const before = fs.statSync(file).mtimeMs
    await exec(name, 'insert_at_cursor', { text: saved })
    await waitSaved(name, file, before)
    const savedSha = sha(file)
    await page.evaluate(() => { window.__r086.toasts.length = 0; window.__r086.saveFailed = 0; window.__r086.seen.clear() })
    const unsaved = 'R086-unsaved-' + Date.now().toString(36)
    await exec(name, 'insert_at_cursor', { text: unsaved })
    const dirty = (await editorState(name)).dirty
    const oldEngine = (await editorState(name)).webview
    // 与 OOM 同一条路：Emscripten abort → onAbort → 客体发 engine-failed
    await page.evaluate((expr, name) => (0, eval)(expr)(name).webviewEl.executeJavaScript('setTimeout(() => Module.abort("R-086 e2e"), 0); true'), editorExpr, name)
    await until(async () => { const s = await editorState(name); return s && s.webview && s.webview !== oldEngine }, 60000, 100)
    await waitReady(name)
    await sleep(1500)
    const state = await editorState(name)
    const text = JSON.stringify(await exec(name, 'get_document_text', { startParagraph: 0, maxParagraphs: 3 }))
    const watch = await page.evaluate(() => window.__r086)
    await page.screenshot({ path: path.join(run, 'crash-recovered.png') })
    results.crash = { dirtyAtAbort: dirty, savedPresent: text.includes(saved), unsavedPresent: text.includes(unsaved), fileSameAsLastSave: sha(file) === savedSha,
      notice: state.notice, saveFailedFrames: watch.saveFailed, status: state.status }
    log('crash', JSON.stringify(results.crash))
    assert.ok(dirty, 'test setup: the second edit must still be unsaved when the engine stops')
    assert.ok(results.crash.savedPresent, 'saved edit missing after recovery')
    assert.ok(!results.crash.unsavedPresent, 'recovery cannot contain the unsaved edit (it died with the engine)')
    assert.ok(results.crash.fileSameAsLastSave, 'recovery must not write the file')
    assert.ok(/stopped unexpectedly|意外停止/.test(state.notice) && /could not be recovered|未能保存/.test(state.notice), 'notice must say what was restored and that later changes were lost: ' + state.notice)
    assert.equal(results.crash.saveFailedFrames, 0, '「保存失败」 must not flash while recovering')
  }
  write('results.json', results)
  console.log(JSON.stringify({ pass: 1, fail: 0, run }))
} finally {
  write('evidence.json', { ...evidence, results })
  if (child) await quit().catch(() => {})
  killGroups()
}
