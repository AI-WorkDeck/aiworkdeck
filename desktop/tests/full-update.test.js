// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const os = require('os')
const http = require('http')
const crypto = require('crypto')
const { EventEmitter } = require('events')
const { prepareMac, createFullUpdate, deferWindowsLaunch, lockPath, windowsPowerShellEnv } = require('../main/services/full-update')
const { finalize } = require('../scripts/finalize-update-manifest')
function root(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'full-update-')); t.after(() => fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })); return dir }
function get(url) { return new Promise((resolve, reject) => http.get(url, (res) => { const chunks = []; res.on('data', (b) => chunks.push(b)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) })); res.on('error', reject) }).on('error', reject)) }
function commands(calls, version = '0.12.0') {
  return async (cmd, args) => {
    calls.push([cmd, args])
    if (cmd.endsWith('hdiutil') && args[0] === 'attach') fs.mkdirSync(path.join(args.at(-1), 'AI WorkDeck.app'))
    if (cmd.endsWith('plutil')) return { stdout: version }
    if (cmd.endsWith('ditto')) fs.writeFileSync(args.at(-1), 'local ZIP bytes')
    return { stdout: '' }
  }
}

test('Mac：真实回环feed仅发布已准备ZIP，收到原生downloaded后才ready，普通退出不重开', async (t) => {
  const dir = root(t), calls = [], native = new EventEmitter()
  let feed, fetched
  native.setFeedURL = ({ url }) => { feed = url }
  native.checkForUpdates = () => { (async () => {
    assert.equal((await get(new URL('/wrong', feed))).status, 404)
    const data = JSON.parse((await get(feed)).body)
    fetched = (await get(data.url)).body.toString()
    native.emit('update-downloaded')
  })().catch((e) => native.emit('error', e)) }
  let restarts = 0
  native.quitAndInstall = () => restarts++
  fs.writeFileSync(path.join(dir, 'update.dmg'), 'verified synthetic dmg')
  const updater = createFullUpdate({ platform: 'darwin', dataDir: dir, autoUpdater: native }, commands(calls))
  assert.equal(updater.isReady(), false)
  await updater.prepare(path.join(dir, 'update.dmg'), '0.12.0')
  assert.equal(fetched, 'local ZIP bytes')
  assert.equal(updater.isReady(), true)
  assert.ok(calls.some(([cmd, args]) => cmd.endsWith('hdiutil') && args[0] === 'detach'))
  assert.equal(await updater.installOnQuit(false), false)
  assert.equal(restarts, 0)
  assert.equal(await updater.installOnQuit(true), true)
  assert.equal(restarts, 1)
  assert.equal(fs.existsSync(path.join(dir, 'update.zip')), false)
  await assert.rejects(get(feed))
})

test('Mac：原生签名拒绝不ready；版本不符仍卸载DMG且不启动原生检查', async (t) => {
  const dir = root(t), native = new EventEmitter(), calls = []
  native.setFeedURL = () => {}
  native.checkForUpdates = () => native.emit('error', new Error('signature rejected'))
  const updater = createFullUpdate({ platform: 'darwin', dataDir: dir, autoUpdater: native }, commands(calls))
  await assert.rejects(updater.prepare(path.join(dir, 'update.dmg'), '0.12.0'), /signature rejected/)
  assert.equal(updater.isReady(), false)
  const otherCalls = []
  await assert.rejects(prepareMac(path.join(dir, 'update.dmg'), '0.13.0', native, commands(otherCalls)), /版本/)
  assert.ok(otherCalls.some(([cmd, args]) => cmd.endsWith('hdiutil') && args[0] === 'detach'))
  assert.ok(!otherCalls.some(([cmd]) => cmd.endsWith('ditto')))
})

test('Windows：安装期间快开仅登记稍后启动；helper已死/损坏锁不能永久拦截', (t) => {
  const dir = root(t), file = lockPath(dir)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ helperPid: 12345 }))
  assert.equal(deferWindowsLaunch(dir, (pid) => pid === 12345), true)
  assert.ok(fs.existsSync(file + '.launch'))
  assert.equal(deferWindowsLaunch(dir, () => false), false)
  fs.writeFileSync(file, 'broken')
  assert.equal(deferWindowsLaunch(dir), false)
})

test('发布汇总：缺任一平台拒绝，齐套后将真实字节哈希绑定到原签名清单', async (t) => {
  const dir = root(t), { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
  fs.mkdirSync(path.join(dir, 'patch'))
  const file = path.join(dir, 'patch/manifest.json')
  const bytes = Buffer.from(JSON.stringify({ schema: 1, channels: { '0.12': { latest: '0.12.0' } } }))
  fs.writeFileSync(file, bytes)
  fs.writeFileSync(file + '.sig', crypto.sign(null, bytes, privateKey).toString('base64'))
  const key = privateKey.export({ type: 'pkcs8', format: 'pem' })
  fs.writeFileSync(path.join(dir, 'AI WorkDeck-0.12.0-arm64.dmg'), 'synthetic dmg')
  await assert.rejects(finalize(dir, '0.12.0', key), /win32/)
  assert.deepEqual(fs.readFileSync(file), bytes)
  fs.writeFileSync(path.join(dir, 'AI WorkDeck Setup 0.12.0.exe'), 'synthetic exe')
  await finalize(dir, '0.12.0', key)
  assert.ok(crypto.verify(null, fs.readFileSync(file), publicKey, Buffer.from(fs.readFileSync(file + '.sig', 'utf8'), 'base64')))
  const entry = JSON.parse(fs.readFileSync(file)).channels['0.12'].installers.win32
  assert.equal(entry.size, 13)
  assert.equal(entry.sha256, crypto.createHash('sha256').update('synthetic exe').digest('hex'))
  assert.deepEqual(entry.urls, [
    'https://www.aiworkdeck.com/update/desktop/installers/AI.WorkDeck.Setup.0.12.0.exe',
    'https://github.com/AI-WorkDeck/aiworkdeck/releases/download/v0.12.0/AI.WorkDeck.Setup.0.12.0.exe'
  ])
  const mac = JSON.parse(fs.readFileSync(file)).channels['0.12'].installers['darwin-arm64']
  assert.ok(mac.urls.every(url => url.endsWith('/AI.WorkDeck-0.12.0-arm64.dmg')))
})

test('Windows helper：NSIS失败落日志并保留安装包，普通退出不重开', { skip: process.platform !== 'win32' }, () => {
  const result = require('child_process').spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'install-update.test.ps1')], { encoding: 'utf8', env: windowsPowerShellEnv() })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('发布实际接线：先checkout再下载双平台产物，签名汇总在Release之前', () => {
  const yaml = require('js-yaml')
  const workflow = yaml.load(fs.readFileSync(path.join(__dirname, '../../.github/workflows/desktop-build.yml'), 'utf8'))
  const steps = workflow.jobs.release.steps
  const checkout = steps.findIndex((s) => s.uses?.startsWith('actions/checkout'))
  const download = steps.findIndex((s) => s.uses?.startsWith('actions/download-artifact'))
  const finalize = steps.findIndex((s) => s.run?.includes('finalize-update-manifest.js'))
  const release = steps.findIndex((s) => s.uses?.startsWith('softprops/action-gh-release'))
  assert.ok(checkout >= 0 && download > checkout && finalize > download && release > finalize)
  assert.ok(steps[finalize].env.UPDATE_SIGNING_KEY.includes('secrets.UPDATE_SIGNING_KEY'))
})


test('Mac安装提交异步失败：记下错误、重开并退出，不能留下无窗口单实例锁', async (t) => {
  const dir = root(t), native = new EventEmitter(), events = []
  native.setFeedURL = () => {}
  native.checkForUpdates = () => native.emit('update-downloaded')
  native.quitAndInstall = () => setImmediate(() => native.emit('error', new Error('ShipIt permission denied')))
  fs.writeFileSync(path.join(dir, 'update.dmg'), 'verified synthetic dmg')
  const app = { relaunch: () => events.push('relaunch'), exit: code => events.push(`exit:${code}`) }
  const updater = createFullUpdate({ app, platform: 'darwin', dataDir: dir, autoUpdater: native }, commands([]))
  await updater.prepare(path.join(dir, 'update.dmg'), '0.12.0')
  assert.equal(await updater.installOnQuit(true), true)
  assert.deepEqual(events, [])
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(events, ['relaunch', 'exit:0'])
  assert.match(updater.lastError(), /ShipIt permission denied/)
  native.emit('error', new Error('duplicate error'))
  assert.equal(events.length, 2, '同次失败不能重复发起重开')
})

test('Windows安装期间用文件关联快开：下一进程仍收到原文档', t => {
  const dir = root(t), file = lockPath(dir)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ helperPid: 12345 }))
  assert.equal(deferWindowsLaunch(dir, () => true, () => {}, ['C:\\材料\\合同.docx']), true)
  assert.deepEqual(require('../main/open-paths').readQueuedPaths(path.join(dir, 'restart-open-paths.json')), ['C:\\材料\\合同.docx'])
})


test('Windows PowerShell子进程只清除继承的模块搜索路径，保留其他环境且不修改父进程', () => {
  const env = { Path: 'runtime-bin', PSModulePath: 'PS7-modules', psMODULEpath: 'other-PS7-modules', TEMP: 'temp-dir' }
  assert.deepEqual(windowsPowerShellEnv(env), { Path: 'runtime-bin', TEMP: 'temp-dir' })
  assert.equal(env.PSModulePath, 'PS7-modules')
})

test('Windows真实PowerShell：生产环境执行hash与签名命令，并拒绝未签名安装包', { skip: process.platform !== 'win32' }, async t => {
  const dir = root(t)
  const input = path.join(dir, 'unsigned.ps1')
  fs.writeFileSync(input, "Write-Output 'installer integrity fixture'\n")
  // The initial Windows CI run reproduced inherited PS7 module failure.
  // Do not fabricate a negative module manifest: Windows may skip incompatible
  // manifests and resolve its built-in command. Verify the actual shipping path.
  const command = `$ErrorActionPreference='Stop'; $f='${input.replace(/'/g, "''")}'; @{ hash=(Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash; signature=(Get-AuthenticodeSignature -LiteralPath $f).Status.ToString() } | ConvertTo-Json -Compress`
  const { spawnSync } = require('child_process')
  const good = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { env: windowsPowerShellEnv(), encoding: 'utf8' })
  assert.equal(good.status, 0, good.stderr || good.stdout)
  const result = JSON.parse(good.stdout)
  assert.equal(result.hash.toLowerCase(), crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex'))
  assert.equal(result.signature, 'NotSigned')
  // Exercise the shipping Authenticode preflight too: it must reject unsigned
  // bytes for the signature reason, never because the cmdlet could not load.
  const updater = createFullUpdate({ platform: 'win32', dataDir: dir })
  await assert.rejects(updater.prepare(input, '0.12.0'), /Invalid installer signature/)
  assert.equal(updater.isReady(), false)
})


test('Windows helper握手超时必须确认子进程退出，再允许main退出；不删除其他helper的锁或job', async t => {
  const vm = require('node:vm')
  const source = fs.readFileSync(path.join(__dirname, '../main/services/full-update.js'), 'utf8')
  for (const replaced of [false, true]) {
    const dir = root(t), file = lockPath(dir), events = []
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const input = path.join(dir, 'update.exe')
    fs.writeFileSync(input, 'verified fixture')
    let running = true
    const context = vm.createContext({ module: { exports: {} }, __dirname: path.join(__dirname, '../main/services'),
      process: { ...process, kill(pid, signal) {
        assert.equal(pid, 321)
        if (!running) throw new Error('Process exited')
        if (signal === 0) return
        events.push('kill')
        fs.writeFileSync(file, JSON.stringify({ helperPid: replaced ? 999 : pid, jobId: replaced ? 'new-job' : JSON.parse(fs.readFileSync(file + '.job')).id }))
        if (replaced) fs.writeFileSync(file + '.job', 'different helper job')
      } }, Buffer, setTimeout: (resolve, ms) => ms === 60000 ? setTimeout(resolve, ms) : setImmediate(resolve), clearTimeout,
      require(name) {
        if (name === 'child_process') return { ...require(name), spawn() {
          const launcher = new EventEmitter()
          fs.writeFileSync(`${file}.${JSON.parse(fs.readFileSync(file + '.job')).id}.pid`, '321')
          setImmediate(() => launcher.emit('exit', 0))
          return launcher
        } }
        return require(name)
      }
    })
    vm.runInContext(source, context)
    const updater = context.module.exports.createFullUpdate({ platform: 'win32', dataDir: dir }, async () => ({}))
    await updater.prepare(input, '0.12.0')
    let settled = false
    const attempt = updater.installOnQuit(false).then(() => { settled = true }, error => { settled = true; return error })
    while (!events.length) await new Promise(resolve => setImmediate(resolve))
    assert.equal(settled, false, '发kill还不够，必须等exit确认才能交还main')
    running = false
    assert.match((await attempt).message, /更新安装器未能启动/)
    assert.equal(fs.existsSync(file), replaced)
    assert.equal(fs.existsSync(file + '.job'), replaced)
    if (replaced) assert.equal(fs.readFileSync(file + '.job', 'utf8'), 'different helper job')
  }
})

test('Windows helper: slow startup handshakes before parent exits; early failure retains diagnostics', async (t) => {
  const vm = require('node:vm')
  const source = fs.readFileSync(path.join(__dirname, '../main/services/full-update.js'), 'utf8')
  for (const earlyExit of [false, true]) {
    const dir = root(t), file = lockPath(dir)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const installer = path.join(dir, 'update.exe')
    fs.writeFileSync(installer, 'verified fixture')
    let ticks = 0
    const context = vm.createContext({ module: { exports: {} }, __dirname: path.join(__dirname, '../main/services'),
      process: { ...process, kill(pid, signal) {
        assert.equal(pid, 543)
        assert.equal(signal, 0, 'Must not kill a live helper before its slow startup handshake')
        if (earlyExit) throw new Error('Process exited')
      } }, Buffer, clearTimeout,
      setTimeout(resolve, ms) {
        if (ms === 60000) return setTimeout(resolve, ms)
        ticks++
        if (ticks === 150) fs.writeFileSync(file, JSON.stringify({ helperPid: 543, jobId: JSON.parse(fs.readFileSync(file + '.job')).id }))
        return setImmediate(resolve)
      },
      require(name) {
        if (name === 'child_process') return { ...require(name), spawn() {
          const launcher = new EventEmitter()
          fs.writeFileSync(`${file}.${JSON.parse(fs.readFileSync(file + '.job')).id}.pid`, '543')
          if (earlyExit) fs.writeFileSync(file + '.stderr.log', 'helper startup fixture error')
          setImmediate(() => launcher.emit('exit', 0))
          return launcher
        } }
        return require(name)
      }
    })
    vm.runInContext(source, context)
    const updater = context.module.exports.createFullUpdate({ platform: 'win32', dataDir: dir }, async () => ({}))
    await updater.prepare(installer, '0.12.0')
    if (earlyExit) {
      await assert.rejects(updater.installOnQuit(false), /helper startup fixture error/)
      assert.equal(ticks, 0, 'An exited helper must fail without waiting for the timeout')
    } else {
      assert.equal(await updater.installOnQuit(false), false)
      assert.equal(ticks, 150, 'A startup exceeding the old ten-second bound can complete')
      assert.equal(JSON.parse(fs.readFileSync(file)).helperPid, 543)
    }
  }
})


test('Windows真实helper：生产spawn完成握手，父进程退出后继续校验并清理', { skip: process.platform !== 'win32', timeout: 120000 }, async t => {
  const dir = path.join(root(t), "中文 helper's space"), file = lockPath(dir)
  fs.mkdirSync(dir)
  const modulePath = require.resolve('../main/services/full-update')
  const parentSource = `
    const fs = require('fs'), path = require('path')
    const { createFullUpdate, lockPath } = require(process.argv[2])
    const dir = process.argv[1], file = lockPath(dir), installer = path.join(dir, 'unsigned.exe')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(installer, 'unsigned startup fixture; must never execute')
    ;(async () => {
      // Only skip the initial signature preflight; the real helper must reject it after parent exit.
      const updater = createFullUpdate({ platform: 'win32', dataDir: dir }, async () => ({}))
      await updater.prepare(installer, '0.12.0')
      await updater.installOnQuit(false)
      if (!fs.existsSync(file) || fs.existsSync(file + '.error')) throw new Error('Helper did not wait for its live parent')
      process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8'))))
      process.exit(0)
    })().catch(error => { console.error(error); process.exit(1) })
  `
  const child = require('child_process').spawn(process.execPath, ['-e', parentSource, dir, modulePath], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let stdout = '', stderr = ''
  child.stdout.on('data', bytes => { stdout += bytes })
  child.stderr.on('data', bytes => { stderr += bytes })
  const timer = setTimeout(() => child.kill(), 75000)
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) }).finally(() => clearTimeout(timer))
  assert.equal(code, 0, stderr)
  const { helperPid } = JSON.parse(stdout)
  assert.ok(Number.isInteger(helperPid) && helperPid > 0, 'Real helper acknowledged before parent exited')
  const end = Date.now() + 30000
  // The helper removes its lock in finally, before PowerShell exits and releases
  // redirected log handles. File disappearance alone is not process completion.
  for (;;) {
    try { process.kill(helperPid, 0) } catch (error) {
      if (error.code === 'ESRCH') break
      throw error
    }
    assert.ok(Date.now() < end, `Update helper ${helperPid} did not exit within 30 seconds`)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.match(fs.readFileSync(file + '.error', 'utf8'), /Invalid installer signature/, 'Helper continued executing after its parent exited')
  assert.equal(fs.existsSync(file), false)
  assert.equal(fs.existsSync(file + '.job'), false)
})
