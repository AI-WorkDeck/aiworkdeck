// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// O14 真机验收：设了打开密码的 docx / xlsx / pptx 在真实桌面宿主（Electron + webview LOWA + 正常自动保存）里
//   打开 → 加载面板出现密码框 → 输错密码提示 → 输对密码进入编辑 → 编辑 → 产品正常自动保存落盘
//   → 磁盘上的文件仍是加密复合文档、用原密码（msoffcrypto-tool 独立实现）能解开且含编辑
//   → 关闭重开再次要密码 → 重开后内容含编辑 → 演示文稿的冷启动预览缓存里没有这份文件的渲染页。
// 不碰用户的生产实例：Electron/后端的 home、userData、端口全部在临时目录（同 office-interaction-latency.mjs）。
// 先构建本树的 H5、zetaoffice（含 LOWA 资源与 cjk* 字体）与后端 JAR；JAVA_HOME 指向 JDK 21。
//   OFFICE_PASSWORD_DECRYPT  msoffcrypto-tool 可执行文件（pip install msoffcrypto-tool）
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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const run = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-office-password-'))
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
const PASSWORD = 'awd-0414'
const TYPED = 'pwedit' + Date.now().toString(36)
const fixtures = path.join(root, 'frontend/tests/lowa-e2e/fixtures/encrypted')
const decryptTool = process.env.OFFICE_PASSWORD_DECRYPT
assert.ok(decryptTool && fs.existsSync(decryptTool), 'OFFICE_PASSWORD_DECRYPT must point at msoffcrypto-tool')
const isCfb = file => fs.readFileSync(file).subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
function stripTags(xml) {
  let prev
  do { prev = xml; xml = xml.replace(/<[^>]*>/g, '') } while (xml !== prev)
  return xml
}
async function decryptedText(file, password) {
  const out = path.join(run, 'dec-' + Date.now() + path.extname(file))
  execFileSync(decryptTool, ['-p', password, file, out])
  const zip = await JSZip.loadAsync(fs.readFileSync(out))
  let text = ''
  for (const n of Object.keys(zip.files).filter(n => n.endsWith('.xml'))) text += stripTags(await zip.file(n).async('string'))
  return text
}
const editor = (name, fn, ...args) => page.evaluate((expr, name, fn, args) => { const e = (0, eval)(expr)(name); return e ? (0, eval)(fn)(e, ...args) : null }, editorExpr, name, fn.toString(), args)
async function passwordBox(name) {
  await page.waitForFunction((expr, name) => (0, eval)(expr)(name)?.openFailCode === 'DOC_ENCRYPTED', { timeout: 240000, polling: 100 }, editorExpr, name)
  return until(() => page.evaluate(() => {
    const el = [...document.querySelectorAll('.libre-password-input input, input.libre-password-input')].find(i => i.getBoundingClientRect().width)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }), 30000, 200)
}
async function enterPassword(name, password) {
  const pt = await passwordBox(name)
  await page.mouse.click(pt.x, pt.y)
  await page.keyboard.type(password, { delay: 20 })
  await page.keyboard.press('Enter')
}
async function edit(name, kind) {
  const { guest } = await findGuest(name)
  if (kind === 'docx') {
    await focusOverlay(name, guest)
    await guest.keyboard.type(TYPED, { delay: 60 })
  } else if (kind === 'xlsx') {
    const vp = await guest.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    await guest.mouse.click(vp.width * 0.32, vp.height * 0.45)
    await sleep(600)
    await focusOverlay(name, guest)
    await guest.keyboard.type(TYPED, { delay: 60 })
    await guest.keyboard.press('Enter')
  } else {
    const info = await exec(name, 'slide_get_page', { slideNumber: 1 })
    const shape = info.shapes.find(s => typeof s.text === 'string' && !s.isTable)
    assert.ok(shape, 'slide 1 needs a text shape')
    await exec(name, 'slide_set_shape_text', { slideNumber: 1, shapeName: shape.name, text: TYPED })
  }
}
async function contentHasEdit(name, kind) {
  if (kind === 'pptx') return JSON.stringify((await exec(name, 'slide_get_page', { slideNumber: 1 })).shapes).includes(TYPED)
  if (kind === 'xlsx') return JSON.stringify((await exec(name, 'sheet_search', { query: TYPED }))).includes(TYPED)
  return JSON.stringify(await exec(name, 'get_document_text')).includes(TYPED)
}
const previewCacheKeys = () => page.evaluate(() => new Promise(resolve => {
  const req = indexedDB.open('awd-slide-preview', 1)
  req.onupgradeneeded = () => req.result.createObjectStore('decks')
  req.onsuccess = () => { const r = req.result.transaction('decks').objectStore('decks').getAllKeys(); r.onsuccess = () => resolve(r.result.length); r.onerror = () => resolve(-1) }
  req.onerror = () => resolve(-1)
}))

async function checkFile(src) {
  const kind = path.extname(src).slice(1)
  const name = 'locked-' + path.basename(src)
  const file = path.join(home, 'docs', name)
  fs.copyFileSync(src, file)
  const r = { name, kind }
  evidence.files.push(r)
  await primeTree(name)
  const mtime0 = fs.statSync(file).mtimeMs
  await clickOpen(name)
  await passwordBox(name)
  r.engineSawCiphertext = await editor(name, e => e.docLoadFailed && e.openFailCode)
  await page.screenshot({ path: path.join(run, kind + '-1-prompt.png') })
  await enterPassword(name, 'wrong-password')
  await page.waitForFunction((expr, name) => (0, eval)(expr)(name)?.passwordState === 'wrong', { timeout: 60000, polling: 100 }, editorExpr, name)
  r.wrongPasswordCleared = await until(() => page.evaluate(() => {
    const el = [...document.querySelectorAll('.libre-password-input input, input.libre-password-input')].find(i => i.getBoundingClientRect().width)
    return el && el.value === '' && document.activeElement === el
  }), 5000, 100).then(() => true).catch(() => false)
  r.wrongPasswordShown = await page.evaluate(() => [...document.querySelectorAll('.libre-password-error')].some(e => e.getBoundingClientRect().width))
  await page.screenshot({ path: path.join(run, kind + '-2-wrong.png') })
  const t0 = Date.now()
  await enterPassword(name, PASSWORD)
  await page.waitForFunction((expr, name) => { const e = (0, eval)(expr)(name); return e && e.ready && e.statusKey === 'ready' && !e.docLoadFailed }, { timeout: 240000, polling: 100 }, editorExpr, name)
  r.openAfterPasswordMs = Date.now() - t0
  await sleep(2500)
  await page.screenshot({ path: path.join(run, kind + '-3-open.png') })
  await dismissLogin()
  await edit(name, kind)
  r.editVisible = await until(() => contentHasEdit(name, kind), 20000, 500).then(() => true).catch(() => false)
  // 产品自己的自动保存：不调 saveDocument，只等磁盘变化
  r.autosaveLanded = await until(() => fs.statSync(file).mtimeMs > mtime0, 120000, 300).then(() => true).catch(() => false)
  await until(() => editor(name, e => !e.saving && !e.dirty), 60000, 300).catch(() => {})
  r.diskStillEncrypted = isCfb(file)
  r.diskDecryptsWithPassword = await decryptedText(file, PASSWORD).then(t => t.includes(TYPED)).catch(e => 'error: ' + e.message)
  r.diskRejectsWrongPassword = await decryptedText(file, 'wrong-password').then(() => false).catch(() => true)
  await close(name)
  // 重开：新实例不带密钥，必须再次要密码；输入后内容含编辑
  await primeTree(name)
  await clickOpen(name)
  await passwordBox(name)
  r.reopenAsksPassword = true
  await enterPassword(name, PASSWORD)
  await page.waitForFunction((expr, name) => { const e = (0, eval)(expr)(name); return e && e.ready && e.statusKey === 'ready' && !e.docLoadFailed }, { timeout: 240000, polling: 100 }, editorExpr, name)
  await sleep(1500)
  r.reopenHasEdit = await until(() => contentHasEdit(name, kind), 20000, 500).then(() => true).catch(() => false)
  await page.screenshot({ path: path.join(run, kind + '-4-reopen.png') })
  await sleep(6000) // 预览抓取在就绪后约 4s 排队；给它机会（应被拦下）
  r.slidePreviewCacheEntries = await previewCacheKeys()
  await close(name)
  log(name, JSON.stringify(r))
  r.passed = r.engineSawCiphertext === 'DOC_ENCRYPTED' && r.wrongPasswordShown && r.wrongPasswordCleared && r.editVisible && r.autosaveLanded &&
    r.diskStillEncrypted && r.diskDecryptsWithPassword === true && r.diskRejectsWrongPassword && r.reopenAsksPassword && r.reopenHasEdit &&
    r.slidePreviewCacheEntries === 0
  return r
}

try {
  await until(async () => (await fetch(base + '/api/admin/wizard')).ok, 120000, 500)
  const dir = path.join(home, 'docs'); fs.mkdirSync(dir)
  for (const key of profileDirs) fs.mkdirSync(path.join(run, 'seed-' + key), { recursive: true })
  for (const f of ['flexmark-table.docx', 'case-ledger.xlsx', 'case-report.pptx']) fs.copyFileSync(path.join(fixtures, f), path.join(dir, 'locked-' + f))
  evidence.runtime = (await start('warmup')).versions
  await openFolder(dir)
  for (const f of ['flexmark-table.docx', 'case-ledger.xlsx', 'case-report.pptx']) {
    try { await checkFile(path.join(fixtures, f)) } catch (error) {
      evidence.files.push({ name: f, error: error.stack })
      log(f, 'failed', error.message)
      await page.screenshot({ path: path.join(run, 'failure-' + f + '.png') }).catch(() => {})
    }
  }
  evidence.passed = evidence.files.length === 3 && evidence.files.every(r => r.passed)
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
