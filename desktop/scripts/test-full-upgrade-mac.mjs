// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Disposable GitHub macOS runner only. Genuine signed bundles and native Squirrel;
// the ephemeral manifest signer is a fixture, NOT production feed trust evidence.
// This verifies installation/data persistence, NOT live AI or LOWA recovery.
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
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
const versions = { baseline: '0.65.0', candidate: '0.66.0' }
const ports = { api: 19566, renderer: 19567, inspector: 19569 }
const evidence = { result: 'FAIL', productionManifestTrustTested: false, liveAiRecoveryTested: false, assertions: [] }
const out = path.resolve('evidence/mac-upgrade')
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
  const encoded = await main(`(async()=>{const w=process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>w.isVisible());if(!w)throw Error('No visible native window');return (await w.webContents.capturePage()).toPNG().toString('base64')})()`)
  fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(encoded, 'base64'))
}

assert(process.platform === 'darwin' && process.arch === 'arm64' && process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted' && process.env.RUNNER_TEMP && process.env.GITHUB_REPOSITORY === 'AI-WorkDeck/aiworkdeck', 'Requires a disposable ARM64 GitHub-hosted Mac runner; never run in a user profile')
fs.mkdirSync(out, { recursive: true })
const root = fs.realpathSync(fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, 'awd-native-upgrade-')))
const dataDir = path.join(os.homedir(), '.aiworkdeck')
const shipDir = path.join(os.homedir(), 'Library/Caches', `${bundleId}.ShipIt`)
const app = path.join(root, 'apps/AI WorkDeck.app')
let child, feed
let launchIndex = 0
const mounts = new Set()
async function ready(version) {
  const jar = fs.statSync(path.join(app, 'Contents/Resources/backend/app.jar'))
  await until(async () => (await api('/admin/wizard')).build === `${jar.size}-${Math.round(jar.mtimeMs)}`, 'bundled backend JAR identity', 240)
  await until(() => renderer('!!window.checkbaDesktop?.update && !!document.querySelector(".page-project-overview") && document.readyState === "complete"'), 'installed workbench renderer', 180)
  check((await renderer('window.checkbaDesktop.update.status()')).appVersion === version, `Running shell version ${version}`)
  const identity = await main(`({pid:process.pid,execPath:process.execPath,version:process.mainModule.require('electron').app.getVersion(),visible:process.mainModule.require('electron').BrowserWindow.getAllWindows().some(w=>w.isVisible())})`)
  check(identity.pid === child.pid && identity.execPath === path.join(app, 'Contents/MacOS/AI WorkDeck') && identity.version === version && identity.visible, 'Running app identity and visible native window')
  save(`launch-${launchIndex}-identity.json`, identity)
}
function launch(config) {
  const log = fs.openSync(path.join(out, `launch-${++launchIndex}.log`), 'w')
  const env = { PATH: process.env.PATH, HOME: os.homedir(), TMPDIR: process.env.TMPDIR, LANG: 'en_US.UTF-8', CHECKBA_BACKEND_PORT: String(ports.api), ...config.env }
  child = spawn(path.join(app, 'Contents/MacOS/AI WorkDeck'), [`--remote-debugging-port=${ports.renderer}`, `--inspect=127.0.0.1:${ports.inspector}`], { env, stdio: ['ignore', log, log] })
  fs.closeSync(log)
}
async function quit() {
  const current = child
  check(await main("setTimeout(()=>process.mainModule.require('electron').app.quit(), 250); true"), 'Requested ordinary app.quit through real lifecycle')
  await until(() => current.exitCode !== null || current.signalCode !== null, 'normal app exit', 120)
  check(current.exitCode === 0 && current.signalCode === null, 'Ordinary quit exits zero without signal')
}
async function mounted(dmg, label) {
  const dir = path.join(root, `${label}-mount`); fs.mkdirSync(dir)
  run('/usr/bin/hdiutil', ['attach', dmg, '-readonly', '-nobrowse', '-mountpoint', dir], { timeout: 180000 }); mounts.add(dir)
  const apps = fs.readdirSync(dir).filter(name => name.endsWith('.app'))
  check(apps.length === 1, `${label}: one app in readonly DMG`)
  return { dir, app: path.join(dir, apps[0]) }
}
function detach(dir) { run('/usr/bin/hdiutil', ['detach', dir]); mounts.delete(dir) }

try {
  check(!exists(dataDir) && !exists(shipDir) && !exists(path.join(os.homedir(), 'Library/Caches', bundleId)), 'Clean disposable account has no prior app/ShipIt data')
  check(!exists('/Applications/AI WorkDeck.app'), 'No production app installed')
  check(!run('/bin/ps', ['-axo', 'command=']).split('\n').some(line => line.includes('/AI WorkDeck.app/Contents/MacOS/')), 'No same-bundle app already running')
  run('/bin/launchctl', ['print', `gui/${process.getuid()}`])
  save('gui-session.json', { uid: process.getuid(), guiDomainAvailable: true })
  const existingJob = spawnSync('/bin/launchctl', ['print', `gui/${process.getuid()}/${bundleId}.ShipIt`], { encoding: 'utf8' })
  check(existingJob.status !== 0, 'No preexisting ShipIt user job')
  const baseline = await downloadBuild('baseline', root)
  const candidate = await downloadBuild('candidate', root)
  const old = await mounted(baseline, 'baseline')
  signature(old.app, versions.baseline, 'baseline')
  fs.mkdirSync(path.dirname(app))
  run('/usr/bin/ditto', [old.app, app], { timeout: 180000 }); detach(old.dir)
  const newer = await mounted(candidate, 'candidate')
  signature(newer.app, versions.candidate, 'candidate')
  const candidateAsar = await hash(path.join(newer.app, 'Contents/Resources/app.asar'))
  const candidateJar = await hash(path.join(newer.app, 'Contents/Resources/backend/app.jar'))
  detach(newer.dir)
  const fixtureDir = path.join(root, 'feed')
  const feedLog = fs.openSync(path.join(out, 'feed.log'), 'w')
  feed = spawn(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'test-full-upgrade-mac-feed.mjs'), '--dmg', candidate, '--sha256', evidence.candidate.sha256, '--out', fixtureDir], { stdio: ['ignore', feedLog, feedLog] })
  fs.closeSync(feedLog)
  const config = await until(() => exists(path.join(fixtureDir, 'config.json')) && JSON.parse(fs.readFileSync(path.join(fixtureDir, 'config.json'))), 'test feed ready', 90)
  save('fixture-feed.json', config)
  launch(config); await ready(versions.baseline); await screenshot('01-baseline')
  const marker = `MAC_UPGRADE_${randomUUID()}`
  const projectDir = path.join(root, 'synthetic-project'); fs.mkdirSync(projectDir)
  const document = path.join(projectDir, 'retained-document.txt'); fs.writeFileSync(document, marker)
  const project = (await api('/projects/open-local', { localRoot: projectDir, name: marker })).data
  check(project.projectId > 0, 'Baseline creates a persisted synthetic project through backend API')
  const files = await api(`/projects/${project.projectId}/files`)
  const file = files.find(f => f.name === path.basename(document))
  check(!!file?.id, 'Baseline indexes synthetic document')
  const documentHash = await hash(document)
  check(await renderer(`localStorage.setItem('awd-upgrade-fixture',${JSON.stringify(marker)});localStorage.getItem('awd-upgrade-fixture')`) === marker, 'Baseline persists renderer preference')
  evidence.project = { projectId: project.projectId, fileId: file.id, marker, documentHash }
  const state = await renderer('window.checkbaDesktop.update.check()', 12 * 60 * 1000)
  save('prepared-update.json', state)
  check(state.phase === 'ready' && state.available?.kind === 'installer' && state.available.version === versions.candidate, 'Real baseline updater downloaded, verified and natively prepared candidate')
  const shipStateFile = path.join(shipDir, 'ShipItState.plist')
  const shipState = JSON.parse(fs.readFileSync(shipStateFile, 'utf8'))
  save('ShipItState-before-quit.json', shipState)
  check(fs.realpathSync(fileURLToPath(shipState.targetBundleURL)) === app && shipState.launchAfterInstallation === false, 'Native ShipIt targets test app and disables automatic relaunch')
  save('ShipIt-user-job.txt', run('/bin/launchctl', ['print', `gui/${process.getuid()}/${bundleId}.ShipIt`]))
  check(plist(app, 'CFBundleShortVersionString') === versions.baseline, 'ShipIt waits while baseline runs')
  await screenshot('02-native-update-ready')
  await quit()
  const installation = await until(async () => {
    const log = path.join(shipDir, 'ShipIt_stderr.log')
    const diagnostics = exists(log) ? fs.readFileSync(log, 'utf8') : ''
    if (diagnostics.includes('Too many attempts to install, aborting update')) return { error: diagnostics }
    if (exists(path.join(app, 'Contents/Resources/app.asar')) && plist(app, 'CFBundleShortVersionString') === versions.candidate && await hash(path.join(app, 'Contents/Resources/app.asar')) === candidateAsar && await hash(path.join(app, 'Contents/Resources/backend/app.jar')) === candidateJar) return { ok: true }
    return false
  }, 'ShipIt installs exact candidate bundle', 600)
  check(installation.ok, `ShipIt installed candidate${installation.error ? ': ' + installation.error : ''}`)
  signature(app, versions.candidate, 'installed')
  await sleep(4000)
  check(!run('/bin/ps', ['-axo', 'command=']).split('\n').some(line => line.includes(`${app}/Contents/MacOS/`)), 'Ordinary quit installed candidate without relaunch')
  launch(config); await ready(versions.candidate)
  const projects = await api('/projects/my')
  check(projects.some(p => p.id === project.projectId && p.name === marker), 'Reopened backend preserves project ID and name')
  const afterFiles = await api(`/projects/${project.projectId}/files`)
  check(afterFiles.some(f => f.id === file.id && f.name === file.name), 'Reopened backend preserves document ID and name')
  check(await hash(document) === documentHash, 'Document bytes survive native upgrade')
  check(await renderer("localStorage.getItem('awd-upgrade-fixture')") === marker, 'Renderer preference survives upgrade and manual reopen')
  await screenshot('03-candidate-reopened')
  await quit()
  evidence.result = 'PASS'
} catch (error) {
  evidence.error = error.stack
  console.error(error)
  process.exitCode = 1
} finally {
  // Evidence first; only this disposable runner and owned child are eligible for cleanup.
  evidence.diagnosticErrors = []
  if (evidence.result !== 'PASS') { try { await screenshot('failure') } catch (error) { evidence.diagnosticErrors.push(error.message) } }
  for (const [label, dir] of [['shipit', shipDir], ['desktop', path.join(dataDir, 'logs')]]) {
    try {
      if (exists(dir)) for (const name of fs.readdirSync(dir)) {
        const file = path.join(dir, name)
        if (fs.statSync(file).isFile() && /\.(log|plist)$/.test(name)) fs.copyFileSync(file, path.join(out, `${label}-${name}`))
      }
    } catch (error) { evidence.diagnosticErrors.push(error.message) }
  }
  try { save('processes.txt', run('/bin/ps', ['-axo', 'pid,ppid,command'])) } catch (error) { evidence.diagnosticErrors.push(error.message) }
  save('result.json', evidence)
  if (child?.exitCode === null && child.signalCode === null) {
    try { await quit() } catch { child.kill('SIGTERM') }
  }
  if (feed?.exitCode === null) feed.kill('SIGTERM')
  for (const dir of mounts) { try { detach(dir) } catch { /* preserve original failure */ } }
}
