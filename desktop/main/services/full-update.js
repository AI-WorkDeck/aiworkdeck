// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const fs = require('fs')
const path = require('path')
const http = require('http')
const crypto = require('crypto')
const { promisify } = require('util')
const { execFile, spawn } = require('child_process')
const run = promisify(execFile)

// Squirrel.Mac owns signature verification, replacement and rollback. We feed it
// only an already SHA256-verified installer through an unguessable loopback URL.
async function prepareMac(file, version, updater, command = run) {
  const dir = path.dirname(file)
  const mount = fs.mkdtempSync(path.join(dir, 'mount-'))
  const zip = path.join(dir, 'update.zip')
  let mounted = false
  try {
    await command('/usr/bin/hdiutil', ['attach', file, '-readonly', '-nobrowse', '-mountpoint', mount])
    mounted = true
    const apps = fs.readdirSync(mount).filter((n) => n.endsWith('.app'))
    if (apps.length !== 1) throw new Error('安装包中必须只有一个应用')
    const source = path.join(mount, apps[0])
    const { stdout } = await command('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', path.join(source, 'Contents/Info.plist')])
    if (stdout.trim() !== version) throw new Error('安装包版本与签名清单不一致')
    await command('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', source, zip])
  } finally {
    if (mounted) await command('/usr/bin/hdiutil', ['detach', mount])
    fs.rmSync(mount, { recursive: true, force: true })
  }
  const token = crypto.randomBytes(24).toString('hex')
  const server = http.createServer((req, res) => {
    if (req.url === `/${token}/feed`) {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/${token}/update.zip`, name: version }))
    } else if (req.url === `/${token}/update.zip`) {
      res.setHeader('Content-Type', 'application/zip')
      res.setHeader('Content-Length', fs.statSync(zip).size)
      const stream = fs.createReadStream(zip)
      stream.on('error', () => res.destroy())
      res.on('close', () => stream.destroy())
      stream.pipe(res)
    } else res.writeHead(404).end()
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  try {
    await new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); updater.removeListener('error', failed); updater.removeListener('update-downloaded', done); updater.removeListener('update-not-available', unavailable) }
      const failed = (e) => { cleanup(); reject(e) }
      const done = () => { cleanup(); resolve() }
      const unavailable = () => failed(new Error('原生更新器没有准备好此版本'))
      const timer = setTimeout(() => failed(new Error('原生更新准备超时')), 10 * 60 * 1000)
      updater.once('error', failed)
      updater.once('update-downloaded', done)
      updater.once('update-not-available', unavailable)
      try { updater.setFeedURL({ url: `http://127.0.0.1:${server.address().port}/${token}/feed` }); updater.checkForUpdates() } catch (e) { failed(e) }
    })
  } finally {
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(zip, { force: true })
  }
}

function lockPath(dataDir) { return path.join(dataDir, 'updates', 'installer', 'installing.json') }

// A fast manual reopen during NSIS extraction must not launch a second backend
// or get killed by NSIS's app-running check. Ask the helper to launch on completion.
function deferWindowsLaunch(dataDir, isAlive = (pid) => { try { process.kill(pid, 0); return true } catch (_) { return false } }, onTimeout = () => {}, openPaths = []) {
  const file = lockPath(dataDir)
  try {
    const lock = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!Number.isInteger(lock.helperPid) || !isAlive(lock.helperPid)) return false
    if (Number.isFinite(lock.startedAt) && Date.now() - lock.startedAt > 20 * 60 * 1000) {
      onTimeout() // Do not start a backend while the installer still owns the files.
      return true
    }
    const queueFile = path.join(dataDir, 'restart-open-paths.json')
    const queue = require('../open-paths')
    if (openPaths.length) queue.writeQueuedPaths(queueFile, [...queue.readQueuedPaths(queueFile), ...openPaths])
    fs.writeFileSync(file + '.launch', '')
    return fs.existsSync(file) // The helper may have completed while the marker was being written.
  } catch (_) { return false }
}

// pwsh -> Node -> powershell.exe otherwise inherits incompatible PS7 modules.
// Let Windows PowerShell construct its own default system module search path.
// https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_psmodulepath#starting-windows-powershell-from-powershell-7
function windowsPowerShellEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => key.toUpperCase() !== 'PSMODULEPATH'))
}

function createFullUpdate({ app, autoUpdater, dataDir, platform = process.platform }, command = run) {
  let prepared = null
  return {
    async prepare(file, version) {
      if (platform === 'darwin') {
        await prepareMac(file, version, autoUpdater, command)
      } else if (platform === 'win32') {
        // The signed manifest pins exact bytes; Authenticode adds Windows trust.
        await command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
          `$s=Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}'; if ($s.Status -ne 'Valid') { throw 'Invalid installer signature' }` ], { env: windowsPowerShellEnv() })
      } else throw new Error('此平台不支持完整自动更新')
      const hash = crypto.createHash('sha256')
      for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
      prepared = { file, version, sha256: hash.digest('hex') }
    },
    isReady: () => !!prepared,
    lastError: () => {
      try { return fs.readFileSync(lockPath(dataDir) + '.error', 'utf8').trim() } catch (_) { return null }
    },
    async installOnQuit(restart) {
      if (!prepared) return false
      if (platform === 'darwin') {
        // Normal exit is observed by ShipIt; quitAndInstall additionally relaunches.
        if (restart) {
          // quitAndInstall reports failures asynchronously, after closing windows.
          // The backend is already stopped: release the instance lock by exiting,
          // then reopen through the normal startup path and surface the saved error.
          let failed = false
          const onError = (error) => {
            if (failed) return
            failed = true
            try {
              fs.mkdirSync(path.dirname(lockPath(dataDir)), { recursive: true })
              fs.writeFileSync(lockPath(dataDir) + '.error', String(error?.message || error))
            } finally {
              app.relaunch()
              app.exit(0)
            }
          }
          autoUpdater.on('error', onError)
          try { autoUpdater.quitAndInstall() } catch (error) { onError(error) }
          return true
        }
        return false
      }
      const file = lockPath(dataDir)
      const job = { parentPid: process.pid, installer: prepared.file, executable: process.execPath, sha256: prepared.sha256, restart: !!restart }
      const jobContents = JSON.stringify(job)
      fs.writeFileSync(file + '.job', jobContents)
      fs.rmSync(file + '.launch', { force: true })
      const helper = path.join(path.dirname(file), 'install-update.ps1')
      fs.copyFileSync(path.join(__dirname, 'install-update.ps1'), helper) // PowerShell cannot read app.asar
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
        helper, file], { detached: true, stdio: 'ignore', windowsHide: true, env: windowsPowerShellEnv() })
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
      child.unref()
      // Handshake before exiting: a failed helper must not leave a phantom update.
      for (let n = 0; n < 100; n++) {
        try { if (JSON.parse(fs.readFileSync(file, 'utf8')).helperPid === child.pid) return false } catch (_) { /* starting */ }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      // Do not let a late detached helper install after a successor has started.
      // Windows kill terminates this owned process; wait for confirmed exit before
      // allowing main to exit/relaunch. While we are alive it cannot pass Wait-Process.
      if (child.exitCode === null && child.signalCode === null) {
        child.ref()
        await new Promise((resolve) => { child.once('exit', resolve); child.kill() })
      }
      try {
        if (JSON.parse(fs.readFileSync(file, 'utf8')).helperPid === child.pid) fs.rmSync(file, { force: true })
      } catch (_) { /* no lock from this helper */ }
      try {
        if (fs.readFileSync(file + '.job', 'utf8') === jobContents) fs.rmSync(file + '.job', { force: true })
      } catch (_) { /* job was already consumed or replaced */ }
      throw new Error('更新安装器未能启动')
    }
  }
}

module.exports = { createFullUpdate, prepareMac, deferWindowsLaunch, lockPath, windowsPowerShellEnv }
