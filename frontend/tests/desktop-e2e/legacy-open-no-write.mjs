// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 真机（台账 B10）：只打开旧格式 .doc/.xls（含轻度损坏的），不做任何编辑，磁盘上的原件一个字节都不能变、
// mtime 也不能变。只有用户明确保存才写。由 save-after-view.mjs 的宿主隔离骨架改出。
// 不碰用户的生产实例：Electron/后端的 home、userData、端口全部在临时目录（同 office-interaction-latency.mjs）。
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
const run = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-legacy-no-write-'))
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

import crypto2 from 'node:crypto'
// 变体：引擎自导出的正常 .doc/.xls（tests/lowa-e2e/fixtures/legacy-malformed/ 里的 base）+ 在中段覆写 16 字节
// 「手改」出来的轻度损坏件（引擎仍能打开）。
const FX = path.join(root, 'frontend/tests/lowa-e2e/fixtures/legacy-malformed')
function variants() {
  const out = []
  // 默认：tests/lowa-e2e/fixtures/legacy-import（Word 2 .doc、Excel 5/95 .xls 与 Word 97/BIFF8 对照）
  const dir = process.env.LEGACY_DIR || path.join(root, 'frontend/tests/lowa-e2e/fixtures/legacy-import')
  if (!process.env.LEGACY_SYNTHETIC) { for (const n of fs.readdirSync(dir).filter(n => /\.(doc|xls|ppt)$/i.test(n))) out.push([n, fs.readFileSync(path.join(dir, n))]); return out }
  for (const base of ['contract.doc', 'case-ledger.xls']) {
    const b = fs.readFileSync(path.join(FX, base))
    const ext = path.extname(base), stem = path.basename(base, ext)
    out.push([stem + '-orig' + ext, b])
    for (const f of [0.1, 0.3, 0.5, 0.7]) { const c = Buffer.from(b); const at = Math.floor(b.length * f); c.fill(0x41, at, at + 16); out.push([stem + '-flip' + String(f).replace('.', '') + ext, c]) }
    out.push([stem + '-append' + ext, Buffer.concat([b, Buffer.alloc(777, 0x5a)])])
  }
  return out
}
const sha = (p) => crypto2.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16)
const IDLE_MS = Number(process.env.LEGACY_IDLE_MS || 20000)
try {
  await until(async () => (await fetch(base + '/api/admin/wizard')).ok, 120000, 500)
  const dir = path.join(home, 'docs'); fs.mkdirSync(dir)
  const files = variants()
  for (const [n, b] of files) fs.writeFileSync(path.join(dir, n), b)
  // 把 mtime 推回过去，任何写盘都看得出来
  const past = new Date(Date.now() - 3600e3)
  for (const [n] of files) fs.utimesSync(path.join(dir, n), past, past)
  for (let attempt = 1; ; attempt++) {
    try { evidence.runtime = (await start('warmup')).versions; await openFolder(dir); break }
    catch (error) { if (child) await quit().catch(() => {}); if (attempt >= 3) throw error }
  }
  await primeTree(files[0][0])
  for (const [name] of (process.env.LEGACY_ONLY ? files.filter(f => process.env.LEGACY_ONLY.split(',').includes(f[0])) : files)) {
    const p = path.join(dir, name), before = { sha: sha(p), mtime: fs.statSync(p).mtimeMs }
    const r = { name, before }
    try {
      await clickOpen(name)
      const state = () => page.evaluate((expr, name) => { const e = (0, eval)(expr)(name); return e ? { ready: !!e.ready, status: e.statusKey, failed: !!e.docLoadFailed, dirty: !!e.dirty, saving: !!e.saving } : null }, editorExpr, name)
      await until(async () => { const s = await state(); return s && (s.ready || s.failed || /Failed|failed/.test(s.status || '')) }, 180000, 200)
      r.timeline = []
      const t0 = Date.now()
      while (Date.now() - t0 < IDLE_MS) {
        const s = await state(); const last = r.timeline[r.timeline.length - 1]
        if (!last || JSON.stringify({ ...last, t: 0 }) !== JSON.stringify({ ...s, t: 0 })) r.timeline.push({ t: Date.now() - t0, ...s })
        await sleep(250)
      }
      // Office 97 之前的格式（B10）：只读横幅；真改一笔也不写原件；「另存为副本」生成 .docx/.xlsx
      const pre97 = /word2|excel95|excel5|样式|候选/.test(name)
      r.banner = await page.evaluate((expr, name) => { const e = (0, eval)(expr)(name); return e ? { legacyProtected: e.legacyProtected, legacyImport: e.legacyImport, bar: e.saveStateText } : null }, editorExpr, name)
      if (pre97 && process.env.LEGACY_EDIT !== '0') {
        const kind = /\.xls$/i.test(name) ? 'calc' : 'writer'
        if (kind === 'writer') await exec(name, 'insert_at_cursor', { text: '真编辑' })
        else await exec(name, 'sheet_write_cells', { startCell: 'H2', rows: [['真编辑']], __agent: true })
        await sleep(9000) // 超过自动保存的等待
        r.afterEdit = { sha: sha(p), mtime: fs.statSync(p).mtimeMs, bar: await page.evaluate((expr, name) => (0, eval)(expr)(name)?.saveStateText, editorExpr, name) }
        const ext = kind === 'calc' ? 'xlsx' : 'docx', copy = path.join(dir, path.basename(name, path.extname(name)) + '.' + ext)
        const ok = await page.evaluate((expr, name) => (0, eval)(expr)(name).saveProtectedCopy(), editorExpr, name)
        await until(() => fs.existsSync(copy), 30000, 300).catch(() => {})
        r.copy = { ok, exists: fs.existsSync(copy), bytes: fs.existsSync(copy) ? fs.statSync(copy).size : 0, zip: fs.existsSync(copy) && fs.readFileSync(copy).subarray(0, 2).toString() === 'PK' }
        await sleep(2500)
        await page.screenshot({ path: path.join(run, 'copy-' + name + '.png') })
      }
      try {
        const { guest } = await findGuest(name)
        r.trace = await guest.evaluate(() => ({ cmds: (window.__olbCmds || []).map(c => [Math.round(c.sent - window.__olb), c.action]), events: (window.__olbEvents || []).filter(e => e.type !== 'boot-log').map(e => [Math.round(e.t - window.__olb), e.type]).slice(0, 80) }))
      } catch (e) { r.traceError = e.message }
      await page.screenshot({ path: path.join(run, 'open-' + name + '.png') })
      await close(name).catch(() => {})
      await sleep(1500)
    } catch (error) { r.error = error.message }
    r.after = { sha: sha(p), mtime: fs.statSync(p).mtimeMs }
    r.untouched = r.after.sha === before.sha && r.after.mtime === before.mtime
    if (r.copy) r.copyOk = r.copy.ok && r.copy.exists && r.copy.zip
    evidence.files.push(r)
    log(name, r.untouched ? 'UNTOUCHED' : 'WRITTEN', JSON.stringify({ banner: r.banner, afterEdit: r.afterEdit, copy: r.copy, dirtyAt: (r.timeline || []).find(x => x.dirty)?.t ?? null, error: r.error }))
  }
  evidence.passed = evidence.files.length > 0 && evidence.files.every(f => f.untouched && (f.copy ? f.copyOk : true))
} catch (error) {
  evidence.error = error.stack
  if (page && browser) await page.screenshot({ path: path.join(run, 'failure.png') }).catch(() => {})
} finally {
  if (child) await quit().catch(() => {})
  try { process.kill(-java.pid, 'SIGTERM') } catch { /* gone */ }
  await until(() => java.exitCode !== null || java.signalCode !== null, 15000).catch(() => { try { process.kill(-java.pid, 'SIGKILL') } catch { /* gone */ } })
  fs.closeSync(logFd)
  write('result.json', evidence)
  console.log(JSON.stringify({ run, passed: evidence.passed, error: evidence.error }, null, 1))
  if (!evidence.passed) process.exitCode = 1
}
