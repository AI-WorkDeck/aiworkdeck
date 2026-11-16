// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 真机：窗口变宽/变窄后，Word/PPT/Excel 的内容要跟着新窗格重排、居中，不能偏到一边被裁
// （台账 B1，教程问题记录第 148 条：1400px 打开 → 拉到 1920px，Word 整页偏右、右半边被裁）。
// RESIZE_FILES=opinion.docx,case-report.pptx,...（默认三种格式各一）。由 save-after-view.mjs 的宿主隔离骨架改出。
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
const run = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-resize-recenter-'))
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

import { PNG } from 'pngjs'
// 页面/幻灯片在客体截图里的水平位置：取若干扫描行上「最长的一段近白色像素」（Writer 页面、
// Impress 幻灯片是白底，四周是灰色应用背景）。Calc 没有「页」，改看可见列数与画布是否铺满。
function whiteRun(buf) {
  const png = PNG.sync.read(buf)
  const rows = [0.3, 0.45, 0.6].map(f => Math.round(png.height * f))
  let best = null
  for (const y of rows) {
    let start = -1
    for (let x = 0; x <= png.width; x++) {
      const i = (y * png.width + x) * 4
      const white = x < png.width && png.data[i] > 245 && png.data[i + 1] > 245 && png.data[i + 2] > 245
      if (white && start < 0) start = x
      if (!white && start >= 0) { if (!best || x - start > best.right - best.left) best = { left: start, right: x, y }; start = -1 }
    }
  }
  return { width: png.width, height: png.height, ...best }
}
async function measure(name, guest, label) {
  const shot = await guest.screenshot({ type: 'png' })
  fs.writeFileSync(path.join(run, `${label}-${name}.png`), shot)
  await page.screenshot({ path: path.join(run, `${label}-${name}-host.png`) })
  const run1 = whiteRun(shot)
  const geo = await guest.evaluate(() => {
    const c = [...document.querySelectorAll('canvas')].map(el => ({ css: [Math.round(el.getBoundingClientRect().width), Math.round(el.getBoundingClientRect().height)], px: [el.width, el.height] }))
    return { inner: [innerWidth, innerHeight], dpr: devicePixelRatio, canvases: c }
  })
  const ui = await exec(name, 'get_ui_state', {}).then(r => r.data?.view || r.view || null).catch(() => null)
  // 截图像素 / 客体 CSS 宽度 = 实际设备像素比（客体页把 devicePixelRatio 钉在启动值，不能用它换算）
  const dpr = run1.width / geo.inner[0]
  const pageCenter = run1.left != null ? (run1.left + run1.right) / 2 / dpr : null
  const viewCenter = geo.inner[0] / 2
  return { label, geo, zoom: ui?.zoom, page: run1.left != null ? [Math.round(run1.left / dpr), Math.round(run1.right / dpr)] : null, offCenter: pageCenter == null ? null : Math.round(pageCenter - viewCenter), clipped: run1.right != null && run1.right >= run1.width - 2 }
}

const FIXTURES = { 'opinion.docx': 'scripts/eval/fixtures/opinion.docx', 'case-report.pptx': 'scripts/eval/fixtures/case-report.pptx' }
for (const f of fs.readdirSync(path.join(root, 'scripts/eval/fixtures'))) if (!FIXTURES[f]) FIXTURES[f] = 'scripts/eval/fixtures/' + f
const names = (process.env.RESIZE_FILES || 'opinion.docx,case-report.pptx,case-ledger.xlsx').split(',')
const SIZES = (process.env.RESIZE_SEQ || '1920x1080,1400x900').split(',').map(s => s.split('x').map(Number))
try {
  await until(async () => (await fetch(base + '/api/admin/wizard')).ok, 120000, 500)
  const dir = path.join(home, 'docs'); fs.mkdirSync(dir)
  for (const n of names) fs.copyFileSync(path.isAbsolute(n) ? n : path.join(root, FIXTURES[n]), path.join(dir, path.basename(n)))
  for (let i = 0; i < names.length; i++) names[i] = path.basename(names[i])
  for (let attempt = 1; ; attempt++) {
    try { evidence.runtime = (await start('warmup')).versions; await openFolder(dir); break }
    catch (error) { if (child) await quit().catch(() => {}); if (attempt >= 3) throw error }
  }
  await primeTree(names[0])
  const mode = process.env.RESIZE_MODE || 'dpr'
  if (mode === 'background') {
    // 文档在后台标签里时改窗口尺寸，再切回来看（webview 被隐藏时收不到 resize）
    const [a, b] = names
    for (const n of [a, b]) {
      await clickOpen(n)
      await page.waitForFunction((expr, name) => { const e = (0, eval)(expr)(name); return e && e.ready && e.statusKey === 'ready' && !e.docLoadFailed }, { timeout: 240000, polling: 100 }, editorExpr, n)
      await sleep(2500)
    }
    const steps = []
    for (const [w, h] of SIZES) {
      fs.writeFileSync(commandFile, JSON.stringify({ size: [w, h], nonce: Date.now() })); await sleep(3000)
      await clickOpen(a); await sleep(3000)
      const { guest } = await findGuest(a)
      steps.push(await measure(a, guest, `bg-resized-${w}`))
      await clickOpen(b); await sleep(1500)
    }
    evidence.files.push({ name: a, mode, steps })
    log(a, mode, JSON.stringify(steps.map(s => ({ label: s.label, inner: s.geo.inner, canvas: s.geo.canvases[0]?.css, page: s.page, offCenter: s.offCenter, clipped: s.clipped, zoom: s.zoom }))))
    names.length = 0
  }
  for (const name of names) {
    const openSize = mode === 'spare' ? SIZES[0] : [1400, 900]
    if (mode === 'spare') { await sleep(8000) }   // 备胎在 1400 宽下预热好
    fs.writeFileSync(commandFile, JSON.stringify({ size: openSize, nonce: Date.now() })); await sleep(1500)
    evidence.spareAtOpen = await spareState()
    await clickOpen(name)
    if (mode === 'during-load') fs.writeFileSync(commandFile, JSON.stringify({ size: SIZES[0], nonce: Date.now() }))
    if (mode === 'anim-during-load') fs.writeFileSync(commandFile, JSON.stringify({ anim: [[1400, 900], SIZES[0]], nonce: Date.now() }))
    await page.waitForFunction((expr, name) => { const e = (0, eval)(expr)(name); return e && e.ready && e.statusKey === 'ready' && !e.docLoadFailed }, { timeout: 240000, polling: 100 }, editorExpr, name)
    await sleep(3000)
    const { guest } = await findGuest(name)
    const steps = [await measure(name, guest, 'open-1400')]
    if (mode === 'dpr') {
      // 换到 1x 外接屏：客体页 devicePixelRatio 2→1（CDP 仿真会触发 resolution 媒体查询变化，与真机换屏同一信号）
      await guest.__cdp.send('Emulation.setDeviceMetricsOverride', { width: 0, height: 0, deviceScaleFactor: Number(process.env.RESIZE_DPR || 1), mobile: false })
      await sleep(3000)
      steps.push(await measure(name, guest, 'dpr-' + (process.env.RESIZE_DPR || 1)))
    }
    let prev = mode.includes('during-load') ? SIZES[0] : [1400, 900]
    for (const [w, h] of SIZES) {
      fs.writeFileSync(commandFile, JSON.stringify(mode === 'anim' ? { anim: [prev, [w, h]], nonce: Date.now() } : { size: [w, h], nonce: Date.now() }))
      prev = [w, h]
      await sleep(4000)
      steps.push(await measure(name, guest, `resized-${w}`))
    }
    evidence.files.push({ name, steps })
    log(name, JSON.stringify(steps.map(s => ({ label: s.label, inner: s.geo.inner, canvas: s.geo.canvases[0]?.css, page: s.page, offCenter: s.offCenter, clipped: s.clipped, zoom: s.zoom }))))
    await close(name)
  }
  // 判定：①换屏（像素比变化）或改尺寸后回到原尺寸，内容位置与同尺寸下打开时一致（±3 px，三种格式通用）；
  // ②Word/PPT 的页面中线与窗格中线相差不超过 24 px、不贴右边被裁（Calc 没有「页」，只用①）；
  // ③Qt 画布 CSS 宽度跟上客体视口。
  const same = (a, b) => a && b && Math.abs(a[0] - b[0]) <= 3 && Math.abs(a[1] - b[1]) <= 3
  evidence.passed = evidence.files.length > 0 && evidence.files.every(f => {
    const open = f.steps.find(s => s.label === 'open-1400')
    const calc = /\.xlsx?$/i.test(f.name)
    return f.steps.every(s => (!open || !(s.label.startsWith('dpr-') || s.label === 'resized-1400') || same(s.page, open.page))
      && (calc || (!s.clipped && s.offCenter != null && Math.abs(s.offCenter) <= 24))
      && Math.abs((s.geo.canvases[0]?.css[0] ?? s.geo.inner[0]) - s.geo.inner[0]) <= 2)
  })
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
}
