// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Disposable hosted-runner installation only. Never patch or replace signed application files.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { downloadBuild } from '../../../desktop/scripts/download-upgrade-build.mjs'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const run = (file, args, options = {}) => execFileSync(file, args, { encoding: 'utf8', timeout: 120000, ...options }).trim()
const powershell = (script, env = {}) => run('pwsh.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { env: { ...process.env, ...env }, timeout: 360000 })
const hash = async file => {
  const h = createHash('sha256')
  for await (const bytes of fs.createReadStream(file)) h.update(bytes)
  return h.digest('hex')
}
async function until(fn, label, seconds = 180) {
  const end = Date.now() + seconds * 1000
  let last
  while (Date.now() < end) {
    try { const result = await fn(); if (result) return result } catch (error) { last = error.message }
    await sleep(250)
  }
  throw new Error(`Timed out: ${label}${last ? ': ' + last : ''}`)
}
async function assertPortFree(port) {
  assert(Number.isSafeInteger(port) && port > 1024 && port < 65536, 'Invalid test port')
  await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => server.close(resolve))
  })
}
function processList() {
  return process.platform === 'darwin' ? run('/bin/ps', ['-axo', 'pid,ppid,command']) : powershell("Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Depth 3")
}
async function rpc(port, expression, main, timeout = 30000) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) })).json()
  const target = targets.find(t => main ? t.type === 'node' : t.type === 'page' && /index\.html/.test(t.url))
  assert(target, main ? 'Installed main inspector unavailable' : 'Installed renderer unavailable')
  const url = new URL(target.webSocketDebuggerUrl)
  assert(url.hostname === '127.0.0.1' && Number(url.port) === port, 'Foreign debugger endpoint')
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true; clearTimeout(timer); ws.close()
      if (error) reject(error); else resolve(value)
    }
    const timer = setTimeout(() => finish(new Error('Debugger request timed out')), timeout)
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
    ws.onmessage = event => {
      const response = JSON.parse(event.data)
      if (response.id !== 1) return
      if (response.error || response.result?.exceptionDetails) finish(new Error(JSON.stringify(response)))
      else finish(null, response.result.result.value)
    }
    ws.onerror = () => finish(new Error('Debugger socket failed'))
    ws.onclose = () => finish(new Error('Debugger closed before reply'))
  })
}

export async function launchInstalledElectron({ outDir, backendPort = 19566, cdpPort = 19567, inspectorPort = 19569 }) {
  const mac = process.platform === 'darwin'
  assert(process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted' &&
    process.env.GITHUB_REPOSITORY === 'AI-WorkDeck/aiworkdeck' && process.env.RUNNER_TEMP &&
    ((mac && process.arch === 'arm64' && process.env.RUNNER_OS === 'macOS') ||
      (process.platform === 'win32' && process.arch === 'x64' && process.env.RUNNER_OS === 'Windows')),
  'Requires a disposable matching GitHub-hosted Windows x64 / macOS ARM64 runner')
  const temp = fs.realpathSync(process.env.RUNNER_TEMP)
  fs.mkdirSync(outDir, { recursive: true })
  outDir = fs.realpathSync(outDir)
  const relative = path.relative(temp, outDir)
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Evidence/install root must be inside RUNNER_TEMP')
  assert.equal(new Set([backendPort, cdpPort, inspectorPort]).size, 3, 'Test ports must differ')
  const ports = { api: backendPort, renderer: cdpPort, inspector: inspectorPort }
  const home = os.homedir()
  const dataDir = path.join(home, '.aiworkdeck')
  assert(!fs.existsSync(dataDir), 'Refusing preexisting application data')
  const chromeProfile = mac ? path.join(home, 'Library/Application Support/AI WorkDeck') : path.join(process.env.APPDATA, 'AI WorkDeck')
  assert(!fs.existsSync(chromeProfile), 'Refusing preexisting Chromium profile')
  const initialProcesses = processList()
  assert(mac ? !initialProcesses.includes('/AI WorkDeck.app/Contents/MacOS/') : !/"Name"\s*:\s*"AI WorkDeck.exe"/i.test(initialProcesses), 'Another installed app is running')
  if (mac) {
    assert(!fs.existsSync('/Applications/AI WorkDeck.app'), 'Refusing existing installed application')
    run('/bin/launchctl', ['print', `gui/${process.getuid()}`])
  }
  const root = fs.mkdtempSync(path.join(outDir, 'installed-'))
  const app = path.join(root, mac ? 'AI WorkDeck.app' : 'AI WorkDeck')
  const executable = path.join(app, mac ? 'Contents/MacOS/AI WorkDeck' : 'AI WorkDeck.exe')
  const resourcesPath = path.join(app, mac ? 'Contents/Resources' : 'resources')
  const provenance = { root, outDir, home, dataDir, ports, assertions: [], launches: [], forced: false }
  const save = (name, value) => fs.writeFileSync(path.join(outDir, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2))
  let child, launchIndex = 0, mounted
  const helper = { executable, resourcesPath, home, dataDir, ports, provenance,
    get child() { return child }, identity: null,
    mainRpc: (expression, timeout) => rpc(inspectorPort, expression, true, timeout),
    rendererRpc: (expression, timeout) => rpc(cdpPort, expression, false, timeout) }
  helper.collectDiagnostics = async () => {
    const errors = []
    try { save('installed-processes.txt', processList()) } catch (error) { errors.push(error.message) }
    try {
      const dir = path.join(dataDir, 'logs')
      if (fs.existsSync(dir)) {
        const dest = path.join(outDir, 'installed-logs'); fs.mkdirSync(dest, { recursive: true })
        for (const name of fs.readdirSync(dir)) if (/\.log$/.test(name) && fs.statSync(path.join(dir, name)).isFile()) fs.copyFileSync(path.join(dir, name), path.join(dest, name))
      }
    } catch (error) { errors.push(error.message) }
    provenance.diagnosticErrors = errors
    save('installed-helper.json', provenance)
  }
  helper.quit = async () => {
    if (!child) return
    const current = child
    assert(current.exitCode === null && current.signalCode === null, 'App exited before ordinary quit')
    await helper.mainRpc("setTimeout(()=>process.mainModule.require('electron').app.quit(),250);true")
    await until(() => current.exitCode !== null || current.signalCode !== null, 'normal app exit', 120)
    assert(current.exitCode === 0 && current.signalCode === null, 'Ordinary quit must exit zero without a signal')
    await until(async () => {
      const processes = processList()
      const owned = mac ? processes.split('\n').filter(line => line.includes(app + '/')) :
        [JSON.parse(processes)].flat().filter(p => p.ExecutablePath?.toLowerCase().startsWith(app.toLowerCase() + path.sep))
      if (owned.length) return false
      for (const port of Object.values(ports)) await assertPortFree(port)
      return true
    }, 'all installed app processes exit and test ports are released', 45)
    provenance.launches[provenance.launches.length - 1].quit = { code: current.exitCode, signal: current.signalCode, ownedProcessesGone: true, portsReleased: true }
    child = null
  }
  helper.close = async () => {
    let failure
    try { await helper.quit() } catch (error) {
      failure = error; provenance.cleanupError = error.message
      if (child?.exitCode === null && child.signalCode === null) {
        provenance.forced = true
        child.kill('SIGTERM') // Failure cleanup only; never turns a failed quit into success.
      }
    }
    if (mounted) {
      try { run('/usr/bin/hdiutil', ['detach', mounted]); mounted = null } catch (error) { failure ||= error }
    }
    await helper.collectDiagnostics()
    if (failure) throw failure
  }
  helper.start = async () => {
    assert(!child, 'Previous installed app must quit before reopening')
    for (const port of Object.values(ports)) await assertPortFree(port)
    const keys = mac ? ['PATH', 'HOME', 'TMPDIR', 'LANG'] : ['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'PROCESSOR_ARCHITECTURE']
    const env = Object.fromEntries(keys.filter(key => process.env[key]).map(key => [key, process.env[key]]))
    Object.assign(env, { CHECKBA_BACKEND_PORT: String(backendPort), CHECKBA_UPDATE_MANIFEST_URL: `http://127.0.0.1:${cdpPort}/updates-disabled`, AIWORKDECK_DESKTOP_DEV: '0' })
    const log = fs.openSync(path.join(outDir, `installed-launch-${++launchIndex}.log`), 'w')
    child = spawn(executable, [`--remote-debugging-port=${cdpPort}`, `--inspect=127.0.0.1:${inspectorPort}`, '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'], { cwd: root, env, stdio: ['ignore', log, log] })
    fs.closeSync(log)
    let spawnError
    child.on('error', error => { spawnError = error })
    const identity = await until(async () => {
      if (spawnError) throw spawnError
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('Installed process exited during startup')
      return helper.mainRpc("(()=>{const e=process.mainModule.require('electron');return {pid:process.pid,execPath:process.execPath,resourcesPath:process.resourcesPath,appVersion:e.app.getVersion(),packaged:e.app.isPackaged,versions:process.versions,arch:process.arch,platform:process.platform,home:e.app.getPath('home'),userData:e.app.getPath('userData'),sandboxDisabled:e.app.commandLine.hasSwitch('no-sandbox')}})()")
    }, 'installed main process identity', 90)
    assert.equal(identity.pid, child.pid)
    assert.equal(fs.realpathSync(identity.execPath), fs.realpathSync(executable))
    assert.equal(fs.realpathSync(identity.resourcesPath), fs.realpathSync(resourcesPath))
    assert.equal(identity.appVersion, process.env.CANDIDATE_VERSION)
    assert.equal(identity.home, home)
    assert.equal(identity.platform, process.platform)
    assert.equal(identity.arch, process.arch)
    assert.equal(identity.packaged, true)
    assert.equal(identity.sandboxDisabled, false)
    assert.equal(identity.versions.electron, provenance.expectedElectron)
    helper.identity = identity
    provenance.launches.push({ ...identity })
    const jar = fs.statSync(path.join(resourcesPath, 'backend/app.jar'))
    await until(async () => {
      const response = await fetch(`http://127.0.0.1:${backendPort}/api/admin/wizard`, { signal: AbortSignal.timeout(3000) })
      const result = await response.json()
      return response.ok && typeof result.initialized === 'boolean' && result.build === `${jar.size}-${Math.round(jar.mtimeMs)}`
    }, 'installed bundled backend identity', 240)
    const javaPath = path.join(resourcesPath, 'jre/bin', mac ? 'java' : 'java.exe')
    const processes = processList()
    const bundledBackend = mac ? processes.split('\n').filter(line => line.includes(javaPath) && line.includes('com.checkba.CheckbaApplication')) :
      [JSON.parse(processes)].flat().filter(p => p.ExecutablePath?.toLowerCase() === javaPath.toLowerCase() && p.CommandLine?.includes('com.checkba.CheckbaApplication'))
    assert.equal(bundledBackend.length, 1, 'Backend must run the installed bundled JRE, without system-Java fallback')
    provenance.launches[provenance.launches.length - 1].backendProcess = bundledBackend[0]
    await until(() => helper.rendererRpc('!!window.__checkbaActiveOverviewVm && !!window.checkbaDesktop?.update && document.readyState === "complete"'), 'installed workbench', 180)
    assert.equal((await helper.rendererRpc('window.checkbaDesktop.update.status()')).appVersion, process.env.CANDIDATE_VERSION)
    assert(await helper.mainRpc("process.mainModule.require('electron').BrowserWindow.getAllWindows().some(w=>w.isVisible())"), 'Native workbench window must be visible')
    save(`installed-identity-${launchIndex}.json`, identity)
    return identity
  }
  try {
    const installer = await downloadBuild('candidate', mac ? 'darwin-arm64' : 'win32', root, outDir)
    provenance.build = JSON.parse(fs.readFileSync(path.join(outDir, 'candidate-build.json')))
    provenance.installer = { name: path.basename(installer), sha256: await hash(installer), size: fs.statSync(installer).size }
    const source = JSON.parse(run('git', ['show', `${provenance.build.head_sha}:desktop/package.json`]))
    provenance.expectedElectron = source.devDependencies.electron
    if (mac) {
      mounted = path.join(root, 'mount'); fs.mkdirSync(mounted)
      run('/usr/bin/hdiutil', ['attach', installer, '-readonly', '-nobrowse', '-mountpoint', mounted], { timeout: 180000 })
      const apps = fs.readdirSync(mounted).filter(name => name.endsWith('.app'))
      assert.equal(apps.length, 1)
      run('/usr/bin/ditto', [path.join(mounted, apps[0]), app], { timeout: 180000 })
      run('/usr/bin/hdiutil', ['detach', mounted]); mounted = null
      run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])
      // These identity commands write reports to stderr; capture both streams without a shell.
      const { spawnSync } = await import('node:child_process')
      for (const [label, command, args] of [
        ['codesign', '/usr/bin/codesign', ['-dv', '--verbose=4', app]],
        ['gatekeeper', '/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', app]],
      ]) {
        const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120000 })
        const report = (result.stdout || '') + (result.stderr || '')
        save(`installed-${label}.txt`, report)
        assert.equal(result.status, 0, report)
        assert(label === 'codesign' ? report.includes('TeamIdentifier=8WKHZVR2W8') && report.includes('Authority=Developer ID Application: Beijing Jingwei Zi Yi Technology Co Ltd') : report.includes('accepted') && report.includes('Notarized Developer ID'), 'Unexpected signing identity or notarization')
      }
      const plist = key => run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', path.join(app, 'Contents/Info.plist')])
      assert.equal(plist('CFBundleIdentifier'), 'com.aiworkdeck.desktop')
      assert.equal(plist('CFBundleShortVersionString'), process.env.CANDIDATE_VERSION)
    } else {
      const signature = file => JSON.parse(powershell(`$ErrorActionPreference='Stop'; $s=Get-AuthenticodeSignature -LiteralPath $env:AWD_TEST_FILE; if($s.Status -ne 'Valid' -or -not $s.TimeStamperCertificate -or $s.SignerCertificate.Subject -notmatch 'Zhen Shan Mei Grace Legacy US Limited'){throw 'Invalid Authenticode identity'}; @{status=[string]$s.Status;publisher=$s.SignerCertificate.Subject;thumbprint=$s.SignerCertificate.Thumbprint;timestamp=$s.TimeStamperCertificate.Subject} | ConvertTo-Json`, { AWD_TEST_FILE: file }))
      provenance.installer.signature = signature(installer)
      powershell(`$ErrorActionPreference='Stop'; $p=Start-Process -FilePath $env:AWD_TEST_INSTALLER -ArgumentList ('/S /D='+$env:AWD_TEST_INSTALLDIR) -PassThru; if(-not $p.WaitForExit(300000)){throw 'NSIS timed out'}; $p.Refresh(); if($p.ExitCode -ne 0){throw ('NSIS exit '+$p.ExitCode)}`, { AWD_TEST_INSTALLER: installer, AWD_TEST_INSTALLDIR: app })
      assert(fs.existsSync(executable), 'NSIS did not install the expected executable')
      provenance.executableSignature = signature(executable)
      const version = powershell('(Get-Item -LiteralPath $env:AWD_TEST_FILE).VersionInfo.ProductVersion', { AWD_TEST_FILE: executable })
      assert([process.env.CANDIDATE_VERSION, process.env.CANDIDATE_VERSION + '.0'].includes(version), 'Installed PE version mismatch')
    }
    for (const relativePath of ['app.asar', 'backend/app.jar', 'frontend/dist/build/h5/index.html', 'frontend/dist/zetaoffice/lowa/soffice.wasm', `jre/bin/${mac ? 'java' : 'java.exe'}`]) assert(fs.statSync(path.join(resourcesPath, relativePath)).size > 0, `Missing bundled resource: ${relativePath}`)
    provenance.appAsarSha256 = await hash(path.join(resourcesPath, 'app.asar'))
    provenance.backendJarSha256 = await hash(path.join(resourcesPath, 'backend/app.jar'))
    await helper.start()
    await helper.collectDiagnostics()
    return helper
  } catch (error) {
    provenance.error = error.stack
    try { await helper.close() } catch (cleanupError) { provenance.cleanupError = cleanupError.message }
    save('installed-helper.json', provenance)
    throw error
  }
}
