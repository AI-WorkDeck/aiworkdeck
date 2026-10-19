// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Real signed Mac product -> Quartz mouse -> separate AppKit file receiver.
// Renderer evaluation is read-only; no DOM click, AX action, startDrag or mocked IPC.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const run = (file, args = [], options = {}) => execFileSync(file, args, { encoding: 'utf8', timeout: 120000, ...options }).trim()
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const exists = fs.existsSync
const bundleId = 'com.aiworkdeck.desktop'
const expectedTeam = '8WKHZVR2W8'
const versions = { candidate: '0.66.0' }
const ports = { api: 19566, renderer: 19567, inspector: 19569 }
const evidence = { result: 'FAIL', assertions: [], gestures: [], clicks: [], diagnosticErrors: [] }
const out = path.resolve('evidence/mac-native-drag')
const save = (name, data) => fs.writeFileSync(path.join(out, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n')
function check(value, label) { assert(value, label); evidence.assertions.push(label); console.log(`PASS: ${label}`) }
async function hash(file) { const h = createHash('sha256'); for await (const b of fs.createReadStream(file)) h.update(b); return h.digest('hex') }
async function until(fn, label, seconds = 180) {
  const end = Date.now() + seconds * 1000
  let last
  while (Date.now() < end) {
    try { const result = await fn(); if (result) return result } catch (error) { last = error.message }
    await sleep(500)
  }
  throw Error(`Timed out: ${label}${last ? ` (${last})` : ''}`)
}
const plist = (app, key) => run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', path.join(app, 'Contents/Info.plist')])
function signature(app, version, label) {
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])
  // codesign writes its identity report to stderr.
  const report = spawnSyncReport('/usr/bin/codesign', ['-dv', '--verbose=4', app])
  save(`${label}-codesign.txt`, report)
  check(report.includes(`TeamIdentifier=${expectedTeam}`) && report.includes('Authority=Developer ID Application: Beijing Jingwei Zi Yi Technology Co Ltd'), `${label}: expected Developer ID publisher`)
  check(plist(app, 'CFBundleIdentifier') === bundleId && plist(app, 'CFBundleShortVersionString') === version, `${label}: bundle identity/version`)
  const assessment = spawnSyncReport('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', app])
  save(`${label}-gatekeeper.txt`, assessment)
  check(assessment.includes('accepted') && assessment.includes('Notarized Developer ID'), `${label}: Gatekeeper accepts notarized app`)
}
function spawnSyncReport(command, args) {
  // Keep stdout and stderr together without a shell or interpolated command text.
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120000 })
  const text = (result.stdout || '') + (result.stderr || '')
  if (result.status !== 0) throw Error(`${command} failed: ${text}`)
  return text
}
async function downloadBuild(kind, root) {
  const id = process.env[`${kind.toUpperCase()}_RUN`]
  const sha = process.env[`${kind.toUpperCase()}_SHA`]
  assert(/^\d+$/.test(id || '') && /^[a-f\d]{40}$/.test(sha || ''), `Invalid ${kind} build inputs`)
  const repo = process.env.GITHUB_REPOSITORY
  const build = JSON.parse(run('gh', ['api', `repos/${repo}/actions/runs/${id}`]))
  check(build.repository.full_name === repo && build.path === '.github/workflows/desktop-build.yml' && build.event === 'workflow_dispatch' && build.conclusion === 'success' && build.head_sha === sha, `${kind}: successful official build from pinned source`)
  save(`${kind}-build.json`, Object.fromEntries(['id', 'head_sha', 'head_branch', 'path', 'event', 'conclusion', 'html_url'].map(key => [key, build[key]])))
  const artifacts = JSON.parse(run('gh', ['api', `repos/${repo}/actions/runs/${id}/artifacts`])).artifacts.filter(a => a.name === 'aiworkdeck-macos-latest' && !a.expired)
  check(artifacts.length === 1, `${kind}: exactly one live Mac artifact`)
  save(`${kind}-artifact.json`, { id: artifacts[0].id, name: artifacts[0].name, digest: artifacts[0].digest, size: artifacts[0].size_in_bytes })
  const dir = path.join(root, kind)
  run('gh', ['run', 'download', id, '--repo', repo, '--name', artifacts[0].name, '--dir', dir], { timeout: 600000 })
  const files = fs.readdirSync(dir).filter(name => name.endsWith('.dmg'))
  check(files.length === 1, `${kind}: exactly one DMG`)
  const dmg = path.join(dir, files[0])
  evidence[kind] = { dmgName: files[0], sha256: await hash(dmg), size: fs.statSync(dmg).size }
  return dmg
}

async function rpc(port, expression, main = false, timeout = 30000) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) })).json()
  const target = main ? targets.find(t => t.type === 'node') : targets.find(t => t.type === 'page' && /index\.html/.test(t.url))
  assert(target, main ? 'Main inspector unavailable' : 'Installed workbench renderer unavailable')
  const url = new URL(target.webSocketDebuggerUrl)
  assert(url.hostname === '127.0.0.1' && Number(url.port) === port, 'Foreign debugger target')
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const timer = setTimeout(() => { ws.close(); reject(Error('Debugger request timed out')) }, timeout)
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
    ws.onmessage = event => {
      const response = JSON.parse(event.data)
      if (response.id !== 1) return
      clearTimeout(timer); ws.close()
      if (response.error || response.result.exceptionDetails) reject(Error(JSON.stringify(response)))
      else resolve(response.result.result.value)
    }
    ws.onerror = () => { clearTimeout(timer); reject(Error('Debugger socket failed')) }
  })
}
const renderer = (expression, timeout) => rpc(ports.renderer, expression, false, timeout)
const main = expression => rpc(ports.inspector, expression, true)
async function api(route, body) {
  const response = await fetch(`http://127.0.0.1:${ports.api}/api${route}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000)
  })
  assert(response.ok, `HTTP ${response.status}: ${route}`)
  return response.json()
}
async function screenshot(name) {
  const full = spawnSync('/usr/sbin/screencapture', ['-x', path.join(out, `${name}-desktop.png`)], { encoding: 'utf8', timeout: 15000 });
  if (full.status !== 0) save(`${name}-desktop-error.txt`, full.stderr || 'capture failed');
  const encoded = await main(`(async()=>{const w=process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>w.isVisible());if(!w)throw Error('No visible native window');return (await w.webContents.capturePage()).toPNG().toString('base64')})()`)
  fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(encoded, 'base64'))
}

assert(process.platform === 'darwin' && process.arch === 'arm64' && process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted' && process.env.RUNNER_TEMP && process.env.GITHUB_REPOSITORY === 'AI-WorkDeck/aiworkdeck', 'Requires disposable ARM64 GitHub-hosted GUI runner; never a user profile')
assert(process.env.CANDIDATE_RUN === '39222690909' && process.env.CANDIDATE_SHA === '11516bc1aa8b43f99b29bf6515a90f7ecdd78ced', 'This acceptance pins the final signed candidate')
fs.mkdirSync(out, { recursive: true })
const root = fs.realpathSync(fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, 'awd-mac-native-drag-')))
const dataDir = path.join(os.homedir(), '.aiworkdeck')
const app = path.join(root, 'apps/AI WorkDeck.app')
const helper = path.join(root, 'native-drag-receiver')
const fixtureDir = path.join(root, 'Native drag fixture')
const zipDir = path.join(root, 'zip-source')
const mounts = new Set()
let child, receiver
let clickSequence = 0
const alive = p => p && p.exitCode === null && p.signalCode === null
const read = name => JSON.parse(fs.readFileSync(path.join(out, name), 'utf8'))
function start(file, args, name, env = process.env) {
  const log = fs.openSync(path.join(out, `${name}.log`), 'w')
  const p = spawn(file, args, { env, stdio: ['ignore', log, log] }); fs.closeSync(log); return p
}
async function element(selector) {
  return renderer(`(() => {const el=document.querySelector(${JSON.stringify(selector)}); if(!el)return null;const r=el.getBoundingClientRect();const x=r.x+Math.min(90,r.width/2),y=r.y+r.height/2;return {x,y,width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight,dpr:devicePixelRatio,domHit:el.contains(document.elementFromPoint(x,y))};})()`)
}
async function point(selector) {
  const e = await element(selector)
  check(e && e.width > 0 && e.height > 0 && e.x >= 0 && e.y >= 0 && e.x < e.viewportWidth && e.y < e.viewportHeight && e.domHit, `Visible unobscured DOM target: ${selector}`)
  const b = await main("process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>w.isVisible()).getContentBounds()")
  // Electron content bounds are screen DIP/points, as are CSS pixels at the default zoom.
  const zoom = await main("process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>w.isVisible()).webContents.getZoomFactor()")
  check(zoom === 1 && Math.abs(b.width - e.viewportWidth) < 2 && Math.abs(b.height - e.viewportHeight) < 2, 'DOM viewport and native content bounds have unit point mapping')
  return { x: b.x + e.x, y: b.y + e.y, bounds: b, element: e }
}
async function click(selector) {
  const p = await point(selector), label = `click-${++clickSequence}`
  const cfg = { action: 'click', label, sourcePid: child.pid, source: { x: p.x, y: p.y } }
  run(helper, ['mouse', out, JSON.stringify(cfg)])
  evidence.clicks.push({ selector, label, ...p })
}
async function recovered(fileId, label) {
  const selector = `.tree-item[data-file-id='${fileId}']`
  await click(selector)
  await until(() => renderer(`!!document.querySelector(${JSON.stringify(selector)})?.classList.contains('tree-item-selected')`), `${label}: real click changes tree selection`, 20)
  await until(() => renderer("[...document.querySelectorAll('.tab-item.active .tab-name')].some(e=>e.textContent==='after-drag.txt')"), `${label}: real click opens recovery file`, 20)
  await click('.tab-item.active .tab-close')
  await until(() => renderer("![...document.querySelectorAll('.tab-name')].some(e=>e.textContent==='after-drag.txt')"), `${label}: real click closes recovery tab`, 20)
  check(true, `${label}: actual coordinate file-row and close-button clicks work`)
}
async function drag(selector, sequence, expectedFile) {
  const p = await point(selector), dest = read('receiver-ready.json'), label = `drag-${sequence}`
  check(dest.pid === receiver.pid && dest.pid !== child.pid, 'Receiver is a separate owned AppKit process')
  run(helper, ['mouse', out, JSON.stringify({ action: 'drag', label, sourcePid: child.pid, source: { x: p.x, y: p.y }, destinationPid: receiver.pid, destination: { x: dest.x, y: dest.y } })])
  const receipt = await until(() => exists(path.join(out, `received-${sequence}.json`)) && read(`received-${sequence}.json`), `${label}: actual native fileURL receipt`, 30)
  const expectedHash = await hash(expectedFile)
  check(receipt.nativeFileURLs === true && receipt.pid === receiver.pid && receipt.name === path.basename(expectedFile), `${label}: native receiver obtained expected file name`)
  check(receipt.sha256 === expectedHash && await hash(receipt.copy) === expectedHash, `${label}: copied bytes match original fixture`)
  await sleep(700)
  check(await hash(receipt.source) === expectedHash, `${label}: delayed source read still yields correct bytes`)
  evidence.gestures.push({ sequence, selector, source: p, destination: dest, receipt, expectedHash })
  await screenshot(`${label}-received`)
}
async function quit() {
  if (!alive(child)) return
  await main("setTimeout(()=>process.mainModule.require('electron').app.quit(),250);true")
  await until(() => !alive(child), 'owned client normal quit', 60)
}
try {
  check(!exists(dataDir) && !exists('/Applications/AI WorkDeck.app'), 'Clean runner has no existing app or profile')
  check(!run('/bin/ps', ['-axo', 'command=']).split('\n').some(l => l.includes('/AI WorkDeck.app/Contents/MacOS/')), 'No same-product process already running')
  save('gui-session.txt', run('/bin/launchctl', ['print', `gui/${process.getuid()}`]))
  run('swiftc', [path.join(path.dirname(fileURLToPath(import.meta.url)), 'native-drag-mac-receiver.swift'), '-o', helper, '-framework', 'AppKit', '-framework', 'ApplicationServices', '-framework', 'CryptoKit'])
  run(helper, ['permissions', out])
  check(read('permissions.json').postEventAccess === true, 'CGEvent posting permission actually granted; no prompt/TCC change')
  const dmg = await downloadBuild('candidate', root)
  const mount = path.join(root, 'candidate-mount'); fs.mkdirSync(mount)
  run('/usr/bin/hdiutil', ['attach', dmg, '-readonly', '-nobrowse', '-mountpoint', mount], { timeout: 180000 }); mounts.add(mount)
  const apps = fs.readdirSync(mount).filter(n => n.endsWith('.app')); check(apps.length === 1, 'Exactly one app in signed candidate DMG')
  const mounted = path.join(mount, apps[0]); signature(mounted, versions.candidate, 'mounted')
  fs.mkdirSync(path.dirname(app)); run('/usr/bin/ditto', [mounted, app], { timeout: 180000 })
  run('/usr/bin/hdiutil', ['detach', mount]); mounts.delete(mount); signature(app, versions.candidate, 'installed')
  evidence.appAsarSha256 = await hash(path.join(app, 'Contents/Resources/app.asar'))
  evidence.backendJarSha256 = await hash(path.join(app, 'Contents/Resources/backend/app.jar'))
  fs.mkdirSync(fixtureDir); fs.mkdirSync(zipDir)
  const ordinary = path.join(fixtureDir, 'ordinary-drag.txt'), archiveEntry = path.join(zipDir, 'archive-entry.txt')
  fs.writeFileSync(ordinary, 'ORDINARY_NATIVE_DROP_1367'); fs.writeFileSync(archiveEntry, 'ARCHIVE_NATIVE_DROP_1367')
  fs.writeFileSync(path.join(fixtureDir, 'after-drag.txt'), 'POST_DRAG_CLICK_1367')
  run('/usr/bin/zip', ['-j', path.join(fixtureDir, 'drag-fixture.zip'), archiveEntry])
  child = start(path.join(app, 'Contents/MacOS/AI WorkDeck'), [`--remote-debugging-port=${ports.renderer}`, `--inspect=127.0.0.1:${ports.inspector}`, fixtureDir], 'app', { PATH: process.env.PATH, HOME: os.homedir(), TMPDIR: process.env.TMPDIR, LANG: 'en_US.UTF-8', CHECKBA_BACKEND_PORT: String(ports.api), CHECKBA_UPDATE_MANIFEST_URL: 'http://127.0.0.1:19568/no-production-updates' })
  await until(() => renderer('!!document.querySelector(".page-project-overview") && document.readyState === "complete"'), 'real signed workbench loaded', 240)
  check((await renderer('window.checkbaDesktop.update.status()')).appVersion === versions.candidate, 'Running shell exact semantic version')
  const identity = await main("({pid:process.pid,execPath:process.execPath,version:process.mainModule.require('electron').app.getVersion(),home:process.mainModule.require('electron').app.getPath('home'),userData:process.mainModule.require('electron').app.getPath('userData')})")
  check(identity.pid === child.pid && identity.execPath === path.join(app, 'Contents/MacOS/AI WorkDeck') && identity.version === versions.candidate, 'Running signed app identity matches owned candidate')
  save('running-identity.json', identity)
  const jar = fs.statSync(path.join(app, 'Contents/Resources/backend/app.jar'))
  await until(async () => (await api('/admin/wizard')).build === `${jar.size}-${Math.round(jar.mtimeMs)}`, 'backend belongs to candidate JAR', 240)
  const project = await until(async () => (await api('/projects/my')).find(p => p.name === 'Native drag fixture'), 'real launch folder request opens project', 120)
  const files = await api(`/projects/${project.id}/files`)
  const file = name => files.find(f => f.name === name)
  const ordinaryId = file('ordinary-drag.txt')?.id, archiveId = file('drag-fixture.zip')?.id, recoveryId = file('after-drag.txt')?.id
  check(ordinaryId > 0 && archiveId > 0 && recoveryId > 0, 'Backend indexed all synthetic fixtures')
  evidence.project = { id: project.id, ordinaryId, archiveId, recoveryId }
  await until(() => element(`.tree-item[data-file-id='${ordinaryId}']`), 'visible project file tree', 60)
  if (await element('.ocd-mask')) {
    await screenshot('optional-components-prompt'); await click('.ocd-actions .ocd-btn:not(.primary)')
    await until(async () => !(await element('.ocd-mask')), 'real Later click dismisses optional components prompt', 20)
  }
  // Open the ordinary file through the same coordinate path that is checked after dragging.
  await click(`.tree-item[data-file-id='${ordinaryId}']`)
  await until(() => renderer("[...document.querySelectorAll('.tab-item.active .tab-name')].some(e=>e.textContent==='ordinary-drag.txt')"), 'real ordinary-file click opens tab', 30)
  receiver = start(helper, ['receiver', out], 'receiver')
  await until(() => exists(path.join(out, 'receiver-ready.json')), 'independent native receiver ready', 20)
  await screenshot('01-ready')
  await drag(`.tree-item[data-file-id='${ordinaryId}']`, 1, ordinary)
  await recovered(recoveryId, 'after ordinary drag')
  await click(`.tree-item[data-file-id='${archiveId}']`)
  await until(() => element('.archive-entry-row'), 'real archive click opens preview', 60)
  await click('.archive-entry-row')
  await until(() => renderer('!!document.querySelector(".archive-drag-hint") && !document.querySelector(".archive-entry-preview [role=alert]")'), 'archive byte preview is ready', 30)
  await sleep(1500) // Product cache write completes normally after preview; no prewarming API.
  await screenshot('02-archive-ready')
  await drag('.archive-entry-row', 2, archiveEntry)
  await recovered(recoveryId, 'after archive drag')
  await screenshot('03-input-recovered')
  await quit(); check(child.exitCode === 0 && child.signalCode === null, 'Owned candidate exits normally')
  evidence.result = 'PASS'
} catch (error) {
  evidence.error = error.stack; console.error(error); process.exitCode = 1
} finally {
  if (evidence.result !== 'PASS') { try { await screenshot('failure') } catch (e) { evidence.diagnosticErrors.push(e.message) } }
  for (const name of ['logs']) {
    try { if (exists(path.join(dataDir, name))) fs.cpSync(path.join(dataDir, name), path.join(out, 'app-logs'), { recursive: true }) } catch (e) { evidence.diagnosticErrors.push(e.message) }
  }
  try { save('processes.txt', run('/bin/ps', ['-axo', 'pid,ppid,command'])) } catch (e) { evidence.diagnosticErrors.push(e.message) }
  try { await quit() } catch (e) { evidence.diagnosticErrors.push(e.message); if (alive(child)) child.kill('SIGTERM') }
  if (alive(receiver)) receiver.kill('SIGTERM')
  for (const m of mounts) { try { run('/usr/bin/hdiutil', ['detach', m]) } catch (e) { evidence.diagnosticErrors.push(e.message) } }
  save('result.json', evidence)
}
