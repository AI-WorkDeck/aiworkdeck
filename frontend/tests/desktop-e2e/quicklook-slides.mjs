// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// O13 真机验收（由 office-password.mjs 的宿主隔离骨架改出）：QuickLook 预览演示文稿用引擎逐页渲染，不再用前端 pptx-preview。
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
const run = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-quicklook-'))
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

const fixtures = path.join(root, 'frontend/tests/lowa-e2e/fixtures')
const SAMPLES = [
  [path.join(root, 'scripts/eval/fixtures/case-report.pptx'), 'pptx'],
  [path.join(fixtures, 'encrypted/legacy/plain.ppt'), 'ppt'],
  [path.join(fixtures, 'encrypted/case-report.pptx'), 'locked'],
]
async function quickLook(name) {
  await primeTree(name)
  await page.evaluate(name => {
    const vm = window.__checkbaActiveOverviewVm
    const tree = vm.$refs.fileTree
    const all = (tree && tree.allFiles) || []
    const file = (Array.isArray(all) ? all : []).find(f => f && f.name === name)
    if (file) vm.toggleQuickLook(file)
  }, name)
  await page.waitForFunction(() => !!document.querySelector('.quick-look-mask'), { timeout: 10000 })
}
async function checkSample(src, kind) {
  const name = 'ql-' + kind + '-' + path.basename(src)
  const r = { name, kind }
  evidence.files.push(r)
  const t0 = Date.now()
  await quickLook(name)
  const state = () => page.evaluate(() => {
    const mask = document.querySelector('.quick-look-mask')
    if (!mask) return null
    const imgs = [...mask.querySelectorAll('.awd-slide-preview-card img')]
    return {
      cards: imgs.length,
      loaded: imgs.filter(i => i.complete && i.naturalWidth > 0).length,
      pptxPreviewDom: !!mask.querySelector('.pptx-preview-wrapper, .pptx-preview-slide-wrapper'),
      unsupported: !!mask.querySelector('.preview-unsupported'),
      loading: !!mask.querySelector('.docx-loading'),
    }
  })
  r.final = await until(async () => { const s = await state(); return s && !s.loading && (s.cards || s.unsupported || s.pptxPreviewDom) ? s : null }, 180000, 300).catch(async () => ({ timeout: true, ...(await state()) }))
  r.ms = Date.now() - t0
  await sleep(800)
  r.final = await state()
  await page.screenshot({ path: path.join(run, 'quicklook-' + kind + '.png') })
  await page.evaluate(() => { window.__checkbaActiveOverviewVm.quickLookFile = null })
  await sleep(500)
  r.passed = kind === 'locked' ? (r.final.unsupported && !r.final.cards) : (r.final.cards > 0 && r.final.loaded === r.final.cards && !r.final.pptxPreviewDom)
  log(name, JSON.stringify(r))
}

try {
  await until(async () => (await fetch(base + '/api/admin/wizard')).ok, 120000, 500)
  const dir = path.join(home, 'docs'); fs.mkdirSync(dir)
  for (const [src, kind] of SAMPLES) fs.copyFileSync(src, path.join(dir, 'ql-' + kind + '-' + path.basename(src)))
  fs.copyFileSync(path.join(root, 'scripts/eval/fixtures/opinion.docx'), path.join(dir, 'b5-opinion.docx'))
  // 偶发启动到 Web 登录页（同 office-interaction-latency.mjs）：重启，最多三次
  for (let attempt = 1; ; attempt++) {
    try {
      evidence.runtime = (await start('warmup')).versions
      await openFolder(dir)
      break
    } catch (error) {
      log('relaunch', attempt, error.message)
      if (child) await quit().catch(() => { try { process.kill(-child.pid, 'SIGKILL') } catch { /* gone */ } child = null })
      if (attempt >= 3) throw error
    }
  }
  // 先等预热备胎就绪（与真实使用一致：打开工作台一会儿之后再按空格预览）
  await page.waitForFunction(() => (window.__checkbaActiveOverviewVm?.libreSpares || []).some(sp => !sp.file && !sp.hidden && sp.executor), { timeout: 240000, polling: 500 }).catch(() => {})
  for (const [src, kind] of SAMPLES) {
    try { await checkSample(src, kind) } catch (error) {
      evidence.files.push({ name: src, error: error.stack }); log(src, 'failed', error.message)
      await page.screenshot({ path: path.join(run, 'failure-' + kind + '.png') }).catch(() => {})
    }
  }
  // 台账 B5：预览借走预热备胎后，紧接着打开文件应仍落在热引擎上（预览清场后原样归还），
  // 而不是冷启动。先预览演示文稿、马上打开一份 Word：打字 → 自动保存落盘 → 关闭重开核对；
  // 再预览一次、马上打开同一份演示文稿。
  const waitReady = n => page.waitForFunction((expr, name) => { const e = (0, eval)(expr)(name); return e && e.ready && e.statusKey === 'ready' && !e.docLoadFailed }, { timeout: 240000, polling: 50 }, editorExpr, n)
  const waitWarmSpare = () => page.waitForFunction(() => (window.__checkbaActiveOverviewVm?.libreSpares || []).some(sp => !sp.file && !sp.hidden && !sp.borrowed && sp.executor), { timeout: 240000, polling: 200 })
  async function previewThenOpen(previewName, openName) {
    await waitWarmSpare()
    await quickLook(previewName)
    await until(() => page.evaluate(() => { const m = document.querySelector('.quick-look-mask'); return m && !m.querySelector('.docx-loading') && m.querySelectorAll('.awd-slide-preview-card img').length > 0 }), 180000, 200)
    await page.evaluate(() => { window.__checkbaActiveOverviewVm.quickLookFile = null })
    await sleep(600) // 用户看完预览、关掉、点开文件的间隔
    const spareAtClick = await spareState()
    const t0 = Date.now()
    await clickOpen(openName)
    await waitReady(openName)
    const r = { preview: previewName, open: openName, spareAtClick, warmAtClick: spareAtClick.some(sp => !sp.file && !sp.hidden && sp.ready), readyMs: Date.now() - t0 }
    await sleep(1500)
    await page.screenshot({ path: path.join(run, 'b5-open-' + openName + '.png') })
    return r
  }
  const b5 = evidence.b5 = {}
  try {
    const docx = 'b5-opinion.docx', deck = 'ql-pptx-case-report.pptx'
    const docPath = path.join(dir, docx), mtime0 = fs.statSync(docPath).mtimeMs
    b5.docx = await previewThenOpen(deck, docx)
    await exec(docx, 'insert_at_cursor', { text: 'B5回收验证' })
    await until(() => fs.statSync(docPath).mtimeMs > mtime0, 60000, 300)   // 产品自身的自动保存落盘
    await close(docx)
    await clickOpen(docx); await waitReady(docx)
    const text = await exec(docx, 'get_document_text', { startParagraph: 0, maxParagraphs: 20, __agent: true })
    b5.docx.savedAndReopened = JSON.stringify(text).includes('B5回收验证')
    await page.screenshot({ path: path.join(run, 'b5-reopened-docx.png') })
    await close(docx)
    b5.deck = await previewThenOpen(deck, deck)
    const nav = await exec(deck, 'office_get_navigation', {})
    b5.deck.slides = nav.items?.length || 0
    await close(deck)
    b5.passed = b5.docx.warmAtClick && b5.docx.savedAndReopened && b5.deck.warmAtClick && b5.deck.slides > 0
  } catch (error) { b5.error = error.stack; await page.screenshot({ path: path.join(run, 'failure-b5.png') }).catch(() => {}) }
  log('B5', JSON.stringify(b5))
  evidence.passed = evidence.files.length === SAMPLES.length && evidence.files.every(r => r.passed) && !!b5.passed
} catch (error) {
  evidence.error = error.stack
  if (page && browser) await page.screenshot({ path: path.join(run, 'failure.png') }).catch(() => {})
} finally {
  if (child) await quit().catch(error => { evidence.quitError = error.message })
  try { process.kill(-java.pid, 'SIGTERM') } catch { /* gone */ }
  await until(() => java.exitCode !== null || java.signalCode !== null, 15000).catch(() => { try { process.kill(-java.pid, 'SIGKILL') } catch { /* gone */ } })
  fs.closeSync(logFd)
  evidence.productionAfter = productionSnapshot()
  evidence.productionUnchanged = JSON.stringify(evidence.productionAfter) === JSON.stringify(productionBefore)
  if (!evidence.passed || !evidence.productionUnchanged) process.exitCode = 1
  write('result.json', evidence)
  console.log(JSON.stringify({ run, passed: evidence.passed, files: evidence.files, error: evidence.error }, null, 1))
}
